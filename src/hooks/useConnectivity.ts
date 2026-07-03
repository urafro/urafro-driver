// Connectivity signal (@react-native-community/netinfo). Before this, "offline"
// could only be INFERRED from a fetch timing out — so the offline queue couldn't
// flush the instant a link returned and no screen could show an authoritative
// "offline / queued" banner. This hook is that authoritative signal.
import { useEffect, useState } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

export type Connectivity = {
  online: boolean;
  type: string; // 'wifi' | 'cellular' | 'none' | 'unknown' | ...
  /** cellular generation when known ('3g','4g',...) — 3G-market aware UI can degrade */
  cellularGeneration: string | null;
};

// `known` = did this sample carry a DEFINITIVE reachability verdict? isInternetReachable
// is the strong signal but is null until probed and can sit null on a captive portal /
// dead-3G-cell (has signal, no real internet). The hook HOLDS the last definitive
// `online` across indefinite samples, so we neither flash a false "offline" on cold
// start NOR misreport "online" on a has-signal-no-internet link once we've learned better.
export function deriveConnectivity(s: NetInfoState): {
  online: boolean;
  known: boolean;
  type: string;
  cellularGeneration: string | null;
} {
  const reachable = s.isInternetReachable;
  const known = reachable != null;
  const online = known ? reachable : s.isConnected !== false;
  const gen =
    s.type === 'cellular' && s.details
      ? ((s.details as { cellularGeneration?: string | null }).cellularGeneration ?? null)
      : null;
  return { online, known, type: s.type, cellularGeneration: gen };
}

export function useConnectivity(): Connectivity {
  const [state, setState] = useState<Connectivity>({ online: true, type: 'unknown', cellularGeneration: null });
  useEffect(() => {
    let cancelled = false;
    const handle = (s: NetInfoState) => {
      const d = deriveConnectivity(s);
      setState((prev) => ({
        online: d.known ? d.online : prev.online, // indefinite sample → hold last definitive
        type: d.type,
        cellularGeneration: d.cellularGeneration,
      }));
    };
    const unsub = NetInfo.addEventListener(handle);
    NetInfo.fetch()
      .then((s) => {
        if (!cancelled) handle(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);
  return state;
}
