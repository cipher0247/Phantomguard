import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Icon } from '../ui';

interface Msg { role: 'user' | 'assistant'; content: string; time: string; error?: boolean }
const CHIPS = [['link', 'Is this link safe?'], ['call', 'How to spot a fake call?'], ['shield', 'What should I do if I clicked a scam link?']];
const now = () => new Date().toLocaleTimeString(undefined, { timeStyle: 'short' });

export function Advisor() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ behavior: 'smooth' }); }, [msgs]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    const history = [...msgs.filter((m) => !m.error), { role: 'user' as const, content: t, time: now() }];
    setMsgs([...msgs, history.at(-1)!]); setInput(''); setBusy(true);
    try {
      const reply = await api.advisor(history.slice(-10).map(({ role, content }) => ({ role, content })));
      setMsgs((m) => [...m, { role: 'assistant', content: reply, time: now() }]);
    } catch (e) { setMsgs((m) => [...m, { role: 'assistant', content: (e as Error).message, time: now(), error: true }]); }
    finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void send(input); };

  return (<>
    <section className="rounded-xl bg-gradient-to-br from-primary-fixed/60 to-surface-container-low p-6">
      <span className="text-xs font-semibold uppercase tracking-wider text-primary">AI security helper</span>
      <h1 className="font-headline text-3xl mt-1">AI Security Assistant</h1>
      <p className="text-on-surface-variant mt-2 text-sm">Ask anything in simple words. Replies are AI-generated advice; they are not results from PHANTOMGUARD's detection models, and nothing here scans your files.</p>
    </section>
    <div className="flex gap-2 overflow-x-auto -mx-6 px-6">
      {CHIPS.map(([icon, label]) => <button key={label} onClick={() => send(label)} disabled={busy} className="shrink-0 min-h-[40px] px-4 rounded-full bg-surface-container text-sm flex items-center gap-2"><Icon name={icon === 'link' ? 'link' : icon === 'call' ? 'call' : 'shield'} className="text-primary text-[18px]" />{label}</button>)}
    </div>
    <div className="flex flex-col gap-4 flex-1" aria-live="polite">
      {msgs.length === 0 && <p className="text-sm text-on-surface-variant text-center py-6">Ask a question to get started.</p>}
      {msgs.map((m, i) => m.role === 'user' ? (
        <div key={i} className="self-end max-w-[85%]"><div className="bg-primary text-on-primary rounded-2xl rounded-tr-sm px-4 py-3 text-sm whitespace-pre-wrap">{m.content}</div><div className="text-[11px] text-on-surface-variant text-right mt-1">{m.time}</div></div>
      ) : (
        <div key={i} className="self-start max-w-[90%]"><div className={`rounded-2xl rounded-tl-sm px-4 py-3 text-sm whitespace-pre-wrap ${m.error ? 'bg-error-container text-error' : 'bg-surface-container-low border border-outline-variant/40'}`}>{m.content}</div>
          <div className="text-[11px] text-on-surface-variant mt-1">{m.error ? 'Error' : 'AI-generated'} • {m.time}</div></div>))}
      {busy && <p role="status" className="text-xs text-on-surface-variant">Thinking…</p>}
      <div ref={end} />
    </div>
    <form onSubmit={submit} className="sticky bottom-24 flex gap-2 bg-surface-container-lowest rounded-2xl p-2 shadow-[0_2px_16px_rgba(58,48,42,0.08)]">
      <label htmlFor="ask" className="sr-only">Ask a question about your safety</label>
      <input id="ask" value={input} maxLength={4000} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question about your safety…" className="flex-1 px-3 text-sm bg-transparent focus:outline-none" />
      <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="w-11 h-11 rounded-xl bg-primary text-on-primary flex items-center justify-center disabled:opacity-50"><Icon name="send" /></button>
    </form>
  </>);
}
