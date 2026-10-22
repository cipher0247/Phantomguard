import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { copyText } from '../src/components';
import { resetIntroForTests } from '../src/Intro';
import { SESSION_EXPIRED } from '../src/api';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const scan = (o: object) => ({ id: 1, kind: 'text', label: 'suspicious', score: 0.93, risk: 'high', model: 'pg-text-tfidf-logreg', version: '1.0.0', mock: false,
  details: { threshold: 0.36, scope: 'English email/SMS text', limitations: 'Hint, not proof.' }, input: { chars: 120 }, createdAt: new Date().toISOString(), ...o });
const REAL = scan({ id: 2 });
const MOCKED = scan({ id: 3, label: 'MOCK result (not a real prediction)', model: 'MOCK-text-model-not-a-detector', version: 'mock-0', mock: true, details: { mock: true } });
const SAFE = scan({ id: 4, label: 'safe', score: 0.02, risk: 'low' });
const EXPERIMENTAL = scan({ id: 5, kind: 'audio', label: 'synthetic', model: 'pg-audio-experimental', details: { experimental: true, limitations: 'Not reliable.' }, input: { filename: 'call.wav' } });

let authed = true, scans: object[] = [], advisor = true, expire = false;
beforeEach(() => {
  resetIntroForTests(); localStorage.clear(); authed = true; scans = [REAL, MOCKED, SAFE, EXPERIMENTAL]; advisor = true; expire = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/health')) return json({ ok: true });
    if (expire && !url.endsWith('/auth/login')) return json({ error: 'unauthenticated', message: 'Please sign in.' }, 401);
    if (url.endsWith('/auth/me')) return authed ? json({ user: { email: 'a@b.co', name: 'Alex' } }) : json({ error: 'unauthenticated', message: 'x' }, 401);
    if (url.endsWith('/status')) return json({ demo: false, models: { text: true, audio: false, video: false, advisor }, limits: { text: 20000, audio: { bytes: 1, exts: ['wav'], maxSeconds: 300 }, video: { bytes: 1, exts: ['mp4'] } } });
    if (url.endsWith('/summary')) return json({ totalScans: 4, mockScans: 1, experimentalScans: 1, highRisk: 1, flagged: 1, lastScanAt: REAL.createdAt, last24h: { scans: 2, maxScore: 0.93, flagged: 1 } });
    if (/\/scans\/\d+\/report$/.test(url)) return json({ id: 2, label: 'suspicious', model: 'pg-text-tfidf-logreg' });
    if (url.includes('/scans')) return json({ scans });
    return json({}, 404);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const open = async (path: string) => { render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); await userEvent.keyboard('{Escape}'); };

describe('history, alerts and details', () => {
  it('alerts list only non-experimental flagged scans (no MOCK, no experimental, no low risk)', async () => {
    await open('/alerts');
    expect(await screen.findByText('All (1)')).toBeInTheDocument();
    expect(screen.queryByText(/MOCK result/)).toBeNull();
    expect(screen.queryByText('synthetic')).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: /suspicious/i }));
    const d = await screen.findByRole('dialog', { name: 'Scan details' });
    expect(within(d).getByText('Trained model')).toBeInTheDocument();
    expect(within(d).getByText('pg-text-tfidf-logreg')).toBeInTheDocument();
    expect(within(d).getByText(/Hint, not proof/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('activity shows persisted records, labels MOCK ones, and opens their details', async () => {
    await open('/activity');
    const items = await screen.findAllByRole('button', { name: /scan/i });
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText('EXPERIMENTAL').length).toBeGreaterThan(0);
    const mockRow = items.find((b) => /MOCK/.test(b.textContent ?? ''))!;
    await userEvent.click(mockRow);
    const d = await screen.findByRole('dialog', { name: 'Scan details' });
    expect(within(d).getByRole('note')).toHaveTextContent(/MOCK \/ DEMO RESULT/);
    expect(within(d).queryByText('Trained model')).toBeNull();
  });

  it('experimental scan details retain the warning and never present an experimental risk badge', async () => {
    await open('/activity');
    const row = await screen.findByRole('button', { name: /voice recording scan/i });
    expect(row).toHaveTextContent('EXPERIMENTAL');
    await userEvent.click(row);
    const d = await screen.findByRole('dialog', { name: 'Scan details' });
    expect(within(d).getByRole('note')).toHaveTextContent(/experimental detector — do not rely/i);
    expect(within(d).getByText('Experimental model')).toBeInTheDocument();
    expect(within(d).queryByText('High risk')).toBeNull();
  });

  it('the Flagged activity filter excludes experimental and MOCK results', async () => {
    await open('/activity');
    await screen.findAllByRole('button', { name: /scan/i });
    await userEvent.click(screen.getByRole('button', { name: 'Flagged' }));
    expect(await screen.findAllByRole('button', { name: /scan/i })).toHaveLength(1);
    expect(screen.queryByText('EXPERIMENTAL')).toBeNull();
    expect(screen.queryByText(/MOCK result/)).toBeNull();
  });

  it('report dialog shows the report and the history entry created by the Android back button closes it', async () => {
    await open('/activity');
    await userEvent.click((await screen.findAllByRole('button', { name: /scan/i }))[0]);
    await userEvent.click(await screen.findByRole('button', { name: /view report/i }));
    expect(await screen.findByRole('dialog', { name: 'Scan report' })).toHaveTextContent('pg-text-tfidf-logreg');
    await act(async () => { history.back(); await new Promise((r) => setTimeout(r, 50)); });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Scan report' })).toBeNull());
  });
});

describe('session, connectivity and resilience', () => {
  it('signs out with an explanation when the server rejects the session mid-use', async () => {
    await open('/');
    await screen.findByText('Am I safe right now?');
    expire = true;
    await act(async () => { window.dispatchEvent(new Event(SESSION_EXPIRED)); });
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/session ended/i)).toBeInTheDocument();
  });

  it('shows an error with Retry instead of an endless spinner when loading fails, and recovers', async () => {
    let fail = true;
    const base = globalThis.fetch as typeof fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (fail && url.includes('/scans?') ? json({ error: 'x', message: 'Database unavailable.' }, 500) : base(url, init))));
    await open('/alerts');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Database unavailable.');
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('All (1)')).toBeInTheDocument();
  });

  it('refreshes data when the app returns to the foreground', async () => {
    await open('/alerts');
    expect(await screen.findByText('All (1)')).toBeInTheDocument();
    scans = [REAL, scan({ id: 9, label: 'suspicious', score: 0.97 }), MOCKED];
    await act(async () => { window.dispatchEvent(new Event('pg:resume')); });
    expect(await screen.findByText('All (2)')).toBeInTheDocument();
  });

  it('shows a banner when the server is unreachable', async () => {
    const base = globalThis.fetch as typeof fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { if (url.endsWith('/health')) throw new TypeError('network'); return base(url, init); }));
    await open('/');
    expect(await screen.findByTestId('connection-banner')).toHaveTextContent(/can.t reach the server/i);
  });
});

describe('advisor, preferences and clipboard', () => {
  it('tells the user when the advisor is not configured and blocks sending', async () => {
    advisor = false;
    await open('/advisor');
    expect(await screen.findByText(/advisor is not configured/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('persists the intro preference and honours it on the next launch', async () => {
    await open('/profile');
    const sw = await screen.findByRole('switch', { name: /play intro/i });
    await userEvent.click(sw);
    expect(JSON.parse(localStorage.getItem('pg_prefs')!)).toEqual({ playIntro: false });
    document.body.innerHTML = ''; resetIntroForTests();
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(screen.queryByTestId('intro')).toBeNull();
  });

  it('copy falls back to execCommand when the async clipboard is refused (WebView)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    const exec = vi.fn(() => true); (document as unknown as { execCommand: unknown }).execCommand = exec;
    expect(await copyText('hello')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    exec.mockReturnValue(false);
    expect(await copyText('hello')).toBe(false);
  });
});
