import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { creatorSchema, videoSchema, type Creator, type Video } from '../../packages/core/src/model';
import type { GatewayConfig } from './config';
import { GatewayError, OfficialClient } from './official';
import type { Grant, Vault } from './vault';

const source = 'Bilibili 官方开放平台 · OAuth 授权账号（/arcopen/fn）';
const profileSchema = z.object({ name: z.string().min(1).max(120), openid: z.string().min(1), face: z.string().optional() });
const archiveSchema = z.object({
  resource_id: z.string().regex(/^BV[0-9A-Za-z]{10}$/), title: z.string().min(1).max(500),
  desc: z.string().optional(), tag: z.string().optional(), cover: z.string().optional(), ptime: z.number().optional(),
  addit_info: z.object({ state: z.number() }), video_info: z.object({ duration: z.number().optional() }).nullable().optional(),
});
const pageSchema = z.object({ list: z.array(z.unknown()), page: z.object({ total: z.number().int().nonnegative() }) });
const statSchema = z.object({ view: z.number().optional(), like: z.number().optional(), coin: z.number().optional(), favorite: z.number().optional(), reply: z.number().optional(), share: z.number().optional() });
const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
const imageUrl = (s?: string | null) => { try { const u = new URL(s?.startsWith('//') ? 'https:' + s : s || ''); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
const parse = <T>(schema: z.ZodType<T>, data: unknown): T => { const p = schema.safeParse(data); if (!p.success) throw new GatewayError(502, 'UPSTREAM_SCHEMA', 'B 站响应字段与官方文档不符，已停止当前采集'); return p.data; };
export type Snapshot = { videos: Video[]; total: number | null; coverage: string; collectedAt: string; source: string; warnings: string[] };
type Flow = { binding: string; returnTo: string; expiresAt: number };

export class GatewayService {
  private grant: Grant | null;
  private generation = 0;
  private flows = new Map<string, Flow>();
  private refreshing?: Promise<Grant>;
  private collecting?: Promise<Snapshot>;
  private cache?: { data: Snapshot; expiresAt: number };
  private lastVerifiedAt: string | null = null;
  private lastError: string | null = null;
  constructor(public config: GatewayConfig, private client: OfficialClient, private vault: Vault) {
    this.grant = vault.read();
    if (this.grant && this.grant.clientId !== config.clientId) { this.grant = null; this.lastError = '应用已更换，请重新授权'; }
  }
  status() {
    const configured = Boolean(this.config.clientId && this.config.clientSecret);
    const valid = configured && this.grant !== null && this.grant.token.expires_in * 1000 > Date.now();
    return {
      platform: 'bilibili' as const, provider: 'bilibili-official', configured, authorized: valid,
      state: !configured ? 'app_unconfigured' : !this.grant ? 'authorization_required' : !valid ? 'token_expired' : 'authorized',
      capabilities: ['creator', 'videos', 'engagement'], account: valid ? { name: this.grant!.name, id: 'self' } : null,
      expiresAt: this.grant ? new Date(this.grant.token.expires_in * 1000).toISOString() : null,
      scopes: this.grant?.token.scopes || [], verified: Boolean(valid && this.lastVerifiedAt), lastVerifiedAt: this.lastVerifiedAt,
      lastError: this.lastError, source, redirectUri: this.config.redirectUri, maxVideos: this.config.maxVideos,
      message: !configured ? '请在服务端 .env 配置 BILIBILI_CLIENT_ID / BILIBILI_CLIENT_SECRET 后重启' : !valid ? '请由 UP 主完成 B 站官方授权' : '可分析已授权账号；公开视频主页 UID 与 OpenID 不混用',
    };
  }
  start(binding: string, returnTo: string) {
    if (!this.status().configured) throw new GatewayError(503, 'APP_NOT_CONFIGURED', this.status().message);
    const target = new URL(returnTo);
    const redirect = new URL(this.config.redirectUri);
    if (target.origin !== returnTo || !['http:', 'https:'].includes(target.protocol) || target.hostname !== redirect.hostname || target.username || target.password) throw new GatewayError(400, 'CALLBACK_HOST_MISMATCH', `请从与回调地址同主机的 Dashboard 发起授权（${redirect.hostname}），避免授权 Cookie 丢失`);
    for (const [key, flow] of this.flows) if (flow.expiresAt < Date.now()) this.flows.delete(key);
    if (this.flows.size >= 10) throw new GatewayError(429, 'TOO_MANY_FLOWS', '待完成的授权过多，请稍后重试');
    const state = randomBytes(32).toString('hex'); this.flows.set(state, { binding, returnTo, expiresAt: Date.now() + 600_000 });
    const url = new URL('https://account.bilibili.com/pc/account-pc/auth/oauth');
    url.search = new URLSearchParams({ client_id: this.config.clientId, gourl: this.config.redirectUri, state }).toString();
    return { url: url.href };
  }
  async exchange(state: string, binding: string, code: string) {
    const flow = this.flows.get(state);
    if (!flow || flow.expiresAt <= Date.now() || flow.binding !== binding) throw new GatewayError(400, 'OAUTH_STATE', '授权会话无效、过期或不属于当前浏览器，请重新开始');
    this.flows.delete(state); // Single use, including failures.
    const generation = this.generation;
    const token = await this.client.token('authorization_code', code);
    const user = parse(profileSchema, await this.client.get('/user/account/info', token.access_token));
    if (generation !== this.generation) throw new GatewayError(409, 'AUTH_CHANGED', '授权状态已改变，请重新开始');
    const next = { token, clientId: this.config.clientId, openid: user.openid, name: user.name, face: imageUrl(user.face) };
    this.vault.write(next); // Commit durable storage before advertising the new authorization.
    this.generation++; this.cache = undefined; this.lastVerifiedAt = null;
    this.grant = next; this.lastError = null;
    return { returnTo: flow.returnTo };
  }
  disconnect() {
    this.generation++; this.grant = null; this.cache = undefined; this.lastVerifiedAt = null; this.lastError = null; this.flows.clear(); this.vault.clear();
  }
  private async activeGrant(): Promise<Grant> {
    if (!this.status().authorized) throw new GatewayError(401, 'AUTHORIZATION_REQUIRED', this.status().message);
    const current = this.grant!;
    if (current.token.expires_in * 1000 - Date.now() > 300_000) return current;
    if (!this.refreshing) {
      const generation = this.generation;
      this.refreshing = (async () => {
        try {
          const token = await this.client.token('refresh_token', current.token.refresh_token);
          if (generation !== this.generation) throw new GatewayError(409, 'AUTH_CHANGED', '授权已改变，已丢弃续期结果');
          const next = { ...current, token }; this.vault.write(next); this.grant = next; return next;
        } catch (error) {
          // A refresh token is single-use. Do not retry an ambiguous failed refresh.
          if (generation === this.generation) this.disconnect();
          throw error;
        }
      })().finally(() => { this.refreshing = undefined; });
    }
    return this.refreshing;
  }
  private self(id: string) {
    if (id !== 'self') throw new GatewayError(409, 'SELF_ONLY', '官方接口仅返回已授权账号，不能验证输入 UID 的归属。请点击“分析已授权账号”；不会将别人的数据绑定到这个主页。');
  }
  private failed(error: unknown) {
    if (error instanceof GatewayError && ['BILIBILI_127001', 'BILIBILI_127011', 'UPSTREAM_UNAUTHORIZED'].includes(error.code)) this.disconnect();
    this.lastError = error instanceof GatewayError ? error.message : '采集失败，请检查配置'; this.lastVerifiedAt = null;
  }
  async creator(id: string): Promise<Creator> {
    this.self(id);
    try {
      const grant = await this.activeGrant(), generation = this.generation;
      // Validate the authorization even when the video snapshot is cached.
      const user = parse(profileSchema, await this.client.get('/user/account/info', grant.token.access_token));
      if (user.openid !== grant.openid || generation !== this.generation) throw new GatewayError(409, 'ACCOUNT_MISMATCH', '授权账号已改变，请重新授权');
      return creatorSchema.parse({ id: 'self', platform: 'bilibili', name: user.name, avatar: imageUrl(user.face), bio: '', followers: null, url: null });
    } catch (e) { this.failed(e); throw e; }
  }
  async videos(id: string): Promise<Snapshot> {
    this.self(id); await this.activeGrant();
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.data;
    if (!this.collecting) this.collecting = this.collect().finally(() => { this.collecting = undefined; });
    return this.collecting;
  }
  private async collect(): Promise<Snapshot> {
    const grant = await this.activeGrant(), generation = this.generation, started = Date.now();
    const warnings = ['仅分析 OAuth 授权账号；官方资料没有公开 UID，未绑定主页链接。', '官方资料接口不提供个人简介和粉丝数；未调用额外用户统计接口，缺失字段保持为空。', '未接入评论正文、弹幕或字幕；评论数不等于评论采样。'];
    const videos: Video[] = [], seen = new Set<string>(); let total: number | null = null, skipped = 0, duplicates = 0, pages = 0;
    try {
      for (let pn = 1; pn <= Math.ceil(this.config.maxVideos / 50); pn++) {
        if (generation !== this.generation) throw new GatewayError(409, 'AUTH_CHANGED', '采集期间授权改变，已停止请求');
        const data = parse(pageSchema, await this.client.get('/archive/viewlist', grant.token.access_token, { pn: String(pn), ps: '50', status: 'pubed' }));
        pages++; total = data.page.total;
        for (const raw of data.list) {
          const row = archiveSchema.safeParse(raw);
          if (!row.success || row.data.addit_info.state !== 0 || !row.data.ptime || row.data.ptime * 1000 > Date.now() || row.data.ptime < 1) { skipped++; continue; }
          const v = row.data;
          if (seen.has(v.resource_id)) { duplicates++; continue; }
          seen.add(v.resource_id);
          videos.push(videoSchema.parse({ id: v.resource_id, title: v.title, description: (v.desc || '').slice(0, 5000), tags: (v.tag || '').split(',').map(t => t.trim().slice(0, 60)).filter(Boolean).slice(0, 30),
            publishedAt: new Date(v.ptime! * 1000).toISOString(), collectedAt: new Date().toISOString(), duration: count(v.video_info?.duration), format: 'video',
            cover: imageUrl(v.cover), url: `https://www.bilibili.com/video/${v.resource_id}`, source: `${source} · archive/viewlist`,
          }));
          if (videos.length >= this.config.maxVideos) break;
        }
        if (videos.length >= this.config.maxVideos || data.list.length < 50 || pn * 50 >= data.page.total) break;
        if (Date.now() - started > 90_000) { warnings.push('采集达到 90 秒预算，已停止翻页。'); break; }
      }
      if (!videos.length) throw new GatewayError(422, 'NO_PUBLIC_VIDEOS', '已授权账号没有可分析的公开已发布作品，或作品缺少有效发布时间；不会替换成演示数据');
      let enriched = 0;
      for (const video of videos) {
        if (generation !== this.generation) throw new GatewayError(409, 'AUTH_CHANGED', '采集期间授权改变，已停止请求');
        if (Date.now() - started > 90_000) { warnings.push('采集达到 90 秒预算，未获取的播放与互动值保持为空。'); break; }
        try {
          const stats = parse(statSchema, await this.client.get('/data/arc/stat', grant.token.access_token, { resource_id: video.id }));
          Object.assign(video, { views: count(stats.view), likes: count(stats.like), coins: count(stats.coin), favorites: count(stats.favorite), comments: count(stats.reply), shares: count(stats.share), collectedAt: new Date().toISOString(), source: `${source} · archive/viewlist + data/arc/stat` }); enriched++;
        } catch (error) {
          if (error instanceof GatewayError && ['BILIBILI_127001', 'BILIBILI_127011', 'UPSTREAM_UNAUTHORIZED'].includes(error.code)) throw error;
          warnings.push(`互动统计在 ${enriched}/${videos.length} 条后停止：${error instanceof GatewayError ? error.message : '响应校验失败'}。未获取字段保持为空。`); break;
        }
      }
      if (generation !== this.generation) throw new GatewayError(409, 'AUTH_CHANGED', '采集期间授权改变，已丢弃旧账号结果');
      if (skipped) warnings.push(`跳过 ${skipped} 条未公开、发布时间无效或字段不符合文档的稿件。`);
      if (duplicates) warnings.push(`分页结果重复 ${duplicates} 条，已按稿件 ID 去重。`);
      if (total !== null && total < videos.length) { warnings.push('分页总数小于有效样本数，可能存在采集期间更新；总数标记为未知。'); total = null; }
      const collectedAt = new Date().toISOString();
      const result: Snapshot = { videos, total, collectedAt, source, warnings,
        coverage: `官方列表前 ${pages} 页，保留 ${videos.length} 条公开作品（上限 ${this.config.maxVideos}，列表报告总数 ${total ?? '未知'}）；已请求 ${enriched} 条互动统计，${videos.filter(v => v.views !== null).length} 条有播放值。列表顺序由上游决定，不代表完整历史；缓存 10 分钟。`,
      };
      this.cache = { data: result, expiresAt: Date.now() + this.config.cacheMs }; this.lastVerifiedAt = collectedAt; this.lastError = null;
      return result;
    } catch (e) { this.failed(e); throw e; }
  }
  async video(id: string) {
    const snapshot = await this.videos('self'), found = snapshot.videos.find(v => v.id === id);
    if (!found) throw new GatewayError(404, 'VIDEO_NOT_IN_SAMPLE', '该视频不在已授权账号的当前采样中');
    return found;
  }
}
