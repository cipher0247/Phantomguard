import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { resetIntroForTests } from '../src/Intro';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const LIMITS = { text: 20000, audio: { bytes: 20 * 1048576, exts: ['wav', 'mp3'], maxSeconds: 300 }, video: { bytes: 100 * 1048576, exts: ['mp4'] } };
const AUDIO = { id: 7, kind: 'audio', label: 'synthetic', score: 0.91, risk: 'high', model: 'pg-audio-melodymachine-pretrained', version: '0.1.0-experimental', mock: false,
  details: { threshold: 0.4, windows_analysed: 3, score_contract: 'Uncalibrated model output on a 0-1 scale; not a calibrated probability.', limitations: 'Experimental baseline.', experimental: true }, input: { filename: 'call.wav', bytes: 1000 }, createdAt: new Date().toISOString() };
const VIDEO = { ...AUDIO, id: 8, kind: 'video', label: 'not flagged', score: 0.02, model: 'pg-video-communityforensics-vit', details: { threshold: 0.03, frames_analysed: 12, score_contract: 'Uncalibrated sigmoid-head output on a 0-1 scale; not a calibrated probability.', limitations: 'Experimental video model.', experimental: true }, input: { filename: 'clip.mp4', bytes: 2000 } };

// A controllable XMLHttpRequest stand-in (jsdom cannot upload for real): the test decides how the "server" answers.
let xhrPlan: { status: number; body: unknown; hang?: boolean } = { status: 200, body: AUDIO };
let lastXhr: FakeXhr | null = null;
class FakeXhr {
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null; onerror: (() => void) | null = null; ontimeout: (() => void) | null = null;
  status = 0; responseText = ''; timeout = 0; aborted = false; headers: Record<string, string> = {};
  open() { lastXhr = this; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  abort() { this.aborted = true; }
  send() {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    if (xhrPlan.hang) return;
    setTimeout(() => { this.status = xhrPlan.status; this.responseText = JSON.stringify(xhrPlan.body); this.onload?.(); }, 5);
  }
}

beforeEach(() => {
  resetIntroForTests(); localStorage.clear(); xhrPlan = { status: 200, body: AUDIO }; lastXhr = null;
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/health')) return json({ ok: true });
    if (url.endsWith('/auth/me')) return json({ user: { email: 'a@b.co', name: 'Alex' } });
    if (url.endsWith('/status')) return json({ demo: false, models: { text: true, audio: true, video: true, advisor: false }, limits: LIMITS });
    if (url.endsWith('/scans/8/report')) return json(VIDEO);
    return json({}, 404);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const open = async (path: string) => { render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); await userEvent.keyboard('{Escape}'); };
const pick = async (name: string, size = 1000, kind: 'audio' | 'video' = 'audio') => {
  const input = await screen.findByLabelText(new RegExp(`choose ${kind} file`, 'i')) as HTMLInputElement;
  await userEvent.upload(input, new File([new Uint8Array(size)], name, { type: kind === 'audio' ? 'audio/wav' : 'video/mp4' }), { applyAccept: false });
};

describe('audio upload flow', () => {
  it('uploads, shows progress, and renders the real-model result with its metadata', async () => {
    await open('/analyze?tab=audio');
    await pick('call.wav');
    await userEvent.click(screen.getByRole('button', { name: /execute scan/i }));
    expect(await screen.findByText('EXPERIMENTAL MODEL')).toBeInTheDocument();
    expect(screen.getByLabelText('Experimental model score 91 out of 100')).toBeInTheDocument();
    expect(screen.getByText(/Experimental detector — do not rely on this result/)).toBeInTheDocument();
    expect(screen.getByText(/pg-audio-melodymachine-pretrained/)).toBeInTheDocument();
    expect(screen.getByText(/Experimental baseline/)).toBeInTheDocument();
    expect(screen.getByText(/not a probability/i)).toBeInTheDocument();
    expect(screen.getByText('0.4')).toBeInTheDocument();
    expect(screen.queryByText(/MOCK \/ DEMO RESULT/)).toBeNull();
    expect(lastXhr?.headers).toBeDefined();
  });

  it('validates type and size before uploading', async () => {
    await open('/analyze?tab=audio');
    await pick('notes.txt');
    expect(await screen.findByRole('alert')).toHaveTextContent(/unsupported file type/i);
    await pick('big.wav', 21 * 1048576);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too large/i));
    expect(screen.getByRole('button', { name: /execute scan/i })).toBeDisabled();
  });

  it('shows the server error for rejected files (corrupt/too long) and lets the user retry', async () => {
    xhrPlan = { status: 422, body: { error: 'input_rejected', message: 'Could not decode this file. It may be corrupt or have no audio track.' } };
    await open('/analyze?tab=audio');
    await pick('call.wav');
    await userEvent.click(screen.getByRole('button', { name: /execute scan/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not decode/i);
    xhrPlan = { status: 200, body: AUDIO };
    await userEvent.click(screen.getByRole('button', { name: /execute scan/i }));
    expect(await screen.findByText('EXPERIMENTAL MODEL')).toBeInTheDocument();
  });

  it('lets the user cancel a running scan without showing an error', async () => {
    xhrPlan = { status: 200, body: AUDIO, hang: true };
    await open('/analyze?tab=audio');
    await pick('call.wav');
    await userEvent.click(screen.getByRole('button', { name: /execute scan/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /execute scan/i })).toBeEnabled());
    expect(lastXhr?.aborted).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('video uploads show the experimental warning and model limitations', async () => {
    xhrPlan = { status: 200, body: VIDEO };
    await open('/analyze?tab=video');
    await pick('clip.mp4', 1000, 'video');
    await userEvent.click(screen.getByRole('button', { name: /execute scan/i }));
    expect(await screen.findByText('EXPERIMENTAL MODEL')).toBeInTheDocument();
    expect(screen.getByText(/Experimental detector — do not rely on this result/)).toBeInTheDocument();
    expect(screen.getByText(/Experimental video model/)).toBeInTheDocument();
    expect(screen.getByLabelText('Experimental model score 2 out of 100')).toBeInTheDocument();
    expect(screen.getByText('0.03')).toBeInTheDocument();
  });

  it('shows the same video score, label, threshold, and score contract in its report', async () => {
    xhrPlan = { status: 200, body: VIDEO };
    await open('/analyze?tab=video');
    await pick('clip.mp4', 1000, 'video');
    await userEvent.click(screen.getByRole('button', { name: /execute scan/i }));
    await screen.findByText('EXPERIMENTAL MODEL');
    await userEvent.click(screen.getByRole('button', { name: /view report/i }));
    const report = await screen.findByRole('dialog', { name: 'Scan report' });
    expect(report).toHaveTextContent('"score": 0.02');
    expect(report).toHaveTextContent('"label": "not flagged"');
    expect(report).toHaveTextContent('"threshold": 0.03');
    expect(report).toHaveTextContent('not a calibrated probability');
  });
});
