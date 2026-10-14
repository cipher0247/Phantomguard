import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, bandLabel, pct, type Kind, type Scan } from '../api';
import { Card, ErrorNote, Icon, kindIcon, RiskBadge, useAsync } from '../ui';

const TABS: [Kind, string, string][] = [['text', 'Text', 'description'], ['audio', 'Voice', 'mic'], ['video', 'Video', 'videocam']];
const GUIDANCE = ['Do not click links or open attachments in the message.', 'Contact the supposed sender through a channel you already trust.', 'Report it to your IT/security team or the impersonated service.'];

function Result({ scan }: { scan: Scan }) {
  const tone = scan.risk === 'high' ? 'bg-error-container/50' : scan.risk === 'warning' ? 'bg-primary-fixed/50' : 'bg-surface-container-low';
  const details = Object.entries(scan.details ?? {}).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v));
  return (<>
    <Card className={`${tone} flex items-center gap-4`} >
      <div className="w-20 h-20 shrink-0 rounded-xl bg-surface-container-lowest flex flex-col items-center justify-center" aria-label={`Score ${pct(scan.score)} out of 100`}>
        <span className="font-headline text-3xl font-semibold text-primary">{pct(scan.score)}</span><span className="text-[11px] text-on-surface-variant">/100</span>
      </div>
      <div className="min-w-0 flex-1">
        <RiskBadge risk={scan.risk}>{bandLabel(scan.score)}</RiskBadge>
        <h3 className="font-headline text-xl mt-1 break-words">{scan.label}</h3>
        <p className="text-xs text-on-surface-variant mt-1">Model: {scan.model}</p>
      </div>
      <a href={api.reportUrl(scan.id)} aria-label="Download report" className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-surface-container-lowest text-on-surface-variant"><Icon name="download" /></a>
    </Card>
    <Card>
      <h4 className="text-xs uppercase tracking-widest text-primary font-semibold mb-2">How to read this</h4>
      <p className="text-sm text-on-surface-variant">{scan.limitation ?? 'The score is a probability estimate from a trained model, not proof.'} Higher means the model considers the input more likely to be malicious or synthetic.</p>
      {details.length > 0 && <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">{details.map(([k, v]) => <div key={k} className="rounded-lg bg-surface-container-lowest p-3"><dt className="text-on-surface-variant uppercase tracking-wider">{k}</dt><dd className="font-semibold mt-0.5 break-words">{String(v)}</dd></div>)}</dl>}
    </Card>
    {scan.risk !== 'low' && <Card>
      <h4 className="text-xs uppercase tracking-widest text-primary font-semibold mb-2">General guidance (not model output)</h4>
      <ul className="text-sm text-on-surface-variant list-disc pl-5 space-y-1">{GUIDANCE.map((g) => <li key={g}>{g}</li>)}</ul>
      <Link to="/advisor" className="inline-flex mt-3 text-sm font-semibold text-primary underline underline-offset-4">Ask the AI advisor</Link>
    </Card>}
  </>);
}

export function Analyze() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t[0] === params.get('tab'))?.[0] ?? 'text') as Kind;
  const status = useAsync(api.status);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Scan | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const limits = status.data?.limits;
  const available = status.data?.models[tab];

  const select = (k: Kind) => { setParams({ tab: k }); setError(''); setResult(null); setFile(null); setProgress(null); };
  const pickFile = (f: File | null) => {
    setError(''); setFile(null);
    if (!f || !limits || tab === 'text') return;
    const lim = limits[tab], ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!lim.exts.includes(ext)) return setError(`Unsupported file type. Use: ${lim.exts.join(', ')}.`);
    if (f.size > lim.bytes) return setError(`File is too large. Maximum ${lim.bytes / 1048576} MB.`);
    setFile(f);
  };
  const run = async () => {
    setBusy(true); setError(''); setResult(null); setProgress(null);
    try {
      if (tab === 'text') setResult(await api.scanText(text));
      else if (file) { setProgress(0); setResult(await api.scanFile(tab, file, setProgress)); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setProgress(null); }
  };
  const ready = tab === 'text' ? text.trim().length > 0 && text.length <= (limits?.text ?? 20000) : !!file;

  return (<>
    <div>
      <h1 className="font-headline text-4xl">Safety Scanner</h1>
      <p className="text-on-surface-variant mt-2">Scan suspicious messages, phone call recordings, or videos to see if they are real or AI-generated scams.</p>
    </div>
    <div role="tablist" aria-label="Scan type" className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-surface-container">
      {TABS.map(([k, label, icon]) => (
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => select(k)}
          className={`min-h-[44px] rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition ${tab === k ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant'}`}>
          <Icon name={icon} className="text-[20px]" />{label}</button>))}
    </div>

    <Card>
      {status.data && !available && <div className="mb-4"><ErrorNote message={`The ${tab} model is not configured on this server, so scans cannot run. See README for setup.`} /></div>}
      {tab === 'text' ? (<>
        <label htmlFor="payload" className="text-[11px] uppercase tracking-widest font-semibold">Payload input</label>
        <textarea id="payload" value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={limits?.text ?? 20000}
          placeholder="Paste a suspicious email, SMS or message…" className="mt-2 w-full rounded-xl bg-surface-container-lowest p-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        <p className="text-xs text-on-surface-variant mt-1">{text.length.toLocaleString()} / {(limits?.text ?? 20000).toLocaleString()} characters. Message text is analysed but not stored.</p>
      </>) : (<>
        <input ref={fileInput} type="file" className="sr-only" aria-label={`Choose ${tab} file`} accept={limits?.[tab].exts.map((e) => `.${e}`).join(',')} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        <button type="button" onClick={() => fileInput.current?.click()} className="w-full min-h-[120px] rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-lowest flex flex-col items-center justify-center gap-2 text-on-surface-variant hover:border-primary">
          <Icon name={kindIcon[tab]} className="text-[32px] text-primary" />
          <span className="text-sm font-medium">{file ? file.name : `Choose a ${tab === 'audio' ? 'voice recording' : 'video'}`}</span>
          {limits && <span className="text-xs">{limits[tab].exts.join(', ')} • up to {limits[tab].bytes / 1048576} MB{tab === 'audio' && ` • ${limits.audio.maxSeconds / 60} min`}</span>}
        </button>
      </>)}
      {error && <div className="mt-4"><ErrorNote message={error} /></div>}
      {progress !== null && <div className="mt-4" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
        <div className="h-2 rounded-full bg-surface-container-high overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
        <p className="text-xs text-on-surface-variant mt-1">{progress < 100 ? `Uploading ${progress}%` : 'Analysing…'}</p></div>}
      <button onClick={run} disabled={busy || !ready || !available}
        className="mt-4 w-full min-h-[48px] rounded-xl bg-primary text-on-primary text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-primary-container">
        <Icon name={busy ? 'progress_activity' : 'bolt'} className={busy ? 'animate-spin' : ''} />{busy ? 'Scanning…' : 'Execute scan'}</button>
    </Card>
    {result && <Result scan={result} />}
  </>);
}
