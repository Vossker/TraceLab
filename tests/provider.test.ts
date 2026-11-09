import test from 'node:test';
import assert from 'node:assert/strict';
import { BilibiliAdapter, collectLive } from '../apps/api/providers';
import { createDemo } from '../packages/core/src/demo';

test('authorized adapter validates capabilities, schemas, creator identity and comment degradation', async t => {
  const oldUrl = process.env.LIVE_DATA_URL, oldAuthorized = process.env.LIVE_DATA_AUTHORIZED;
  process.env.LIVE_DATA_URL = 'https://authorized.example.invalid'; process.env.LIVE_DATA_AUTHORIZED = 'true';
  const d = createDemo(); const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    const path = new URL(url).pathname; paths.push(path);
    if (path === '/capabilities') return Response.json({ platform: 'bilibili', authorized: true, capabilities: ['creator', 'videos'] });
    if (path === '/creators/42') return Response.json({ ...d.creator, id: '42' });
    if (path === '/creators/42/videos') return Response.json({ videos: d.videos, total: 108, collectedAt: d.collectedAt, coverage: '测试网关的合成数据' });
    return new Response('not available', { status: 403 });
  });
  try {
    const progress: number[] = []; const result = await collectLive('42', value => progress.push(value));
    assert.equal(result.creator.id, '42'); assert.equal(result.videos.length, 108); assert.equal(result.comments.length, 0); assert.match(result.warnings[0], /评论/);
    assert.deepEqual(progress, [10, 25, 45, 65]); assert.equal(paths[0], '/capabilities');
  } finally { if (oldUrl === undefined) delete process.env.LIVE_DATA_URL; else process.env.LIVE_DATA_URL = oldUrl; if (oldAuthorized === undefined) delete process.env.LIVE_DATA_AUTHORIZED; else process.env.LIVE_DATA_AUTHORIZED = oldAuthorized; }
});
test('adapter makes no network request without authorization attestation', async t => {
  const old = process.env.LIVE_DATA_AUTHORIZED; delete process.env.LIVE_DATA_AUTHORIZED;
  const spy = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not call'); });
  try { await assert.rejects(() => new BilibiliAdapter().verify(), /尚未配置/); assert.equal(spy.mock.callCount(), 0); }
  finally { if (old !== undefined) process.env.LIVE_DATA_AUTHORIZED = old; }
});
