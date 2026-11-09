import express, { type ErrorRequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { gatewayConfig, type GatewayConfig } from './config';
import { GatewayError, OfficialClient } from './official';
import { EncryptedVault } from './vault';
import { GatewayService } from './service';

export function createGateway(config: GatewayConfig = gatewayConfig(), service = new GatewayService(config, new OfficialClient(config), new EncryptedVault(config.tokenFile, config.key))) {
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname) || req.headers.origin) return res.status(403).json({ error: '网关仅供本机服务端调用，不接受浏览器直连', code: 'LOCAL_ONLY' });
    const got = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${config.key}`);
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return res.status(401).json({ error: '网关密钥无效', code: 'INVALID_GATEWAY_KEY' });
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get('/capabilities', (_req, res) => res.json(service.status()));
  app.get('/creators/:id', async (req, res) => res.json(await service.creator(req.params.id)));
  app.get('/creators/:id/videos', async (req, res) => res.json(await service.videos(req.params.id)));
  app.get('/creators/:id/comments', (_req, res) => res.status(501).json({ error: '官方网关未接入评论正文；不使用其他接口回退', code: 'COMMENTS_UNSUPPORTED' }));
  app.get('/videos/:id', async (req, res) => res.json(await service.video(req.params.id)));
  app.post('/oauth/start', (req, res) => {
    const body = z.object({ binding: z.string().regex(/^[a-f0-9]{64}$/), returnTo: z.string().url().max(300) }).parse(req.body);
    res.json(service.start(body.binding, body.returnTo));
  });
  app.post('/oauth/exchange', async (req, res) => {
    const body = z.object({ state: z.string().regex(/^[a-f0-9]{64}$/), binding: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().min(1).max(2000) }).parse(req.body);
    res.json(await service.exchange(body.state, body.binding, body.code));
  });
  app.delete('/oauth/grant', (_req, res) => { service.disconnect(); res.json({ ok: true }); });
  app.use((_req, res) => res.status(404).json({ error: '网关路径不存在', code: 'NOT_FOUND' }));
  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof GatewayError) return void res.status(err.status).json({ error: err.message, code: err.code });
    if (err instanceof z.ZodError || err instanceof SyntaxError) return void res.status(400).json({ error: '请求参数或数据结构无效', code: 'INVALID_INPUT' });
    res.status(500).json({ error: '网关内部错误；未返回敏感请求内容', code: 'INTERNAL_ERROR' });
  };
  app.use(errors); return app;
}
