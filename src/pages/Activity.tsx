import { useEffect, useState } from 'react';
import { api, riskLabel, pct, type Kind, type Scan } from '../api';
import { MockBadge, ScanDetailDialog } from '../components';
import { APP_RESUME, Card, ErrorNote, Icon, kindIcon, kindName, RiskBadge, Spinner, useAsync } from '../ui';

const PAGE = 25;
const FILTERS = [['all', 'All Telemetry'], ['flagged', 'Flagged'], ['audio', 'Voice AI'], ['video', 'Video'], ['text', 'Text']] as const;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
const experimental = (s: Scan) => !s.mock && s.details.experimental === true;
const verdict = (s: Scan) => (s.mock ? ['MOCK', 'text-on-surface-variant'] : experimental(s) ? ['EXPERIMENTAL', 'text-error'] : s.risk === 'high' ? ['FLAGGED', 'text-error'] : s.risk === 'warning' ? ['REVIEW', 'text-primary'] : ['CLEAR', 'text-on-surface-variant']);

export function Activity() {
  const sum = useAsync(api.summary);
  const [f, setF] = useState<(typeof FILTERS)[number][0]>('all');
  const [scans, setScans] = useState<Scan[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Scan | null>(null);

  const load = async (before?: number) => {
    setLoading(true); setError('');
    try {
      const rows = await api.scans({ limit: PAGE, before, kind: ['text', 'audio', 'video'].includes(f) ? (f as Kind) : undefined });
      setScans((p) => (before ? [...p, ...rows] : rows)); setMore(rows.length === PAGE);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [f]);
  useEffect(() => { const again = () => void load(); window.addEventListener(APP_RESUME, again); return () => window.removeEventListener(APP_RESUME, again); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [f]);

  const shown = f === 'flagged' ? scans.filter((s) => !s.mock && !experimental(s) && s.risk !== 'low') : scans;
  const groups = shown.reduce<Record<string, Scan[]>>((g, s) => ((g[day(s.createdAt)] ??= []).push(s), g), {});
  const stat = 'rounded-xl bg-surface-container-low border border-outline-variant/40 p-4';

  return (<>
    <div className="grid grid-cols-3 gap-3">
      <div className={stat}><span className="text-xs uppercase tracking-wider text-on-surface-variant">Scans</span><div className="font-headline text-2xl font-semibold mt-1">{sum.data?.totalScans ?? '–'}</div></div>
      <div className={stat}><span className="text-xs uppercase tracking-wider text-on-surface-variant">Flagged</span><div className="font-headline text-2xl font-semibold text-error mt-1">{sum.data?.flagged ?? '–'}</div></div>
      <div className={stat}><span className="text-xs uppercase tracking-wider text-on-surface-variant">Last scan</span><div className="text-sm font-semibold mt-2">{sum.data ? (sum.data.lastScanAt ? new Date(sum.data.lastScanAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : 'None') : '–'}</div></div>
    </div>
    <div role="group" aria-label="Filter activity" className="flex gap-2 overflow-x-auto -mx-5 px-5 sm:-mx-6 sm:px-6 pb-1">
      {FILTERS.map(([k, label]) => (
        <button key={k} aria-pressed={f === k} onClick={() => setF(k)} className={`shrink-0 min-h-[44px] px-5 rounded-full text-sm font-semibold ${f === k ? 'bg-primary text-on-primary shadow' : 'bg-surface-container text-on-surface-variant'}`}>{label}</button>))}
    </div>
    {error && <ErrorNote message={error} onRetry={() => load()} />}
    {Object.entries(groups).map(([d, items]) => (
      <section key={d} className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between"><h2 className="font-headline text-lg font-semibold">{d}</h2><span className="text-xs text-on-surface-variant">{items.length} event{items.length > 1 ? 's' : ''} loaded</span></div>
        {items.map((s) => { const [v, c] = verdict(s); return (
          <button key={s.id} type="button" onClick={() => setOpen(s)} className="text-left rounded-xl bg-surface-container-low border border-outline-variant/40 p-5 shadow-xs active:bg-surface-container">
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-primary-fixed flex items-center justify-center text-primary shrink-0"><Icon name={kindIcon[s.kind]} /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><h3 className="font-headline text-base font-semibold">{kindName[s.kind]} scan</h3>{s.mock ? <MockBadge /> : experimental(s) ? <span className="text-xs px-2 py-0.5 rounded font-bold bg-error-container text-error">EXPERIMENTAL</span> : <RiskBadge risk={s.risk}>{riskLabel(s)}</RiskBadge>}</div>
                <p className="text-xs text-on-surface-variant mt-0.5 truncate">{s.input.filename ? String(s.input.filename) : `${s.input.chars ?? '?'} characters`} • {s.model}</p>
              </div>
              <time className="text-xs text-on-surface-variant" dateTime={s.createdAt}>{new Date(s.createdAt).toLocaleTimeString(undefined, { timeStyle: 'short' })}</time>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-container-lowest px-3 py-2 text-sm">
              <span className="capitalize">{s.label} ({experimental(s) ? 'model score ' : ''}{pct(s.score)}/100)</span><span className={`text-xs font-bold ${c}`}>{v}</span>
            </div>
          </button>); })}
      </section>))}
    {loading && <Spinner />}
    {!loading && !error && shown.length === 0 && <Card className="text-center py-10"><Icon name="history" className="text-[40px] text-primary" /><p className="text-sm text-on-surface-variant mt-2">{f === 'all' ? 'No scans recorded yet.' : 'Nothing matches this filter yet.'}</p></Card>}
    {more && !loading && <button onClick={() => load(scans.at(-1)?.id)} className="min-h-[48px] rounded-xl bg-surface-container text-sm font-medium flex items-center justify-center gap-2"><Icon name="history" />Load earlier</button>}
    {open && <ScanDetailDialog scan={open} onClose={() => setOpen(null)} />}
  </>);
}
