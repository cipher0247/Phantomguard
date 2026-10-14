import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Icon, ErrorNote } from '../ui';
import { ServerStatus } from '../components';

export function SignIn() {
  const { user, ready, signIn } = useAuth();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (ready && user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');
    setBusy(true); setError('');
    try { await signIn(email.trim(), password, remember); nav(from, { replace: true }); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  };

  const field = 'w-full h-12 pl-11 pr-4 bg-surface-container-lowest rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30 shadow-[0_1px_6px_rgba(58,48,42,0.03)]';
  return (
    <main className="min-h-dvh bg-surface flex flex-col items-center px-5 sm:px-6 pt-[calc(3rem+env(safe-area-inset-top))] pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md relative">
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none -z-0" />
        <div className="relative flex flex-col items-center text-center mb-8">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-high/70 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-label font-medium tracking-wide text-on-surface-variant uppercase">Secure login • PHANTOMGUARD</span>
          </span>
          <div className="w-20 h-20 rounded-2xl bg-surface-container-lowest p-2.5 shadow-[0_4px_24px_rgba(58,48,42,0.06)] mb-5">
            <img src="/logo.png" alt="PHANTOMGUARD" className="w-full h-full object-contain rounded-xl" />
          </div>
          <h1 className="font-headline text-4xl tracking-tight mb-2">PHANTOMGUARD</h1>
          <p className="text-sm text-on-surface-variant">Detect the invisible threats.<br />Protect the human.</p>
        </div>

        <form onSubmit={submit} noValidate className="relative space-y-4" aria-label="Sign in">
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-xs font-semibold tracking-wide">Email Address</label>
            <div className="relative flex items-center">
              <Icon name="shield_person" className="absolute left-3.5 text-on-surface-variant text-[20px] pointer-events-none" />
              <input id="email" type="email" autoComplete="username" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-xs font-semibold tracking-wide">Password</label>
            <div className="relative flex items-center">
              <Icon name="key" className="absolute left-3.5 text-on-surface-variant text-[20px] pointer-events-none" />
              <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${field} pr-11`} />
              <button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}
                className="absolute right-2 min-w-[36px] min-h-[36px] flex items-center justify-center text-on-surface-variant"><Icon name={show ? 'visibility_off' : 'visibility'} className="text-[19px]" /></button>
            </div>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs text-on-surface-variant">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-primary w-4 h-4" />
            Remember this device for 30 days
          </label>
          {error && <ErrorNote message={error} />}
          <button type="submit" disabled={busy}
            className="w-full h-12 rounded-xl bg-primary text-on-primary text-sm font-semibold shadow-[0_4px_20px_rgba(194,101,42,0.25)] flex items-center justify-center gap-2 hover:bg-primary-container disabled:opacity-60 active:scale-[0.98] transition">
            <Icon name={busy ? 'progress_activity' : 'lock_open'} className={`text-[20px] ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <div className="relative mt-6"><ServerStatus startOpen /></div>
        <p className="relative mt-6 text-center text-xs text-on-surface-variant">Need an account? Ask your administrator to create one.</p>
      </div>
    </main>
  );
}
