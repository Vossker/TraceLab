import { useMemo, useState } from 'react';
import { ArrowUpRight, Flag, Info, Maximize2, MousePointer2, RotateCcw } from 'lucide-react';
import type { Analysis, AnalyzedVideo } from '../../../packages/core/src/model';
import { median } from '../../../packages/core/src/analysis';
import { colors, Cover, fmt, percent, shortDate } from './ui';

export default function Timeline({ analysis, onSelect, pins, onTogglePin }: { analysis: Analysis; onSelect: (video: AnalyzedVideo) => void; pins: string[]; onTogglePin: (id: string) => void }) {
  const [metric, setMetric] = useState<'views' | 'engagement'>('views');
  const [topic, setTopic] = useState('all'); const [range, setRange] = useState('all');
  const [log, setLog] = useState(true); const [hovered, setHovered] = useState<string | null>(null); const [expanded, setExpanded] = useState(false);
  const end = Date.parse(analysis.end);
  const videos = useMemo(() => analysis.videos.filter(v => (topic === 'all' || v.topic === topic) && (range === 'all' || end - Date.parse(v.publishedAt) <= Number(range) * 86400000)), [analysis, topic, range, end]);
  const valid = videos.filter(v => v[metric] !== null);
  const W = 1100, H = 310, left = 65, right = W - 24, top = 45, bottom = H - 37;
  const startX = valid.length ? Date.parse(valid[0].publishedAt) : end - 86400000;
  const endX = valid.length > 1 ? Date.parse(valid.at(-1)!.publishedAt) : startX + 86400000;
  const isLog = log && metric === 'views';
  const max = Math.max(...valid.map(v => v[metric]!), metric === 'views' ? 10 : 0.01) * 1.15;
  const x = (v: AnalyzedVideo) => left + (Date.parse(v.publishedAt) - startX) / Math.max(86400000, endX - startX) * (right - left);
  const y = (n: number) => bottom - (isLog ? Math.log10(1 + n) / Math.log10(1 + max) : n / max) * (bottom - top);
  const ticks = isLog ? [0, 100, 1000, 10000, 100000, 1000000, 10000000].filter(n => n <= max) : Array.from({ length: 5 }, (_, i) => max / 4 * i);
  const trend = valid.map((v, i) => `${x(v)},${y(median(valid.slice(Math.max(0, i - 6), i + 1).map(t => t[metric]))!)}`).join(' ');
  const active = valid.find(v => v.id === hovered);
  const changes = analysis.changes.filter(c => valid.some(v => v.id === c.videoId));
  return <section className={`panel timeline-panel ${expanded ? 'timeline-expanded' : ''}`} id="timeline">
    <div className="panel-heading"><div><span className="eyebrow"><span className="section-index">01</span></span><h2>作品时间线</h2><p>按发布日期查看每条作品的累计播放量或互动率。</p></div><button className="icon-button desktop-only" onClick={() => setExpanded(!expanded)} aria-label={expanded ? '收起时间线' : '放大时间线'}><Maximize2 size={18}/></button></div>
    <div className="chart-toolbar"><div className="segmented" aria-label="纵轴指标"><button className={metric === 'views' ? 'selected' : ''} onClick={() => setMetric('views')}>累计播放量</button><button className={metric === 'engagement' ? 'selected' : ''} onClick={() => setMetric('engagement')}>互动率</button></div><div className="chart-controls">{metric === 'views' && <label className="switch-label"><input type="checkbox" checked={log} onChange={e => setLog(e.target.checked)}/>对数坐标</label>}<select aria-label="时间范围" value={range} onChange={e => setRange(e.target.value)}><option value="all">全部时间</option><option value="365">样本最近一年</option><option value="730">样本最近两年</option></select><button className="icon-button" aria-label="重置图表筛选" onClick={() => { setMetric('views'); setTopic('all'); setRange('all'); setLog(true); }}><RotateCcw size={15}/></button></div></div>
    <div className="topic-filters"><button className={topic === 'all' ? 'active' : ''} onClick={() => setTopic('all')}>全部主题 <span>{analysis.count}</span></button>{analysis.topics.map((t, i) => <button key={t.name} className={topic === t.name ? 'active' : ''} onClick={() => setTopic(t.name)}><i style={{ background: colors[i % colors.length] }}/>{t.name}<span>{t.count}</span></button>)}</div>
    {valid.length ? <div className="chart-wrap" onMouseLeave={() => setHovered(null)}>
      <svg className="timeline-svg" viewBox={`0 0 ${W} ${H}`} aria-label={`创作时间线，${metric === 'views' ? '当前累计播放量' : '互动率'}，${valid.length} 条有效作品，${isLog ? '对数' : '线性'}坐标`}>
        <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#bce487" stopOpacity="0.13"/><stop offset="100%" stopColor="#bce487" stopOpacity="0"/></linearGradient></defs>
        {ticks.map(t => <g key={t}><line x1={left} x2={right} y1={y(t)} y2={y(t)} className="chart-gridline"/><text x={left - 14} y={y(t) + 4} textAnchor="end" className="chart-axis">{metric === 'views' ? fmt(t, 0) : percent(t)}</text></g>)}
        <polygon points={`${left},${bottom} ${trend} ${x(valid.at(-1)!)},${bottom}`} fill="url(#chartFill)"/>
        <polyline points={trend} fill="none" stroke="#bce487" strokeWidth="1.6" strokeOpacity="0.6" strokeLinejoin="round"/>
        {Array.from({ length: 5 }, (_, i) => <text key={i} x={left + (right - left) * i / 4} y={H - 10} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} className="chart-axis">{shortDate(new Date(startX + (endX - startX) * i / 4).toISOString()).slice(0, 7)}</text>)}
        {changes.slice(0, 4).map((c, i) => { const v = valid.find(v => v.id === c.videoId)!; return <g key={`${c.kind}-${c.videoId}`} className="chart-annotation" onClick={() => onSelect(v)}><line x1={x(v)} x2={x(v)} y1={top - 10} y2={bottom} stroke="currentColor" strokeDasharray="3 5" strokeOpacity="0.2"/><rect x={Math.min(right - 98, Math.max(left, x(v) - 46))} y={i % 2 ? 20 : 1} width="98" height="21" rx="5" fill="var(--surface-raised)"/><text x={Math.min(right - 49, Math.max(left + 49, x(v) + 3))} y={i % 2 ? 34 : 15} textAnchor="middle">{c.kind === 'outlier' ? '高表现候选' : '主题占比变化'} ↗</text></g>; })}
        {valid.map(v => { const color = colors[analysis.topics.findIndex(t => t.name === v.topic) % colors.length]; const isPin = pins.includes(v.id); return <g key={v.id}>
          {(isPin || (v.relative.value ?? 0) >= 2) && <circle cx={x(v)} cy={y(v[metric]!)} r={isPin ? 11 : 9} fill="none" stroke={isPin ? '#f4c788' : color} strokeWidth="1" opacity="0.55"/>}
          <circle cx={x(v)} cy={y(v[metric]!)} r={hovered === v.id ? 6.5 : 4.5} fill={color} stroke="var(--surface)" strokeWidth="1.5" tabIndex={0} role="button" aria-label={`${v.title}，${metric === 'views' ? fmt(v.views) + '次播放' : percent(v.engagement)}，查看详情`} onFocus={() => setHovered(v.id)} onBlur={() => setHovered(null)} onMouseEnter={() => setHovered(v.id)} onClick={() => onSelect(v)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(v); } }} className="chart-point"/>
        </g>; })}
      </svg>
      {active && <div className="chart-tooltip" style={{ left: `${Math.min(72, Math.max(1, x(active) / W * 100 - 10))}%` }}><Cover video={active}/><strong>{active.title}</strong><span>{shortDate(active.publishedAt)} · {active.topic}</span><div><span>播放 <b>{fmt(active.views)}</b></span><span>点赞 <b>{fmt(active.likes)}</b></span></div><small>点击数据点，查看证据与分析 →</small></div>}
    </div> : <div className="empty-chart"><Info size={25}/><h3>这个范围内暂无有效{metric === 'views' ? '播放' : '互动率'}数据</h3><p>{metric === 'engagement' ? '互动率需要完整的点赞、投币、收藏、评论、分享与播放量。' : '尝试切换主题或扩大时间范围。'}</p></div>}
    <p className="chart-pan-hint">← 横向滑动时间线，点击数据点查看作品 →</p>
    <div className="chart-caption"><span><span className="legend-line"/>近 7 条有效作品的中位数 <span className="separator">·</span> {valid.length} / {videos.length} 条有效样本</span><span><MousePointer2 size={13}/>悬停查看，点击打开详情</span></div>
    <div className="chart-caveat"><Info size={14}/><span>纵轴为采集时的累计表现，横轴为发布日期；曲线不代表账号在历史时点的即时流量。{metric === 'views' && log ? '当前使用对数坐标。' : ''}</span></div>
    {changes.length > 0 && <div className="milestones">{changes.slice(0, 3).map((c, i) => <div className="milestone" key={`${c.kind}-${c.videoId}`}><span className="milestone-dot">0{i + 1}</span><div><span className="eyebrow">{shortDate(c.date)}</span><button className="milestone-title" onClick={() => onSelect(analysis.videos.find(v => v.id === c.videoId)!)}>{c.title}<ArrowUpRight size={14}/></button><p>{c.description}</p></div><button aria-label={`${pins.includes(c.videoId) ? '取消标记' : '标记'}${c.title}`} className={`icon-button pin ${pins.includes(c.videoId) ? 'is-pinned' : ''}`} onClick={() => onTogglePin(c.videoId)}><Flag size={14}/></button></div>)}</div>}
  </section>;
}
