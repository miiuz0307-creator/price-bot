import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useQueryClient } from '@tanstack/react-query';
import {
  getCurrentSession, logoutAdmin, setAuthTokenGetter,
  type Admin, type CurrentSession, type Permission,
} from '@workspace/api-client-react';
import { isUnauthorized } from '@/lib/api';
import { keys, prefs, secure } from '@/lib/storage';
import { unregisterPush } from '@/lib/push';

export type SessionStatus = 'loading' | 'signedOut' | 'locked' | 'signedIn' | 'offline';

type SessionValue = {
  status: SessionStatus;
  admin: Admin | null;
  /** Called with the sign-in response (it carries the token for the app). */
  signIn: (session: CurrentSession) => Promise<void>;
  signOut: (options?: { local?: boolean }) => Promise<void>;
  unlock: () => Promise<boolean>;
  retry: () => void;
  can: (permission: Permission) => boolean;
  setAdmin: (admin: Admin) => void;
  biometric: { available: boolean; enabled: boolean; setEnabled: (value: boolean) => void };
};

const SessionContext = createContext<SessionValue | null>(null);

let currentToken: string | null = null;
setAuthTokenGetter(() => currentToken);

/** Lets the query client sign the user out when the server says the session ended. */
let unauthorizedHandler: (() => void) | null = null;
export function handleApiError(error: unknown) {
  if (isUnauthorized(error)) unauthorizedHandler?.();
}

async function biometricAvailable() {
  if (Platform.OS === 'web') return false;
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [admin, setAdminState] = useState<Admin | null>(null);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const statusRef = useRef(status);
  statusRef.current = status;

  const setAdmin = useCallback((next: Admin) => {
    setAdminState(next);
    void prefs.set('pricebot.admin', next);
  }, []);

  const clearLocal = useCallback(async () => {
    currentToken = null;
    await secure.remove(keys.token);
    await prefs.set('pricebot.admin', null);
    queryClient.clear();
    setAdminState(null);
    setStatus('signedOut');
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [token, available, enabled] = await Promise.all([
        secure.get(keys.token), biometricAvailable(), prefs.get<boolean>(keys.biometric, true),
      ]);
      if (cancelled) return;
      setBioAvailable(available);
      setBioEnabled(enabled);
      if (!token) { setStatus('signedOut'); return; }
      currentToken = token;
      try {
        const session = await getCurrentSession();
        if (cancelled) return;
        setAdmin(session.admin);
        setStatus(available && enabled ? 'locked' : 'signedIn');
      } catch (error) {
        if (cancelled) return;
        if (isUnauthorized(error)) { await clearLocal(); return; }
        // No connection: keep the saved session and let the user retry.
        const cached = await prefs.get<Admin | null>('pricebot.admin', null);
        if (cached) setAdminState(cached);
        setStatus('offline');
      }
    })();
    return () => { cancelled = true; };
  }, [attempt, clearLocal, setAdmin]);

  useEffect(() => {
    unauthorizedHandler = () => {
      if (statusRef.current === 'signedIn' || statusRef.current === 'locked') void clearLocal();
    };
    return () => { unauthorizedHandler = null; };
  }, [clearLocal]);

  const value = useMemo<SessionValue>(() => ({
    status,
    admin,
    async signIn(session) {
      if (session.token) {
        currentToken = session.token;
        await secure.set(keys.token, session.token);
      }
      setAdmin(session.admin);
      setStatus('signedIn');
    },
    async signOut(options) {
      if (!options?.local) {
        await unregisterPush().catch(() => undefined);
        await logoutAdmin().catch(() => undefined);
      }
      await clearLocal();
    },
    async unlock() {
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'כניסה למחירון', cancelLabel: 'ביטול', fallbackLabel: 'קוד המכשיר',
        });
        if (result.success) setStatus('signedIn');
        return result.success;
      } catch {
        return false;
      }
    },
    retry: () => { setStatus('loading'); setAttempt((value) => value + 1); },
    can: (permission) => Boolean(admin && (admin.role === 'owner' || admin.permissions.includes(permission))),
    setAdmin,
    biometric: {
      available: bioAvailable,
      enabled: bioEnabled,
      setEnabled: (next) => { setBioEnabled(next); void prefs.set(keys.biometric, next); },
    },
  }), [status, admin, bioAvailable, bioEnabled, clearLocal, setAdmin]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}
