import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PublicBilibiliProvider } from '../apps/api/public-bilibili';
import { createApp } from '../apps/api/app';
import { ReportStore } from '../apps/api/store';
import { analyze } from '../packages/core/src/analysis';
import { bilibiliZones } from '../packages/core/src/bilibili-zones';
const ok = (data: unknown) => Response.json({ code: 0, data });
const row = (i: number) => ({ bvid: `BV1${String(i).padStart(9, '0')}`, title: `合成测试作品 ${i}`, pubdate: 1735689600 + i * 86400, state: 0, duration: 120, stat: { view: 500 } });
const profile = { card: { mid: '42', name: '公开协议测试（模拟）', sign: '测试数据', face: '' }, follower: 0 };
function mock(handler: (u: URL) => Response): typeof fetch { return async (url, init) => { assert.equal(new URL(String(url)).hostname, 'api.bilibili.com'); assert.equal(init?.redirect, 'error'); assert.ok(!('Cookie' in (init?.headers || {}))); return handler(new URL(String(url))); }; }
const happy = (u: URL) => u.pathname.endsWith('/card') ? ok(profile) : u.pathname.includes('recArchives') ? ok({ archives: [row(1), row(2)], page: { total: 2 } }) : ok({ bvid: u.searchParams.get('bvid'), owner: { mid: 42 }, stat: { view: 0, like: 0, coin: 2, favorite: 3, reply: 4, share: 5 }, desc: '测试简介' });

test('public data normalization, UID identity, true zero, provenance and isolated cached copies', async () => {
  let calls = 0; const provider = new PublicBilibiliProvider(mock(u => { calls++; return happy(u); }), 0);
  const [a,b] = await Promise.all([provider.collect('42'), provider.collect('42')]);
  assert.equal(calls, 4); assert.equal(a.creator.id, '42'); assert.equal(a.creator.followers, 0); assert.equal(a.videos[0].views, 0);
  assert.match(a.source, /非开放平台/); assert.equal(a.mode, 'live'); assert.equal(a.videos[0].duration, 120); assert.equal(a.comments.length, 0);
  a.videos[0].title = 'mutated'; assert.notEqual(b.videos[0].title, a.videos[0].title);
  const c = await provider.collect('42'); assert.equal(c.collectedAt, b.collectedAt); assert.equal(calls, 4);
});
test('HTTP 412 stops all subsequent requests and never substitutes another endpoint', async () => {
  const paths: string[] = []; const p = new PublicBilibiliProvider(mock(u => { paths.push(u.pathname); return u.pathname.endsWith('/card') ? ok(profile) : new Response('', { status: 412 }); }), 0);
  await assert.rejects(() => p.collect('42'), /412/); assert.equal(paths.length, 2); assert.equal(p.status().state, 'restricted');
  await assert.rejects(() => p.collect('43'), /暂停/); assert.equal(paths.length, 2);
});
test('a restriction starts a one-minute cooldown', async () => {
  const before = Date.now(); const p = new PublicBilibiliProvider(mock(() => new Response('', { status: 412 })), 0);
  await assert.rejects(() => p.collect('42'), /冷却 1 分钟/);
  const remaining = Date.parse(p.status().retryAfter!) - before; assert.ok(remaining >= 60_000 && remaining < 65_000);
  await assert.rejects(() => p.collect('42'), /暂停请求 1 分钟/);
});
test('verification challenge and API restrictions are not considered successful data', async () => {
  for (const response of [ok({ v_voucher: 'fake-challenge' }), Response.json({ code: -352 }), Response.json({ code: -101 })]) {
    const p = new PublicBilibiliProvider(mock(() => response), 0);
    await assert.rejects(() => p.collect('42'), /验证|登录/); assert.equal(p.status().state, 'restricted');
  }
});
test('missing statistics remain null, failed details preserve list observations with explicit warning', async () => {
  let calls = 0;
  const p = new PublicBilibiliProvider(mock(u => { calls++; return u.pathname.endsWith('/view') ? new Response('', { status: 429 }) : happy(u); }), 0);
  const data = await p.collect('42'); assert.equal(calls, 3); assert.equal(data.videos[0].views, 500); assert.equal(data.videos[0].likes, null); assert.match(data.warnings.join(' '), /429/);
});
test('wrong profile or video ownership cannot become a report about the requested UID', async () => {
  const wrongProfile = new PublicBilibiliProvider(mock(() => ok({ card: { ...profile.card, mid: '43' } })), 0);
  await assert.rejects(() => wrongProfile.collect('42'), /UID/);
  const wrongVideo = new PublicBilibiliProvider(mock(u => u.pathname.endsWith('/view') ? ok({ bvid: u.searchParams.get('bvid'), owner: { mid: 43 }, stat: {} }) : happy(u)), 0);
  await assert.rejects(() => wrongVideo.collect('42'), /归属/);
});
test('pagination deduplicates and partial page failure never continues to detail endpoint', async () => {
  const paths: string[] = [];
  const p = new PublicBilibiliProvider(mock(u => {
    paths.push(u.pathname);
    if (u.pathname.endsWith('/card')) return ok(profile);
    if (u.searchParams.get('pn') === '2') return new Response('', { status: 412 });
    return ok({ archives: [row(1), row(1), ...Array.from({ length: 28 }, (_, i) => row(i + 2))], page: { total: 100 } });
  }), 0, 60);
  const data = await p.collect('42'); assert.equal(data.videos.length, 29); assert.equal(paths.length, 3); assert.match(data.warnings.join(' '), /分页提前停止/);
});
test('mixed-owner list removes mismatched works while retaining verified creator evidence', async () => {
  const p = new PublicBilibiliProvider(mock(u => u.pathname.endsWith('/view') && u.searchParams.get('bvid') === row(2).bvid ? ok({ bvid: row(2).bvid, owner: { mid: 43 }, stat: { view: 999 } }) : happy(u)), 0);
  const d = await p.collect('42'); assert.equal(d.videos.length, 1); assert.equal(d.videos[0].id, row(1).bvid); assert.match(d.warnings.join(' '), /排除 1 条/);
});
test('private, future-dated and invalid rows are excluded; no fabricated empty report', async () => {
  const p = new PublicBilibiliProvider(mock(u => u.pathname.endsWith('/card') ? ok(profile) : ok({ archives: [{ ...row(1), state: -4 }, { ...row(2), pubdate: Date.now() }, {}], page: { total: 3 } })), 0);
  await assert.rejects(() => p.collect('42'), /没有可读取/);
});
const withDetail = (extra: object) => new PublicBilibiliProvider(mock(u => u.pathname.endsWith('/view') ? ok({ bvid: u.searchParams.get('bvid'), owner: { mid: 42 }, stat: { view: 1, like: 0, coin: 0, favorite: 0, reply: 0, share: 0 }, desc: '', ...extra }) : happy(u)), 0);
test('empty upstream zone names fall back to the tid table and are labelled as platform topics', async () => {
  const d = await withDetail({ tid: 201, tname: '', tname_v2: '' }).collect('42');
  assert.equal(d.videos[0].topic, '科学科普'); assert.equal(d.videos[0].topicSource, 'platform'); assert.doesNotMatch(d.warnings.join(' '), /未取得 B 站分区/);
  const a = analyze(d); assert.equal(a.topics[0].name, '科学科普'); assert.equal(a.videos[0].topicSource, 'platform');
});
test('non-empty upstream zone names take priority over the tid table', async () => {
  assert.equal((await withDetail({ tid: 201, tname: '旧名', tname_v2: '新名' }).collect('42')).videos[0].topic, '新名');
  assert.equal((await withDetail({ tid: 201, tname: '旧名', tname_v2: '' }).collect('42')).videos[0].topic, '旧名');
});
test('unknown, missing or malformed tid keeps statistics and falls back to rules with a warning', async () => {
  for (const extra of [{ tid: 99999 }, {}, { tid: '201' }, { tid: 174 }]) {
    const d = await withDetail(extra).collect('42');
    assert.equal(d.videos[0].topic, null); assert.equal(d.videos[0].likes, 0); assert.match(d.warnings.join(' '), /2 条作品未取得 B 站分区/);
    assert.equal(analyze(d).videos[0].topicSource, 'rule');
  }
});
test('failed details leave topics to the keyword rules with a warning', async () => {
  const d = await new PublicBilibiliProvider(mock(u => u.pathname.endsWith('/view') ? new Response('', { status: 429 }) : happy(u)), 0).collect('42');
  assert.equal(d.videos[0].topic, null); assert.match(d.warnings.join(' '), /2 条作品未取得 B 站分区/); assert.equal(analyze(d).videos[0].topicSource, 'rule');
});
test('oversized or blank zone names are ignored and cannot invalidate the whole collection', async () => {
  assert.equal((await withDetail({ tid: 201, tname_v2: 'x'.repeat(61), tname: '   ' }).collect('42')).videos[0].topic, '科学科普');
  assert.equal((await withDetail({ tname_v2: 'x'.repeat(61) }).collect('42')).videos[0].topic, null);
});
test('zone table matches observed partitions and stays within the topic schema', () => {
  assert.equal(bilibiliZones[193], 'MV'); assert.equal(bilibiliZones[201], '科学科普'); assert.equal(bilibiliZones[162], '绘画');
  assert.equal(bilibiliZones[174], undefined);
  for (const name of Object.values(bilibiliZones)) { assert.ok(name.length >= 1 && name.length <= 60); assert.notEqual(name, '其他内容'); }
});
test('local API public research works without gateway credentials (upstream responses are synthetic)', async () => {
  const store = new ReportStore(':memory:'), provider = new PublicBilibiliProvider(mock(happy), 0);
  const server = createApp(store, provider).listen(0, '127.0.0.1'); await once(server, 'listening'); const a = server.address(); assert.ok(a && typeof a !== 'string'); const base = `http://127.0.0.1:${a.port}`;
  try {
    const response = await fetch(base + '/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://space.bilibili.com/42', source: 'public' }) }); assert.equal(response.status, 202);
    const job = await response.json(); let id: string | undefined;
    for (let i=0;i<100;i++) { const state = await (await fetch(base + '/api/jobs/' + job.id)).json(); assert.notEqual(state.status, 'error', state.message); if (state.status === 'complete') { id = state.reportId; break; } await new Promise(r => setTimeout(r, 10)); }
    assert.ok(id); const report = await (await fetch(base + '/api/reports/' + id)).json(); assert.equal(report.dataset.creator.id, '42'); assert.equal(report.analysis.count, 2); assert.match(report.dataset.source, /网站公开接口/);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); }
});
