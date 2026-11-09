import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { GatewayConfig } from '../apps/gateway/config';
import { OfficialClient, signHeaders } from '../apps/gateway/official';
import { EncryptedVault, type Grant, type Vault } from '../apps/gateway/vault';
import { GatewayService } from '../apps/gateway/service';
import { createGateway } from '../apps/gateway/app';
import { createApp } from '../apps/api/app';
import { ReportStore } from '../apps/api/store';
import type { Report } from '../packages/core/src/model';

// Every upstream response in this file is a synthetic contract fixture, not live validation.
const config: GatewayConfig = { clientId: 'test-client', clientSecret: 'test-secret', key: 'fixture-gateway-key-'.repeat(3), redirectUri: 'http://127.0.0.1:3001/api/live/callback', port: 3003, maxVideos: 50, intervalMs: 0, cacheMs: 600_000, tokenFile: 'unused' };
const grant = (): Grant => ({ clientId: config.clientId, openid: 'synthetic-openid', name: '官方协议测试账号（模拟）', face: null, token: { access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token', expires_in: Math.floor(Date.now() / 1000) + 86400, scopes: ['USER_INFO', 'ARC_BASE', 'ARC_DATA'] } });
class MemoryVault implements Vault {
  constructor(public value: Grant | null = null) {}
  read() { return this.value; } write(g: Grant) { this.value = g; } clear() { this.value = null; }
}
const archive = (i: number) => ({ resource_id: `BV1${String(i).padStart(9, '0')}`, title: `接口测试作品 ${i}`, desc: '仅用于自动化测试', tag: '测试,摄影', cover: '//i0.hdslb.com/test.jpg', ptime: 1735689600 + i * 86400, addit_info: { state: 0 }, video_info: { duration: 180 } });
const ok = (data: unknown) => Response.json({ code: 0, data });
const profile = () => ({ name: grant().name, openid: grant().openid, face: '' });
const transport = (handler: (url: URL, init?: RequestInit) => Response | Promise<Response>): typeof fetch => async (input, init) => handler(new URL(String(input)), init);
async function listen(server: Server) { await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`; }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }

test('official signature v2 sorts six headers, hashes empty GET body and has no trailing newline', () => {
  const h = signHeaders('client', 'secret', 'token', 1730185575, 'fixed-nonce');
  const canonical = 'x-bili-accesskeyid:client\nx-bili-content-md5:d41d8cd98f00b204e9800998ecf8427e\nx-bili-signature-method:HMAC-SHA256\nx-bili-signature-nonce:fixed-nonce\nx-bili-signature-version:2.0\nx-bili-timestamp:1730185575';
  assert.equal(h.Authorization, createHmac('sha256', 'secret').update(canonical).digest('hex'));
  assert.equal(h['access-token'], 'token'); assert.equal(h['x-bili-signature-version'], '2.0');
});

test('OAuth uses documented POST query parameters and absolute expiry; no relative expiry guessing', async () => {
  let calls = 0;
  const client = new OfficialClient(config, transport((url, init) => {
    calls++; assert.equal(url.origin, 'https://api.bilibili.com'); assert.equal(url.searchParams.get('client_secret'), config.clientSecret);
    assert.equal(url.searchParams.get('grant_type'), 'authorization_code'); assert.equal(init?.method, 'POST'); assert.equal(init?.body, undefined);
    return ok(calls === 1 ? grant().token : { ...grant().token, expires_in: 3600 });
  }));
  assert.equal((await client.token('authorization_code', 'test-code')).access_token, grant().token.access_token);
  await assert.rejects(() => client.token('authorization_code', 'another-code'), /绝对 UTC/);
});

test('HTTP 412 and platform throttling stop requests without retry, fallback or leaking upstream strings', async () => {
  for (const response of [new Response('blocked', { status: 412 }), Response.json({ code: 127306, message: 'LEAKED_SECRET' })]) {
    let calls = 0; const client = new OfficialClient(config, transport(() => { calls++; return response; }));
    await assert.rejects(() => client.get('/archive/viewlist', 'secret'), e => e instanceof Error && !e.message.includes('LEAKED_SECRET'));
    await assert.rejects(() => client.get('/data/arc/stat', 'secret'), /暂停请求/);
    assert.equal(calls, 1);
  }
});

test('OAuth state is browser-bound, single-use, and rejects callback host mismatch', async () => {
  let calls = 0; const vault = new MemoryVault();
  const service = new GatewayService(config, new OfficialClient(config, transport(url => { calls++; return ok(url.pathname.endsWith('/token') ? grant().token : profile()); })), vault);
  const binding = 'a'.repeat(64), { url } = service.start(binding, 'http://127.0.0.1:5173'), state = new URL(url).searchParams.get('state')!;
  assert.equal(new URL(url).searchParams.get('gourl'), config.redirectUri);
  assert.throws(() => service.start(binding, 'https://evil.test'), /同主机/);
  await assert.rejects(() => service.exchange(state, 'b'.repeat(64), 'code'), /当前浏览器/); assert.equal(calls, 0);
  assert.equal((await service.exchange(state, binding, 'code')).returnTo, 'http://127.0.0.1:5173'); assert.ok(vault.value);
  await assert.rejects(() => service.exchange(state, binding, 'code'), /无效/); assert.equal(calls, 2);
  assert.equal(service.status().authorized, true); assert.equal(service.status().verified, false);
  assert.ok(!JSON.stringify(service.status()).includes('synthetic-access-token'));
  assert.ok(!JSON.stringify(service.status()).includes('synthetic-openid'));
});

test('empty credentials and expired grants do not report authorized or call upstream', async () => {
  let calls = 0; const fetcher = transport(() => { calls++; throw new Error('must not call'); });
  const blank = { ...config, clientId: '', clientSecret: '' };
  const service = new GatewayService(blank, new OfficialClient(blank, fetcher), new MemoryVault());
  assert.equal(service.status().state, 'app_unconfigured'); assert.throws(() => service.start('a'.repeat(64), 'http://127.0.0.1:5173'), /配置/);
  const expired = grant(); expired.token.expires_in = 100;
  const old = new GatewayService(config, new OfficialClient(config, fetcher), new MemoryVault(expired));
  assert.equal(old.status().state, 'token_expired'); await assert.rejects(() => old.videos('self'), /授权/); assert.equal(calls, 0);
});

test('failed token persistence never advertises a successfully connected account', async () => {
  const vault: Vault = { read: () => null, clear: () => {}, write: () => { throw new Error('disk unavailable'); } };
  const service = new GatewayService(config, new OfficialClient(config, transport(url => ok(url.pathname.endsWith('/token') ? grant().token : profile()))), vault);
  const binding = 'a'.repeat(64), { url } = service.start(binding, 'http://127.0.0.1:5173');
  await assert.rejects(() => service.exchange(new URL(url).searchParams.get('state')!, binding, 'fixture-code'), /disk/);
  assert.equal(service.status().authorized, false); assert.equal(service.status().account, null);
});

test('pagination deduplicates, rejects nonpublic/invalid dates, normalizes missing stats, and preserves cache time', async () => {
  const paths: string[] = [];
  const client = new OfficialClient(config, transport(url => {
    paths.push(url.pathname);
    if (url.pathname.endsWith('viewlist')) {
      assert.equal(url.searchParams.get('status'), 'pubed');
      return ok({ list: url.searchParams.get('pn') === '1' ? Array.from({ length: 50 }, (_, i) => archive(i + 1)) : [archive(50), { ...archive(51), addit_info: { state: -4 } }, { ...archive(52), ptime: undefined }, archive(53)], page: { total: 54 } });
    }
    return ok({ view: 0, like: -1, coin: 2, favorite: 3, reply: 4 });
  }));
  const service = new GatewayService({ ...config, maxVideos: 60 }, client, new MemoryVault(grant()));
  const [a, b] = await Promise.all([service.videos('self'), service.videos('self')]);
  assert.equal(a.videos.length, 51); assert.equal(a.total, 54); assert.equal(a.collectedAt, b.collectedAt);
  assert.equal(a.videos[0].views, 0); assert.equal(a.videos[0].likes, null); assert.equal(a.videos[0].shares, null);
  assert.equal(a.videos[0].duration, 180); assert.equal(a.videos[0].publishedAt, new Date(archive(1).ptime * 1000).toISOString());
  assert.match(a.warnings.join(' '), /重复 1 条/); assert.match(a.warnings.join(' '), /跳过 2 条/);
  const before = paths.length; assert.equal((await service.videos('self')).collectedAt, a.collectedAt); assert.equal(paths.length, before);
  assert.equal(paths.filter(p => p.endsWith('viewlist')).length, 2); assert.equal(service.status().verified, true);
  await assert.rejects(() => service.creator('42'), /不能验证输入 UID/); assert.equal(paths.length, before);
});

test('missing statistics permission produces partial real-shaped metadata with explicit nulls and warning', async () => {
  let calls = 0;
  const service = new GatewayService(config, new OfficialClient(config, transport(url => {
    calls++; return url.pathname.endsWith('viewlist') ? ok({ list: [archive(1), archive(2)], page: { total: 2 } }) : Response.json({ code: 127007, message: 'secret' });
  })), new MemoryVault(grant()));
  const result = await service.videos('self'); assert.equal(calls, 2); assert.ok(result.videos.every(v => v.views === null));
  assert.match(result.warnings.join(' '), /127007/); assert.match(result.coverage, /0 条有播放值/);
});

test('near-expiry token refresh is single-flight and stores replacement before data calls', async () => {
  const current = grant(); current.token.expires_in = Math.floor(Date.now() / 1000) + 120;
  const vault = new MemoryVault(current); let refreshes = 0;
  const service = new GatewayService(config, new OfficialClient(config, transport((url, init) => {
    if (url.pathname.endsWith('/refresh_token')) { refreshes++; return ok({ ...grant().token, access_token: 'replacement' }); }
    assert.equal((init?.headers as Record<string, string>)['access-token'], 'replacement'); return ok(profile());
  })), vault);
  const [a, b] = await Promise.all([service.creator('self'), service.creator('self')]);
  assert.equal(a.name, b.name); assert.equal(refreshes, 1); assert.equal(vault.value?.token.access_token, 'replacement');
});

test('authorization change during collection discards pending result and stops further requests', async () => {
  let release!: () => void, entered!: () => void, calls = 0;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const service = new GatewayService(config, new OfficialClient(config, transport(async () => {
    calls++; entered(); await pending; return ok({ list: [archive(1)], page: { total: 1 } });
  })), new MemoryVault(grant()));
  const result = service.videos('self'); await ready; service.disconnect(); release();
  await assert.rejects(() => result, /授权改变/); assert.equal(calls, 1); assert.equal(service.status().authorized, false);
});

test('invalidated credentials clear the token and previously usable cache instead of serving stale authorization', async () => {
  let revoked = false, calls = 0; const vault = new MemoryVault(grant());
  const service = new GatewayService(config, new OfficialClient(config, transport(url => {
    calls++;
    if (revoked) return new Response('', { status: 401 });
    if (url.pathname.endsWith('viewlist')) return ok({ list: [archive(1)], page: { total: 1 } });
    return ok({ view: 1 });
  })), vault);
  await service.videos('self'); revoked = true;
  await assert.rejects(() => service.creator('self'), /401/);
  const before = calls; await assert.rejects(() => service.videos('self'), /授权/);
  assert.equal(calls, before); assert.equal(vault.value, null); assert.equal(service.status().verified, false);
});

test('empty/nonpublic-only listings fail without creating a fictional dataset', async () => {
  const service = new GatewayService(config, new OfficialClient(config, transport(() => ok({ list: [{ ...archive(1), addit_info: { state: -4 } }], page: { total: 1 } }))), new MemoryVault(grant()));
  await assert.rejects(() => service.videos('self'), /没有可分析的公开已发布作品/);
  assert.equal(service.status().verified, false);
});

test('failed single-use refresh discards grant and cannot repeat the refresh token', async () => {
  const current = grant(); current.token.expires_in = Math.floor(Date.now() / 1000) + 60; let calls = 0;
  const vault = new MemoryVault(current);
  const service = new GatewayService(config, new OfficialClient(config, transport(() => { calls++; throw new Error('network'); })), vault);
  await assert.rejects(() => service.creator('self'), /超时/);
  await assert.rejects(() => service.creator('self'), /授权/);
  assert.equal(calls, 1); assert.equal(vault.value, null);
});

test('AES-GCM vault survives restart, detects wrong key, and clears only its token file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tracelab-vault-')), file = join(directory, 'oauth.enc');
  try {
    const vault = new EncryptedVault(file, config.key); vault.write(grant());
    assert.ok(!readFileSync(file).includes(Buffer.from('synthetic-access-token')));
    assert.equal(new EncryptedVault(file, config.key).read()?.openid, grant().openid);
    vault.write({ ...grant(), name: '更新后的测试昵称' }); assert.equal(vault.read()?.name, '更新后的测试昵称');
    assert.throws(() => new EncryptedVault(file, 'wrong').read(), /无法解密/);
    vault.clear(); assert.equal(vault.read(), null);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('real local HTTP pipeline: OAuth callback → gateway → report, with only upstream mocked', async () => {
  const names = ['PORT', 'LIVE_DATA_URL', 'LIVE_DATA_KEY', 'LIVE_DATA_PROVIDER', 'LIVE_DATA_AUTHORIZED'];
  const old = Object.fromEntries(names.map(key => [key, process.env[key]]));
  const store = new ReportStore(':memory:'), api = createApp(store).listen(0, '127.0.0.1'), base = await listen(api);
  process.env.PORT = new URL(base).port;
  const c = { ...config, redirectUri: base + '/api/live/callback' };
  const service = new GatewayService(c, new OfficialClient(c, transport(url => {
    if (url.pathname.endsWith('/token')) return ok(grant().token);
    if (url.pathname.endsWith('/info')) return ok(profile());
    if (url.pathname.endsWith('/viewlist')) return ok({ list: Array.from({ length: 8 }, (_, i) => archive(i)), page: { total: 8 } });
    return ok({ view: 1000, like: 100, coin: 2, favorite: 3, reply: 4, share: 5 });
  })), new MemoryVault());
  const gateway = createGateway(c, service).listen(0, '127.0.0.1'), gatewayUrl = await listen(gateway);
  process.env.LIVE_DATA_URL = gatewayUrl; process.env.LIVE_DATA_KEY = c.key; process.env.LIVE_DATA_PROVIDER = 'bilibili-official';
  const post = (path: string, body = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(gatewayUrl + '/capabilities')).status, 401);
    assert.equal((await fetch(gatewayUrl + '/capabilities', { headers: { Authorization: `Bearer ${c.key}`, Origin: 'https://evil.test' } })).status, 403);
    assert.equal((await (await fetch(base + '/api/health')).json()).live.authorized, false);
    const begin = await post('/api/live/authorize'); assert.equal(begin.status, 200);
    const cookie = begin.headers.get('set-cookie')!.split(';')[0]; assert.match(begin.headers.get('set-cookie')!, /HttpOnly/);
    const state = new URL((await begin.json()).url).searchParams.get('state')!;
    const callback = await fetch(base + `/api/live/callback?state=${state}&code=fixture-code`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(callback.status, 303); assert.equal(callback.headers.get('location'), base + '/?live=connected');
    const job = await (await post('/api/research', { account: 'self' })).json(); let reportId = '';
    for (let i = 0; i < 100; i++) {
      const progress = await (await fetch(base + '/api/jobs/' + job.id)).json();
      assert.notEqual(progress.status, 'error', progress.message);
      if (progress.status === 'complete') { reportId = progress.reportId; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(reportId); const report = await (await fetch(base + '/api/reports/' + reportId)).json() as Report;
    assert.equal(report.dataset.mode, 'live'); assert.equal(report.dataset.creator.id, 'self'); assert.equal(report.dataset.creator.url, null);
    assert.equal(report.analysis.count, 8); assert.equal(report.analysis.median, 1000); assert.match(report.dataset.source, /官方开放平台/);
    assert.match(report.dataset.warnings.join(' '), /OpenID|公开 UID/); assert.equal(report.dataset.comments.length, 0);
    const health = await (await fetch(base + '/api/health')).json(); assert.equal(health.liveVerified, true);
    assert.ok(!JSON.stringify(health).includes(c.key)); assert.ok(!JSON.stringify(report).includes(grant().token.access_token));
    const replay = await fetch(base + `/api/live/callback?state=${state}&code=fixture-code`, { headers: { Cookie: cookie } }); assert.equal(replay.status, 400);
    await fetch(base + '/api/live/authorization', { method: 'DELETE', headers: { Origin: base } }); assert.equal(service.status().authorized, false);
  } finally {
    await close(api); await close(gateway); store.close();
    for (const name of names) if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name];
  }
});
