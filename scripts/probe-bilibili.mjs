// Read-only, unauthenticated capability probes. No cookies, WBI signing or retries.
const endpoints = [
  ['official-platform', 'https://open.bilibili.com/'],
  ['creator-profile', 'https://api.bilibili.com/x/web-interface/card?mid=2'],
  ['video-list', 'https://api.bilibili.com/x/space/arc/search?mid=2&pn=1&ps=1'],
  ['video-statistics', 'https://api.bilibili.com/x/web-interface/view?aid=170001'],
  ['comments', 'https://api.bilibili.com/x/v2/reply?type=1&oid=170001&pn=1&ps=1'],
];
for (const [capability, url] of endpoints) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    const text = await r.text(); let body; try { body = JSON.parse(text); } catch { /* HTML */ }
    console.log(JSON.stringify({ capability, checkedAt: new Date().toISOString(), status: r.status, apiCode: body?.code ?? null, accessible: r.ok && body?.code === 0, note: r.ok && body?.code === 0 ? '只验证匿名可读，不代表获得使用授权' : '未验证成功，不启用 Live Mode' }));
  } catch (error) { console.log(JSON.stringify({ capability, checkedAt: new Date().toISOString(), accessible: false, error: error.message })); }
}
console.log(JSON.stringify({ capability: 'subtitles', accessible: false, note: '未获得字幕访问授权，不进行获取；本 MVP 不使用字幕或弹幕。' }));
