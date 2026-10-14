import { App as CapApp } from '@capacitor/app';
import { isNative } from './server';
import { APP_RESUME } from './ui';

/**
 * Turns "the app is usable again" signals (returning to foreground, network back) into one window event.
 * Screens refetch on it and the auth provider re-validates the session, so nothing is left stale or stuck after a
 * phone sleep, a lost connection or a server restart. Also wires the Android back button. Returns a cleanup function.
 */
export function initLifecycle(): () => void {
  let last = 0;
  const fire = () => { const n = Date.now(); if (n - last > 1500) { last = n; window.dispatchEvent(new Event(APP_RESUME)); } };
  const onVisible = () => { if (document.visibilityState === 'visible') fire(); };
  window.addEventListener('online', fire);
  document.addEventListener('visibilitychange', onVisible);
  const handles = isNative() ? [
    CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) fire(); }),
    // Android hardware back: go back in history, otherwise leave the app.
    CapApp.addListener('backButton', ({ canGoBack }) => (canGoBack ? history.back() : void CapApp.exitApp())),
  ] : [];
  return () => {
    window.removeEventListener('online', fire);
    document.removeEventListener('visibilitychange', onVisible);
    handles.forEach((h) => void h.then((l) => l.remove()));
  };
}
