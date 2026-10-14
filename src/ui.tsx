import { NavLink, Link, Outlet } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type Risk } from './api';
import { useKeyboardOpen } from './components';

export const Icon = ({ name, fill, className = '' }: { name: string; fill?: boolean; className?: string }) =>
  <span aria-hidden="true" className={`material-symbols-outlined ${fill ? 'icon-fill' : ''} ${className}`}>{name}</span>;

export const Wordmark = () => <span className="font-headline text-lg font-semibold tracking-wide">PHANTOM<span className="text-primary">GUARD</span></span>;

const NAV = [['/', 'shield', 'Home'], ['/analyze', 'analytics', 'Analyze'], ['/alerts', 'radar', 'Alerts'], ['/activity', 'terminal', 'Activity'], ['/profile', 'manage_accounts', 'Profile']] as const;

export function Shell() {
  const kb = useKeyboardOpen();
  const status = useAsync(api.status);
  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="fixed top-0 inset-x-0 z-40 bg-surface/80 backdrop-blur-xl shadow-[0_1px_8px_rgba(58,48,42,0.04)] pt-safe">
        <div className="h-16 px-5 sm:px-6 flex items-center justify-between max-w-2xl mx-auto">
          <Link to="/" className="flex items-center gap-2.5" aria-label="PHANTOMGUARD home">
            <img src="/logo.png" alt="" className="h-8 w-8 rounded-full object-cover" /><Wordmark />
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/alerts" aria-label="Notifications" className="min-w-[44px] min-h-[44px] flex items-center justify-center text-on-surface-variant"><Icon name="notifications" /></Link>
            <Link to="/profile" aria-label="Profile" className="w-9 h-9 rounded-full bg-primary-fixed flex items-center justify-center text-primary"><Icon name="person" className="text-[20px]" /></Link>
          </div>
        </div>
      </header>
      <main className={`flex-1 w-full max-w-2xl mx-auto px-5 sm:px-6 pt-[calc(5rem+env(safe-area-inset-top))] ${kb ? 'pb-6' : 'pb-[calc(7rem+env(safe-area-inset-bottom))]'} flex flex-col gap-6`}>
        {status.data?.demo && (
          <div role="note" data-testid="demo-banner" className="rounded-xl bg-inverse-surface text-on-primary text-xs text-center font-semibold py-2 px-4">
            DEMO MODE: any scan results come from a MOCK test service, not an AI model.
          </div>)}
        <Outlet />
      </main>
      <nav aria-label="Primary" hidden={kb} className="fixed bottom-0 inset-x-0 z-40 bg-surface/90 backdrop-blur-xl border-t border-outline-variant/40 pb-safe">
        <ul className="max-w-2xl mx-auto flex justify-around">
          {NAV.map(([to, icon, label]) => (
            <li key={to}><NavLink to={to} end={to === '/'} className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 min-w-[56px] min-h-[56px] justify-center text-xs font-label ${isActive ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}>
              {({ isActive }) => <><Icon name={icon} fill={isActive} /><span>{label}</span></>}
            </NavLink></li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

const RISK_STYLE: Record<Risk, string> = { high: 'bg-error-container text-error', warning: 'bg-primary-fixed text-primary', low: 'bg-surface-container-high text-on-surface-variant' };
export const RiskBadge = ({ risk, children }: { risk: Risk; children: ReactNode }) =>
  <span className={`text-xs px-2 py-0.5 rounded font-label font-medium ${RISK_STYLE[risk]}`}>{children}</span>;

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) =>
  <section className={`rounded-xl bg-surface-container-low border border-outline-variant/40 p-5 shadow-sm animate-fade-in ${className}`}>{children}</section>;

export const Spinner = ({ label = 'Loading' }: { label?: string }) =>
  <div role="status" className="flex items-center gap-2 text-sm text-on-surface-variant py-6 justify-center"><Icon name="progress_activity" className="animate-spin" />{label}…</div>;

export const ErrorNote = ({ message }: { message: string }) =>
  <p role="alert" className="text-sm text-error bg-error-container rounded-xl px-4 py-3 flex gap-2"><Icon name="error" className="text-[20px]" />{message}</p>;

export const kindIcon = { text: 'description', audio: 'mic', video: 'videocam' } as const;
export const kindName = { text: 'Text message', audio: 'Voice recording', video: 'Video' } as const;
export const timeAgo = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [s, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    set({ loading: true });
    fn().then((data) => live && set({ data, loading: false }), (e) => live && set({ error: e.message, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}
