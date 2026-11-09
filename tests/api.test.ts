import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../apps/api/app';
import { ReportStore } from '../apps/api/store';
import { csvTemplate } from '../packages/core/src/import';
import type { Report } from '../packages/core/src/model';

test('API end-to-end: demo, import, persistence, invalid input, origin checks and honest degradation', async t => {
  const previous = { key: process.env.AI_API_KEY, live: process.env.LIVE_DATA_URL, authorized: process.env.LIVE_DATA_AUTHORIZED };
  delete process.env.AI_API_KEY; delete process.env.LIVE_DATA_URL; delete process.env.LIVE_DATA_AUTHORIZED;
  const store = new ReportStore(':memory:'); const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown, extra?: Record<string, string>) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  try {
    await t.test('health identifies unconfigured services without secrets', async () => {
      const health = await (await fetch(base + '/api/health')).json(); assert.equal(health.ok, true); assert.equal(health.ai, false); assert.equal(health.liveConfigured, false); assert.equal(health.liveVerified, false);
    });
    await t.test('demo is complete and explicitly synthetic', async () => {
      const response = await fetch(base + '/api/demo'); assert.equal(response.status, 200); const r = await response.json() as Report;
      assert.equal(r.dataset.mode, 'demo'); assert.equal(r.analysis.count, 108); assert.ok(r.analysis.highlights.length); assert.equal(r.ai, null);
    });
    let id = '';
    await t.test('CSV import generates report, persists it and lists history', async () => {
      const response = await post('/api/import', { format: 'csv', content: csvTemplate, creatorName: 'API 测试' }); assert.equal(response.status, 201);
      const r = await response.json() as Report; id = r.id; assert.equal(r.analysis.count, 2); assert.equal(r.dataset.videos[1].likes, null); assert.equal(r.analysis.highlights.length, 0);
      const loaded = await (await fetch(base + '/api/reports/' + id)).json() as Report; assert.equal(loaded.dataset.creator.name, 'API 测试');
      const history = await (await fetch(base + '/api/history')).json(); assert.equal(history[0].id, id);
    });
    await t.test('report lookup and parameter validation are explicit', async () => {
      assert.equal((await fetch(base + '/api/reports/missing')).status, 404);
      assert.equal((await post('/api/import', { content: 'bad', format: 'xml' })).status, 400);
      assert.equal((await post('/api/import', { content: '{', format: 'json' })).status, 400);
      assert.equal((await post('/api/research', { url: 'https://evil.test/123' })).status, 400);
    });
    await t.test('live mode never substitutes demo when unavailable', async () => {
      const response = await post('/api/research', { url: 'https://space.bilibili.com/2' }); assert.equal(response.status, 503);
      const body = await response.json(); assert.equal(body.creator.id, '2'); assert.ok(!body.dataset); assert.match(body.error, /未配置/);
    });
    await t.test('missing AI configuration leaves imported report usable', async () => {
      const response = await post(`/api/reports/${id}/ai`, {}); assert.equal(response.status, 400); assert.match((await response.json()).error, /尚未配置/);
      assert.equal((await (await fetch(base + '/api/reports/' + id)).json()).ai, null);
    });
    await t.test('external origin is rejected and SQL-shaped ID is data', async () => {
      assert.equal((await post('/api/import', { content: csvTemplate, format: 'csv' }, { Origin: 'https://evil.test' })).status, 403);
      assert.equal((await fetch(base + '/api/reports/' + encodeURIComponent("' OR 1=1 --"))).status, 404);
    });
    await t.test('templates download without credentials', async () => {
      assert.match(await (await fetch(base + '/api/template.csv')).text(), /collectedAt/);
      assert.equal((await (await fetch(base + '/api/template.json')).json()).mode, 'demo');
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); store.close();
    for (const [name, value] of [['AI_API_KEY', previous.key], ['LIVE_DATA_URL', previous.live], ['LIVE_DATA_AUTHORIZED', previous.authorized]]) if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
  }
});
