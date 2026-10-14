import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, type User } from './api';

interface Ctx { user: User | null; ready: boolean; signIn: (e: string, p: string, r: boolean) => Promise<void>; signOut: () => Promise<void> }
const AuthCtx = createContext<Ctx>(null!);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { api.me().then(setUser).catch(() => setUser(null)).finally(() => setReady(true)); }, []);
  const signIn = async (e: string, p: string, r: boolean) => setUser(await api.login(e, p, r));
  const signOut = async () => { await api.logout().catch(() => {}); setUser(null); };
  return <AuthCtx.Provider value={{ user, ready, signIn, signOut }}>{children}</AuthCtx.Provider>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return null; // intro overlay covers this wait on launch
  return user ? <>{children}</> : <Navigate to="/signin" replace state={{ from: loc.pathname }} />;
}
