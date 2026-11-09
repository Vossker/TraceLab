import { useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, Download, Flag, Info, MessageSquare, Quote, Sparkles, TrendingUp } from 'lucide-react';
import type { AnalyzedVideo, Report } from '../../../packages/core/src/model';
import { reportSections } from '../../../packages/core/src/report';
import { colors, Cover, fmt, kindLabel, Modal, percent, shortDate, SourceLink } from './ui';

export function Highlights({ report, onSelect }: { report: Report; onSelect: (v: AnalyzedVideo) => void }) {
  const [all, setAll] = useState(false); const videos = report.analysis.highlights;
  return <section className="highlights-section" id="highlights"><div className="section-heading"><div><span className="eyebrow"><span className="section-index">03</span> STANDOUT MOMENTS</span><h2>那些被更多人看见的作品</h2><p>不只看播放量，更看它比可比作品走了多远。</p></div>{videos.length > 3 && <button className="text-link" onClick={() => setAll(!all)}>{all ? '收起作品' : `全部 ${videos.length} 条`}<ArrowRight size={16}/></button>}</div>
    {videos.length ? <div className="video-grid">{videos.slice(0, all ? 6 : 3).map((v, i) => <button className="video-card" key={v.id} onClick={() => onSelect(v)}><div className="video-cover-wrapper"><Cover video={v} color={colors[i % colors.length]}/><span className="relative-badge"><TrendingUp size={13}/>{v.relative.value!.toFixed(1)}× 相对表现</span></div><div className="video-card-body"><div className="video-meta"><span>{v.topic}</span><span>{shortDate(v.publishedAt)}</span></div><h3>{v.title}</h3><div className="video-stats"><span><b>{fmt(v.views)}</b> 播放</span><span><b>{percent(v.engagement)}</b> 互动率</span><ArrowUpRight size={17}/></div></div></button>)}</div> : <div className="panel empty-state"><TrendingUp size={28}/><h3>还没有足够证据识别高表现作品</h3><p>至少需要 5 条满足时间、发布时长与内容形式要求的可比作品，并达到 2 倍中位数。不会用绝对播放排名代替。</p></div>}
    <div className="fine-print"><Info size={13}/>相对表现 = 当前累计播放量 ÷ 可比作品播放中位数。点击作品查看比较对象、基准与数据缺口。</div>
  </section>;
}

export function Feedback({ report, onSelect }: { report: Report; onSelect: (v: AnalyzedVideo) => void }) {
  const [cluster, setCluster] = useState<string | null>(null);
  const groups = report.ai?.commentClusters.map(c => ({ ...c, videoIds: report.dataset.comments.filter(x => c.commentIds.includes(x.id)).map(x => x.videoId) })) ?? report.analysis.feedback;
  const selected = groups.find(g => g.label === cluster);
  const comments = selected ? report.dataset.comments.filter(c => selected.commentIds.includes(c.id)) : report.dataset.comments;
  const sentiment = report.ai?.commentClusters.find(g => g.label === cluster)?.sentiment;
  const sentimentLabels = { positive: '正向反馈', negative: '负向反馈', mixed: '混合反馈', neutral: '中性反馈' };
  const topicCoverage = report.analysis.topics.map(topic => ({ name: topic.name, count: report.dataset.comments.filter(c => topic.evidenceIds.includes(c.videoId)).length })).filter(t => t.count > 0);
  return <section className="panel feedback-panel" id="feedback"><div className="panel-heading"><div><span className="eyebrow"><span className="section-index">04</span> AUDIENCE SIGNALS</span><h2>听见数字之外的声音</h2></div><span className="small-badge">{report.ai ? 'AI 评论聚类' : '关键词规则归组'}</span></div>
    {topicCoverage.length > 0 && <div className="feedback-summary"><span>主题覆盖：{topicCoverage.map(t => `${t.name} ${t.count} 条`).join(' · ')}{sentiment ? ` / AI 情绪标签：${sentimentLabels[sentiment]}（需复核）` : ''}</span></div>}
    {!comments.length && !report.dataset.comments.length ? <div className="empty-state"><MessageSquare size={25}/><h3>暂未获得评论样本</h3><p>报告仍可正常生成。导入包含 comments 的 JSON 可补充观众反馈。</p></div> : <><div className="feedback-summary"><MessageSquare size={16}/><span>{report.dataset.comments.length} 条{report.dataset.mode === 'demo' ? '模拟' : '采样'}评论 · 覆盖 {new Set(report.dataset.comments.map(c => c.videoId)).size} 条作品 · 非随机样本</span></div><div className="feedback-tags"><button className={!cluster ? 'active' : ''} onClick={() => setCluster(null)}>全部反馈</button>{groups.map(g => <button key={g.label} className={cluster === g.label ? 'active' : ''} onClick={() => setCluster(g.label)}>{g.label}<span>{g.commentIds.length}</span></button>)}</div><div className="quotes-grid">{comments.slice(0, 3).map(c => <blockquote key={c.id}><Quote size={20}/><p>{c.text}</p><footer><button onClick={() => onSelect(report.analysis.videos.find(v => v.id === c.videoId)!)}>来源作品 <ArrowUpRight size={12}/></button><span>{fmt(c.likes)} 赞</span></footer><small>{c.source} · {shortDate(c.collectedAt)}</small></blockquote>)}</div><p className="fine-print">展示当前分组的前 {Math.min(3, comments.length)} / {comments.length} 条评论。完整样本可在来源作品详情或导出的 JSON 中查看；不以样本推断全体观众态度。</p></>}
  </section>;
}

export function GrowthReport({ report, onSelect, onAI, aiBusy, aiAvailable, onExport }: { report: Report; onSelect: (v: AnalyzedVideo) => void; onAI: () => void; aiBusy: boolean; aiAvailable: boolean; onExport: () => void }) {
  const sections = report.ai?.sections ?? reportSections(report);
  const [open, setOpen] = useState<number[]>([0, 1, 2, 3, 4]);
  return <section className="panel growth-report" id="report"><div className="report-header"><div><span className="eyebrow"><span className="section-index">05</span> THE STORY BEHIND THE DATA</span><h2>从线索，到一个有依据的故事。</h2><p>{report.ai?.headline ?? '每一个结论，都应该能回到一条作品。'}</p></div><div className="report-symbol"><BookOpen size={30} strokeWidth={1.3}/></div></div>
    <div className="report-mode"><span><i className={report.ai ? 'status-dot' : 'status-dot neutral'}/>{report.ai ? `AI 解读 · ${report.aiModel}` : '基础研究报告 · 确定性统计 + 规则生成'}</span><button onClick={onAI} disabled={aiBusy} className="small-button"><Sparkles size={14}/>{aiBusy ? '正在分析…' : report.ai ? '重新生成 AI 解读' : '生成 AI 深度解读'}</button></div>
    {!report.ai && <p className="ai-availability">{aiAvailable ? '模型已配置。点击后将把标题、描述、统计与采样评论发送至所配置的 LLM 服务。' : '未配置大模型时，完整基础报告仍可使用；AI 解读需要服务端 API Key。'}</p>}
    <div className="report-sections">{sections.map((section, i) => <article key={section.title}><button className="report-section-toggle" onClick={() => setOpen(open.includes(i) ? open.filter(x => x !== i) : [...open, i])} aria-expanded={open.includes(i)}><span className="report-number">0{i + 1}</span><h3>{section.title}</h3><span className={`kind-badge ${section.kind}`}>{kindLabel[section.kind]}</span><ChevronDown size={17} className={open.includes(i) ? 'rotated' : ''}/></button><div hidden={!open.includes(i)} className="report-section-content"><p>{section.text}</p><div className="evidence-list"><span>作品证据</span>{section.evidenceIds.slice(0, 6).map(id => { const video = report.analysis.videos.find(v => v.id === id); return video && <button key={id} title={video.title} onClick={() => onSelect(video)}>{id}<ArrowUpRight size={11}/></button>; })}</div></div></article>)}</div>
    <div className="report-limitations"><Info size={17}/><div><strong>知道什么，也说明不知道什么</strong><p>单次快照无法还原历史流量；选题变化与表现变化可能相关，但不是因果结论。{report.ai ? 'AI 内容已通过结构与引用校验，语义仍需人工复核。' : '尚未调用 LLM，不把规则文本标为 AI 生成。'}</p>{report.ai?.uncertainties.map((u, i) => <p key={i}>{u}</p>)}</div></div>
    <div className="report-footer"><span><Check size={14}/>每个结论关联原始作品样本</span><button className="text-link" onClick={onExport}><Download size={15}/>带走这份研究</button></div>
  </section>;
}

export function VideoDetail({ report, video, onClose, onSelect, pinned, onPin }: { report: Report; video: AnalyzedVideo; onClose: () => void; onSelect: (v: AnalyzedVideo) => void; pinned: boolean; onPin: () => void }) {
  const comments = report.dataset.comments.filter(c => c.videoId === video.id);
  const classification = report.ai?.classifications.find(c => c.videoId === video.id);
  const aiSections = report.ai?.sections.filter(s => s.evidenceIds.includes(video.id));
  return <Modal title="从一个作品，继续追问" subtitle={`${video.id} · ${report.dataset.mode === 'demo' ? '模拟演示作品' : '作品证据'}`} onClose={onClose} wide>
    <div className="detail-top"><Cover video={video} large/><div><span className="tag">{video.topic}</span><h3>{video.title}</h3><p>{video.description || '暂无视频简介'}</p><SourceLink video={video}/></div></div>
    <div className="detail-stats">{[['累计播放', fmt(video.views)], ['点赞', fmt(video.likes)], ['互动率', percent(video.engagement)], ['相对表现', video.relative.value === null ? '样本不足' : `${video.relative.value.toFixed(1)}×`]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="detail-dates"><span>发布：{shortDate(video.publishedAt)}</span><span>采集：{shortDate(video.collectedAt)}</span><span>来源：{video.source}</span></div>
    <div className="detail-explanation"><h4><TrendingUp size={16}/>如何判断这条作品的表现？</h4><p>{video.relative.reason}。{video.relative.baseline !== null ? `比较组中位数为 ${fmt(video.relative.baseline)} 播放，共 ${video.relative.peerIds.length} 条作品。` : ''}</p><p>这是当前累计表现的相对比较，不表示发布当时的传播速度或创作者的历史流量。</p><div className="evidence-list">{video.relative.peerIds.slice(0, 12).map(id => <button key={id} title={report.analysis.videos.find(v => v.id === id)?.title} onClick={() => onSelect(report.analysis.videos.find(v => v.id === id)!)}>{id}<ArrowUpRight size={11}/></button>)}</div></div>
    <div className="detail-explanation"><h4><Sparkles size={16}/>{classification ? 'AI 主题理解' : '内容分类依据'}</h4><p>{classification ? `建议主题「${classification.topic}」：${classification.reason}` : `主题「${video.topic}」来自${{ provided: '数据提供者的标签', platform: 'B 站分区', rule: '标题、描述与标签的关键词规则', llm: 'LLM 分类' }[video.topicSource]}。未读取未提供的字幕或视频画面。`}</p>{aiSections?.length ? aiSections.map(s => <p key={s.title}><span className={`kind-badge ${s.kind}`}>{kindLabel[s.kind]}</span> {s.text}</p>) : <p className="muted">此作品暂无 AI 解读。可在成长报告模块配置并生成有证据引用的 AI 分析。</p>}</div>
    {comments.length > 0 && <div className="detail-explanation"><h4><MessageSquare size={16}/>这条作品的反馈 · {comments.length} 条样本</h4>{comments.map(c => <blockquote className="detail-comment" key={c.id}>“{c.text}”<small>{c.source} · {shortDate(c.collectedAt)}</small></blockquote>)}</div>}
    <div className="modal-actions"><button className={pinned ? 'secondary-button' : 'primary-button'} onClick={onPin}><Flag size={16}/>{pinned ? '取消时间线标记' : '标记到时间线'}</button><button className="secondary-button" onClick={onClose}>返回研究</button></div>
  </Modal>;
}
