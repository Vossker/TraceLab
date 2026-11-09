import { useEffect, useRef, type ReactNode } from 'react';
import { X, ArrowUpRight, Play, ScanLine } from 'lucide-react';
import type { Video } from '../../../packages/core/src/model';

export const colors = ['#bce487', '#80b8cf', '#c2a3db', '#edaa79', '#e3cf77', '#72c7af', '#bdabb0', '#8d9eee'];
export const fmt = (n: number | null, digits = 1) => n === null ? '暂无数据' : n >= 100_000_000 ? `${(n / 100_000_000).toFixed(digits)}亿` : n >= 10_000 ? `${(n / 10_000).toFixed(digits)}万` : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(n);
export const percent = (n: number | null) => n === null ? '暂无数据' : `${(n * 100).toFixed(1)}%`;
export const shortDate = (s: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s)).replaceAll('/', '.');
export const kindLabel = { fact: '统计事实', association: '相关性发现', hypothesis: '待验证解释' };

export function Logo({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-icon"><ScanLine size={small ? 19 : 23} strokeWidth={1.6} /><i /></span><span>创迹<span className="brand-en">CreatorTrace</span></span></div>;
}
export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => { d?.close(); }; }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} aria-label={title} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) { const rect = e.currentTarget.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose(); } }}>
    <header className="modal-heading"><div><span className="eyebrow">CREATORTRACE / RESEARCH</span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="关闭对话框"><X size={20}/></button></header>{children}
  </dialog>;
}
export function Cover({ video, color = colors[0], large = false }: { video: Video; color?: string; large?: boolean }) {
  return <div className={`video-cover ${large ? 'video-cover-large' : ''}`} style={{ '--cover-color': color } as React.CSSProperties}>
    {video.cover ? <img src={video.cover} alt={video.title} referrerPolicy="no-referrer" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} /> : null}
    <div className="cover-grid"/><span className="cover-tag">{video.topic || '内容研究'}</span><div className="cover-orbit"><span/><span/><span/></div>
    <div className="cover-type">{video.source.includes('演示') ? 'LIFE AS AN' : 'A CREATOR’S'}<br/><strong>{video.source.includes('演示') ? 'EXPERIMENT.' : 'PERSPECTIVE.'}</strong></div>
    <span className="cover-play"><Play size={15} fill="currentColor"/></span><span className="cover-duration">{video.duration === null ? '时长未知' : `${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, '0')}`}</span>
  </div>;
}
export function SourceLink({ video }: { video: Video }) { return video.url ? <a className="text-link" href={video.url} target="_blank" rel="noreferrer">查看原始作品 <ArrowUpRight size={14}/></a> : <span className="muted">{video.source.includes('演示') ? '模拟作品 · 无真实视频链接' : '未提供原始作品链接'}</span>; }
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  let data;
  try { data = await response.json(); } catch { throw new Error('无法连接分析服务，请确认 API 已启动'); }
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data as T;
}
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
