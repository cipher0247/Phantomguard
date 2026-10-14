import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, riskLabel, pct, type Scan } from '../api';
import { MockBadge, ScanDetailDialog } from '../components';
import { Card, Icon, kindIcon, RiskBadge, Spinner, ErrorNote, timeAgo, useAsync } from '../ui';

const SERVICES = [['text', 'description', 'Text analysis model'], ['audio', 'mic', 'Voice deepfake model'], ['video', 'videocam', 'Video deepfake model'], ['advisor', 'psychology', 'AI advisor']] as const;

export function Home() {
  const sum = useAsync(api.summary), status = useAsync(api.status), recent = useAsync(() => api.scans({ limit: 5 }));
  const [open, setOpen] = useState<Scan | null>(null);
  const max = sum.data?.last24h.maxScore ?? null;
  const flagged = sum.data?.last24h.flagged ?? 0;
  const configured = status.data ? Object.values(status.data.models).filter(Boolean).length : 0;

  return (<>
    <Card className="relative overflow-hidden flex items-center gap-4">
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary"><Icon name="security" fill className="text-[26px]" /></div>
      <div>
        <span className="text-xs uppercase tracking-widest text-on-surface-variant font-medium">Detection services</span>
        <h2 className="font-headline text-2xl font-bold">{status.loading && !status.data ? '…' : status.error ? 'Unavailable' : `${configured} of ${SERVICES.length} configured`}</h2>
      </div>
    </Card>

    <Card className="bg-surface-container-lowest flex flex-col gap-4">
      <div>
        <span className="text-xs text-on-surface-variant font-medium uppercase tracking-wider">Last 24 hours</span>
        <h3 className="font-headline text-2xl font-semibold mt-0.5">Am I safe right now?</h3>
      </div>
      {sum.loading && !sum.data ? <Spinner /> : sum.error && !sum.data ? <ErrorNote message={sum.error} onRetry={sum.reload} /> : (
        <div className="flex items-center justify-between">
          <div>
            {max == null ? <span className="font-headline text-2xl font-semibold text-on-surface-variant">No scans yet</span> : (<>
              <div className="flex items-baseline gap-1"><span className="font-headline text-5xl font-bold text-primary">{pct(max)}</span><span className="text-lg text-on-surface-variant">/100</span></div>
              <span className="text-xs font-semibold text-primary">Highest score · {flagged ? `${flagged} flagged` : 'nothing flagged'}</span></>)}
          </div>
          <div className="relative w-24 h-24">
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90" role="img" aria-label={max == null ? 'No data' : `Highest score ${pct(max)} of 100`}>
              <path className="text-surface-variant" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3.5" />
              {max != null && <path className="text-primary gauge-animated" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3.5" strokeDasharray={`${pct(max)}, 100`} />}
            </svg>
            <Icon name="shield_lock" className="absolute inset-0 flex items-center justify-center text-primary text-[22px]" />
          </div>
        </div>)}
      <p className="text-sm text-on-surface-variant leading-relaxed">
        PHANTOMGUARD only evaluates what you submit; it does not monitor your calls or messages in the background.
        {sum.data && ` ${sum.data.last24h.scans} scan${sum.data.last24h.scans === 1 ? '' : 's'} in the last 24 hours.`}
        {!!sum.data?.mockScans && ` ${sum.data.mockScans} MOCK demo scan${sum.data.mockScans === 1 ? '' : 's'} are excluded from these figures.`}
      </p>
    </Card>

    <div className="flex flex-col gap-3">
      <h3 className="font-headline text-xl font-semibold px-1">Quick Security Check</h3>
      <div className="grid grid-cols-3 gap-3">
        {([['text', 'Text Message', 'Check a message'], ['audio', 'Phone Call', 'Check for fake voice'], ['video', 'Video', 'Check for AI fake']] as const).map(([k, t, s]) => (
          <Link key={k} to={`/analyze?tab=${k}`} className="flex flex-col items-start p-4 rounded-xl bg-surface-container-low border border-outline-variant/40 hover:bg-surface-container active:scale-95 transition">
            <span className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary mb-3"><Icon name={kindIcon[k]} className="text-[20px]" /></span>
            <span className="text-sm font-bold">{t}</span><span className="text-xs text-on-surface-variant mt-0.5">{s}</span>
          </Link>))}
      </div>
    </div>

    <div className="flex flex-col gap-3">
      <h3 className="font-headline text-xl font-semibold px-1">Service Status</h3>
      {status.error && !status.data ? <ErrorNote message={status.error} onRetry={status.reload} /> : SERVICES.map(([k, icon, name]) => (
        <div key={k} className="flex items-center justify-between p-4 rounded-xl bg-surface-container-low border border-outline-variant/40">
          <div className="flex items-center gap-4"><span className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary"><Icon name={icon} className="text-[18px]" /></span>
            <span className="text-sm font-bold">{name}</span></div>
          <span className={`text-xs font-semibold ${status.data?.models[k] ? 'text-primary' : 'text-on-surface-variant'}`}>{status.data ? (status.data.models[k] ? 'Configured' : 'Not configured') : '…'}</span>
        </div>))}
    </div>

    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1"><h3 className="font-headline text-xl font-semibold">Recent Activity</h3><Link to="/activity" className="min-h-[44px] flex items-center text-xs text-primary font-semibold">See all</Link></div>
      {recent.loading && !recent.data ? <Spinner /> : recent.error && !recent.data ? <ErrorNote message={recent.error} onRetry={recent.reload} /> : !recent.data?.length ?
        <p className="text-sm text-on-surface-variant px-1">No scans yet. Run your first check above.</p> :
        recent.data.map((s) => (
          <button key={s.id} type="button" onClick={() => setOpen(s)} className="text-left p-4 rounded-xl bg-surface-container-low border border-outline-variant/40 flex items-start gap-4 active:bg-surface-container">
            <span className="w-8 h-8 rounded-lg bg-surface-variant/60 flex items-center justify-center text-primary shrink-0"><Icon name={kindIcon[s.kind]} className="text-[18px]" /></span>
            <div className="flex-1 min-w-0"><div className="flex justify-between gap-2"><span className="text-sm font-bold truncate">{s.label}</span><span className="text-xs text-on-surface-variant shrink-0">{timeAgo(s.createdAt)}</span></div>
              <div className="mt-1 flex gap-2 items-center">{s.mock ? <MockBadge /> : <RiskBadge risk={s.risk}>{riskLabel(s)}</RiskBadge>}<span className="text-xs text-on-surface-variant">score {pct(s.score)}/100</span></div></div>
          </button>))}
    </div>
    {open && <ScanDetailDialog scan={open} onClose={() => setOpen(null)} />}
  </>);
}
