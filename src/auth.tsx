import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, SESSION_EXPIRED, type User } from './api';
import { APP_RESUME } from './ui';

interface Ctx { user: User | null; ready: boolean; expired: boolean; signIn: (e: string, p: string, r: boolean) => Promise<void>; signOut: () => Promise<void> }
const AuthCtx = createContext<Ctx>(null!);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => { api.me().then(setUser).catch(() => setUser(null)).finally(() => setReady(true)); }, []);

  // Server says the session is gone (expiry, revocation, restart): sign out locally and explain why on the sign-in screen.
  useEffect(() => {
    const onExpired = () => setUser((u) => { if (u) setExpired(true); return null; });
    window.addEventListener(SESSION_EXPIRED, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired);
  }, []);

  // Returning to the app: re-validate the session (a 401 triggers the handler above).
  useEffect(() => {
    const revalidate = () => { if (user) void api.me().catch(() => {}); };
    window.addEventListener(APP_RESUME, revalidate);
    return () => window.removeEventListener(APP_RESUME, revalidate);
  }, [user]);

  const signIn = async (e: string, p: string, r: boolean) => { setUser(await api.login(e, p, r)); setExpired(false); };
  const signOut = async () => { await api.logout().catch(() => {}); setUser(null); setExpired(false); };
  return <AuthCtx.Provider value={{ user, ready, expired, signIn, signOut }}>{children}</AuthCtx.Provider>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return null; // intro overlay covers this wait on launch
  return user ? <>{children}</> : <Navigate to="/signin" replace state={{ from: loc.pathname }} />;
}
