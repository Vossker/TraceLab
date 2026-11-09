import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const file = '.env';
let content = existsSync(file) ? readFileSync(file, 'utf8') : '';
const current = key => content.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1].trim().replace(/^(["'])(.*)\1$/, '$2');
const set = (key, value) => {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) content = content.replace(pattern, `${key}=${value}`);
  else content += `${content.endsWith('\n') || !content ? '' : '\n'}${key}=${value}\n`;
};
const port = current('LIVE_GATEWAY_PORT') || '3003';
const target = `http://127.0.0.1:${port}`;
if (current('LIVE_DATA_URL') && current('LIVE_DATA_URL') !== target) throw new Error('已有外部 LIVE_DATA_URL 配置，未覆盖。请按 docs/live-gateway.md 手动选择网关。');
if (current('LIVE_DATA_KEY') && current('LIVE_DATA_KEY').length < 32) throw new Error('现有 LIVE_DATA_KEY 少于 32 字符。未覆盖；请按接入文档更新密钥。');
set('LIVE_DATA_URL', target); set('LIVE_DATA_PROVIDER', 'bilibili-official'); set('LIVE_GATEWAY_ENABLED', 'true'); set('LIVE_GATEWAY_PORT', port);
if (!current('LIVE_DATA_KEY')) set('LIVE_DATA_KEY', randomBytes(32).toString('hex'));
for (const [key, value] of Object.entries({ BILIBILI_CLIENT_ID: '', BILIBILI_CLIENT_SECRET: '', BILIBILI_REDIRECT_URI: `http://127.0.0.1:${current('PORT') || 3001}/api/live/callback`, BILIBILI_MAX_VIDEOS: '50', BILIBILI_REQUEST_INTERVAL_MS: '1000' })) if (current(key) === undefined) set(key, value);
writeFileSync(file, content, { mode: 0o600 });
console.log(`本地官方网关已配置：${target}。密钥已保存在 .env（不会显示）。\n下一步：填写 BILIBILI_CLIENT_ID / BILIBILI_CLIENT_SECRET，核对回调地址，重启 npm run dev，并在 Dashboard 发起授权。\n未配置应用时网关仍可启动，并明确报告“应用未配置”；不会发起上游请求。`);
