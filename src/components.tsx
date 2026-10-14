import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { getServerUrl, isNative, parseServerUrl, setServerUrl } from './server';
import { Icon } from './ui';

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

/** Opens a scan report. Native WebViews cannot download authenticated links, so the JSON is shown in a dialog with Copy. */
export function ReportButton({ id, className = '' }: { id: number; className?: string }) {
  const [data, setData] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const close = () => { setData(null); setErr(''); setCopied(false); };
  useEffect(() => {
    if (data === null && !err) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [data, err]);
  const open = async () => { try { setData(JSON.stringify(await api.report(id), null, 2)); } catch (e) { setErr((e as Error).message); } };
  const copy = async () => { try { await navigator.clipboard.writeText(data!); setCopied(true); } catch { setErr('Could not copy. Select the text and copy manually.'); } };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data!], { type: 'application/json' }));
    a.download = `phantomguard-scan-${id}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (<>
    <button type="button" onClick={open} className={`min-h-[44px] px-1 text-xs font-semibold text-primary underline underline-offset-4 ${className}`}>View report</button>
    {(data !== null || err) && (
      <div role="dialog" aria-modal="true" aria-label="Scan report" className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={close}>
        <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[85dvh] flex flex-col bg-surface rounded-t-2xl sm:rounded-2xl p-5 pb-safe">
          <h2 className="font-headline text-xl mb-3">Scan report</h2>
          {err ? <p role="alert" className="text-sm text-error">{err}</p> : <pre className="flex-1 overflow-auto text-xs bg-surface-container-lowest rounded-xl p-3 whitespace-pre-wrap break-words">{data}</pre>}
          <div className="flex gap-2 mt-4">
            {data !== null && <><button onClick={copy} className="flex-1 min-h-[48px] rounded-xl bg-surface-container text-sm font-semibold">{copied ? 'Copied' : 'Copy'}</button>
              {!isNative() && <button onClick={download} className="flex-1 min-h-[48px] rounded-xl bg-surface-container text-sm font-semibold">Download</button>}</>}
            <button onClick={close} autoFocus className="flex-1 min-h-[48px] rounded-xl bg-primary text-on-primary text-sm font-semibold">Close</button>
          </div>
        </div>
      </div>)}
  </>);
}
