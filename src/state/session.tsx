import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearSession, loadSession, saveSession, type Session } from '../lib/session';

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

  async function signIn(s: Session): Promise<void> {
    await saveSession(s);
    setSession(s);
  }

  async function signOut(): Promise<void> {
    await clearSession();
    setSession(null);
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
