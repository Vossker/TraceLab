import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../packages/core/src/demo';
import { analyze } from '../packages/core/src/analysis';
import { reportSections } from '../packages/core/src/report';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { enhanceReport, validateAI } from '../apps/api/ai';
import { createApp } from '../apps/api/app';
import { ReportStore } from '../apps/api/store';
import { csvTemplate } from '../packages/core/src/import';
import type { AIReport, Report } from '../packages/core/src/model';

const d = createDemo(); const report: Report = { id: 'test', createdAt: d.collectedAt, dataset: d, analysis: analyze(d), ai: null, aiModel: null };
const valid = (): AIReport => ({ headline: '以证据观察创作变化', sections: reportSections(report).map(s => ({ ...s, title: s.title as AIReport['sections'][number]['title'] })), classifications: d.videos.map(v => ({ videoId: v.id, topic: '新的统一主题', reason: '根据输入的标题与描述' })), commentClusters: [{ label: '记录过程', commentIds: [d.comments[0].id], sentiment: 'positive' }], uncertainties: ['样本不能建立因果关系'] });

test('AI schema rejects fabricated video evidence and comment evidence', () => {
  assert.doesNotThrow(() => validateAI(valid(), report));
  const fakeVideo = valid(); fakeVideo.sections[0].evidenceIds = ['invented']; assert.throws(() => validateAI(fakeVideo, report), /不存在/);
  const fakeComment = valid(); fakeComment.commentClusters[0].commentIds = ['invented']; assert.throws(() => validateAI(fakeComment, report), /不存在/);
});
test('AI schema rejects missing sections, duplicates and oversized content', () => {
  const missing = valid(); missing.sections.pop(); assert.throws(() => validateAI(missing, report));
  const duplicate = valid(); duplicate.sections[1].title = duplicate.sections[0].title; assert.throws(() => validateAI(duplicate, report));
  const long = valid(); long.sections[0].text = 'x'.repeat(1601); assert.throws(() => validateAI(long, report));
  const duplicatedVideo = valid(); duplicatedVideo.classifications.push(duplicatedVideo.classifications[0]); assert.throws(() => validateAI(duplicatedVideo, report), /重复/);
});
test('LLM unavailable fails explicitly, preserving original report', async () => {
  const previous = process.env.AI_API_KEY; delete process.env.AI_API_KEY;
  try { await assert.rejects(() => enhanceReport(report), /尚未配置/); assert.equal(report.ai, null); }
  finally { if (previous === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previous; }
});
test('two-pass AI recomputes statistics before narrative; never exposes API key in report', async t => {
  const previous = { key: process.env.AI_API_KEY, model: process.env.AI_MODEL, base: process.env.AI_BASE_URL };
  process.env.AI_API_KEY = 'local-test-only-key'; process.env.AI_MODEL = 'mock-model'; process.env.AI_BASE_URL = 'https://example.invalid/v1';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++; const payload = JSON.parse(String(init.body)); const input = JSON.parse(payload.messages[1].content);
    assert.equal(payload.response_format.type, 'json_schema'); assert.equal(payload.response_format.json_schema.strict, true);
    assert.ok(!JSON.stringify(input).includes('local-test-only-key'));
    let output;
    if (calls === 1) output = { classifications: valid().classifications, commentClusters: valid().commentClusters };
    else {
      assert.equal(input.statistics.topics.length, 1); assert.equal(input.statistics.topics[0].name, '新的统一主题'); assert.equal(input.statistics.topics[0].count, 108);
      assert.equal(input.videos[0].topic, '新的统一主题'); assert.equal(input.videos[0].likes, d.videos.find(v => v.id === input.videos[0].id)!.likes); assert.ok('relativeToPeers' in input.videos[0]);
      assert.equal(input.limitations, undefined); assert.equal(input.statistics.insights, undefined);
      assert.match(payload.messages[0].content, /可执行的建议/); assert.match(payload.messages[0].content, /必须来自输入/);
      output = { headline: valid().headline, sections: valid().sections, uncertainties: valid().uncertainties };
    }
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }), { status: 200 });
  });
  try {
    const enhanced = await enhanceReport(report); assert.equal(calls, 2); assert.equal(enhanced.analysis.topics.length, 1); assert.equal(enhanced.dataset.videos[0].topicSource, 'llm'); assert.equal(enhanced.aiModel, 'mock-model');
    assert.equal(report.analysis.topics.length, 4); assert.equal(report.ai, null); assert.ok(!JSON.stringify(enhanced).includes('local-test-only-key'));
  } finally {
    for (const [name, value] of [['AI_API_KEY', previous.key], ['AI_MODEL', previous.model], ['AI_BASE_URL', previous.base]]) if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
  }
});
const withAIEnv = async (values: Record<string, string>, run: () => Promise<void>) => {
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  Object.assign(process.env, values);
  try { await run(); } finally { for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value; }
};
const sse = (parts: Uint8Array[]) => new Response(new ReadableStream({ start(controller) { parts.forEach(part => controller.enqueue(part)); controller.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
const sseChunks = (content: string, finish: string) => [
  ': keep-alive\n\n', `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '思考不进入输出' } }] })}\n\n`,
  ...[content.slice(0, 40), content.slice(40)].map(text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`),
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`, 'data: [DONE]\n\n',
].join('');
test('streamed completion survives splits inside lines and multibyte characters; reports progress', async t => {
  let calls = 0; const messages: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++; assert.equal(JSON.parse(String(init.body)).stream, true); assert.ok(init.signal);
    const output = calls === 1 ? { classifications: valid().classifications, commentClusters: valid().commentClusters } : { headline: valid().headline, sections: valid().sections, uncertainties: valid().uncertainties };
    const bytes = new TextEncoder().encode(sseChunks(JSON.stringify(output), 'stop'));
    return sse(Array.from({ length: Math.ceil(bytes.length / 7) }, (_, i) => bytes.slice(i * 7, (i + 1) * 7)));
  });
  await withAIEnv({ AI_API_KEY: 'test', AI_MODEL: 'stream-model', AI_BASE_URL: 'https://example.invalid/v1' }, async () => {
    const enhanced = await enhanceReport(report, (_value, message) => messages.push(message));
    assert.equal(calls, 2); assert.equal(enhanced.aiModel, 'stream-model'); assert.equal(enhanced.analysis.topics[0].name, '新的统一主题'); assert.equal(messages.length, 2); assert.match(messages[1], /第 2\/2 步/);
  });
});
test('a stream ending without finish_reason stop is rejected', async t => {
  t.mock.method(globalThis, 'fetch', async () => sse([new TextEncoder().encode(sseChunks('{"classifications":[],"commentClusters":[]}', 'length'))]));
  await withAIEnv({ AI_API_KEY: 'test', AI_MODEL: 'test', AI_BASE_URL: 'https://example.invalid/v1' }, async () => { await assert.rejects(() => enhanceReport(report), /未返回完整/); });
});
test('timeouts and broken connections give actionable errors without changing the report', async t => {
  const failure = t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('aborted', 'TimeoutError'); });
  await withAIEnv({ AI_API_KEY: 'test', AI_MODEL: 'test', AI_BASE_URL: 'https://example.invalid/v1', AI_TIMEOUT_MS: '120000' }, async () => {
    await assert.rejects(() => enhanceReport(report), /120 秒内没有完成.*AI_TIMEOUT_MS/);
    failure.mock.mockImplementation(async () => { throw new TypeError('fetch failed'); });
    await assert.rejects(() => enhanceReport(report), /连接失败或中断/);
    assert.equal(report.ai, null);
  });
});
test('AI runs as a background job over real local HTTP with one lock per report', async () => {
  const llmCalls: { release: () => void }[] = []; let failNext = false;
  const llm = createServer((req, res) => {
    let raw = ''; req.on('data', part => { raw += part; }); req.on('end', () => {
      const body = JSON.parse(raw) as { messages: { content: string }[]; response_format: { json_schema: { schema: { required: string[] } } } };
      assert.ok(req.headers.authorization?.includes('http-test-key'));
      if (failNext) { res.statusCode = 503; return void res.end('provider detail must stay private'); }
      const ids = (JSON.parse(body.messages[1].content) as { videos: { id: string }[] }).videos.map(v => v.id);
      const isPassOne = body.response_format.json_schema.schema.required.includes('classifications');
      const output = isPassOne ? { classifications: ids.map(videoId => ({ videoId, topic: '本地测试主题', reason: '依据标题' })), commentClusters: [] }
        : { headline: '测试标题', sections: ['创作者概览', '创作轨迹', '关键转折', '内容特点', '分析结论'].map(title => ({ title, text: '测试内容', kind: 'fact', evidenceIds: [ids[0]] })), uncertainties: ['需要人工复核'] };
      const send = () => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(sseChunks(JSON.stringify(output), 'stop')); };
      if (isPassOne) llmCalls.push({ release: send }); else send();
    });
  });
  llm.listen(0, '127.0.0.1'); await once(llm, 'listening'); const llmAddress = llm.address(); assert.ok(llmAddress && typeof llmAddress !== 'string');
  const store = new ReportStore(':memory:'), server = createApp(store).listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const until = async (id: string, status: string[]) => { for (let i = 0; i < 300; i++) { const job = await (await fetch(`${base}/api/jobs/${id}`)).json() as { status: string; message: string; reportId?: string }; if (status.includes(job.status)) return job; await new Promise(r => setTimeout(r, 10)); } throw new Error('job did not finish'); };
  try {
    await withAIEnv({ AI_API_KEY: 'http-test-key', AI_MODEL: 'local-model', AI_BASE_URL: `http://127.0.0.1:${llmAddress.port}/v1` }, async () => {
      const imported = await (await post('/api/import', { content: csvTemplate, format: 'csv' })).json() as Report;
      const started = await post(`/api/reports/${imported.id}/ai`); assert.equal(started.status, 202); const job = await started.json() as { id: string };
      assert.equal((await post(`/api/reports/${imported.id}/ai`)).status, 409);
      for (let i = 0; i < 300 && !llmCalls.length; i++) await new Promise(r => setTimeout(r, 10));
      assert.match((await until(job.id, ['running'])).message, /第 1\/2 步/); assert.equal((await (await fetch(`${base}/api/reports/${imported.id}`)).json() as Report).ai, null);
      llmCalls[0].release();
      const done = await until(job.id, ['complete', 'error']); assert.equal(done.status, 'complete', done.message); assert.equal(done.reportId, imported.id);
      const saved = await (await fetch(`${base}/api/reports/${imported.id}`)).json() as Report; assert.equal(saved.aiModel, 'local-model'); assert.equal(saved.analysis.topics[0].name, '本地测试主题');
      failNext = true;
      const failing = await (await post(`/api/reports/${imported.id}/ai`)).json() as { id: string };
      const failed = await until(failing.id, ['complete', 'error']); assert.equal(failed.status, 'error'); assert.match(failed.message, /HTTP 503/); assert.doesNotMatch(failed.message, /private/);
      assert.equal((await (await fetch(`${base}/api/reports/${imported.id}`)).json() as Report).aiModel, 'local-model');
      assert.equal((await post(`/api/reports/${imported.id}/ai`)).status, 202);
    });
  } finally { server.closeAllConnections(); llm.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await new Promise<void>(r => llm.close(() => r())); store.close(); }
});
test('LLM transport failure does not mutate deterministic analysis', async t => {
  const previous = { key: process.env.AI_API_KEY, model: process.env.AI_MODEL };
  process.env.AI_API_KEY = 'test'; process.env.AI_MODEL = 'test';
  t.mock.method(globalThis, 'fetch', async () => new Response('private provider response must never be relayed', { status: 429 }));
  try { await assert.rejects(() => enhanceReport(report), /HTTP 429/); assert.equal(report.ai, null); }
  finally { if (previous.key === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previous.key; if (previous.model === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = previous.model; }
});
