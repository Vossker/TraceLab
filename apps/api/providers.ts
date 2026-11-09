import { creatorSchema, videoSchema, commentSchema, datasetSchema, type Creator, type Video, type Comment, type Dataset } from '../../packages/core/src/model';
import { z } from 'zod';
import { capabilitiesSchema, gatewayRequest } from './live';

export interface CreatorProvider { getCreator(id: string): Promise<Creator> }
export interface VideoProvider { getVideos(id: string): Promise<{ videos: Video[]; total: number | null; coverage: string; collectedAt: string }> }
export interface EngagementProvider { getEngagement(id: string): Promise<Pick<Video, 'views' | 'likes' | 'coins' | 'favorites' | 'comments' | 'shares'>> }
export interface CommentProvider { getComments(id: string): Promise<Comment[]> }
export interface PlatformAdapter extends CreatorProvider, VideoProvider, CommentProvider { readonly platform: string; verify(): Promise<void> }

/** Standard gateway contract; the bundled implementation uses official OAuth APIs. */
export class BilibiliAdapter implements PlatformAdapter, EngagementProvider {
  readonly platform = 'bilibili';
  private request = gatewayRequest;
  async verify() {
    const result = capabilitiesSchema.parse(await this.request('/capabilities'));
    if (!result.authorized) throw new Error(result.message || '数据网关尚未完成用户授权');
    if (!['creator', 'videos'].every(c => result.capabilities.includes(c))) throw new Error('授权数据源不支持创作者资料或视频列表');
  }
  async getCreator(id: string) { return creatorSchema.parse(await this.request(`/creators/${encodeURIComponent(id)}`)); }
  async getVideos(id: string) { return z.object({ videos: z.array(videoSchema).min(1).max(2000), total: z.number().int().nonnegative().nullable(), coverage: z.string().max(1000), collectedAt: z.string().datetime({ offset: true }), source: z.string().max(300).optional(), warnings: z.array(z.string().max(1000)).max(29).default([]) }).parse(await this.request(`/creators/${encodeURIComponent(id)}/videos`)); }
  async getComments(id: string) { return z.array(commentSchema).max(2000).parse(await this.request(`/creators/${encodeURIComponent(id)}/comments`)); }
  async getEngagement(id: string) { return videoSchema.parse(await this.request(`/videos/${encodeURIComponent(id)}`)); }
}
export async function collectLive(id: string, progress: (percent: number, message: string) => void): Promise<Dataset> {
  const adapter = new BilibiliAdapter();
  progress(10, '验证授权数据源能力'); await adapter.verify();
  progress(25, '读取创作者公开资料'); const creator = await adapter.getCreator(id);
  if (creator.id !== id || creator.platform !== 'bilibili') throw new Error('数据源返回的创作者与请求不一致');
  progress(45, '读取作品与互动数据'); const data = await adapter.getVideos(id);
  progress(65, '尝试读取公开评论样本'); let comments: Comment[] = []; const warnings: string[] = [...data.warnings];
  try { comments = await adapter.getComments(id); } catch { warnings.push('评论数据不可用，其余分析正常生成。'); }
  return datasetSchema.parse({ version: 1, mode: 'live', creator, videos: data.videos, comments, collectedAt: data.collectedAt, source: data.source || '用户配置的已授权 Bilibili 数据网关', coverage: data.coverage, totalVideos: data.total, warnings });
}
