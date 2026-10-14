// Per-device preferences, kept in localStorage (the backend has no per-user settings store; nothing sensitive belongs here).
export interface Prefs { playIntro: boolean }
const KEY = 'pg_prefs', DEFAULTS: Prefs = { playIntro: true };

export function getPrefs(): Prefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULTS; }
}
export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...getPrefs(), [k]: v })); } catch { /* storage blocked: preference lasts only this session */ }
}
