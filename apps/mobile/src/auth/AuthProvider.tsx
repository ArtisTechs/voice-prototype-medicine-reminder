import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, setOnAuthLost } from '../api/client';
import type { Tokens } from '../api/types';
import { clearTokens, loadTokens, saveTokens } from './tokenStore';

type Status = 'loading' | 'signedOut' | 'signedIn';

type Auth = {
  status: Status;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: (opts?: { pushToken?: string | null }) => Promise<void>;
  /** Called after DELETE /me: forget the session without calling the API. */
  forget: () => Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const qc = useQueryClient();

  const forget = useCallback(async () => {
    await clearTokens();
    qc.clear();
    setStatus('signedOut');
  }, [qc]);

  useEffect(() => {
    loadTokens()
      .then((t) => setStatus(t ? 'signedIn' : 'signedOut'))
      .catch(() => setStatus('signedOut'));
    setOnAuthLost(() => {
      qc.clear();
      setStatus('signedOut');
    });
  }, [qc]);

  const value = useMemo<Auth>(
    () => ({
      status,
      signIn: async (email, password) => {
        const t = await api<Tokens>('/api/v1/auth/login', { method: 'POST', body: { email, password }, auth: false });
        await saveTokens(t);
        setStatus('signedIn');
      },
      signUp: async (name, email, password) => {
        const t = await api<Tokens>('/api/v1/auth/signup', {
          method: 'POST',
          body: { name, email, password },
          auth: false,
        });
        await saveTokens(t);
        setStatus('signedIn');
      },
      signOut: async (opts) => {
        const t = await loadTokens();
        try {
          await api('/api/v1/auth/logout', {
            method: 'POST',
            body: { refreshToken: t?.refreshToken ?? null, pushToken: opts?.pushToken ?? null },
          });
        } catch {
          // Signing out locally must always work, even offline.
        }
        await forget();
      },
      forget,
    }),
    [status, forget],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
