import { useEffect, useRef, useState } from 'react';
import { api, pct, riskLabel, type Scan } from './api';
import { getServerUrl, isNative, parseServerUrl, setServerUrl } from './server';
import { Icon, RiskBadge, kindIcon, kindName, APP_RESUME } from './ui';

/** Strong, unmissable label for output from the MOCK stub. It must never look like an AI prediction. */
export const MockBadge = () =>
  <span className="text-xs px-2 py-0.5 rounded font-label font-bold bg-inverse-surface text-on-primary tracking-wider">MOCK</span>;

export const MockNotice = () => (
  <p role="note" className="rounded-xl border-2 border-dashed border-tertiary bg-tertiary-fixed/60 text-on-tertiary-container px-4 py-3 text-sm font-semibold flex gap-2">
    <Icon name="science" className="text-[20px]" />MOCK / DEMO RESULT. Produced by a test stub, not an AI model. It is not a real detection.
  </p>
);

export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  const maxH = useRef(0);
  useEffect(() => {
    const check = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      maxH.current = Math.max(maxH.current, h, window.innerHeight);
      setOpen(h < maxH.current * 0.75);
    };
    check();
    window.visualViewport?.addEventListener('resize', check);
    window.addEventListener('resize', check);
    return () => { window.visualViewport?.removeEventListener('resize', check); window.removeEventListener('resize', check); };
  }, []);
  return open;
}

/** Backend connectivity indicator; on the native app it also lets the user choose the server address. */
export function ServerStatus({ startOpen = false }: { startOpen?: boolean }) {
  const native = isNative();
  const [url, setUrl] = useState(getServerUrl());
  const [state, setState] = useState<'checking' | 'ok' | 'down' | 'unset'>('checking');
  const [editing, setEditing] = useState(startOpen && native && !url);
  const [draft, setDraft] = useState(url);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const check = async (base = url) => {
    if (native && !base) return setState('unset');
    setState('checking');
    setState((await api.health(base)) ? 'ok' : 'down');
  };
  useEffect(() => { void check(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const save = async () => {
    const p = parseServerUrl(draft);
    if ('error' in p) return setError(p.error);
    setBusy(true); setError('');
    const ok = await api.health(p.url);
    setBusy(false);
    if (!ok) return setError('Could not reach that server. Check the address, that the backend is running, and that you are on the same network.');
    setServerUrl(p.url); setUrl(p.url); setState('ok'); setEditing(false);
  };

  const dot = { ok: 'bg-green-600', down: 'bg-error', checking: 'bg-outline animate-pulse', unset: 'bg-outline' }[state];
  const text = { ok: 'Connected', down: 'Unreachable', checking: 'Checking…', unset: 'No server set' }[state];
  return (
    <div className="text-xs">
      <div className="flex items-center justify-center gap-2 flex-wrap" data-testid="server-status">
        <span aria-hidden className={`w-2 h-2 rounded-full ${dot}`} />
        <span role="status">Server: {text}</span>
        <span className="text-on-surface-variant truncate max-w-[14rem]">{native ? url || '' : window.location.host}</span>
        <button type="button" onClick={() => void check()} className="min-h-[44px] px-2 text-primary font-semibold">Retry</button>
        {native && <button type="button" onClick={() => { setDraft(url); setEditing(!editing); }} className="min-h-[44px] px-2 text-primary font-semibold">Change</button>}
      </div>
      {native && editing && (
        <div className="mt-2 rounded-xl bg-surface-container-low p-4 text-left space-y-2">
          <label htmlFor="server" className="block text-xs font-semibold">Backend address</label>
          <input id="server" value={draft} onChange={(e) => setDraft(e.target.value)} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder="https://… or http://<pc-lan-ip>:8787" className="w-full h-12 px-3 rounded-xl bg-surface-container-lowest text-base focus:outline-none focus:ring-2 focus:ring-primary/30" />
          {error && <p role="alert" className="text-error">{error}</p>}
          <button type="button" onClick={save} disabled={busy} className="w-full min-h-[48px] rounded-xl bg-primary text-on-primary text-sm font-semibold disabled:opacity-60">{busy ? 'Testing…' : 'Save & test'}</button>
        </div>)}
    </div>
  );
}

/** Bottom-sheet dialog. Pushes a history entry so the Android back button (or browser back) closes it instead of leaving the screen. */
export function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    history.pushState({ pgModal: true }, '');
    let poppedByUser = false;
    const pop = () => { poppedByUser = true; close.current(); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('popstate', pop);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('keydown', key);
      if (!poppedByUser && history.state?.pgModal) history.back();
    };
  }, []);
  return (
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center" onClick={() => close.current()}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[88dvh] overflow-y-auto bg-surface rounded-t-2xl sm:rounded-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
    </div>
  );
}

const label = (k: string) => k.replace(/_/g, ' ');

/** Full detail of one stored analysis. Used by Home, Alerts and Activity. */
export function ScanDetailDialog({ scan, onClose }: { scan: Scan; onClose: () => void }) {
  const details = Object.entries(scan.details ?? {}).filter(([k, v]) => k !== 'limitations' && ['string', 'number', 'boolean'].includes(typeof v));
  const limitation = typeof scan.details?.limitations === 'string' ? scan.details.limitations : scan.limitation;
  const input = Object.entries(scan.input ?? {});
  return (
    <Modal label="Scan details" onClose={onClose}>
      <div className="flex items-start gap-3">
        <span className="w-11 h-11 rounded-xl bg-primary-fixed flex items-center justify-center text-primary shrink-0"><Icon name={kindIcon[scan.kind]} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-headline text-2xl break-words">{scan.label}</h2>
          <div className="flex gap-2 items-center flex-wrap mt-1">
            {scan.mock ? <MockBadge /> : <RiskBadge risk={scan.risk}>{riskLabel(scan)}</RiskBadge>}
            <span className="text-xs text-on-surface-variant">{kindName[scan.kind]} • {new Date(scan.createdAt).toLocaleString()}</span>
          </div>
        </div>
      </div>
      {scan.mock && <div className="mt-4"><MockNotice /></div>}
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-surface-container-lowest p-3"><div className="uppercase tracking-wider text-on-surface-variant">Score</div><div className="font-headline text-2xl font-semibold mt-0.5">{pct(scan.score)}<span className="text-sm text-on-surface-variant">/100</span></div></div>
        <div className="rounded-lg bg-surface-container-lowest p-3"><div className="uppercase tracking-wider text-on-surface-variant">{scan.mock ? 'Source' : 'Trained model'}</div><div className="font-semibold mt-0.5 break-words">{scan.model}</div><div className="text-on-surface-variant">v{scan.version}</div></div>
        {[...input, ...details].map(([k, v]) => <div key={k} className="rounded-lg bg-surface-container-lowest p-3"><div className="uppercase tracking-wider text-on-surface-variant">{label(k)}</div><div className="font-semibold mt-0.5 break-words">{String(v)}</div></div>)}
      </div>
      <p className="mt-4 text-sm text-on-surface-variant">{scan.mock ? 'This score comes from a test stub and says nothing about the content.' : limitation ?? 'A model score is a probability estimate, not proof.'}</p>
      <div className="flex gap-2 mt-4 items-center">
        <ReportButton id={scan.id} />
        <button onClick={onClose} autoFocus className="ml-auto min-h-[48px] px-6 rounded-xl bg-primary text-on-primary text-sm font-semibold">Close</button>
      </div>
    </Modal>
  );
}

/** Copies text; the async Clipboard API can be refused inside a WebView, so fall back to a selected textarea. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/** Opens a scan report (JSON) in a dialog with Copy, Share (when the OS offers it) and, on the web, Download. */
export function ReportButton({ id, className = '' }: { id: number; className?: string }) {
  const [data, setData] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true); setErr('');
    try { setData(JSON.stringify(await api.report(id), null, 2)); } catch (e) { setErr((e as Error).message); setData(''); } finally { setBusy(false); }
  };
  const close = () => { setData(null); setErr(''); setNote(''); };
  const copy = async () => setNote((await copyText(data!)) ? 'Copied to clipboard.' : 'Could not copy. Press and hold the text to select it.');
  const share = async () => { try { await navigator.share({ title: `PHANTOMGUARD report #${id}`, text: data! }); } catch { /* user cancelled */ } };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data!], { type: 'application/json' }));
    a.download = `phantomguard-scan-${id}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const btn = 'flex-1 min-h-[48px] rounded-xl bg-surface-container text-sm font-semibold';
  return (<>
    <button type="button" onClick={open} disabled={busy} className={`min-h-[44px] px-1 text-xs font-semibold text-primary underline underline-offset-4 ${className}`}>{busy ? 'Loading…' : 'View report'}</button>
    {data !== null && (
      <Modal label="Scan report" onClose={close}>
        <h2 className="font-headline text-xl mb-3">Scan report #{id}</h2>
        {err ? <p role="alert" className="text-sm text-error">{err}</p> : <pre className="max-h-[50dvh] overflow-auto text-xs bg-surface-container-lowest rounded-xl p-3 whitespace-pre-wrap break-words select-text">{data}</pre>}
        {note && <p role="status" className="text-xs text-on-surface-variant mt-2">{note}</p>}
        <div className="flex gap-2 mt-4">
          {!err && <button onClick={copy} className={btn}>Copy</button>}
          {!err && typeof navigator.share === 'function' && <button onClick={share} className={btn}>Share</button>}
          {!err && !isNative() && <button onClick={download} className={btn}>Download</button>}
          <button onClick={close} autoFocus className="flex-1 min-h-[48px] rounded-xl bg-primary text-on-primary text-sm font-semibold">Close</button>
        </div>
      </Modal>)}
  </>);
}

/** Banner shown while the backend cannot be reached. Rechecks on resume/network-back and every 20 s while down. */
export function ConnectionBanner() {
  const [down, setDown] = useState(false);
  const [busy, setBusy] = useState(false);
  const check = async () => { setBusy(true); setDown(!(await api.health())); setBusy(false); };
  useEffect(() => {
    void check();
    window.addEventListener(APP_RESUME, check);
    window.addEventListener('offline', () => setDown(true));
    return () => window.removeEventListener(APP_RESUME, check);
  }, []);
  useEffect(() => { if (!down) return; const t = setInterval(check, 20_000); return () => clearInterval(t); }, [down]);
  if (!down) return null;
  return (
    <div role="alert" data-testid="connection-banner" className="rounded-xl bg-error-container text-error text-sm px-4 py-3 flex items-center gap-3">
      <Icon name="cloud_off" className="text-[20px] shrink-0" />
      <span className="flex-1">Can’t reach the server. Showing what is already loaded; actions will fail until it is back.</span>
      <button type="button" onClick={check} disabled={busy} className="shrink-0 min-h-[44px] px-3 font-semibold underline underline-offset-4">{busy ? '…' : 'Retry'}</button>
    </div>
  );
}
