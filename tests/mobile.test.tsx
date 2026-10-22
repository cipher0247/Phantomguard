import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { ServerStatus, MockNotice } from '../src/components';
import { parseServerUrl } from '../src/server';
import { resetIntroForTests } from '../src/Intro';

describe('backend URL configuration', () => {
  it('accepts https anywhere and defaults to https', () => {
    expect(parseServerUrl('https://demo.example.com/some/path')).toEqual({ url: 'https://demo.example.com' });
    expect(parseServerUrl('demo.example.com')).toEqual({ url: 'https://demo.example.com' });
  });
  it('allows plain http only for loopback and private LAN hosts', () => {
    for (const ok of ['http://localhost:8787', 'http://127.0.0.1:8787', 'http://192.168.1.20:8787', 'http://10.0.0.5:8787', 'http://172.20.1.1:8787', 'http://pc.local:8787'])
      expect(parseServerUrl(ok)).toHaveProperty('url');
    for (const bad of ['http://example.com', 'http://8.8.8.8:8787', 'http://172.32.0.1', 'ftp://192.168.1.2', '::::'])
      expect(parseServerUrl(bad)).toHaveProperty('error');
  });
});

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
let demo = false, down = false;
beforeEach(() => {
  resetIntroForTests(); demo = false; down = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (down) throw new TypeError('network');
    if (url.endsWith('/health')) return json({ ok: true });
    if (url.endsWith('/auth/me')) return json({ user: { email: 'a@b.co', name: 'Alex' } });
    if (url.endsWith('/status')) return json({ demo, models: { text: true, audio: false, video: false, advisor: false }, limits: { text: 20000, audio: { bytes: 1, exts: ['wav'], maxSeconds: 300 }, video: { bytes: 1, exts: ['mp4'] } } });
    if (url.endsWith('/summary')) return json({ totalScans: 0, mockScans: 0, experimentalScans: 0, highRisk: 0, flagged: 0, lastScanAt: null, last24h: { scans: 0, maxScore: null, flagged: 0 } });
    if (url.includes('/scans')) return json({ scans: [] });
    return json({}, 404);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('connectivity and demo labelling', () => {
  it('shows Connected when the backend answers and Unreachable when it does not', async () => {
    const { unmount } = render(<ServerStatus />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Connected'));
    unmount(); down = true;
    render(<ServerStatus />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Unreachable'));
  });
  it('MOCK notice is explicit', () => {
    render(<MockNotice />);
    expect(screen.getByRole('note')).toHaveTextContent(/MOCK \/ DEMO RESULT.*not an AI model/i);
  });
  const open = async (path: string) => { render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); await userEvent.keyboard('{Escape}'); };
  it('shows the Demo Mode banner and synthetic samples only in demo mode', async () => {
    demo = true; await open('/analyze');
    expect(await screen.findByTestId('demo-banner')).toHaveTextContent(/MOCK/);
    await userEvent.click(await screen.findByRole('button', { name: 'Fake bank alert' }));
    expect((screen.getByLabelText(/payload input/i) as HTMLTextAreaElement).value).toContain('URGENT');
  });
  it('has no demo banner or samples otherwise', async () => {
    await open('/analyze');
    await screen.findByText('Safety Scanner');
    await waitFor(() => expect(screen.queryByTestId('demo-banner')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Fake bank alert' })).toBeNull();
  });
  it('mobile navigation reaches every primary screen from the bottom bar', async () => {
    await open('/');
    const nav = within(await screen.findByRole('navigation', { name: 'Primary' }));
    expect(nav.getAllByRole('link')).toHaveLength(5);
    for (const [name, text] of [['Analyze', 'Safety Scanner'], ['Alerts', 'No alerts'], ['Activity', 'No scans recorded yet.'], ['Profile', 'Backend connection']] as const) {
      await userEvent.click(nav.getByRole('link', { name })); expect(await screen.findByText(text)).toBeInTheDocument();
    }
  });
  it('surfaces API failure states in the UI', async () => {
    await open('/'); await screen.findByRole('navigation', { name: 'Primary' });
    down = true;
    await userEvent.click(screen.getByRole('link', { name: 'Activity' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot reach the server/i);
  });
});
