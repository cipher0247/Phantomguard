import { apiBase, clearToken, getToken, isNative, setToken } from './server';
export type Kind = 'text' | 'audio' | 'video';
export type Risk = 'low' | 'warning' | 'high';
export interface User { email: string; name: string }
export interface Scan { mock: boolean; id: number; kind: Kind; label: string; score: number; risk: Risk; model: string; version: string; details: Record<string, unknown>;
  input: Record<string, unknown>; createdAt: string; limitation?: string }
export interface Status { models: Record<Kind | 'advisor', boolean>;
  demo: boolean; limits: { text: number; audio: { bytes: number; exts: string[]; maxSeconds: number }; video: { bytes: number; exts: string[] } } }
export interface Summary { mockScans: number; totalScans: number; highRisk: number; flagged: number; lastScanAt: string | null; last24h: { scans: number; maxScore: number | null; flagged: number } }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const toError = async (r: Response) => {
  const j = await r.json().catch(() => ({}));
  return new ApiError(r.status, j.error ?? 'error', j.message ?? 'Request failed. Please try again.');
};
const NO_SERVER = () => new ApiError(0, 'no_server', 'Set the server address first (tap the server status).');
const authHeaders = (): Record<string, string> => { const t = getToken(); return t ? { authorization: `Bearer ${t}` } : {}; };
const endpoint = (path: string) => {
  if (isNative() && !apiBase()) throw NO_SERVER();
  return `${apiBase()}/api${path}`;
};
const ABSENT = 'Cannot reach the server. Check the address and that the phone and server are on the same network.';

/** Fired when the server rejects the session (expired, revoked, server restarted with a new database). The auth provider signs the user out. */
export const SESSION_EXPIRED = 'pg:session-expired';

async function req<T>(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
  let r: Response;
  try {
    r = await fetch(endpoint(path), { ...init, signal: AbortSignal.timeout(timeoutMs), credentials: isNative() ? 'omit' : 'same-origin', headers: { ...authHeaders(), ...init?.headers } });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error).name === 'TimeoutError') throw new ApiError(0, 'timeout', 'The server took too long to respond. Try again.');
    throw new ApiError(0, 'network', ABSENT);
  }
  if (r.status === 401 && path !== '/auth/login') { clearToken(); window.dispatchEvent(new Event(SESSION_EXPIRED)); }
  if (!r.ok) throw await toError(r);
  try { return await r.json(); } catch { throw new ApiError(r.status, 'bad_response', 'The server sent an unreadable response.'); }
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  me: () => req<{ user: User }>('/auth/me').then((r) => r.user),
  login: (email: string, password: string, remember: boolean) =>
    req<{ user: User; token?: string }>('/auth/login', json({ email, password, remember, client: isNative() ? 'native' : 'web' })).then((r) => { if (r.token) setToken(r.token); return r.user; }),
  logout: () => req('/auth/logout', { method: 'POST' }).finally(clearToken),
  health: async (baseUrl = apiBase(), timeoutMs = 5000) => {
    try { return (await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs), credentials: 'omit' })).ok; } catch { return false; }
  },
  scan: (id: number) => req<Scan>(`/scans/${id}`),
  report: (id: number) => req<Record<string, unknown>>(`/scans/${id}/report`),
  status: () => req<Status>('/status'),
  summary: () => req<Summary>('/summary'),
  scans: (opts: { kind?: Kind; before?: number; limit?: number } = {}) => {
    const q = new URLSearchParams(Object.entries(opts).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
    return req<{ scans: Scan[] }>(`/scans?${q}`).then((r) => r.scans);
  },
  scanText: (text: string) => req<Scan>('/scan/text', json({ text }), 60_000),
  advisor: (messages: { role: 'user' | 'assistant'; content: string }[]) => req<{ reply: string }>('/advisor', json({ messages })).then((r) => r.reply),
  // XHR rather than fetch: fetch cannot report upload progress.
  scanFile: (kind: 'audio' | 'video', file: File, onProgress: (pct: number) => void) => new Promise<Scan>((resolve, reject) => {
    const x = new XMLHttpRequest(), fd = new FormData();
    fd.append('file', file);
    try { x.open('POST', endpoint(`/scan/${kind}`)); } catch (e) { return reject(e); }
    const t = getToken(); if (t) x.setRequestHeader('Authorization', `Bearer ${t}`);
    x.timeout = 180_000; x.ontimeout = () => reject(new ApiError(0, 'timeout', 'The upload timed out. Try a smaller file or a faster connection.'));
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onerror = () => reject(new ApiError(0, 'network', ABSENT));
    x.onload = () => {
      let j: any = {};
      try { j = JSON.parse(x.responseText); } catch { /* non-JSON error body */ }
      x.status >= 200 && x.status < 300 ? resolve(j) : reject(new ApiError(x.status, j.error ?? 'error', j.message ?? 'Upload failed.'));
    };
    x.send(fd);
  }),
};

export const pct = (s: number) => Math.round(s * 100);
export const riskLabel = (s: Pick<Scan, 'risk' | 'score'>) => (s.risk === 'high' ? (s.score >= 0.95 ? 'Critical' : 'High risk') : s.risk === 'warning' ? 'Warning' : 'Low risk');
