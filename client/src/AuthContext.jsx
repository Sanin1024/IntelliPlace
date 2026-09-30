import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore, setUnauthorizedHandler } from './api';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => !!tokenStore.get());

  const clear = useCallback(() => { tokenStore.clear(); setUser(null); }, []);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    return () => setUnauthorizedHandler(() => {});
  }, [clear]);

  useEffect(() => {
    if (!tokenStore.get()) return undefined;
    let live = true;
    api('/auth/me')
      .then(u => { if (live) setUser(u); })
      .catch(() => { if (live) clear(); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [clear]);

  const login = useCallback(async (email, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { email, password }, auth: false });
    tokenStore.set(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const register = useCallback(async (name, email, password) => {
    await api('/auth/register', { method: 'POST', body: { name, email, password }, auth: false });
    return login(email, password);
  }, [login]);

  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* sign out locally regardless */ }
    clear();
  }, [clear]);

  const value = useMemo(() => ({ user, loading, login, register, logout }), [user, loading, login, register, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
