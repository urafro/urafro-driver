import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearSession, loadSession, saveSession, type Session } from '../lib/session';
import { setUnauthorizedHandler } from '../lib/api';
import { unregisterForPush } from '../lib/notifications';

// App-wide auth state. On mount it rehydrates the session from the secure store,
// so a logged-in driver skips the login screen on relaunch. signIn/signOut
// persist + update in one step.
interface SessionState {
  session: Session | null;
  loading: boolean;
  signIn: (s: Session) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadSession().then((s) => {
      setSession(s);
      setLoading(false);
    });
  }, []);

  // Any authenticated 401 (revoked/expired token) drops the driver back to login,
  // rather than wedging on Home with a dead token. signOut is a hoisted declaration.
  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    return () => setUnauthorizedHandler(null);
  }, []);

  async function signIn(s: Session): Promise<void> {
    await saveSession(s);
    setSession(s);
  }

  async function signOut(): Promise<void> {
    // Capture the bearer before it's wiped, so we can drop this device's push token —
    // without that a signed-out phone keeps waking up for the PREVIOUS driver's
    // offers (the server keys push tokens on the token, not the session). Read from
    // the store, not the `session` state: the 401 handler above holds a mount-time
    // closure where `session` is still null.
    //
    // The read is BEST-EFFORT and must never gate the wipe: SecureStore rejects on
    // keystore errors (a decrypt failure after the keystore is invalidated, an OS
    // restore onto a new device), and a driver who taps "sign out" has to end up
    // signed out even then. Worst case we lose the push cleanup, never the credential
    // wipe, so the clear stays exactly as reliable as it was before this read existed.
    const current = await loadSession().catch(() => null);
    await clearSession();
    setSession(null);
    // Fired AFTER the clear and never awaited, so a dead network can't hang the
    // sign-out and a 401 on the DELETE lands back here as a no-op. unregisterForPush
    // swallows every failure.
    if (current) void unregisterForPush(current.token);
  }

  return (
    <SessionContext.Provider value={{ session, loading, signIn, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
