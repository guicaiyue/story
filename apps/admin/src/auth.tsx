import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, clearSession, getAccount, getToken, setSession, type AdminAccount } from './api/client';

type AuthState = {
  account: AdminAccount | null;
  isAuthed: boolean;
  login: (phone: string, code: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

/**
 * Holds the admin session.
 *
 * M1 issues a plain JWT with no refresh flow, so the token is kept in
 * localStorage and a 401 from any request clears it (see api/client.ts).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AdminAccount | null>(() => (getToken() ? getAccount() : null));

  const login = useCallback(async (phone: string, code: string) => {
    const res = await api.adminLogin({ phone, code });
    const next: AdminAccount = { accountId: res.accountId, role: res.role, phone };
    setSession(res.token, next);
    setAccount(next);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setAccount(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ account, isAuthed: Boolean(account), login, logout }),
    [account, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
