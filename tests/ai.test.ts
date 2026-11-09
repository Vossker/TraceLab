import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../packages/core/src/demo';
import { analyze } from '../packages/core/src/analysis';
import { reportSections } from '../packages/core/src/report';
import { enhanceReport, validateAI } from '../apps/api/ai';
import type { AIReport, Report } from '../packages/core/src/model';

const d = createDemo(); const report: Report = { id: 'test', createdAt: d.collectedAt, dataset: d, analysis: analyze(d), ai: null, aiModel: null };
const valid = (): AIReport => ({ headline: '以证据观察创作变化', sections: reportSections(report).map(s => ({ ...s, title: s.title as AIReport['sections'][number]['title'] })), classifications: d.videos.map(v => ({ videoId: v.id, topic: '新的统一主题', reason: '根据输入的标题与描述' })), commentClusters: [{ label: '记录过程', commentIds: [d.comments[0].id], sentiment: 'positive' }], uncertainties: ['样本不能建立因果关系'] });

test('AI schema rejects fabricated video evidence and comment evidence', () => {
  assert.doesNotThrow(() => validateAI(valid(), report));
  const fakeVideo = valid(); fakeVideo.sections[0].evidenceIds = ['invented']; assert.throws(() => validateAI(fakeVideo, report), /不存在/);
  const fakeComment = valid(); fakeComment.commentClusters[0].commentIds = ['invented']; assert.throws(() => validateAI(fakeComment, report), /不存在/);
});
test('AI schema rejects missing sections, duplicates and oversized content', () => {
  const missing = valid(); missing.sections.pop(); assert.throws(() => validateAI(missing, report));
  const duplicate = valid(); duplicate.sections[1].title = duplicate.sections[0].title; assert.throws(() => validateAI(duplicate, report));
  const long = valid(); long.sections[0].text = 'x'.repeat(1601); assert.throws(() => validateAI(long, report));
  const duplicatedVideo = valid(); duplicatedVideo.classifications.push(duplicatedVideo.classifications[0]); assert.throws(() => validateAI(duplicatedVideo, report), /重复/);
});
test('LLM unavailable fails explicitly, preserving original report', async () => {
  const previous = process.env.AI_API_KEY; delete process.env.AI_API_KEY;
  try { await assert.rejects(() => enhanceReport(report), /尚未配置/); assert.equal(report.ai, null); }
  finally { if (previous === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previous; }
});
test('two-pass AI recomputes statistics before narrative; never exposes API key in report', async t => {
  const previous = { key: process.env.AI_API_KEY, model: process.env.AI_MODEL, base: process.env.AI_BASE_URL };
  process.env.AI_API_KEY = 'local-test-only-key'; process.env.AI_MODEL = 'mock-model'; process.env.AI_BASE_URL = 'https://example.invalid/v1';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++; const payload = JSON.parse(String(init.body)); const input = JSON.parse(payload.messages[1].content);
    assert.equal(payload.response_format.type, 'json_schema'); assert.equal(payload.response_format.json_schema.strict, true);
    assert.ok(!JSON.stringify(input).includes('local-test-only-key'));
    let output;
    if (calls === 1) output = { classifications: valid().classifications, commentClusters: valid().commentClusters };
    else {
      assert.equal(input.statistics.topics.length, 1); assert.equal(input.statistics.topics[0].name, '新的统一主题'); assert.equal(input.statistics.topics[0].count, 108);
      output = { headline: valid().headline, sections: valid().sections, uncertainties: valid().uncertainties };
    }
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }), { status: 200 });
  });
  try {
    const enhanced = await enhanceReport(report); assert.equal(calls, 2); assert.equal(enhanced.analysis.topics.length, 1); assert.equal(enhanced.dataset.videos[0].topicSource, 'llm'); assert.equal(enhanced.aiModel, 'mock-model');
    assert.equal(report.analysis.topics.length, 4); assert.equal(report.ai, null); assert.ok(!JSON.stringify(enhanced).includes('local-test-only-key'));
  } finally {
    for (const [name, value] of [['AI_API_KEY', previous.key], ['AI_MODEL', previous.model], ['AI_BASE_URL', previous.base]]) if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
  }
});
test('LLM transport failure does not mutate deterministic analysis', async t => {
  const previous = { key: process.env.AI_API_KEY, model: process.env.AI_MODEL };
  process.env.AI_API_KEY = 'test'; process.env.AI_MODEL = 'test';
  t.mock.method(globalThis, 'fetch', async () => new Response('private provider response must never be relayed', { status: 429 }));
  try { await assert.rejects(() => enhanceReport(report), /HTTP 429/); assert.equal(report.ai, null); }
  finally { if (previous.key === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previous.key; if (previous.model === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = previous.model; }
});
