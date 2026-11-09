import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { creatorSchema, datasetSchema, videoSchema, type Dataset, type Video } from '../../packages/core/src/model';
import { bilibiliZones } from '../../packages/core/src/bilibili-zones';

const SOURCE = 'Bilibili 网站公开接口（非开放平台）';
const LIST = '/x/series/recArchivesByKeywords';
const CARD = '/x/web-interface/card';
const VIEW = '/x/web-interface/view';
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const uid = z.union([z.string().regex(/^[1-9]\d{0,19}$/), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform(String);
const rowSchema = z.object({ bvid: z.string().regex(/^BV[A-Za-z0-9]{10}$/), title: z.string().min(1).max(500), pubdate: z.number().int().positive(), state: z.number(), duration: z.number().optional(), pic: z.string().optional(), stat: z.object({ view: z.number().optional() }).optional() });
const listSchema = z.object({ archives: z.array(z.unknown()), page: z.object({ total: z.number().int().nonnegative() }) });
const profileSchema = z.object({ card: z.object({ mid: uid, name: z.string().min(1).max(120), sign: z.string().optional(), face: z.string().optional() }), follower: z.number().optional() });
// Zone fields are best-effort: a format change here must not discard the video's statistics.
const detailSchema = z.object({ bvid: z.string(), owner: z.object({ mid: uid }), desc: z.string().optional(), tid: z.number().optional().catch(undefined), tname: z.string().optional().catch(undefined), tname_v2: z.string().optional().catch(undefined), stat: z.object({ view: z.number().optional(), like: z.number().optional(), coin: z.number().optional(), favorite: z.number().optional(), reply: z.number().optional(), share: z.number().optional() }) });
const zoneName = (name?: string) => { const trimmed = name?.trim(); return trimmed && trimmed.length <= 60 ? trimmed : null; };
const zoneTopic = (d: { tid?: number; tname?: string; tname_v2?: string }) => zoneName(d.tname_v2) ?? zoneName(d.tname) ?? (d.tid === undefined ? null : bilibiliZones[d.tid] ?? null);
const safeImage = (s?: string) => { try { const u = new URL(s?.startsWith('//') ? 'https:' + s : s || ''); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
export class PublicDataError extends Error {
  constructor(public code: string, message: string, public restricted = false) { super(message); }
}
type Progress = (value: number, message: string) => void;
export class PublicBilibiliProvider {
  private queue: Promise<unknown> = Promise.resolve();
  private nextAt = 0;
  private blockedUntil = 0;
  private lastError: string | null = null;
  private lastSuccess: { uid: string; collectedAt: string } | null = null;
  private cache = new Map<string, { data: Dataset; expires: number }>();
  private pending = new Map<string, Promise<Dataset>>();
  constructor(private transport: typeof fetch = fetch, private intervalMs = 1000, private maxVideos = 30) {}
  status() { return { enabled: process.env.PUBLIC_DATA_ENABLED !== 'false', state: this.blockedUntil > Date.now() ? 'restricted' : this.lastError ? 'last_attempt_failed' : this.lastSuccess ? 'sample_verified' : 'untested', lastError: this.lastError, lastSuccess: this.lastSuccess, retryAfter: this.blockedUntil > Date.now() ? new Date(this.blockedUntil).toISOString() : null, maxVideos: this.maxVideos }; }
  private request(path: typeof LIST | typeof CARD | typeof VIEW, params: Record<string, string>): Promise<unknown> {
    const task = this.queue.then(async () => {
      if (this.blockedUntil > Date.now()) throw new PublicDataError('COOLDOWN', '公开接口当前受限，已暂停请求 1 分钟。可导入数据或稍后手动重试。', true);
      await delay(Math.max(0, this.nextAt - Date.now())); this.nextAt = Date.now() + this.intervalMs;
      const url = new URL(path, 'https://api.bilibili.com'); url.search = new URLSearchParams(params).toString();
      let response: Response;
      try { response = await this.transport(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
      catch { throw new PublicDataError('NETWORK', `公开接口 ${path} 网络错误或超时；未重试`); }
      const stop = (message: string): never => { this.blockedUntil = Date.now() + 60_000; throw new PublicDataError('RESTRICTED', message + '；已停止采集并冷却 1 分钟，不更换接口或身份', true); };
      if ([401, 403, 412, 429].includes(response.status)) stop(`公开接口 ${path} 返回 HTTP ${response.status}（访问或频率受限）`);
      if (!response.ok) throw new PublicDataError('HTTP', `公开接口 ${path} 返回 HTTP ${response.status}`);
      let raw: unknown; try { raw = await response.json(); } catch { throw new PublicDataError('FORMAT', `公开接口 ${path} 未返回 JSON，已停止当前采集`); }
      const parsed = z.object({ code: z.number(), data: z.unknown().optional() }).safeParse(raw);
      if (!parsed.success) throw new PublicDataError('SCHEMA', '公开接口响应结构发生变化');
      const { code, data } = parsed.data;
      if ([-101, -352, -403, -412, -509, -799].includes(code)) stop(`公开接口 ${path} 返回 code ${code}，需要登录、验证或接口不可用`);
      if (code !== 0) throw new PublicDataError('UPSTREAM', `公开接口 ${path} 返回 code ${code}；未重试`);
      if (data && typeof data === 'object' && 'v_voucher' in data) stop('公开接口要求额外验证');
      return data;
    });
    this.queue = task.catch(() => undefined); return task;
  }
  async collect(id: string, progress: Progress = () => {}): Promise<Dataset> {
    uid.parse(id);
    if (process.env.PUBLIC_DATA_ENABLED === 'false') throw new PublicDataError('DISABLED', '管理员已关闭网站公开接口读取');
    const cached = this.cache.get(id);
    if (cached && cached.expires > Date.now()) { progress(75, '读取 10 分钟内的真实快照缓存（保留原采集时间）'); return structuredClone(cached.data); }
    if (!this.pending.has(id)) {
      const task = this.collectFresh(id, progress).then(data => {
        if (this.cache.size >= 20) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(id, { data, expires: Date.now() + 600_000 }); this.lastSuccess = { uid: id, collectedAt: data.collectedAt }; return data;
      }).catch(error => { this.lastError = error instanceof Error ? error.message : '公开接口读取失败'; throw error; }).finally(() => this.pending.delete(id));
      this.pending.set(id, task);
    }
    return structuredClone(await this.pending.get(id)!);
  }
  private async collectFresh(id: string, progress: Progress): Promise<Dataset> {
    const started = Date.now(); this.lastError = null;
    progress(10, '读取公开创作者资料');
    const profile = profileSchema.parse(await this.request(CARD, { mid: id }));
    if (profile.card.mid !== id) throw new PublicDataError('IDENTITY', '公开接口返回的创作者 UID 与请求不一致');
    const creator = creatorSchema.parse({ id, platform: 'bilibili', name: profile.card.name, bio: (profile.card.sign || '').slice(0, 2000), avatar: safeImage(profile.card.face), followers: count(profile.follower), url: `https://space.bilibili.com/${id}` });
    const videos: Video[] = [], seen = new Set<string>(), warnings = ['非开放平台接口；公开可读不代表官方授权或长期稳定。', '仅为采集时累计数据，不代表历史即时播放或粉丝增长。', '未采集评论正文、弹幕和字幕；不将评论数作为评论样本。'];
    let total: number | null = null, pages = 0, skipped = 0, pageFailed = false;
    for (let pn = 1; pn <= Math.ceil(this.maxVideos / 30); pn++) {
      progress(20 + pn * 5, `读取公开作品第 ${pn} 页`);
      let page: z.infer<typeof listSchema>;
      try { page = listSchema.parse(await this.request(LIST, { mid: id, keywords: '', pn: String(pn), ps: '30', orderby: 'pubdate' })); }
      catch (error) { if (!videos.length) throw error; warnings.push(`分页提前停止：${error instanceof Error ? error.message : '请求失败'}`); this.lastError = warnings.at(-1)!; pageFailed = true; break; }
      pages++; total = page.page.total;
      for (const raw of page.archives) {
        const parsed = rowSchema.safeParse(raw);
        if (!parsed.success || parsed.data.state !== 0 || parsed.data.pubdate * 1000 > Date.now()) { skipped++; continue; }
        const row = parsed.data; if (seen.has(row.bvid)) continue; seen.add(row.bvid);
        videos.push(videoSchema.parse({ id: row.bvid, title: row.title, publishedAt: new Date(row.pubdate * 1000).toISOString(), collectedAt: new Date().toISOString(), views: count(row.stat?.view), duration: count(row.duration), format: 'video', cover: safeImage(row.pic), url: `https://www.bilibili.com/video/${row.bvid}`, source: `${SOURCE} · ${LIST}` }));
        if (videos.length >= this.maxVideos) break;
      }
      if (page.archives.length < 30 || pn * 30 >= page.page.total || videos.length >= this.maxVideos || Date.now() - started > 80_000) break;
    }
    if (!videos.length) throw new PublicDataError('EMPTY', '该 UID 没有可读取的公开作品，或数据缺少有效发布时间；未生成报告');
    let enriched = 0;
    const foreign = new Set<string>();
    // A failed page must not trigger another upstream endpoint as a fallback.
    if (!pageFailed) for (const video of videos) {
      if (Date.now() - started > 80_000) { warnings.push('达到 80 秒采集预算，其余互动字段未读取。'); break; }
      progress(40 + Math.floor(enriched / videos.length * 35), `读取视频详情 ${enriched + 1}/${videos.length}`);
      try {
        const detail = detailSchema.parse(await this.request(VIEW, { bvid: video.id }));
        if (detail.bvid !== video.id) throw new PublicDataError('IDENTITY', '详情返回的视频 ID 不一致，已拒绝整次结果');
        if (detail.owner.mid !== id) { foreign.add(video.id); continue; }
        const s = detail.stat, topic = zoneTopic(detail);
        Object.assign(video, topic ? { topic, topicSource: 'platform' } : {}, { description: (detail.desc || '').slice(0, 5000), views: count(s.view), likes: count(s.like), coins: count(s.coin), favorites: count(s.favorite), comments: count(s.reply), shares: count(s.share), collectedAt: new Date().toISOString(), source: `${SOURCE} · ${LIST} + ${VIEW}` }); enriched++;
      } catch (error) {
        if (error instanceof PublicDataError && error.code === 'IDENTITY') throw error;
        this.lastError = error instanceof Error ? error.message : '详情读取失败'; warnings.push(`详情补充停止：${this.lastError}。已取得的列表数据保留，其余字段为暂无数据。`); break;
      }
    }
    if (skipped) warnings.push(`跳过 ${skipped} 条非公开或字段无效的作品。`);
    if (foreign.size) warnings.push(`排除 ${foreign.size} 条详情 owner.mid 与请求 UID 不同的作品；未推断联合投稿或账号迁移关系。`);
    const ownedVideos = videos.filter(video => !foreign.has(video.id));
    if (!ownedVideos.length) throw new PublicDataError('IDENTITY', '已读取作品的归属均与请求 UID 不一致，未生成报告');
    const unzoned = ownedVideos.filter(video => !video.topic).length;
    if (unzoned) warnings.push(`${unzoned} 条作品未取得 B 站分区，主题回退为关键词规则。`);
    if (total !== null && total < videos.length) { total = null; warnings.push('列表总数与样本矛盾，总数标记为未知。'); }
    return datasetSchema.parse({ version: 1, mode: 'live', creator, videos: ownedVideos, comments: [], totalVideos: total, collectedAt: new Date().toISOString(), source: SOURCE, warnings,
      coverage: `公开列表 ${pages} 页，保留 ${ownedVideos.length} 条（默认上限 ${this.maxVideos}；接口报告总数 ${total ?? '未知'}）；${enriched} 条详情成功且归属校验通过。按发布日期请求排序，非完整历史，未包含不可见作品；快照缓存 10 分钟。` });
  }
}
