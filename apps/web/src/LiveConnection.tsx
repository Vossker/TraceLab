import { useState } from 'react';
import { ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from './ui';

export type LiveStatus = {
  provider?: string; configured?: boolean; reachable: boolean; authorized?: boolean;
  verified: boolean; message?: string; state?: string; lastError?: string | null;
  lastVerifiedAt?: string | null; account?: { id: string; name: string } | null;
};
export function LiveConnection({ status, busy, onRefresh, onAnalyze }: { status?: LiveStatus; busy: boolean; onRefresh: () => Promise<void>; onAnalyze: () => void }) {
  const [working, setWorking] = useState(false), [error, setError] = useState('');
  const act = async (kind: 'authorize' | 'disconnect' | 'refresh') => {
    setError(''); setWorking(true);
    try {
      if (kind === 'authorize') { const result = await api<{ url: string }>('/api/live/authorize', { method: 'POST' }); location.assign(result.url); }
      if (kind === 'disconnect') await api('/api/live/authorization', { method: 'DELETE' });
      if (kind !== 'authorize') await onRefresh();
    } catch (e) { setError((e as Error).message); } finally { setWorking(false); }
  };
  const disabled = busy || working;
  return <section className="live-connection" aria-label="实时数据连接">
    <div className="source-status"><ShieldCheck size={20}/><div><strong>Live Mode · {status?.authorized ? `已授权：${status.account?.name || '数据源账号'}` : status?.reachable ? status.configured ? '等待 UP 主授权' : '应用尚未配置' : '数据网关尚未连接'}</strong>
      <p>{status?.message || '配置本地官方网关后，可由 UP 主授权分析自己的公开作品。'}</p>
      {status?.lastVerifiedAt && <p>最近采集：{new Date(status.lastVerifiedAt).toLocaleString('zh-CN')} · {status.verified ? '取得有效作品数据' : '当前需重新验证'}</p>}
    </div></div>
    {status?.provider === 'bilibili-official' && <><p className="form-hint">官方授权分析的是登录并同意授权的账号。OpenID 不能替代主页 UID；输入任意主页不会获得该 UP 主的授权。播放与互动数据还需对应的数据权限。</p><div className="live-actions">
      {status.authorized ? <><button type="button" className="primary-button" disabled={disabled} onClick={onAnalyze}>分析已授权账号</button><button type="button" className="secondary-button" disabled={disabled} onClick={() => void act('disconnect')}>忘记本机授权</button></> : <button type="button" className="primary-button" disabled={disabled || !status.configured} onClick={() => void act('authorize')}>前往 B 站授权<ExternalLink size={15}/></button>}
      <button type="button" className="secondary-button" disabled={disabled} onClick={() => void act('refresh')}><RefreshCw size={15}/>刷新状态</button>
    </div><p className="fine-print">{status.authorized ? '忘记授权会删除本机令牌与缓存；平台侧授权可在 B 站管理。已保存的研究报告仍保留。' : <>接入步骤见项目 docs/live-gateway.md；应用需先在 <a href="https://open.bilibili.com/" target="_blank" rel="noreferrer">B 站开放平台</a> 申请并通过审核。</>}</p></>}
    {(error || status?.lastError) && <p className="error-banner" role="alert">{error || status?.lastError}</p>}
  </section>;
}
