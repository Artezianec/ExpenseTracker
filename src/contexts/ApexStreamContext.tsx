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
  ApexStreamDatabase,
  type AppAuthSession,
} from '@apexstream/client';
import {
  apexAuthConfigured,
  apexConfig,
  apexWsConfigured,
  getAllowInsecureTransport,
  getApexAuth,
} from '../lib/apexstream';
import { ensureUserProfile } from '../lib/budgetDb';
import { sessionToAppUser } from '../lib/user';
import type { AppUser } from '../types';

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

interface ApexStreamContextValue {
  session: AppAuthSession | null;
  accessToken: string | null;
  user: AppUser | null;
  loading: boolean;
  authConfigured: boolean;
  wsConfigured: boolean;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  client: ApexStreamClient | null;
  db: ApexStreamDatabase | null;
  channel: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  publish: (payload: unknown) => void;
}

const ApexStreamContext = createContext<ApexStreamContextValue | null>(null);

export function ApexStreamProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AppAuthSession | null>(() =>
    apexAuthConfigured ? getApexAuth().getSession() : null,
  );
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(apexAuthConfigured);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('idle');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [client, setClient] = useState<ApexStreamClient | null>(null);
  const [db, setDb] = useState<ApexStreamDatabase | null>(null);

  useEffect(() => {
    if (!apexAuthConfigured) {
      setLoading(false);
      return;
    }

    return getApexAuth().onAuthStateChange(async (nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        try {
          setUser(sessionToAppUser(nextSession));
        } catch (error) {
          console.error('Auth session error:', error);
          setUser(null);
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
      setDb(null);
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
        const c = new ApexStreamClient({
          url: wsUrl,
          jwt: await getApexAuth().issueRealtimeToken(),
          apiKey: apexConfig.apiKey,
          allowInsecureTransport: allowInsecure,
        });

        if (cancelled) {
          c.disconnect();
          return;
        }

        const database = new ApexStreamDatabase({
          controlPlaneUrl: apexConfig.controlPlaneUrl,
          apiKey: apexConfig.apiKey,
          realtimeClient: c,
        });

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
        setDb(database);

        try {
          const appUser = await ensureUserProfile(database, session);
          if (!cancelled) setUser(appUser);
        } catch (error) {
          console.error('User profile sync error:', error);
        }
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
      setDb(null);
      setConnectionStatus('disconnected');
    };
  }, [session?.accessToken]);

  const signIn = useCallback(async (email: string, password: string) => {
    await getApexAuth().signInWithPassword(email, password);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    await getApexAuth().signUp(email, password);
  }, []);

  const signOut = useCallback(async () => {
    client?.disconnect();
    setClient(null);
    setDb(null);
    await getApexAuth().signOut();
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
      accessToken: session?.accessToken ?? null,
      user,
      loading,
      authConfigured: apexAuthConfigured,
      wsConfigured: apexWsConfigured,
      connectionStatus,
      connectionError,
      client,
      db,
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
      db,
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
