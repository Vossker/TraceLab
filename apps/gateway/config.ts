import { z } from 'zod';

export type GatewayConfig = {
  clientId: string; clientSecret: string; redirectUri: string; key: string;
  port: number; maxVideos: number; intervalMs: number; cacheMs: number; tokenFile: string;
};
export function gatewayConfig(env = process.env): GatewayConfig {
  const number = (value: string | undefined, fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).parse(value || fallback);
  const redirectUri = env.BILIBILI_REDIRECT_URI || 'http://127.0.0.1:3001/api/live/callback';
  const url = new URL(redirectUri);
  if (url.username || url.password || url.hash || url.search || url.pathname !== '/api/live/callback' || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('BILIBILI_REDIRECT_URI 必须为 HTTPS 或本机 HTTP 的 /api/live/callback');
  const key = env.LIVE_DATA_KEY || '';
  if (key.length < 32) throw new Error('本地网关需要至少 32 字符的 LIVE_DATA_KEY；请运行 npm run setup:live');
  return {
    clientId: env.BILIBILI_CLIENT_ID || '', clientSecret: env.BILIBILI_CLIENT_SECRET || '', redirectUri, key,
    port: number(env.LIVE_GATEWAY_PORT, 3003, 1024, 65535), maxVideos: number(env.BILIBILI_MAX_VIDEOS, 50, 1, 200),
    intervalMs: number(env.BILIBILI_REQUEST_INTERVAL_MS, 1000, 500, 10000), cacheMs: 600_000,
    tokenFile: '.data/gateway/oauth.enc',
  };
}
