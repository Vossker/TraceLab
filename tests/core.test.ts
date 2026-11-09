import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, classify, engagement, median, relativePerformance } from '../packages/core/src/analysis';
import { createDemo } from '../packages/core/src/demo';
import { datasetSchema, parseCreatorUrl, videoSchema, type Dataset, type Video } from '../packages/core/src/model';
import { csvTemplate, importDataset, parseCSV } from '../packages/core/src/import';
import { markdownReport, reportSections } from '../packages/core/src/report';

const sample = (): Video => ({ ...createDemo().videos[0], id: 'test', publishedAt: '2025-01-10T00:00:00Z', collectedAt: '2026-01-15T00:00:00Z', duration: 500, format: 'video', views: 1000, likes: 10, coins: 10, favorites: 10, comments: 10, shares: 10 });
const peerVideos = (n = 6) => Array.from({ length: n }, (_, i) => ({ ...sample(), id: `v${i}`, publishedAt: `2025-01-${String(10 + i).padStart(2, '0')}T00:00:00Z`, views: i === 0 ? 1000 : 100 }));
const dataset = (videos: Video[]): Dataset => ({ ...createDemo(), videos, comments: [], totalVideos: null, mode: 'import' });

test('median preserves zero, ignores missing/nonfinite, and is resistant to an outlier', () => {
  assert.equal(median([]), null); assert.equal(median([null, NaN, Infinity]), null);
  assert.equal(median([0, 0, null]), 0); assert.equal(median([5, 1, 3, 2]), 2.5); assert.equal(median([1, 2, 3, 1e9]), 2.5);
});
test('URL parser accepts canonical Bilibili space URLs and numeric UID', () => {
  assert.deepEqual(parseCreatorUrl(' https://space.bilibili.com/1234/video?from=test#x '), { id: '1234', url: 'https://space.bilibili.com/1234' });
  assert.equal(parseCreatorUrl('42').id, '42');
});
test('URL parser rejects lookalikes, userinfo, ports, file URLs and invalid IDs', () => {
  for (const url of ['https://space.bilibili.com.evil.test/123', 'https://space.bilibili.com@evil.test/123', 'https://user@space.bilibili.com/123', 'https://space.bilibili.com:8000/123', 'file:///123', 'https://www.bilibili.com/video/123', '0', '-1', '123abc']) assert.throws(() => parseCreatorUrl(url));
});
test('engagement uses complete-case action sum; missing and zero denominators remain null', () => {
  assert.equal(engagement(sample()), 0.05); assert.equal(engagement({ ...sample(), likes: null }), null);
  assert.equal(engagement({ ...sample(), views: 0 }), null); assert.equal(engagement({ ...sample(), views: null }), null);
  assert.equal(engagement({ ...sample(), likes: 0, coins: 0, favorites: 0, comments: 0, shares: 0 }), 0);
});
test('relative performance excludes self and uses at least five matched peers', () => {
  const videos = peerVideos(); const r = relativePerformance(videos[0], videos);
  assert.equal(r.value, 10); assert.equal(r.baseline, 100); assert.equal(r.peerIds.length, 5); assert.ok(!r.peerIds.includes('v0'));
  assert.equal(relativePerformance(videos[0], videos.slice(0, 5)).value, null);
});
test('relative performance rejects incompatible form, age, collection date and duration', () => {
  const videos = peerVideos();
  const mutate = (v: Video) => [...videos.slice(0, 5), v];
  for (const change of [{ format: 'short' as const }, { duration: 1200 }, { publishedAt: '2024-01-15T00:00:00Z' }, { collectedAt: '2026-02-15T00:00:00Z' }, { views: null }]) assert.equal(relativePerformance(videos[0], mutate({ ...videos[5], ...change })).value, null);
  assert.equal(relativePerformance({ ...videos[0], duration: null }, videos).value, null);
  assert.equal(relativePerformance({ ...videos[0], format: 'unknown' }, videos).value, null);
  assert.equal(relativePerformance({ ...videos[0], collectedAt: '2025-01-20T00:00:00Z' }, videos).value, null);
});
test('relative performance rejects unequal publication ages even within date window', () => {
  const videos = peerVideos().map((v, i) => ({ ...v, collectedAt: '2025-05-01T00:00:00Z', publishedAt: i ? '2025-03-20T00:00:00Z' : '2025-01-10T00:00:00Z' }));
  assert.equal(relativePerformance(videos[0], videos).value, null);
});
test('zero baseline never produces Infinity', () => {
  const videos = peerVideos().map((v, i) => ({ ...v, views: i ? 0 : 100 })); assert.equal(relativePerformance(videos[0], videos).value, null);
});
test('demo is deterministic, explicitly synthetic and contains verifiable narrative signals', () => {
  const d = createDemo(); assert.deepEqual(d, createDemo()); assert.equal(d.mode, 'demo'); assert.equal(d.videos.length, 108); assert.equal(d.comments.length, 12);
  assert.ok(d.videos.every(v => v.url === null)); const a = analyze(d); assert.equal(a.topics.reduce((sum, t) => sum + t.count, 0), 108);
  assert.ok(a.highlights.some(v => v.id === 'demo-053' && v.relative.value! > 10)); assert.ok(a.changes.some(c => c.kind === 'topic' && c.date.startsWith('2025')));
});
test('classification preserves provided labels and falls back conservatively', () => {
  assert.equal(classify({ ...sample(), topic: '音乐', title: '实验' }), '音乐');
  assert.equal(classify({ ...sample(), topic: null, title: '一个普通的标题', description: '', tags: [] }), '其他内容');
});
test('single item and missing observations do not force outliers, frequency or stages', () => {
  const a = analyze(dataset([{ ...sample(), views: null, topic: null }]));
  assert.equal(a.median, null); assert.equal(a.recentMedian, null); assert.equal(a.monthlyFrequency, null); assert.equal(a.engagement, null);
  assert.equal(a.highlights.length, 0); assert.equal(a.changes.length, 0); assert.equal(a.recentCount, 0);
});
test('recent median is taken from last twelve chronologically, without refilling missing values', () => {
  const videos = Array.from({ length: 15 }, (_, i) => ({ ...sample(), id: `v${i}`, publishedAt: `2025-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, views: i >= 13 ? null : i }));
  const a = analyze(dataset([...videos].reverse())); assert.equal(a.recentCount, 10); assert.equal(a.recentMedian, 7.5);
});
test('topic changes cannot compare quarters separated by missing periods', () => {
  const videos = peerVideos(12).map((v, i) => ({ ...v, topic: i < 6 ? 'A' : 'B', publishedAt: i < 6 ? `2025-01-${String(i + 10).padStart(2, '0')}T00:00:00Z` : `2025-10-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
  assert.equal(analyze(dataset(videos)).changes.filter(c => c.kind === 'topic').length, 0);
});
test('JSON schema rejects duplicate IDs, bad dates, negative counts and hostile links', () => {
  assert.throws(() => datasetSchema.parse(dataset([sample(), sample()])));
  for (const change of [{ views: -1 }, { views: 1.5 }, { views: Infinity }, { url: 'javascript:alert(1)' }, { publishedAt: '2025-02-30T00:00:00Z' }, { publishedAt: '2025-01-10T00:00:00' }, { collectedAt: '2020-01-01T00:00:00Z' }]) assert.throws(() => videoSchema.parse({ ...sample(), ...change }));
});
test('comment references and totals must be consistent with the sample', () => {
  const d = createDemo(); assert.throws(() => datasetSchema.parse({ ...d, totalVideos: 1 }));
  assert.throws(() => datasetSchema.parse({ ...d, comments: [{ ...d.comments[0], videoId: 'missing' }] }));
  assert.throws(() => datasetSchema.parse({ ...d, comments: [d.comments[0], d.comments[0]] }));
});
test('CSV supports BOM, quoted commas, escaped quotes, CRLF and multiline descriptions', () => {
  const rows = parseCSV('\uFEFFid,title,publishedAt,collectedAt,description\r\nv1,"Hello, ""world""",2025-01-01,2026-01-01,"line1\nline2"\r\n');
  assert.equal(rows[0].title, 'Hello, "world"'); assert.equal(rows[0].description, 'line1\nline2');
});
test('CSV rejects malformed quoting, duplicated headers and mismatched columns', () => {
  for (const content of ['id,title\nx,y', 'id,title,publishedAt,collectedAt\nv1,"unclosed,x,y', 'id,title,publishedAt,collectedAt\nx,y,z', 'id,title,publishedAt,collectedAt,id\nx,y,z,w,q', 'id,title,publishedAt,collectedAt\nx,"a"b,z,w']) assert.throws(() => parseCSV(content));
});
test('CSV import keeps missing counters null and dates timezone-explicit', () => {
  const d = importDataset(csvTemplate, 'csv', '测试创作者'); assert.equal(d.mode, 'import'); assert.equal(d.creator.name, '测试创作者'); assert.equal(d.videos[1].likes, null); assert.equal(d.creator.followers, null);
  const dateOnly = importDataset('id,title,publishedAt,collectedAt,views\nx,测试,2025-01-01,2026-01-01,0', 'csv');
  assert.equal(dateOnly.videos[0].publishedAt, '2025-01-01T00:00:00+08:00'); assert.equal(dateOnly.videos[0].views, 0);
});
test('CSV import rejects freeform numbers and an oversized file', () => {
  assert.throws(() => importDataset('id,title,publishedAt,collectedAt,views\nx,测试,2025-01-01,2026-01-01,1.2万', 'csv'));
  assert.throws(() => importDataset(' '.repeat(4_000_001), 'json'));
});
test('JSON reimport never relabels synthetic data as real; exported reports round trip', () => {
  const d = createDemo(); const r = { id: 'demo', createdAt: d.collectedAt, dataset: d, analysis: analyze(d), ai: null, aiModel: null };
  const imported = importDataset(JSON.stringify(r), 'json'); assert.equal(imported.mode, 'demo'); assert.equal(imported.videos.length, 108);
  assert.throws(() => importDataset('{bad}', 'json')); assert.throws(() => importDataset('null', 'json'));
});
test('report contains five evidence-backed sections and data limitations', () => {
  const d = createDemo(); const r = { id: 'demo', createdAt: d.collectedAt, dataset: d, analysis: analyze(d), ai: null, aiModel: null };
  assert.equal(reportSections(r).length, 5); assert.ok(reportSections(r).every(s => s.evidenceIds.every(id => d.videos.some(v => v.id === id))));
  const md = markdownReport(r); assert.match(md, /模拟演示数据/); assert.match(md, /不代表|不是/); assert.match(md, /demo-053/); assert.match(md, /未调用 LLM/);
});
