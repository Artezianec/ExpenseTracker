import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  fetchMe,
  getAccessToken,
  login,
  register,
  setAccessToken,
} from '../lib/api';
import { ensureUserProfile } from '../lib/budgetDb';
import type { AppUser } from '../types';

interface AuthContextValue {
  user: AppUser | null;
  accessToken: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(() => getAccessToken());

  useEffect(() => {
    const stored = getAccessToken();
    if (!stored) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const { user: me } = await fetchMe();
        setUser(me);
        setToken(stored);
        await ensureUserProfile();
      } catch {
        setAccessToken(null);
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { token: nextToken, user: nextUser } = await login(email, password);
    setAccessToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
    await ensureUserProfile();
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const { token: nextToken, user: nextUser } = await register(
        email,
        password,
        displayName,
      );
      setAccessToken(nextToken);
      setToken(nextToken);
      setUser(nextUser);
    },
    [],
  );

  const signOut = useCallback(async () => {
    setAccessToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      accessToken: token,
      loading,
      signIn,
      signUp,
      signOut,
    }),
    [user, token, loading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
