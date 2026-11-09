/// <reference types="chrome" />
import { parseCreatorUrl } from '../../packages/core/src/model';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = element<HTMLInputElement>('creator-url');
const dashboardInput = element<HTMLInputElement>('dashboard-url');
const status = element('status');
let dashboard = 'http://127.0.0.1:5173';
function message(text: string, error = false) { status.textContent = text; status.className = error ? 'status error' : 'status'; }
function validateDashboard(value: string) {
  const url = new URL(value);
  if (url.username || url.password || !((url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) || url.protocol === 'https:')) throw new Error('Dashboard 需要本地 HTTP 或 HTTPS 地址');
  url.search = ''; url.hash = ''; return url.toString();
}
async function open(creator?: string) {
  try {
    const url = new URL(validateDashboard(dashboard));
    if (creator) { url.searchParams.set('creator', parseCreatorUrl(creator).url); url.searchParams.set('source', 'public'); }
    else url.searchParams.set('report', 'demo');
    await chrome.tabs.create({ url: url.toString() });
  } catch (error) { message(error instanceof Error ? error.message : '无法打开 Dashboard', true); }
}
element<HTMLFormElement>('form').addEventListener('submit', event => { event.preventDefault(); void open(input.value); });
element('demo').addEventListener('click', () => { void open(); });
element('save').addEventListener('click', () => {
  void (async () => { try { dashboard = validateDashboard(dashboardInput.value.trim()); await chrome.storage.local.set({ dashboard }); message('地址已保存。请确认 Dashboard 服务已启动。'); } catch (error) { message((error as Error).message, true); } })();
});
async function initialize() {
  const saved = await chrome.storage.local.get('dashboard');
  if (typeof saved.dashboard === 'string') { try { dashboard = validateDashboard(saved.dashboard); } catch { /* Retain safe default. */ } }
  dashboardInput.value = dashboard;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    if (!tab?.url) throw new Error('当前页面不是 B 站创作者主页');
    const creator = parseCreatorUrl(tab.url);
    input.value = creator.url; element('creator-name').textContent = '已识别 B 站创作者'; element('creator-id').textContent = `UID ${creator.id}`; element('detected').hidden = false;
    element('avatar').textContent = 'B';
    if (tab.id) {
      try {
        const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
          const name = document.querySelector('.h-name, .nickname, .upinfo-detail__top .nickname, h1')?.textContent?.trim() || document.title.replace(/的个人空间.*|_哔哩哔哩.*| - 哔哩哔哩.*/, '').trim();
          const avatar = document.querySelector<HTMLImageElement>('.h-avatar img, .avatar img, .upinfo-detail__avatar img')?.src;
          return { name: name?.slice(0, 100), avatar: avatar?.startsWith('https://') ? avatar : null };
        } });
        const info = results[0]?.result;
        if (info?.name) element('creator-name').textContent = info.name;
        if (info?.avatar) { const img = document.createElement('img'); img.src = info.avatar; img.alt = '当前页面的创作者头像'; img.referrerPolicy = 'no-referrer'; element('avatar').replaceChildren(img); }
      } catch { message('已从主页链接识别 UID，页面资料暂不可读。'); }
    }
  } catch { element('creator-name').textContent = '还没有发现创作者'; element('creator-id').textContent = '访问 B 站空间，或在下方粘贴链接'; }
}
void initialize().catch(() => { message('当前标签页不可读，请手动粘贴链接。', true); element('creator-name').textContent = '请手动输入创作者'; });
