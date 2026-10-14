export type Kind = 'text' | 'audio' | 'video';
export type Risk = 'low' | 'warning' | 'high';
export interface User { email: string; name: string }
export interface Scan { id: number; kind: Kind; label: string; score: number; risk: Risk; model: string; details: Record<string, unknown>;
  input: Record<string, unknown>; createdAt: string; limitation?: string }
export interface Status { models: Record<Kind | 'advisor', boolean>;
  limits: { text: number; audio: { bytes: number; exts: string[]; maxSeconds: number }; video: { bytes: number; exts: string[] } } }
export interface Summary { totalScans: number; highRisk: number; lastScanAt: string | null; last24h: { scans: number; maxScore: number | null } }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const toError = async (r: Response) => {
  const j = await r.json().catch(() => ({}));
  return new ApiError(r.status, j.error ?? 'error', j.message ?? 'Request failed. Please try again.');
};
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try { r = await fetch(`/api${path}`, { credentials: 'same-origin', ...init }); }
  catch { throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection.'); }
  if (!r.ok) throw await toError(r);
  return r.json();
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  me: () => req<{ user: User }>('/auth/me').then((r) => r.user),
  login: (email: string, password: string, remember: boolean) => req<{ user: User }>('/auth/login', json({ email, password, remember })).then((r) => r.user),
  logout: () => req('/auth/logout', { method: 'POST' }),
  status: () => req<Status>('/status'),
  summary: () => req<Summary>('/summary'),
  scans: (opts: { kind?: Kind; before?: number; limit?: number } = {}) => {
    const q = new URLSearchParams(Object.entries(opts).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
    return req<{ scans: Scan[] }>(`/scans?${q}`).then((r) => r.scans);
  },
  scanText: (text: string) => req<Scan>('/scan/text', json({ text })),
  advisor: (messages: { role: 'user' | 'assistant'; content: string }[]) => req<{ reply: string }>('/advisor', json({ messages })).then((r) => r.reply),
  reportUrl: (id: number) => `/api/scans/${id}/report`,
  // XHR rather than fetch: fetch cannot report upload progress.
  scanFile: (kind: 'audio' | 'video', file: File, onProgress: (pct: number) => void) => new Promise<Scan>((resolve, reject) => {
    const x = new XMLHttpRequest(), fd = new FormData();
    fd.append('file', file);
    x.open('POST', `/api/scan/${kind}`);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onerror = () => reject(new ApiError(0, 'network', 'Cannot reach the server. Check your connection.'));
    x.onload = () => {
      let j: any = {};
      try { j = JSON.parse(x.responseText); } catch { /* non-JSON error body */ }
      x.status >= 200 && x.status < 300 ? resolve(j) : reject(new ApiError(x.status, j.error ?? 'error', j.message ?? 'Upload failed.'));
    };
    x.send(fd);
  }),
};

export const pct = (s: number) => Math.round(s * 100);
export const bandLabel = (s: number) => (s >= 0.9 ? 'Critical' : s >= 0.7 ? 'High risk' : s >= 0.4 ? 'Warning' : 'Low risk');
