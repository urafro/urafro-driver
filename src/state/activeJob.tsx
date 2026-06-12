import { createContext, useContext, useState, type ReactNode } from 'react';

// A tiny cross-tab beacon for the in-flight delivery. The job itself lives in
// HomeScreen (the always-mounted Shift tab); this only mirrors "is there a job,
// and where to" so the Jobs/Profile tabs can show a persistent "tap to return"
// chip. Kept separate from the heavy job state on purpose — App.tsx and the
// other tabs read this without depending on HomeScreen.
export interface ActiveJobInfo {
  id: string;
  /** Short destination label for the chip (landmark-first). */
  label: string;
}

interface ActiveJobState {
  active: ActiveJobInfo | null;
  setActive: (a: ActiveJobInfo | null) => void;
}

const ActiveJobContext = createContext<ActiveJobState | undefined>(undefined);

export function ActiveJobProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveJobInfo | null>(null);
  return (
    <ActiveJobContext.Provider value={{ active, setActive }}>{children}</ActiveJobContext.Provider>
  );
}

export function useActiveJob(): ActiveJobState {
  const ctx = useContext(ActiveJobContext);
  if (!ctx) throw new Error('useActiveJob must be used within an ActiveJobProvider');
  return ctx;
}
