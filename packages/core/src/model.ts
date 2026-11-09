import { z } from 'zod';

const count = z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().default(null);
export const timestamp = z.string().datetime({ offset: true, message: '需要有效的 ISO 8601 日期时间（包含时区）' });
const safeUrl = z.string().url().refine(v => ['http:', 'https:'].includes(new URL(v).protocol), '仅允许 HTTP(S) 链接');
const optionalUrl = safeUrl.nullable().default(null);
export const creatorSchema = z.object({
  id: z.string().min(1).max(100), platform: z.enum(['bilibili', 'import']),
  name: z.string().min(1).max(120), bio: z.string().max(2000).default(''),
  avatar: optionalUrl, url: optionalUrl, followers: count,
});
export const videoSchema = z.object({
  id: z.string().min(1).max(100), title: z.string().min(1).max(500),
  description: z.string().max(5000).default(''), tags: z.array(z.string().max(60)).max(30).default([]),
  publishedAt: timestamp, collectedAt: timestamp,
  views: count, likes: count, coins: count, favorites: count, comments: count, shares: count,
  duration: count, format: z.enum(['video', 'short', 'live', 'unknown']).default('unknown'),
  topic: z.string().min(1).max(60).nullable().default(null),
  topicSource: z.enum(['provided', 'platform', 'rule', 'llm']).default('provided'),
  cover: optionalUrl, url: optionalUrl, source: z.string().min(1).max(300),
}).refine(v => Date.parse(v.collectedAt) >= Date.parse(v.publishedAt), '采集时间不能早于发布时间');
export const commentSchema = z.object({
  id: z.string().min(1).max(100), videoId: z.string().min(1).max(100),
  text: z.string().min(1).max(2000), likes: count, collectedAt: timestamp,
  source: z.string().min(1).max(300),
});
export const datasetSchema = z.object({
  version: z.literal(1), mode: z.enum(['demo', 'import', 'live']),
  creator: creatorSchema, videos: z.array(videoSchema).min(1).max(2000),
  comments: z.array(commentSchema).max(2000).default([]),
  collectedAt: timestamp, source: z.string().min(1).max(300),
  coverage: z.string().max(1000), totalVideos: count,
  warnings: z.array(z.string().max(1000)).max(30).default([]),
}).superRefine((data, ctx) => {
  const ids = new Set<string>();
  data.videos.forEach((v, i) => {
    if (ids.has(v.id)) ctx.addIssue({ code: 'custom', path: ['videos', i, 'id'], message: `视频 ID 重复：${v.id}` });
    ids.add(v.id);
  });
  const commentIds = new Set<string>();
  data.comments.forEach((c, i) => {
    if (!ids.has(c.videoId)) ctx.addIssue({ code: 'custom', path: ['comments', i], message: '评论引用了不存在的视频' });
    if (commentIds.has(c.id)) ctx.addIssue({ code: 'custom', path: ['comments', i], message: '评论 ID 重复' });
    commentIds.add(c.id);
  });
  if (data.totalVideos !== null && data.totalVideos < data.videos.length) ctx.addIssue({ code: 'custom', path: ['totalVideos'], message: '作品总数不能小于样本数量' });
});
export type Creator = z.infer<typeof creatorSchema>;
export type Video = z.infer<typeof videoSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type Dataset = z.infer<typeof datasetSchema>;
export type Insight = { kind: 'fact' | 'association' | 'hypothesis'; title: string; text: string; evidenceIds: string[] };
export type Relative = { value: number | null; baseline: number | null; peerIds: string[]; reason: string };
export type AnalyzedVideo = Video & { engagement: number | null; relative: Relative };
export type Topic = { name: string; count: number; share: number; median: number | null; engagement: number | null; evidenceIds: string[] };
export type Period = { key: string; count: number; median: number | null; topics: Record<string, number>; evidenceIds: string[] };
export type Change = { videoId: string; date: string; title: string; description: string; kind: 'outlier' | 'topic' };
export type Analysis = {
  count: number; viewCount: number; median: number | null; recentMedian: number | null;
  recentCount: number; engagement: number | null; engagementCount: number; monthlyFrequency: number | null;
  start: string; end: string; topics: Topic[]; periods: Period[]; changes: Change[];
  videos: AnalyzedVideo[]; highlights: AnalyzedVideo[]; insights: Insight[];
  feedback: { label: string; commentIds: string[]; videoIds: string[] }[];
  limitations: string[];
};
export const aiSchema = z.object({
  headline: z.string().min(1).max(120),
  sections: z.array(z.object({
    title: z.enum(['创作者概览', '创作轨迹', '关键转折', '内容特点', '分析结论']),
    text: z.string().min(1).max(1600), kind: z.enum(['fact', 'association', 'hypothesis']),
    evidenceIds: z.array(z.string()).min(1).max(20),
  })).length(5),
  classifications: z.array(z.object({ videoId: z.string(), topic: z.string().min(1).max(30), reason: z.string().min(1).max(200) })).max(200),
  commentClusters: z.array(z.object({ label: z.string().min(1).max(50), commentIds: z.array(z.string()).min(1).max(30), sentiment: z.enum(['positive', 'negative', 'mixed', 'neutral']) })).max(8),
  uncertainties: z.array(z.string().min(1).max(500)).min(1).max(8),
}).strict();
export type AIReport = z.infer<typeof aiSchema>;
export type Report = { id: string; createdAt: string; dataset: Dataset; analysis: Analysis; ai: AIReport | null; aiModel: string | null };

export function parseCreatorUrl(input: string): { id: string; url: string } {
  const raw = input.trim();
  if (/^[1-9]\d{0,19}$/.test(raw)) return { id: raw, url: `https://space.bilibili.com/${raw}` };
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('请输入完整的 B 站空间链接或数字 UID'); }
  const match = u.pathname.match(/^\/([1-9]\d{0,19})(?:\/.*)?$/);
  if (!['https:', 'http:'].includes(u.protocol) || u.hostname !== 'space.bilibili.com' || u.port || u.username || u.password || !match) throw new Error('仅支持 https://space.bilibili.com/数字UID 形式的创作者主页');
  return { id: match[1], url: `https://space.bilibili.com/${match[1]}` };
}
