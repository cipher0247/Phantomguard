import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, riskLabel, pct, type Scan } from '../api';
import { ScanDetailDialog } from '../components';
import { Card, ErrorNote, Icon, kindIcon, kindName, RiskBadge, Spinner, timeAgo, useAsync } from '../ui';

// An alert is a genuine (non-MOCK) analysis the model flagged. "Flagged" is decided server-side from the model's own decision
// threshold (risk = warning or high); 0.95+ is shown as Critical.
const FILTERS = [
  ['all', 'All', () => true],
  ['critical', 'Critical', (s: Scan) => s.risk === 'high' && s.score >= 0.95],
  ['high', 'High Risk', (s: Scan) => s.risk === 'high' && s.score < 0.95],
  ['warning', 'Warnings', (s: Scan) => s.risk === 'warning'],
] as const;

export function Alerts() {
  const { data, loading, error, reload } = useAsync(() => api.scans({ limit: 200 }));
  const [f, setF] = useState<(typeof FILTERS)[number][0]>('all');
  const [open, setOpen] = useState<Scan | null>(null);
  const alerts = (data ?? []).filter((s) => s.risk !== 'low' && !s.mock); // MOCK results are never alerts
  const shown = alerts.filter(FILTERS.find((x) => x[0] === f)![2]);

  return (<>
    <div className="flex justify-end"><span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-high text-primary text-xs font-semibold uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-primary" />From your scans</span></div>
    <div role="group" aria-label="Filter alerts" className="flex gap-2 overflow-x-auto -mx-5 px-5 sm:-mx-6 sm:px-6 pb-1">
      {FILTERS.map(([k, label, fn]) => (
        <button key={k} aria-pressed={f === k} onClick={() => setF(k)}
          className={`shrink-0 min-h-[44px] px-4 rounded-full text-sm font-semibold ${f === k ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{label} ({alerts.filter(fn).length})</button>))}
    </div>
    {error && <ErrorNote message={error} onRetry={reload} />}
    {loading && !data ? <Spinner /> : !error && shown.length === 0 ? (
      <Card className="text-center py-10"><Icon name="verified_user" className="text-[40px] text-primary" /><h3 className="font-headline text-xl mt-2">No alerts</h3>
        <p className="text-sm text-on-surface-variant mt-1">None of your analyses have been flagged{f !== 'all' && ' in this category'}.</p></Card>
    ) : shown.map((s) => (
      <button key={s.id} type="button" onClick={() => setOpen(s)} className="text-left rounded-xl bg-surface-container-low border border-outline-variant/40 p-5 shadow-xs flex gap-4 active:bg-surface-container">
        <span className="w-10 h-10 rounded-xl bg-error-container flex items-center justify-center text-error shrink-0"><Icon name={kindIcon[s.kind]} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2"><h3 className="font-headline text-lg truncate capitalize">{s.label}</h3><span className="text-xs text-on-surface-variant shrink-0">{timeAgo(s.createdAt)}</span></div>
          <p className="text-xs text-on-surface-variant">{kindName[s.kind]} • score {pct(s.score)}/100 • {s.model}</p>
          <div className="mt-2 flex gap-2 items-center"><RiskBadge risk={s.risk}>{riskLabel(s)}</RiskBadge><span className="text-xs font-semibold text-primary">Details</span></div>
        </div>
      </button>))}
    <Card className="flex items-center gap-4"><Icon name="shield_lock" className="text-primary text-[28px]" />
      <div className="flex-1"><h3 className="font-headline text-base font-bold">Only scanned items appear here</h3><p className="text-xs text-on-surface-variant">Alerts reflect what you have submitted for analysis.</p></div>
      <Link to="/activity" className="min-h-[44px] px-4 rounded-lg bg-surface-container-high text-sm flex items-center">View History</Link></Card>
    {open && <ScanDetailDialog scan={open} onClose={() => setOpen(null)} />}
  </>);
}
