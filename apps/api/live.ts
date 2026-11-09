import { z } from 'zod';

export const liveConfigured = () => Boolean(process.env.LIVE_DATA_URL && (process.env.LIVE_DATA_PROVIDER === 'bilibili-official' || process.env.LIVE_DATA_AUTHORIZED === 'true'));
export const capabilitiesSchema = z.object({
  platform: z.literal('bilibili'), authorized: z.boolean(), capabilities: z.array(z.string()),
  provider: z.string().optional(), configured: z.boolean().optional(), state: z.string().optional(), message: z.string().optional(),
  verified: z.boolean().default(false), lastVerifiedAt: z.string().nullable().optional(), lastError: z.string().nullable().optional(),
  account: z.object({ name: z.string(), id: z.string() }).nullable().optional(), scopes: z.array(z.string()).optional(),
  expiresAt: z.string().nullable().optional(), source: z.string().optional(),
});
export async function gatewayRequest(path: string, init: RequestInit = {}, timeoutMs = 130_000): Promise<unknown> {
  if (!liveConfigured()) throw new Error('Live Mode 尚未配置数据网关。请运行 npm run setup:live，或使用 Demo / 导入。');
  const base = process.env.LIVE_DATA_URL!.replace(/\/$/, ''), url = new URL(base);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('数据网关需要 HTTPS，或本地 HTTP；不能在 URL 中嵌入凭证');
  let response: Response;
  try { response = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(process.env.LIVE_DATA_KEY ? { Authorization: `Bearer ${process.env.LIVE_DATA_KEY}` } : {}) }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }); }
  catch { throw new Error('无法连接 Live 数据网关或采集超时，请确认网关服务已启动'); }
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error(`数据网关返回非 JSON 响应（HTTP ${response.status}）`); }
  if (!response.ok) {
    const error = z.object({ error: z.string().max(1000) }).safeParse(data);
    throw new Error(error.success ? error.data.error : `数据网关返回 HTTP ${response.status}；已停止采集`);
  }
  return data;
}
export async function liveStatus() {
  if (!liveConfigured()) return { configured: false, reachable: false, verified: false, message: 'Live Mode 未配置数据网关' };
  try { return { ...capabilitiesSchema.parse(await gatewayRequest('/capabilities', {}, 3000)), reachable: true, gatewayConfigured: true }; }
  catch (error) { return { configured: true, reachable: false, verified: false, message: error instanceof Error ? error.message : '网关状态读取失败' }; }
}
