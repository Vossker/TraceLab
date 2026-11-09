import { datasetSchema, type Dataset } from './model';

/** RFC 4180-style CSV parser: quoted commas, escaped quotes, CRLF and multiline cells. */
export function parseCSV(text: string): Record<string, string>[] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; };
  const pushRow = () => { pushCell(); if (row.some(v => v.trim())) rows.push(row); row = []; };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '"') {
      if (cell.length || closed) throw new Error('CSV 引号位置不正确');
      quoted = true;
    } else if (char === ',') pushCell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && input[i + 1] === '\n') i++; pushRow(); }
    else { if (closed) throw new Error('CSV 闭合引号后只能接分隔符或换行'); cell += char; }
  }
  if (quoted) throw new Error('CSV 中存在未闭合的引号');
  if (cell || row.length || closed) pushRow();
  if (rows.length < 2) throw new Error('CSV 至少需要表头和一行视频数据');
  const headers = rows.shift()!.map(h => h.trim());
  if (headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('CSV 表头不能为空或重复');
  for (const name of ['id', 'title', 'publishedAt', 'collectedAt']) if (!headers.includes(name)) throw new Error(`CSV 缺少必填列：${name}`);
  return rows.map((r, i) => {
    if (r.length !== headers.length) throw new Error(`CSV 第 ${i + 2} 行列数不匹配`);
    return Object.fromEntries(headers.map((h, j) => [h, r[j].trim()]));
  });
}
const number = (v: string | undefined) => {
  if (!v) return null;
  if (!/^\d+(?:\.\d+)?$/.test(v)) throw new Error(`数字字段“${v.slice(0, 30)}”无效，请使用非负数字；缺失请留空`);
  return Number(v);
};
const date = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00+08:00` : v;
export function importDataset(content: string, format: 'csv' | 'json', creatorName = '导入的创作者'): Dataset {
  if (content.length > 4_000_000) throw new Error('文件过大，请控制在 4 MB 以内');
  if (format === 'json') {
    let parsed;
    try { parsed = JSON.parse(content); } catch { throw new Error('JSON 格式错误，请检查逗号、引号与括号'); }
    const candidate = parsed?.dataset ?? parsed;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('JSON 须包含 creator、videos、collectedAt 等数据集字段');
    return datasetSchema.parse({ ...candidate, mode: candidate.mode === 'demo' ? 'demo' : 'import', warnings: [...(Array.isArray(candidate.warnings) ? candidate.warnings.slice(0, 28) : []), '通过用户文件导入；来源与完整性由提供者声明，未独立核验。'] });
  }
  const rows = parseCSV(content);
  const videos = rows.map(r => ({ id: r.id, title: r.title, description: r.description || '', tags: (r.tags || '').split('|').filter(Boolean),
    publishedAt: date(r.publishedAt), collectedAt: date(r.collectedAt), views: number(r.views), likes: number(r.likes), coins: number(r.coins), favorites: number(r.favorites), comments: number(r.comments), shares: number(r.shares), duration: number(r.duration),
    format: r.format || 'unknown', topic: r.topic || null, topicSource: 'provided', cover: r.cover || null, url: r.url || null, source: r.source || '用户导入的 CSV',
  }));
  const collectedAt = videos.reduce((latest, v) => Date.parse(v.collectedAt) > Date.parse(latest) ? v.collectedAt : latest, videos[0].collectedAt);
  return datasetSchema.parse({ version: 1, mode: 'import', creator: { id: 'imported', platform: 'import', name: creatorName || '导入的创作者' }, videos, comments: [], collectedAt, source: '用户导入的 CSV', coverage: `用户提供的 ${videos.length} 条视频；不假设覆盖全部历史作品。`, totalVideos: null, warnings: ['CSV 中仅有日期的时间按北京时间 00:00 解释。未提供的数值保留为缺失；未提供内容形式或时长时不计算相对表现。'] });
}
export const csvTemplate = 'id,title,publishedAt,collectedAt,views,likes,coins,favorites,comments,shares,duration,format,topic,url,source\r\nmy-video-1,我的第一期生活实验,2025-01-10T10:00:00+08:00,2026-01-15T10:00:00+08:00,12000,600,100,200,35,20,480,video,生活实验,,用户提供\r\nmy-video-2,记录一个普通的周末,2025-02-10T10:00:00+08:00,2026-01-15T10:00:00+08:00,18000,,,,,,420,video,影像记录,,用户提供\r\n';
