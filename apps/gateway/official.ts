import { createHash, createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { GatewayConfig } from './config';

export class GatewayError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function signHeaders(clientId: string, secret: string, token: string, timestamp = Math.floor(Date.now() / 1000), nonce: string = randomUUID()): Record<string, string> {
  const signed: Record<string, string> = {
    'x-bili-accesskeyid': clientId, 'x-bili-content-md5': createHash('md5').update('').digest('hex'),
    'x-bili-signature-method': 'HMAC-SHA256', 'x-bili-signature-nonce': nonce,
    'x-bili-signature-version': '2.0', 'x-bili-timestamp': String(timestamp),
  };
  const canonical = Object.keys(signed).sort().map(key => `${key}:${signed[key]}`).join('\n');
  return { ...signed, Authorization: createHmac('sha256', secret).update(canonical).digest('hex'), 'access-token': token, Accept: 'application/json', 'Content-Type': 'application/json' };
}
export const tokenSchema = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1),
  // Bilibili documents expires_in as an absolute UTC Unix timestamp, NOT a duration.
  expires_in: z.number().int().positive(), scopes: z.array(z.string()).default([]),
});
export type Token = z.infer<typeof tokenSchema>;
const messages: Record<number, string> = {
  122000: 'Client ID 无效', 122001: 'Client Secret 无效', 122002: '授权码无效或已使用，请重新授权',
  122007: '刷新令牌无效，请重新授权', 127001: '令牌失效，请重新授权', 127002: '请求签名无效',
  127005: '开发者认证未通过', 127006: '应用审核未通过', 127007: '应用缺少接口权限',
  127009: '接口配额或频率受限', 127011: '用户未授权所需权限', 127304: '接口访问受限',
  127305: '应用白名单限制', 127306: '请求频率受限', 4002: '请求签名异常', 4003: '请求时间过期，请检查本机时钟',
};
export class OfficialClient {
  private queue: Promise<unknown> = Promise.resolve();
  private nextAt = 0;
  private cooldownUntil = 0;
  constructor(private config: GatewayConfig, private transport: typeof fetch = fetch) {}
  private request(url: URL, init: RequestInit): Promise<unknown> {
    const task = this.queue.then(async () => {
      if (Date.now() < this.cooldownUntil) throw new GatewayError(429, 'UPSTREAM_COOLDOWN', '上游访问受限，网关暂停请求 10 分钟；不会自动重试或更换接口');
      await delay(Math.max(0, this.nextAt - Date.now()));
      this.nextAt = Date.now() + this.config.intervalMs;
      let response: Response;
      try { response = await this.transport(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12000) }); }
      catch { throw new GatewayError(502, 'UPSTREAM_NETWORK', '无法连接 B 站官方接口或请求超时；未重试'); }
      if (response.status === 401) throw new GatewayError(401, 'UPSTREAM_UNAUTHORIZED', 'B 站官方接口拒绝当前授权（HTTP 401），请重新授权');
      if ([403, 412, 429].includes(response.status)) {
        this.cooldownUntil = Date.now() + 600_000;
        throw new GatewayError(response.status === 429 ? 429 : 502, 'UPSTREAM_RESTRICTED', `B 站官方接口返回 HTTP ${response.status}，已停止请求；请检查应用权限与配额`);
      }
      if (!response.ok) throw new GatewayError(502, 'UPSTREAM_HTTP', `B 站官方接口返回 HTTP ${response.status}；未重试`);
      let raw: unknown;
      try { raw = await response.json(); } catch { throw new GatewayError(502, 'UPSTREAM_FORMAT', 'B 站返回非 JSON 数据；已停止请求'); }
      const parsed = z.object({ code: z.number(), data: z.unknown().optional() }).safeParse(raw);
      if (!parsed.success) throw new GatewayError(502, 'UPSTREAM_SCHEMA', 'B 站响应结构与接口文档不符');
      const { code, data } = parsed.data;
      if (code !== 0) {
        if ([127009, 127304, 127305, 127306, -412, -352, -509].includes(code)) this.cooldownUntil = Date.now() + 600_000;
        // Never relay arbitrary upstream messages: they can echo credentials or request URLs.
        throw new GatewayError(502, `BILIBILI_${code}`, `B 站错误 ${code}：${messages[code] || '请求失败，请查阅官方状态码'}；未重试`);
      }
      return data;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  async token(grant: 'authorization_code' | 'refresh_token', value: string): Promise<Token> {
    if (!this.config.clientId || !this.config.clientSecret) throw new GatewayError(503, 'APP_NOT_CONFIGURED', '请在服务端 .env 填写 BILIBILI_CLIENT_ID 和 BILIBILI_CLIENT_SECRET');
    const url = new URL(`https://api.bilibili.com/x/account-oauth2/v1/${grant === 'authorization_code' ? 'token' : 'refresh_token'}`);
    // The official OAuth contract puts these parameters in the query, with an empty POST body.
    url.search = new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, grant_type: grant, [grant === 'authorization_code' ? 'code' : 'refresh_token']: value }).toString();
    const parsed = tokenSchema.safeParse(await this.request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } }));
    if (!parsed.success || parsed.data.expires_in * 1000 <= Date.now()) throw new GatewayError(502, 'TOKEN_SCHEMA', '授权响应缺少有效令牌或绝对 UTC 到期时间；未保存授权');
    return parsed.data;
  }
  get(path: '/user/account/info' | '/archive/viewlist' | '/data/arc/stat' | '/data/user/stat', token: string, params: Record<string, string> = {}) {
    const url = new URL(`https://member.bilibili.com/arcopen/fn${path}`); url.search = new URLSearchParams(params).toString();
    return this.request(url, { headers: signHeaders(this.config.clientId, this.config.clientSecret, token) });
  }
}
