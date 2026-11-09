import type { Report, Insight } from './model';

export const reportSections = (report: Report): Insight[] => {
  const a = report.analysis, d = report.dataset;
  return [
    { kind: 'fact', title: '创作者概览', text: `研究问题：${d.creator.name}如何在作品中形成自己的内容方向？本次观察 ${a.count} 条作品，时间范围为 ${a.start.slice(0, 10)} 至 ${a.end.slice(0, 10)}。主要主题为「${a.topics[0].name}」（${a.topics[0].count} 条）。这是作品样本研究，不是历史粉丝增长的还原。`, evidenceIds: a.topics[0].evidenceIds.slice(0, 3) },
    { kind: a.changes.some(c => c.kind === 'topic') ? 'association' : 'fact', title: '创作轨迹', text: a.changes.filter(c => c.kind === 'topic').map(c => c.description).join(' ') || '相邻季度尚未出现满足阈值的主题占比变化，或季度样本不足。已有数据不能支持强行划分创作阶段。', evidenceIds: a.changes.filter(c => c.kind === 'topic').map(c => c.videoId).slice(0, 5).concat(a.videos[0].id) },
    { kind: 'association', title: '关键转折', text: a.insights[1].text + '这些是进一步研究的候选节点，而非已证实的创作转折。', evidenceIds: a.insights[1].evidenceIds },
    { kind: 'fact', title: '内容特点', text: `样本包含 ${a.topics.length} 个主题。${a.topics.slice(0, 3).map(t => `「${t.name}」${(t.share * 100).toFixed(0)}%`).join('、')}。标题与标签可用于观察选题倾向，但无法单独判断镜头、表达方式或完整视频风格。${d.comments.length ? `采样 ${d.comments.length} 条评论，覆盖 ${new Set(d.comments.map(c => c.videoId)).size} 条作品，可辅助提出解释。` : '未获得评论，不推断观众情绪。'}`, evidenceIds: a.topics.flatMap(t => t.evidenceIds.slice(0, 1)).slice(0, 6) },
    { kind: 'hypothesis', title: '分析结论', text: `当前证据支持的结论是：${d.creator.name}的公开样本主要围绕「${a.topics[0].name}」展开，${a.highlights.length ? '其中存在相对同类作品明显突出的作品' : '还没有足够证据识别稳定的高表现作品'}。可继续验证“主题集中是否伴随更稳定的传播表现”，但不能把相关性解释为成长原因。建议记录后续作品发布后第 7 / 30 天的同口径快照，并补充观众反馈。`, evidenceIds: (a.highlights.length ? a.highlights : a.videos.slice(-3)).slice(0, 3).map(v => v.id) },
  ];
};
export function markdownReport(report: Report): string {
  const label = { demo: '模拟演示数据', import: '用户导入数据（未独立核验）', live: '已配置的数据源' }[report.dataset.mode];
  const sections = report.ai?.sections ?? reportSections(report);
  const escape = (s: string) => s.replace(/[[\]<>`*_]/g, c => `\\${c}`);
  return `# ${escape(report.dataset.creator.name)} · 创作者成长报告\n\n> 创迹 CreatorTrace / TraceLab\n\n数据模式：${label}\n采集时间：${report.dataset.collectedAt}\n来源：${escape(report.dataset.source)}\n覆盖范围：${escape(report.dataset.coverage)}\n分析方式：${report.ai ? `LLM（${escape(report.aiModel || '')}），经结构校验，仍需人工复核` : '确定性统计与规则报告，未调用 LLM'}\n\n` +
    sections.map((s, i) => `## ${i + 1}. ${s.title}\n\n[${{ fact: '事实', association: '相关性', hypothesis: '待验证解释' }[s.kind]}] ${escape(s.text)}\n\n证据：${s.evidenceIds.map(id => { const v = report.analysis.videos.find(v => v.id === id); return v ? `${escape(id)}「${escape(v.title)}」${v.url ? ` <${v.url}>` : '（无外部链接）'}` : escape(id); }).join('；')}\n`).join('\n') +
    '\n## 方法与局限\n\n' + report.analysis.limitations.concat(report.ai?.uncertainties ?? []).map(l => `- ${escape(l)}`).join('\n') +
    '\n\n相对表现：自身累计播放量 / 可比作品播放量中位数。可比组要求：发布相距 ≤120 天、采集相距 ≤7 天、发布时长比 0.67–1.5、视频时长比 0.5–2、相同内容形式、发布至少 30 天、至少 5 条且不包含自身。高表现阈值 ≥2 倍。\n';
}
