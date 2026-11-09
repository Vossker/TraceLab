import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Analysis, AnalyzedVideo } from '../../../packages/core/src/model';
import { colors, fmt } from './ui';

export default function Topics({ analysis, onSelect }: { analysis: Analysis; onSelect: (v: AnalyzedVideo) => void }) {
  const [view, setView] = useState<'share' | 'performance'>('share');
  const [active, setActive] = useState<string | null>(null);
  const selected = analysis.topics.find(t => t.name === active) ?? analysis.topics[0];
  const max = Math.max(...analysis.topics.map(t => t.median ?? 0), 1);
  let offset = 0;
  const segments = analysis.topics.map((t, i) => { const begin = offset; offset += t.share * 100; return `${colors[i % colors.length]} ${begin}% ${offset}%`; }).join(',');
  return <section className="panel topics-panel" id="topics">
    <div className="panel-heading"><div><span className="eyebrow"><span className="section-index">02</span></span><h2>内容主题</h2><p>各主题的作品数量和播放表现。</p></div><div className="segmented"><button className={view === 'share' ? 'selected' : ''} onClick={() => setView('share')}>主题分布</button><button className={view === 'performance' ? 'selected' : ''} onClick={() => setView('performance')}>播放表现</button></div></div>
    <div className="topics-layout"><div className="topic-breakdown">{view === 'share' ? <div className="donut" role="img" aria-label={analysis.topics.map(t => `${t.name} ${t.count} 条`).join('，')} style={{ background: `conic-gradient(${segments})` }}><div><span>创作主题</span><strong>{analysis.topics.length}<small>类</small></strong></div></div> : <div className="performance-bars">{analysis.topics.map((t, i) => <div key={t.name}><span>{t.name}<b>{fmt(t.median)}</b></span><div><i style={{ width: `${(t.median ?? 0) / max * 100}%`, background: colors[i % colors.length] }}/></div></div>)}</div>}
      <div className="topic-legend">{analysis.topics.map((t, i) => <button key={t.name} className={selected.name === t.name ? 'current' : ''} onClick={() => setActive(t.name)}><i style={{ background: colors[i % colors.length] }}/><span>{t.name}</span><b>{view === 'share' ? `${Math.round(t.share * 100)}%` : fmt(t.median)}</b><small>{t.count} 条</small></button>)}</div>
      <div className="topic-note">{view === 'share' ? '依据 B 站分区、已提供标签、关键词或明确标注的 AI 分类。点击主题查看代表作品。' : '各主题当前累计播放中位数。样本年龄与规模不同，不作直接因果比较。'}</div>
    </div><div className="topic-evolution"><div className="subheading"><h3>各季度主题占比</h3><span>按季度 · 作品占比</span></div><div className="stack-chart" role="group" aria-label="各季度内容主题占比"><div className="stack-y"><span>100%</span><span>50%</span><span>0</span></div><div className="stack-columns">{analysis.periods.map((p, i) => <div className="stack-column" key={p.key}><div className="stack-bar">{analysis.topics.map((t, j) => p.topics[t.name] > 0 && <button key={t.name} onClick={() => setActive(t.name)} style={{ height: `${p.topics[t.name] / p.count * 100}%`, background: colors[j % colors.length], opacity: !active || active === t.name ? 0.9 : 0.28 }} title={`${p.key} · ${t.name}：${p.topics[t.name]} / ${p.count} 条`} aria-label={`${p.key} ${t.name} ${p.topics[t.name]} 条`}/>)}</div><span>{analysis.periods.length <= 6 || i % Math.ceil(analysis.periods.length / 5) === 0 ? p.key.replace(' ', '\n') : ''}</span></div>)}</div></div>
      <div className="topic-representative"><span className="tag">{selected.name}</span><button onClick={() => onSelect(analysis.videos.find(v => v.id === selected.evidenceIds[Math.floor(selected.evidenceIds.length / 2)])!)}><span>{analysis.videos.find(v => v.id === selected.evidenceIds[Math.floor(selected.evidenceIds.length / 2)])?.title}</span><ArrowUpRight size={17}/></button><small>代表作品 · 按发布时间取主题中间样本</small></div>
    </div></div>
  </section>;
}
