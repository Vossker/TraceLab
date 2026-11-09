import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, BarChart3, BookOpen, Check, CircleHelp, Clock3, Database, ExternalLink, FileJson, FlaskConical, History, Info, LayoutDashboard, LoaderCircle, Menu, MessageSquare, Moon, Plus, Search, Sparkles, Sun, TrendingUp, Upload, X } from 'lucide-react';
import type { Report, AnalyzedVideo } from '../../../packages/core/src/model';
import { parseCreatorUrl } from '../../../packages/core/src/model';
import { markdownReport } from '../../../packages/core/src/report';
import Timeline from './Timeline';
import Topics from './Topics';
import { Feedback, GrowthReport, Highlights, VideoDetail } from './ResearchPanels';
import { api, download, fmt, kindLabel, Logo, Modal, shortDate } from './ui';
import { LiveConnection, type LiveStatus } from './LiveConnection';

type Health = { ai: boolean; liveConfigured: boolean; liveVerified: boolean; live?: LiveStatus; publicData?: { enabled: boolean; state: string; lastError: string | null; retryAfter: string | null; lastSuccess: { uid: string; collectedAt: string } | null } };
type HistoryRow = { id: string; name: string; mode: string; createdAt: string };
const readStorage = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStorage = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Private browsing can disable storage. */ } };
const readPins = (id: string): string[] => { try { const value: unknown = JSON.parse(readStorage(`pins:${id}`) || '[]'); return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []; } catch { return []; } };
const nav = [{ id: 'overview', label: '研究概览', icon: LayoutDashboard }, { id: 'timeline', label: '成长时间线', icon: Activity }, { id: 'topics', label: '内容主题', icon: BarChart3 }, { id: 'highlights', label: '高表现作品', icon: TrendingUp }, { id: 'feedback', label: '观众反馈', icon: MessageSquare }, { id: 'report', label: '成长研究报告', icon: BookOpen }];

export default function App() {
  const [report, setReport] = useState<Report | null>(null); const [health, setHealth] = useState<Health>({ ai: false, liveConfigured: false, liveVerified: false });
  const [bootError, setBootError] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [input, setInput] = useState(new URLSearchParams(location.search).get('creator') || '');
  const [source, setSource] = useState<'public' | 'gateway'>(new URLSearchParams(location.search).get('source') === 'gateway' ? 'gateway' : 'public');
  const [modal, setModal] = useState<'research' | 'import' | 'export' | 'method' | 'history' | null>(new URLSearchParams(location.search).has('creator') || new URLSearchParams(location.search).has('live') ? 'research' : null);
  const [selected, setSelected] = useState<AnalyzedVideo | null>(null); const [pins, setPins] = useState<string[]>([]);
  const [active, setActive] = useState('overview'); const [mobileNav, setMobileNav] = useState(false);
  const [theme, setTheme] = useState(readStorage('tracelab-theme') || 'dark');
  const [busy, setBusy] = useState(false); const [aiBusy, setAiBusy] = useState(false); const [aiProgress, setAiProgress] = useState(''); const [progress, setProgress] = useState({ value: 0, message: '' });
  const [file, setFile] = useState<File | null>(null); const [creatorName, setCreatorName] = useState('');
  const [history, setHistory] = useState<HistoryRow[]>([]); const [historyLoading, setHistoryLoading] = useState(false); const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { document.documentElement.dataset.theme = theme; writeStorage('tracelab-theme', theme); }, [theme]);
  const showReport = useCallback((r: Report) => { setReport(r); setPins(readPins(r.id)); setSelected(null); const url = new URL(location.href); url.search = ''; url.searchParams.set('report', r.id); window.history.replaceState({}, '', url); }, []);
  const boot = useCallback(async () => {
    setBootError('');
    try {
      const id = new URLSearchParams(location.search).get('report');
      const results = await Promise.all([api<Report>(id && id !== 'demo' ? `/api/reports/${encodeURIComponent(id)}` : '/api/demo'), api<Health>('/api/health')]);
      showReport(results[0]); setHealth(results[1]);
    } catch (e) { setBootError(e instanceof Error ? e.message : '加载失败'); }
  }, [showReport]);
  useEffect(() => { void boot(); }, [boot]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!report) return;
    const observer = new IntersectionObserver(entries => { const visible = entries.filter(e => e.isIntersecting); if (visible.length) setActive(visible[0].target.id); }, { rootMargin: '-15% 0px -65% 0px', threshold: 0 });
    nav.forEach(n => { const element = document.getElementById(n.id); if (element) observer.observe(element); }); return () => observer.disconnect();
  }, [report]);
  const togglePin = (id: string) => { const next = pins.includes(id) ? pins.filter(p => p !== id) : [...pins, id]; setPins(next); if (report) writeStorage(`pins:${report.id}`, JSON.stringify(next)); };
  const openModal = (m: typeof modal) => { setError(''); setModal(m); setMobileNav(false); };
  const loadDemo = async () => { setBusy(true); setError(''); try { showReport(await api<Report>('/api/demo')); setModal(null); setNotice('已打开模拟案例：林间实验室'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const refreshHealth = async () => { setHealth(await api<Health>('/api/health')); };
  const startResearch = async (self = false) => {
    setError(''); setModal('research');
    if (!self) { try { parseCreatorUrl(input); } catch (e) { setError((e as Error).message); return; } }
    setBusy(true); setProgress({ value: 5, message: '验证主页链接与数据源' });
    try {
      const job = await api<{ id: string }>('/api/research', { method: 'POST', body: JSON.stringify(self ? { account: 'self' } : { url: input, source }) });
      for (let attempts = 0; attempts < 225; attempts++) {
        const result = await api<{ status: string; progress: number; message: string; reportId?: string }>(`/api/jobs/${job.id}`);
        setProgress({ value: result.progress, message: result.message });
        if (result.status === 'error') throw new Error(result.message);
        if (result.status === 'complete') { showReport(await api<Report>(`/api/reports/${result.reportId}`)); setModal(null); setNotice('创作者研究已完成'); return; }
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      throw new Error('数据源响应超时，请稍后从研究历史查看或重试');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); void refreshHealth().catch(() => setError('无法刷新网关状态，请检查服务')); }
  };
  const research = (e: FormEvent) => {
    e.preventDefault();
    if (source === 'gateway' && health.live?.provider === 'bilibili-official') { openModal('research'); void refreshHealth().catch(() => setError('无法刷新网关状态，请检查服务')); }
    else void startResearch();
  };
  const importFile = async (e: FormEvent) => {
    e.preventDefault(); if (!file) return; setBusy(true); setError(''); setProgress({ value: 10, message: '读取并校验数据文件' });
    try {
      if (file.size > 4_000_000) throw new Error('文件不能超过 4 MB');
      const format = file.name.toLowerCase().endsWith('.csv') ? 'csv' : file.name.toLowerCase().endsWith('.json') ? 'json' : null;
      if (!format) throw new Error('仅支持 CSV 或 JSON 文件');
      const content = await file.text(); setProgress({ value: 45, message: '计算指标、可比组与研究报告' });
      const r = await api<Report>('/api/import', { method: 'POST', body: JSON.stringify({ content, format, creatorName: creatorName || '导入的创作者' }) });
      showReport(r); setModal(null); setFile(null); setNotice(`已导入 ${r.analysis.count} 条作品并完成分析`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const runAI = async () => {
    if (!report) return;
    if (!health.ai) { setError('尚未配置 LLM。请将 .env.example 复制为 .env，填写服务端 AI_API_KEY、AI_MODEL，然后重启 API。当前基础报告已包含完整统计与证据。'); setModal('method'); return; }
    setAiBusy(true); setAiProgress('准备 AI 分析'); setError('');
    try {
      const job = await api<{ id: string }>(`/api/reports/${report.id}/ai`, { method: 'POST' });
      for (let attempts = 0; attempts < 2400; attempts++) {
        const result = await api<{ status: string; message: string; reportId?: string }>(`/api/jobs/${job.id}`);
        setAiProgress(result.message);
        if (result.status === 'error') throw new Error(result.message);
        if (result.status === 'complete') { showReport(await api<Report>(`/api/reports/${result.reportId}`)); setNotice('AI 报告已生成，结构与引用通过校验'); return; }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      throw new Error('AI 分析等待超时。结果完成后会自动保存，请稍后刷新页面查看。');
    } catch (e) { setError((e as Error).message); setModal('method'); } finally { setAiBusy(false); setAiProgress(''); }
  };
  const loadHistory = async () => { openModal('history'); setHistoryLoading(true); try { setHistory(await api<HistoryRow[]>('/api/history')); } catch (e) { setError((e as Error).message); } finally { setHistoryLoading(false); } };
  const exportReport = (format: 'md' | 'json') => { if (!report) return; download(`CreatorTrace-${report.dataset.creator.name.replace(/[<>:"/\\|?*]/g, '_')}.${format}`, format === 'md' ? markdownReport(report) : JSON.stringify(report, null, 2), format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json'); setNotice('报告已导出'); };
  const a = report?.analysis, d = report?.dataset;
  return <div className="app-shell"><aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}><a href="#overview" className="brand-link" onClick={() => setMobileNav(false)}><Logo/></a><div className="workspace-label"><span className="workspace-avatar">T</span><div>TraceLab 研究空间<small>CREATOR RESEARCH STUDIO</small></div><span className="workspace-version">01</span></div><div className="nav-label">研究工作台</div><nav>{nav.map(n => <a key={n.id} href={`#${n.id}`} onClick={() => { setActive(n.id); setMobileNav(false); }} className={active === n.id ? 'active' : ''}><n.icon size={18} strokeWidth={1.6}/><span>{n.label}</span>{n.id === 'timeline' && <span className="nav-new">核心</span>}</a>)}</nav><div className="sidebar-divider"/><button className="sidebar-action" onClick={loadHistory}><History size={18}/>研究历史<ArrowUpRight size={14}/></button><button className="sidebar-action" onClick={() => openModal('import')}><Database size={18}/>我的数据<Plus size={14}/></button><div className="sidebar-bottom"><div className="demo-invitation"><span className="tiny-label"><FlaskConical size={13}/> 从一个故事开始</span><strong>好奇，是研究的第一步。</strong><p>看看一个创作者，如何慢慢找到自己的方向。</p><button onClick={loadDemo} disabled={busy}>探索演示案例<ArrowUpRight size={15}/></button></div><button className="sidebar-help" onClick={() => openModal('method')}><CircleHelp size={17}/><span>分析方法与数据说明</span></button><div className="sidebar-footer"><span className="status-dot"/>LOCAL WORKSPACE<span>v1.0</span></div></div></aside>
    {mobileNav && <button className="nav-scrim" aria-label="关闭菜单" onClick={() => setMobileNav(false)}/>}
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-only" aria-label="打开菜单" onClick={() => setMobileNav(true)}><Menu size={20}/></button><span>研究工作台</span><span>/</span><strong>创作者研究</strong></div><div className="topbar-right"><span className="local-status"><span className="status-dot"/>本地研究空间</span><button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button><span className="user-avatar">研</span></div></header>
    <main><section className="page-heading" id="overview"><div><div className="eyebrow"><span className="live-line"/>FOLLOW THE CREATIVE TRACE</div><h1>每一次创作，都有迹可循<span>。</span></h1><p>从作品中寻找线索，从数据中发现变化，从变化中理解创作者。</p></div><button className="secondary-button export-top" onClick={() => openModal('export')} disabled={!report}><ArrowDownToLine size={16}/>导出研究</button></section>
      <div className="search-row"><form className="creator-search" onSubmit={research}><span className="platform-mark">bilibili</span><span className="search-divider"/><Search size={17}/><input aria-label="B 站创作者主页链接或 UID" placeholder="粘贴 B 站创作者主页链接或 UID，开启一次研究…" value={input} onChange={e => setInput(e.target.value)} disabled={busy}/><button type="submit" className="primary-button" disabled={busy || !input.trim()}>开始研究<ArrowRight size={16}/></button></form><button className="secondary-button import-button" onClick={() => openModal('import')}><Upload size={16}/><span>导入数据</span></button><button className="secondary-button" onClick={() => { openModal('research'); void refreshHealth().catch(() => setError('无法刷新网关状态，请检查服务')); }}><Activity size={16}/>连接 B 站</button></div>
      {!report ? <div className="panel boot-state">{bootError ? <><Info size={32}/><h2>暂时无法打开研究空间</h2><p>{bootError}</p><div className="modal-actions"><button className="primary-button" onClick={boot}>重新连接</button><button className="secondary-button" onClick={loadDemo}>打开演示案例</button></div></> : <><LoaderCircle className="spin" size={32}/><h2>整理作品，寻找线索…</h2><p>读取数据集，计算统计与证据报告</p></>}</div> : <>
      <div className={`data-banner ${d!.mode}`}><span><FlaskConical size={15}/><strong>{d!.mode === 'demo' ? '你正在探索演示案例' : d!.mode === 'import' ? '用户导入数据' : d!.source.includes('网站公开接口') ? '网站公开接口 · 非官方授权' : '授权数据源'}</strong><span className="banner-separator">/</span>{d!.mode === 'demo' ? '创作者、作品及评论均为模拟数据，完整体验研究过程。' : d!.coverage}</span><button onClick={() => openModal('method')}>数据说明<ArrowUpRight size={13}/></button></div>
      <section className="profile-section"><div className="profile-main"><div className="profile-avatar">{d!.creator.avatar ? <img alt={`${d!.creator.name}头像`} src={d!.creator.avatar} referrerPolicy="no-referrer"/> : <><span>{d!.creator.name.slice(0, 1)}</span><svg viewBox="0 0 80 80" aria-hidden="true"><path d="M8 70L29 21 48 62 60 38 77 72" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="59" cy="19" r="7"/></svg></>}</div><div><div className="profile-name"><h2>{d!.creator.name}</h2><span className="platform-pill">{d!.creator.platform === 'bilibili' ? 'BILIBILI' : 'IMPORT'}</span>{d!.mode === 'demo' && <span className="muted-badge">虚构创作者</span>}</div><p>{d!.creator.bio || '暂无个人简介'}</p><div className="profile-meta"><span><Clock3 size={12}/>{shortDate(a!.start).slice(0, 7)} — {shortDate(a!.end).slice(0, 7)}</span><span>{a!.topics[0].name}为主</span>{d!.creator.url && <a href={d!.creator.url} target="_blank" rel="noreferrer">创作者主页<ExternalLink size={11}/></a>}</div></div></div><div className="profile-research"><span className="eyebrow">RESEARCH QUESTION</span><p>内容方向，是如何一步步<br/><strong>成为自己的风格？</strong></p><span><span className="status-dot"/>基于 {a!.count} 条作品的观察</span></div></section>
      <div className="stat-row">{[{ label: '当前粉丝数', value: fmt(d!.creator.followers), note: d!.mode === 'demo' ? '模拟数据 · 非历史粉丝曲线' : '数据集声明值 · 无历史快照', spark: [2, 3, 2, 5, 4, 6, 7] }, { label: '已观察作品', value: String(a!.count), unit: '条', note: d!.totalVideos === null ? '账号总作品数未知' : `数据集声明共 ${d!.totalVideos} 条`, spark: [2, 4, 4, 5, 6, 6, 8] }, { label: '近期播放中位数', value: fmt(a!.recentMedian), note: `最近 12 条中 ${a!.recentCount} 条有播放数据`, spark: [3, 6, 4, 7, 5, 7, 6] }, { label: '平均发布频率', value: a!.monthlyFrequency === null ? '暂无数据' : a!.monthlyFrequency.toFixed(1), unit: a!.monthlyFrequency === null ? '' : '条 / 月', note: a!.monthlyFrequency === null ? '至少需要 30 天的样本跨度' : '按相邻作品的平均间隔折算', spark: [3, 3, 5, 4, 6, 4, 5] }].map((s, i) => <div className="stat" key={s.label}><span>{s.label}<Info size={12}/></span><div><strong>{s.value}</strong>{s.unit && <small>{s.unit}</small>}<span className="stat-symbol">{i === 0 ? <Activity size={28} strokeWidth={1}/> : i === 1 ? <BarChart3 size={28} strokeWidth={1}/> : i === 2 ? <TrendingUp size={28} strokeWidth={1}/> : <Clock3 size={27} strokeWidth={1}/>}</span></div><p>{s.note}</p></div>)}</div>
      <div className="research-insight"><span className="insight-icon"><Sparkles size={19}/></span><div><span className="eyebrow">第一条线索</span><p>{a!.insights[0].title}，<strong>{a!.topics[0].count} 条作品</strong>反复探索这一方向。</p></div><a href="#report">走进成长故事<ArrowRight size={16}/></a></div>
      <Timeline key={report.id} analysis={a!} onSelect={setSelected} pins={pins} onTogglePin={togglePin}/>
      <div className="insight-strip">{a!.insights.map((insight, i) => <button key={insight.title} onClick={() => setSelected(a!.videos.find(v => v.id === insight.evidenceIds[0])!)}><span className="insight-number">0{i + 1}</span><div><span className={`kind-badge ${insight.kind}`}>{kindLabel[insight.kind]}</span><h3>{insight.title}</h3><p>{insight.text}</p></div><ArrowUpRight size={16}/></button>)}</div>
      <Topics key={`topics-${report.id}-${report.aiModel}`} analysis={a!} onSelect={setSelected}/><Highlights report={report} onSelect={setSelected}/><Feedback report={report} onSelect={setSelected}/><GrowthReport report={report} onSelect={setSelected} onAI={runAI} aiBusy={aiBusy} aiProgress={aiProgress} aiAvailable={health.ai} onExport={() => openModal('export')}/>
      <footer className="page-footer"><Logo small/><span>每一个数据点，都是一次创作的痕迹。</span><button onClick={() => openModal('method')}>数据采集于 {shortDate(d!.collectedAt)}<ArrowUpRight size={13}/></button></footer>
      </>}
    </main></div>
    {notice && <div className="toast" role="status"><Check size={17}/>{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
    {modal && <Modal title={{ research: '开启一段创作研究', import: '把你的数据，变成故事', export: '带走这份成长研究', method: '让分析，经得起追问', history: '继续未完的发现' }[modal]} onClose={() => { if (!busy) setModal(null); }} subtitle={{ research: '识别主页 → 获取数据 → 计算指标 → 生成证据报告', import: 'CSV / JSON · 最大 4 MB · 最多 2,000 条作品', export: '保留数据来源、计算方法、证据引用与不确定性。', method: '研究方法、数据可用性与产品边界', history: '报告保存在本机 SQLite 数据库中。' }[modal]} wide={modal === 'method'}>
      {error && <div className="error-box" role="alert"><Info size={17}/><span>{error}</span></div>}
      {busy && <div className="progress-box" role="status"><span><LoaderCircle className="spin" size={16}/>{progress.message || '正在读取数据…'}</span><progress value={progress.value} max="100"/></div>}
      {modal === 'research' && <><div className="segmented" aria-label="数据来源"><button type="button" onClick={() => {setSource('public');setError('');}} disabled={busy} aria-pressed={source === 'public'} className={source === 'public' ? 'selected' : ''}>网站公开接口</button><button type="button" onClick={() => {setSource('gateway');setError('');}} disabled={busy} aria-pressed={source === 'gateway'} className={source === 'gateway' ? 'selected' : ''}>官方 / 授权网关</button></div>
      {source === 'public' ? <div className="source-status"><Info size={18}/><div><strong>公开接口 · 实验性 · {health.publicData?.enabled === false ? '已关闭' : health.publicData?.state === 'restricted' ? '当前受限' : '按请求验证可用性'}</strong><p>支持任意有效 UID / 主页链接作为输入；能否读取取决于作品可见性和接口访问限制。默认最多 30 条，缺失字段不补造。</p>{health.publicData?.lastError && <p>{health.publicData.lastError}</p>}{health.publicData?.retryAfter && <p>冷却至 {new Date(health.publicData.retryAfter).toLocaleTimeString('zh-CN')}，不会自动重试。</p>}</div></div> : <LiveConnection status={health.live} busy={busy} onRefresh={refreshHealth} onAnalyze={() => void startResearch(true)}/>}
      {source === 'public' || health.live?.provider !== 'bilibili-official' ? <form onSubmit={research} className="modal-form"><label>创作者主页链接或 UID<input value={input} onChange={e => setInput(e.target.value)} placeholder="https://space.bilibili.com/123456" disabled={busy}/></label><button className="primary-button" disabled={busy || !input.trim() || (source === 'public' && health.publicData?.enabled === false)}>分析创作轨迹<ArrowRight size={16}/></button></form> : <p className="form-hint">官方网关只分析主动授权的账号；不会将输入的 UID 强行关联到 OAuth 账号。</p>}<div className="or-divider">也可以从这里开始</div><div className="choice-grid"><button onClick={loadDemo} disabled={busy}><FlaskConical size={22}/><strong>探索演示案例</strong><span>完整的合成创作成长故事</span></button><button onClick={() => openModal('import')} disabled={busy}><Upload size={22}/><strong>导入自己的数据</strong><span>CSV / JSON，无需 API 凭证</span></button></div></>}
      {modal === 'import' && <form onSubmit={importFile} className="modal-form"><label>创作者名称 <span className="muted">（CSV 使用；JSON 保留原值）</span><input value={creatorName} onChange={e => setCreatorName(e.target.value)} placeholder="例如：我的创作实验室" maxLength={120}/></label><input ref={fileRef} type="file" accept=".csv,.json" className="hidden-input" aria-label="选择 CSV 或 JSON 文件" onChange={e => { setFile(e.target.files?.[0] || null); setError(''); }}/><button className="file-drop" type="button" onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); setFile(e.dataTransfer.files[0] || null); }}><Upload size={28}/><strong>{file?.name || '点击选择文件，或拖放到这里'}</strong><span>{file ? `${(file.size / 1024).toFixed(1)} KB · 已选择` : '支持 UTF-8 CSV 和标准化 JSON'}</span></button><div className="template-links"><a href="/api/template.csv" download><ArrowDownToLine size={14}/>CSV 模板</a><a href="/api/template.json" download><FileJson size={14}/>完整 JSON 示例（模拟）</a></div><p className="form-hint">CSV 必填：id、title、publishedAt、collectedAt。数值缺失留空；duration 单位为秒，format 填 video / short / live / unknown。至少 5 条可比作品才计算相对表现。</p><button className="primary-button" disabled={!file || busy}>导入并生成研究<ArrowRight size={16}/></button></form>}
      {modal === 'export' && <><div className="export-options"><button onClick={() => exportReport('md')}><BookOpen size={25}/><div><strong>成长报告 · Markdown</strong><p>完整五部分叙事，附方法、来源与局限。</p></div><ArrowDownToLine size={19}/></button><button onClick={() => exportReport('json')}><FileJson size={25}/><div><strong>研究档案 · JSON</strong><p>原始数据、计算结果与 AI 输出，可重新导入。</p></div><ArrowDownToLine size={19}/></button><button onClick={() => { setModal(null); setTimeout(() => window.print(), 100); }}><BarChart3 size={25}/><div><strong>可视化报告 · 打印 / PDF</strong><p>打开浏览器打印界面，可保存为 PDF。</p></div><ArrowUpRight size={19}/></button></div><div className="source-status"><Info size={17}/><p>链接仅在此本机服务上可用。分享给他人时，请使用导出的报告或 JSON 档案。</p></div></>}
      {modal === 'history' && <div className="history-list">{historyLoading ? <div className="empty-state"><LoaderCircle className="spin"/>正在读取研究历史…</div> : history.length ? history.map(h => <button key={h.id} onClick={async () => { try { showReport(await api<Report>(`/api/reports/${h.id}`)); setModal(null); } catch (e) { setError((e as Error).message); } }}><span className="history-icon"><BookOpen size={20}/></span><div><strong>{h.name}</strong><span>{shortDate(h.createdAt)} · {h.mode === 'demo' ? '模拟演示' : h.mode === 'import' ? '用户导入' : '实时数据（来源见报告）'}</span></div><ArrowUpRight size={17}/></button>) : <div className="empty-state"><History size={30}/><h3>第一份研究，等你开始</h3><p>导入数据或完成真实分析后，报告会自动保存在这里。</p><button className="secondary-button" onClick={() => openModal('import')}>导入数据</button></div>}</div>}
      {modal === 'method' && <div className="method-content"><div className="capability-grid"><div><strong>Demo</strong><span className="success-text">开箱即用</span><p>虚构创作者，108 条作品、12 条模拟评论。</p></div><div><strong>Import</strong><span className="success-text">CSV / JSON</span><p>由提供者声明来源，缺失值不补造。</p></div><div><strong>Live</strong><span>{health.liveVerified ? '已采集验证' : health.live?.authorized ? '已授权，待采集' : health.liveConfigured ? '待配置 / 授权' : '未配置'}</span><p>公开接口按请求验证；官方网关需授权。数据来源在报告中单独标注。</p></div><div><strong>LLM</strong><span>{health.ai ? '已配置，按需调用' : '未配置，规则降级'}</span><p>服务端密钥、结构化 JSON 与证据校验。</p></div></div><h3>相对表现：先定义“可比”</h3><p>当前视频播放量 ÷ 可比作品播放中位数。比较组不含自身，至少 5 条；发布日期相差不超过 120 天，采集相差不超过 7 天；发布时长比 0.67–1.5，视频长度比 0.5–2，且内容形式相同。发布不足 30 天或信息不全时不计算。</p><h3>关键节点：候选，而非定论</h3><p>相对表现达到 2 倍才列为高表现候选。相邻季度均有至少 5 条作品、某主题占比上升至少 40 个百分点时，标记主题变化。没有纵向流量快照时不自动划分成长阶段。</p><h3>数据来源与局限</h3><p>{d?.source} · {d?.coverage}</p><ul>{a?.limitations.map(l => <li key={l}>{l}</li>)}</ul><h3>如何启用 AI 解读</h3><p>在项目根目录创建 .env，设置 AI_API_KEY、AI_BASE_URL、AI_MODEL，重启 API。仅在点击 AI 按钮时发送当前研究的标题、描述、统计与采样评论；密钥不会发送到前端。兼容服务需支持 json_schema 结构化输出。</p><p className="fine-print">完整接口约定、安装说明与演示步骤见项目 README 和 docs 目录。</p></div>}
    </Modal>}
    {selected && report && <VideoDetail key={selected.id} video={selected} report={report} onClose={() => setSelected(null)} onSelect={setSelected} pinned={pins.includes(selected.id)} onPin={() => togglePin(selected.id)}/>}
  </div>;
}
