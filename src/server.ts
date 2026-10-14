import { Capacitor } from '@capacitor/core';

// Where the API lives. Browser (served by the backend or the Vite proxy): same origin, nothing to configure.
// Native Android app: the UI is bundled in the APK, so the backend address is entered by the user and kept on the device.
const URL_KEY = 'pg_server', TOKEN_KEY = 'pg_token';

export const isNative = () => Capacitor.isNativePlatform();

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};

const PRIVATE_HOST = /^(localhost|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|[a-z0-9-]+\.local)$/i;

/** Returns the normalised origin, or an error message. HTTPS is always fine; plain HTTP only for loopback/LAN hosts. */
export function parseServerUrl(raw: string): { url: string } | { error: string } {
  let u: URL;
  try { u = new URL(raw.trim().includes('://') ? raw.trim() : `https://${raw.trim()}`); } catch { return { error: 'Enter a valid address, e.g. https://example.com or http://192.168.1.20:8787' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Address must start with https:// or http://' };
  if (u.protocol === 'http:' && !PRIVATE_HOST.test(u.hostname)) return { error: 'Plain http:// is only allowed for localhost or a local-network address. Use https:// for anything else.' };
  return { url: u.origin };
}

export const getServerUrl = (): string => (isNative() ? store.get(URL_KEY) || (import.meta.env.VITE_API_URL as string | undefined) || '' : '');
export const setServerUrl = (url: string) => store.set(URL_KEY, url);
export const apiBase = () => getServerUrl();

export const getToken = () => (isNative() ? store.get(TOKEN_KEY) : null);
export const setToken = (t: string) => store.set(TOKEN_KEY, t);
export const clearToken = () => store.del(TOKEN_KEY);
