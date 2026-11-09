import type { Analysis, AnalyzedVideo, Change, Dataset, Insight, Relative, Video } from './model';

const DAY = 86_400_000;
export function median(values: (number | null)[]): number | null {
  const sorted = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}
// Strict complete-case rate: missing counters are never silently replaced with zero.
export function engagement(v: Video): number | null {
  if (!v.views || [v.likes, v.coins, v.favorites, v.comments, v.shares].some(n => n === null)) return null;
  return (v.likes! + v.coins! + v.favorites! + v.comments! + v.shares!) / v.views;
}
export function classify(v: Video): string {
  if (v.topic) return v.topic;
  const text = `${v.title} ${v.description} ${v.tags.join(' ')}`;
  const rules: [string, RegExp][] = [['生活实验', /实验|挑战|坚持|尝试|一周|30天|改造/], ['数码科技', /数码|手机|电脑|测评|评测|键盘|耳机|相机/], ['影像记录', /摄影|影像|旅行|旅拍|城市|散步|vlog/i], ['创作手记', /幕后|创作|剪辑|复盘|手记|拍摄/]];
  return rules.find(([, rule]) => rule.test(text))?.[0] ?? '其他内容';
}
export function relativePerformance(video: Video, videos: Video[]): Relative {
  const excluded = (reason: string): Relative => ({ value: null, baseline: null, peerIds: [], reason });
  if (video.views === null) return excluded('缺少播放量');
  if (video.duration === null || video.duration === 0 || video.format === 'unknown') return excluded('缺少时长或内容形式，无法建立可靠的可比组');
  const duration = video.duration;
  const age = (Date.parse(video.collectedAt) - Date.parse(video.publishedAt)) / DAY;
  if (age < 30) return excluded('发布不足 30 天，累计曝光尚不稳定');
  const peers = videos.filter(v => {
    const peerAge = (Date.parse(v.collectedAt) - Date.parse(v.publishedAt)) / DAY;
    return v.id !== video.id && v.views !== null && v.duration !== null && v.duration > 0 &&
      v.format === video.format && Math.abs(Date.parse(v.publishedAt) - Date.parse(video.publishedAt)) <= 120 * DAY &&
      Math.abs(Date.parse(v.collectedAt) - Date.parse(video.collectedAt)) <= 7 * DAY &&
      peerAge >= 30 && peerAge / age >= 0.67 && peerAge / age <= 1.5 &&
      v.duration / duration >= 0.5 && v.duration / duration <= 2;
  });
  const baseline = median(peers.map(v => v.views));
  const result = { baseline, peerIds: peers.map(v => v.id) };
  if (peers.length < 5) return { ...result, value: null, reason: `仅 ${peers.length} 条可比作品，至少需要 5 条` };
  if (!baseline) return { ...result, value: null, reason: '可比作品中位数为 0，无法计算比值' };
  return { ...result, value: video.views / baseline, reason: '发布相距 ≤120 天；采集相距 ≤7 天；发布时长比 0.67–1.5；视频时长比 0.5–2；相同内容形式；排除自身' };
}
export function analyze(dataset: Dataset): Analysis {
  const raw = [...dataset.videos].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  const videos: AnalyzedVideo[] = raw.map(v => ({ ...v, topic: classify(v), topicSource: v.topic ? v.topicSource : 'rule', engagement: engagement(v), relative: relativePerformance(v, raw) }));
  const start = videos[0].publishedAt, end = videos.at(-1)!.publishedAt;
  const days = (Date.parse(end) - Date.parse(start)) / DAY;
  const recent = videos.slice(-12);
  const topics = [...new Set(videos.map(v => v.topic!))].map(name => {
    const group = videos.filter(v => v.topic === name);
    return { name, count: group.length, share: group.length / videos.length, median: median(group.map(v => v.views)), engagement: median(group.map(v => v.engagement)), evidenceIds: group.map(v => v.id) };
  }).sort((a, b) => b.count - a.count);
  const periodKeys = [...new Set(videos.map(v => `${v.publishedAt.slice(0, 4)} Q${Math.floor(new Date(v.publishedAt).getUTCMonth() / 3) + 1}`))];
  const periods = periodKeys.map(key => {
    const group = videos.filter(v => `${v.publishedAt.slice(0, 4)} Q${Math.floor(new Date(v.publishedAt).getUTCMonth() / 3) + 1}` === key);
    return { key, count: group.length, median: median(group.map(v => v.views)), topics: Object.fromEntries(topics.map(t => [t.name, group.filter(v => v.topic === t.name).length])), evidenceIds: group.map(v => v.id) };
  });
  const highlights = videos.filter(v => v.relative.value !== null && v.relative.value >= 2).sort((a, b) => b.relative.value! - a.relative.value!).slice(0, 6);
  const changes: Change[] = highlights.slice(0, 3).map(v => ({ videoId: v.id, date: v.publishedAt, kind: 'outlier', title: '异常高表现候选', description: `当前累计播放为 ${v.relative.peerIds.length} 条可比作品中位数的 ${v.relative.value!.toFixed(1)} 倍；不代表发布时的即时流量。` }));
  // A topic-mix candidate, not a causal or account-growth changepoint.
  for (let i = 1; i < periods.length; i++) {
    const prev = periods[i - 1], curr = periods[i];
    const quarterIndex = (key: string) => Number(key.slice(0, 4)) * 4 + Number(key.at(-1));
    if (quarterIndex(curr.key) - quarterIndex(prev.key) !== 1) continue;
    if (prev.count < 5 || curr.count < 5) continue;
    const topic = topics.find(t => curr.topics[t.name] / curr.count - prev.topics[t.name] / prev.count >= 0.4);
    if (topic) {
      const v = videos.find(v => curr.evidenceIds.includes(v.id) && v.topic === topic.name)!;
      changes.push({ videoId: v.id, date: v.publishedAt, kind: 'topic', title: `「${topic.name}」占比变化`, description: `「${topic.name}」从 ${prev.key} 的 ${Math.round(prev.topics[topic.name] / prev.count * 100)}% 变为 ${curr.key} 的 ${Math.round(curr.topics[topic.name] / curr.count * 100)}%。仅为相邻季度样本中的主题变化。` });
    }
  }
  const insights: Insight[] = [{ kind: 'fact', title: `「${topics[0].name}」是样本中的主要方向`, text: `${topics[0].count} / ${videos.length} 条作品属于这一主题，占比 ${(topics[0].share * 100).toFixed(0)}%。分类基于 B 站分区、已提供标签或标题关键词，不能等同于完整视频内容。`, evidenceIds: topics[0].evidenceIds.slice(0, 5) }];
  if (highlights.length) insights.push({ kind: 'association', title: `${highlights.length} 条作品值得进一步研究`, text: `在可比组中，这些作品的当前累计播放量至少达到中位数的 2 倍。「${highlights[0].title}」为 ${highlights[0].relative.value!.toFixed(1)} 倍。作品主题与表现同时出现，不足以建立因果关系。`, evidenceIds: highlights.map(v => v.id) });
  else insights.push({ kind: 'fact', title: '暂未识别出可靠的高表现候选', text: '可比组不足或相对表现未达到 2 倍阈值。系统不会用总播放量排名替代可靠的相对表现。', evidenceIds: videos.slice(-3).map(v => v.id) });
  const topicChanges = changes.filter(c => c.kind === 'topic');
  insights.push(topicChanges.length ? { kind: 'association', title: '作品主题组合出现可观察的变化', text: topicChanges[0].description + ' 这不是对创作生涯的自动分期，需要更多连续观测验证。', evidenceIds: [topicChanges[0].videoId] } : { kind: 'hypothesis', title: '下一步：用连续快照验证风格变化', text: '单次采集只描述目前可见的作品。持续记录发布后 7 天与 30 天表现，才能更可靠地研究内容调整与传播的关系。', evidenceIds: videos.slice(-3).map(v => v.id) });
  const feedbackRules: [string, RegExp][] = [['过程与真实感', /真实|过程|记录|细节/], ['实用与启发', /实用|学到|尝试|有用|启发/], ['节奏与信息密度', /节奏|太长|拖沓|太快|干货|剪辑/], ['对内容变化的反馈', /以前|变化|风格|越来越|转型/]];
  const feedback = feedbackRules.map(([label, regex]) => {
    const found = dataset.comments.filter(c => regex.test(c.text));
    return { label, commentIds: found.map(c => c.id), videoIds: [...new Set(found.map(c => c.videoId))] };
  }).filter(g => g.commentIds.length);
  return {
    count: videos.length, viewCount: videos.filter(v => v.views !== null).length,
    median: median(videos.map(v => v.views)), recentMedian: median(recent.map(v => v.views)), recentCount: recent.filter(v => v.views !== null).length,
    engagement: median(videos.map(v => v.engagement)), engagementCount: videos.filter(v => v.engagement !== null).length,
    monthlyFrequency: days >= 30 ? (videos.length - 1) / (days / 30.4375) : null,
    start, end, topics, periods, videos, highlights, changes: changes.sort((a, b) => a.date.localeCompare(b.date)), insights, feedback,
    limitations: [
      '播放量为各作品在所示采集时间的累计值，不是发布当时的账号流量，也不能还原历史粉丝增长。',
      '相对表现仅缓解发布时间、发布时长与视频长度的差异；分发、推广、删稿和幸存者偏差仍未控制。',
      '互动率 =（点赞 + 投币 + 收藏 + 评论 + 分享）÷ 播放量，是动作数之比，不是独立用户比例；任一字段缺失即不计算。',
      '主题来自 B 站分区（投稿时选择，不等于内容主题）、导入标签、关键词规则或标明来源的 LLM 推断，不涉及未获取的字幕与画面。',
      '评论为非随机样本，只代表采样评论；同一评论可命中多个主题，未采样不代表没有相关反馈。',
      ...dataset.warnings,
    ],
  };
}
