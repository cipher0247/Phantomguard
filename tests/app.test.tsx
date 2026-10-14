import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { resetIntroForTests } from '../src/Intro';

const play = vi.fn(() => Promise.resolve());
let authed = false;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

beforeEach(() => {
  resetIntroForTests(); authed = false; play.mockClear();
  HTMLMediaElement.prototype.play = play as never;
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/auth/me')) return authed ? json({ user: { email: 'a@b.co', name: 'Alex' } }) : json({ error: 'unauthenticated', message: 'x' }, 401);
    if (url.endsWith('/auth/login')) {
      if (JSON.parse(String(init!.body)).password !== 'good-password') return json({ error: 'bad_credentials', message: 'Incorrect email or password.' }, 401);
      authed = true; return json({ user: { email: 'a@b.co', name: 'Alex' } });
    }
    if (url.endsWith('/auth/logout')) { authed = false; return json({ ok: true }); }
    if (url.endsWith('/status')) return json({ demo: false, models: { text: false, audio: false, video: false, advisor: false }, limits: { text: 20000, audio: { bytes: 1, exts: ['wav'], maxSeconds: 300 }, video: { bytes: 1, exts: ['mp4'] } } });
    if (url.endsWith('/summary')) return json({ totalScans: 0, mockScans: 0, highRisk: 0, lastScanAt: null, last24h: { scans: 0, maxScore: null } });
    if (url.includes('/scans')) return json({ scans: [] });
    return json({}, 404);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const mount = (path = '/') => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const video = () => document.querySelector('video')!;

describe('intro', () => {
  it('starts playback only after canplay, then continues to sign-in when the video ends', async () => {
    mount();
    expect(play).not.toHaveBeenCalled();
    expect(video().controls).toBe(false);
    fireEvent.canPlay(video());
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.ended(video());
    await waitFor(() => expect(screen.queryByTestId('intro')).toBeNull(), { timeout: 2000 });
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('can be skipped by click and by keyboard', async () => {
    const { unmount } = mount();
    await userEvent.click(screen.getByRole('button', { name: /skip intro/i }));
    await waitFor(() => expect(screen.queryByTestId('intro')).toBeNull(), { timeout: 2000 });
    unmount(); resetIntroForTests(); mount();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('intro')).toBeNull(), { timeout: 2000 });
  });

  it('shows the branded fallback on video error and still continues', async () => {
    mount();
    fireEvent.error(video());
    expect(await screen.findByTestId('intro-fallback')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('intro')).toBeNull(), { timeout: 4000 });
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('falls back when playback never starts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    await act(async () => { vi.advanceTimersByTime(4100); });
    expect(screen.getByTestId('intro-fallback')).toBeInTheDocument();
  });

  it('plays once: not replayed on navigation', async () => {
    authed = true; mount('/');
    fireEvent.ended(video());
    await waitFor(() => expect(screen.queryByTestId('intro')).toBeNull(), { timeout: 2000 });
    const nav = within(await screen.findByRole('navigation', { name: 'Primary' }));
    await userEvent.click(nav.getByRole('link', { name: /alerts/i }));
    await userEvent.click(nav.getByRole('link', { name: /home/i }));
    expect(screen.queryByTestId('intro')).toBeNull();
    expect(document.querySelector('video')).toBeNull();
  });

  it('shows a static splash without video under reduced motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    mount();
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByTestId('intro-fallback')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('intro')).toBeNull(), { timeout: 3000 });
  });
});

describe('authentication and navigation', () => {
  const skip = async () => { fireEvent.keyDown(window, { key: 'Escape' }); await waitFor(() => expect(screen.queryByTestId('intro')).toBeNull(), { timeout: 2000 }); };

  it('redirects unauthenticated users to sign-in and shows validation + server errors', async () => {
    mount('/analyze'); await skip();
    const form = await screen.findByRole('form', { name: 'Sign in' });
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    expect(form).toBeInTheDocument();
  });

  it('signs in to the dashboard, navigates all tabs, and signs out', async () => {
    mount('/'); await skip();
    await userEvent.type(await screen.findByLabelText(/email/i), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'good-password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Am I safe right now?')).toBeInTheDocument();
    for (const [name, heading] of [['Analyze', 'Safety Scanner'], ['Activity', 'No scans recorded yet.'], ['Alerts', 'No alerts'], ['Profile', 'Alex']] as const) {
      await userEvent.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name }));
      expect(await screen.findByText(heading)).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', { name: /log out/i }));
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('tells the user when a model is not configured instead of faking a scan', async () => {
    authed = true; mount('/analyze?tab=audio'); await skip();
    expect(await screen.findByText(/audio model is not configured/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /execute scan/i })).toBeDisabled();
  });
});
