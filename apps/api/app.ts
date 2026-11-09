import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import { createDemo } from '../../packages/core/src/demo';
import { analyze } from '../../packages/core/src/analysis';
import { importDataset, csvTemplate } from '../../packages/core/src/import';
import { parseCreatorUrl, type Dataset, type Report } from '../../packages/core/src/model';
import { ReportStore } from './store';
import { collectLive } from './providers';
import { enhanceReport, requireAIConfig } from './ai';
import { liveConfigured, liveStatus, gatewayRequest } from './live';
import { PublicBilibiliProvider } from './public-bilibili';

type Job = { id: string; status: 'running' | 'complete' | 'error'; progress: number; message: string; reportId?: string; updatedAt: number; ai?: boolean };
export function createApp(store = new ReportStore(), publicProvider = new PublicBilibiliProvider()) {
  const app = express(); const jobs = new Map<string, Job>(); const aiLocks = new Set<string>();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store');
      const host = req.hostname;
      if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) return res.status(403).json({ error: '本地 API 仅允许 localhost 访问' });
      const origin = req.headers.origin;
      if (origin && ![`http://127.0.0.1:${process.env.PORT || 3001}`, `http://localhost:${process.env.PORT || 3001}`, 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin)) return res.status(403).json({ error: '不允许的请求来源' });
    }
    next();
  });
  app.use(express.json({ limit: '5mb' }));
  const makeReport = (dataset: Dataset, id: string = randomUUID()): Report => ({ id, createdAt: new Date().toISOString(), dataset, analysis: analyze(dataset), ai: null, aiModel: null });
  const demo = makeReport(createDemo(), 'demo');
  app.get('/api/health', async (_req, res) => {
    const live = await liveStatus();
    res.json({ ok: true, ai: Boolean(process.env.AI_API_KEY && process.env.AI_MODEL), liveConfigured: liveConfigured(), liveVerified: live.verified, live, publicData: publicProvider.status(), version: '1.2.0' });
  });
  app.post('/api/live/authorize', async (req, res) => {
    const binding = randomBytes(32).toString('hex');
    const returnTo = req.headers.origin || `http://127.0.0.1:${process.env.PORT || 3001}`;
    const result = z.object({ url: z.string().url() }).parse(await gatewayRequest('/oauth/start', { method: 'POST', body: JSON.stringify({ binding, returnTo }) }, 15000));
    const target = new URL(result.url);
    if (target.protocol !== 'https:' || target.hostname !== 'account.bilibili.com') throw new Error('数据网关返回了非官方授权地址');
    res.cookie('tracelab_oauth', binding, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/api/live/callback', maxAge: 600_000 });
    res.json(result);
  });
  app.get('/api/live/callback', async (req, res) => {
    res.clearCookie('tracelab_oauth', { path: '/api/live/callback' });
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const { code, state } = z.object({ code: z.string().min(1).max(2000), state: z.string().regex(/^[a-f0-9]{64}$/) }).parse(req.query);
      const binding = /(?:^|;\s*)tracelab_oauth=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      if (!binding) throw new Error('缺少授权会话 Cookie，请从同一浏览器重新发起授权');
      const result = z.object({ returnTo: z.string().url() }).parse(await gatewayRequest('/oauth/exchange', { method: 'POST', body: JSON.stringify({ state, binding, code }) }, 30000));
      const allowed = [`http://127.0.0.1:${process.env.PORT || 3001}`, `http://localhost:${process.env.PORT || 3001}`, 'http://127.0.0.1:5173', 'http://localhost:5173'];
      if (!allowed.includes(result.returnTo)) throw new Error('授权返回地址不在本机白名单内');
      res.redirect(303, result.returnTo + '/?live=connected');
    } catch (error) {
      const message = error instanceof ZodError ? '授权未完成或回调参数无效，请重新开始' : error instanceof Error ? error.message : '授权失败';
      const escaped = message.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
      res.status(400).type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CreatorTrace 授权结果</title><body><h1>授权未完成</h1><p>${escaped}</p><a href="/">返回 CreatorTrace</a><p>开发模式可返回 http://127.0.0.1:5173 重新开始。</p></body></html>`);
    }
  });
  app.delete('/api/live/authorization', async (_req, res) => { await gatewayRequest('/oauth/grant', { method: 'DELETE' }, 5000); res.json({ ok: true }); });
  app.get('/api/demo', (_req, res) => res.json(demo));
  app.get('/api/history', (_req, res) => res.json(store.list()));
  app.get('/api/template.csv', (_req, res) => res.type('text/csv').attachment('tracelab-template.csv').send('\uFEFF' + csvTemplate));
  app.get('/api/template.json', (_req, res) => res.attachment('tracelab-demo.json').json(demo.dataset));
  app.get('/api/reports/:id', (req, res) => { const report = req.params.id === 'demo' ? demo : store.get(req.params.id); if (!report) return res.status(404).json({ error: '报告不存在或已不在本机；可重新导入 JSON' }); res.json(report); });
  app.post('/api/import', (req, res) => {
    const input = z.object({ content: z.string().max(4_000_000), format: z.enum(['csv', 'json']), creatorName: z.string().max(120).optional() }).parse(req.body);
    const report = makeReport(importDataset(input.content, input.format, input.creatorName));
    store.save(report); res.status(201).json(report);
  });
  app.post('/api/research', (req, res) => {
    const input = z.union([z.object({ url: z.string().max(500), source: z.enum(['public', 'gateway']).default('gateway') }), z.object({ account: z.literal('self') })]).parse(req.body);
    const creator = 'url' in input ? parseCreatorUrl(input.url) : { id: 'self', url: null };
    const usePublic = 'source' in input && input.source === 'public';
    if (usePublic && !publicProvider.status().enabled) return res.status(503).json({ error: '管理员已关闭网站公开接口读取', creator });
    if (!usePublic && !liveConfigured()) return res.status(503).json({ error: 'Live Mode 未配置数据网关。请运行 npm run setup:live 并重启服务，或使用演示 / 导入。', creator });
    for (const [key, job] of jobs) if (Date.now() - job.updatedAt > 3_600_000) jobs.delete(key);
    if ([...jobs.values()].filter(j => j.status === 'running' && !j.ai).length >= 2) return res.status(429).json({ error: '已有两个采集任务进行中，请稍后重试' });
    const job: Job = { id: randomUUID(), status: 'running', progress: 0, message: '准备分析', updatedAt: Date.now() }; jobs.set(job.id, job);
    res.status(202).json(job);
    void (async () => {
      try {
        const progress = (progress: number, message: string) => { Object.assign(job, { progress, message, updatedAt: Date.now() }); };
        const dataset = usePublic ? await publicProvider.collect(creator.id, progress) : await collectLive(creator.id, progress);
        Object.assign(job, { progress: 85, message: '计算统计与生成证据报告' });
        const report = makeReport(dataset); store.save(report);
        Object.assign(job, { status: 'complete', progress: 100, message: '研究完成', reportId: report.id, updatedAt: Date.now() });
      } catch (e) { Object.assign(job, { status: 'error', message: e instanceof ZodError ? '数据源返回的数据未通过校验' : e instanceof Error ? e.message : '数据获取失败', updatedAt: Date.now() }); }
    })();
  });
  app.get('/api/jobs/:id', (req, res) => { const job = jobs.get(req.params.id); if (!job) return res.status(404).json({ error: '任务不存在，服务可能已重启' }); res.json(job); });
  app.post('/api/reports/:id/ai', (req, res) => {
    const reportId = req.params.id;
    const report = reportId === 'demo' ? demo : store.get(reportId);
    if (!report) return res.status(404).json({ error: '报告不存在' });
    requireAIConfig();
    if (aiLocks.has(reportId)) return res.status(409).json({ error: '该报告正在分析，请等待完成' });
    if (aiLocks.size >= 2) return res.status(429).json({ error: 'AI 分析繁忙，请稍后重试' });
    aiLocks.add(reportId);
    const job: Job = { id: randomUUID(), status: 'running', progress: 0, message: '准备 AI 分析', updatedAt: Date.now(), ai: true }; jobs.set(job.id, job);
    res.status(202).json(job);
    void (async () => {
      try {
        const enhanced = await enhanceReport(report, (progress, message) => { Object.assign(job, { progress, message, updatedAt: Date.now() }); });
        if (enhanced.id === 'demo') { enhanced.id = randomUUID(); enhanced.createdAt = new Date().toISOString(); }
        store.save(enhanced);
        Object.assign(job, { status: 'complete', progress: 100, message: 'AI 解读已生成', reportId: enhanced.id, updatedAt: Date.now() });
      } catch (e) {
        const message = e instanceof ZodError ? `LLM 输出未通过校验，已保留基础报告：${e.issues[0]?.path.join('.')} ${e.issues[0]?.message}` : e instanceof SyntaxError ? 'LLM 输出不是有效的 JSON，已保留基础报告' : e instanceof Error ? e.message : 'AI 分析失败，已保留基础报告';
        Object.assign(job, { status: 'error', message, updatedAt: Date.now() });
      } finally { aiLocks.delete(reportId); }
    })();
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API 不存在' }));
  const web = resolve('dist/web');
  if (existsSync(web)) { app.use(express.static(web)); app.get('/{*path}', (_req, res) => res.sendFile(resolve(web, 'index.html'))); }
  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) return void res.status(400).json({ error: err.issues.slice(0, 4).map(i => `${i.path.join('.')}：${i.message}`).join('；') });
    if (err?.type === 'entity.too.large') return void res.status(413).json({ error: '请求过大，请将文件控制在 4 MB 以内' });
    if (err instanceof SyntaxError) return void res.status(400).json({ error: '数据格式无效，请检查 JSON 文件或模型输出' });
    res.status(400).json({ error: err instanceof Error ? err.message : '请求失败，请重试' });
  };
  app.use(errors); return app;
}
