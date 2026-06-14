import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ApexStreamClient,
  type AppAuthSession,
} from '@apexstream/client';
import {
  apexAuth,
  apexAuthConfigured,
  apexConfig,
  apexWsConfigured,
  getAllowInsecureTransport,
} from '../lib/apexstream';
import {
  ensureFirebaseBridge,
  sessionToAppUser,
  signOutFirebaseBridge,
} from '../lib/firebaseBridge';
import type { AppUser } from '../types';

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

interface ApexStreamContextValue {
  session: AppAuthSession | null;
  user: AppUser | null;
  loading: boolean;
  authConfigured: boolean;
  wsConfigured: boolean;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  client: ApexStreamClient | null;
  channel: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  publish: (payload: unknown) => void;
}

const ApexStreamContext = createContext<ApexStreamContextValue | null>(null);

export function ApexStreamProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AppAuthSession | null>(() =>
    apexAuthConfigured ? apexAuth.getSession() : null,
  );
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(apexAuthConfigured);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('idle');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [client, setClient] = useState<ApexStreamClient | null>(null);

  useEffect(() => {
    if (!apexAuthConfigured) {
      setLoading(false);
      return;
    }

    return apexAuth.onAuthStateChange(async (nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        try {
          const appUser = await ensureFirebaseBridge(nextSession);
          setUser(appUser);
        } catch (error) {
          console.error('Firebase bridge error:', error);
          setUser(sessionToAppUser(nextSession));
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!session?.accessToken || !apexWsConfigured) {
      setClient(null);
      setConnectionStatus('idle');
      return;
    }

    let cancelled = false;
    let wsClient: ApexStreamClient | null = null;
    setConnectionStatus('connecting');
    setConnectionError(null);

    (async () => {
      try {
        const wsUrl = apexConfig.wsUrl;
        const allowInsecure = getAllowInsecureTransport(wsUrl);
        const useJwt = apexAuthConfigured;

        const c = useJwt
          ? new ApexStreamClient({
              url: wsUrl,
              jwt: await apexAuth.issueRealtimeToken(),
              allowInsecureTransport: allowInsecure,
            })
          : new ApexStreamClient({
              url: wsUrl,
              apiKey: apexConfig.apiKey,
              allowInsecureTransport: allowInsecure,
            });

        if (cancelled) {
          c.disconnect();
          return;
        }

        c.on('open', () => {
          if (!cancelled) {
            setConnectionStatus('connected');
            setConnectionError(null);
            c.subscribe(apexConfig.channel, () => {});
          }
        });
        c.on('close', () => {
          if (!cancelled) setConnectionStatus('disconnected');
        });
        c.on('error', () => {
          if (!cancelled) {
            setConnectionStatus('error');
            setConnectionError('WebSocket connection error');
          }
        });

        c.connect();
        wsClient = c;
        setClient(c);
      } catch (error) {
        if (!cancelled) {
          setConnectionStatus('error');
          setConnectionError(
            error instanceof Error ? error.message : 'Failed to connect',
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      wsClient?.disconnect();
      setClient(null);
      setConnectionStatus('disconnected');
    };
  }, [session?.accessToken]);

  const signIn = useCallback(async (email: string, password: string) => {
    await apexAuth.signInWithPassword(email, password);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    await apexAuth.signUp(email, password);
  }, []);

  const signOut = useCallback(async () => {
    client?.disconnect();
    setClient(null);
    await apexAuth.signOut();
    await signOutFirebaseBridge();
    setSession(null);
    setUser(null);
    setConnectionStatus('idle');
  }, [client]);

  const publish = useCallback(
    (payload: unknown) => {
      if (!client) return;
      client.publish(apexConfig.channel, payload);
    },
    [client],
  );

  const value = useMemo(
    () => ({
      session,
      user,
      loading,
      authConfigured: apexAuthConfigured,
      wsConfigured: apexWsConfigured,
      connectionStatus,
      connectionError,
      client,
      channel: apexConfig.channel,
      signIn,
      signUp,
      signOut,
      publish,
    }),
    [
      session,
      user,
      loading,
      connectionStatus,
      connectionError,
      client,
      signIn,
      signUp,
      signOut,
      publish,
    ],
  );

  return (
    <ApexStreamContext.Provider value={value}>
      {children}
    </ApexStreamContext.Provider>
  );
}

export function useApexStream() {
  const ctx = useContext(ApexStreamContext);
  if (!ctx) {
    throw new Error('useApexStream must be used within ApexStreamProvider');
  }
  return ctx;
}
