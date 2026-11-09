// One anonymous public query; no credentials, signing, retries or fallback endpoints.
const mid = process.argv[2] || '163637592';
if (!/^[1-9]\d{0,19}$/.test(mid)) throw new Error('Invalid UID');
const url = new URL('https://api.bilibili.com/x/series/recArchivesByKeywords');
url.search = new URLSearchParams({ mid, keywords: '', pn: '1', ps: '3' }).toString();
const response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'error', headers: { Accept: 'application/json' } });
const raw = await response.text();
let result;
try { result = JSON.parse(raw); } catch { console.log(JSON.stringify({ http: response.status, contentType: response.headers.get('content-type'), result: 'Non-JSON response; stopped' })); process.exit(1); }
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), source: url.toString(), http: response.status, code: result.code, message: result.message, data: result.code === 0 ? result.data : undefined }, null, 2));
