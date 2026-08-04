import { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SessionProvider, useSession } from './src/state/session';
import { ActiveJobProvider, useActiveJob } from './src/state/activeJob';
import { ToastProvider, OfflineBanner } from './src/components/ui';
import { useQueuedCount } from './src/hooks/useQueuedCount';
import { getProfile, type DriverProfile } from './src/lib/api';
import { onNotificationResponse } from './src/lib/notifications';
import { loadActiveJob } from './src/lib/session';
import { colors, FONT } from './src/theme';
import LoginScreen from './src/screens/LoginScreen';
import Onboarding from './src/screens/Onboarding';
import HomeScreen from './src/screens/HomeScreen';
import EarningsScreen from './src/screens/EarningsScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ProfileScreen from './src/screens/ProfileScreen';

type Tab = 'shift' | 'earnings' | 'history' | 'profile';

// Clean Feather line icons (the set lucide derives from) — replaces the bulky
// coloured emoji; they tint with the active/inactive tab colour.
const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'shift', label: 'Shift', icon: 'truck' },
  { key: 'earnings', label: 'Earnings', icon: 'dollar-sign' },
  { key: 'history', label: 'Jobs', icon: 'clock' },
  { key: 'profile', label: 'Profile', icon: 'user' },
];

// Hand-rolled tabs (no nav lib — three screens don't earn a dependency on 2G
// budgets). CRITICAL: the Shift screen is HIDDEN, never unmounted — its polls and
// AppState listener are the on-shift liveness heartbeat; unmounting them while the
// driver browses History would stop offer notifications and (eventually) get them
// swept off shift. History/Profile mount fresh per visit (cheap; refetch on open).
function Tabs({ onProfileStale }: { onProfileStale: () => void | Promise<void> }) {
  const [tab, setTab] = useState<Tab>('shift');
  const { active } = useActiveJob();
  // Authoritative offline / queued-sync status, shown on EVERY tab (network hardening,
  // Phase 2.4). Sits in the chrome — not per-screen — so a driver who wandered onto
  // Earnings still sees "you're offline, taps are saved". Collapses to nothing when
  // online with an empty queue. Fed the live queue depth from the offline queue's pub/sub.
  const queued = useQueuedCount();
  // Tapping a delivery notification (warm or cold-start) lands on the Shift tab where
  // offers live — its focus-refresh then pulls the offer in immediately.
  useEffect(() => {
    const sub = onNotificationResponse(() => setTab('shift'));
    return () => sub.remove();
  }, []);
  return (
    <View style={styles.root}>
      <View style={[styles.screen, tab !== 'shift' && styles.hidden]}>
        <HomeScreen focused={tab === 'shift'} onProfileStale={onProfileStale} />
      </View>
      {tab === 'earnings' ? (
        <View style={styles.screen}>
          <EarningsScreen />
        </View>
      ) : null}
      {tab === 'history' ? (
        <View style={styles.screen}>
          <HistoryScreen
            onOpenShift={() => setTab('shift')}
            onOpenEarnings={() => setTab('earnings')}
          />
        </View>
      ) : null}
      {tab === 'profile' ? (
        <View style={styles.screen}>
          <ProfileScreen />
        </View>
      ) : null}
      {/* Persistent "you're mid-delivery" beacon while browsing other tabs — the
          active job only lives on the Shift tab, so without this a driver who
          wandered off could lose the thread of an in-flight delivery. */}
      {tab !== 'shift' && active ? (
        <Pressable style={styles.jobChip} onPress={() => setTab('shift')}>
          <Feather name="truck" size={18} color={colors.badgeText} />
          <Text style={styles.jobChipText} numberOfLines={1}>
            On a delivery · {active.label}
          </Text>
          <Feather name="chevron-right" size={20} color={colors.badgeText} />
        </Pressable>
      ) : null}
      <OfflineBanner queued={queued} />
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={styles.tabBtn} onPress={() => setTab(t.key)}>
            <Feather
              name={t.icon}
              size={22}
              color={tab === t.key ? colors.tabActive : colors.textFaint}
            />
            <Text style={[styles.tabLabel, tab === t.key && styles.tabActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// Session- and approval-gated root: rehydrate the token (spinner) → OTP login if
// signed out → first-run Onboarding while not-yet-approved → the tabbed app once
// approved. The profile fetch decides approval; a fetch failure falls through to
// the app (the Profile banner still guards go-online) rather than trapping anyone.
function Root() {
  const { session, loading } = useSession();
  // undefined = not loaded yet · null = load failed/none · DriverProfile = decide
  const [profile, setProfile] = useState<DriverProfile | null | undefined>(undefined);

  // undefined = snapshot not read yet. Whether the driver is holding a delivery, read
  // from the SecureStore snapshot — the same one HomeScreen restores from after the OS
  // kills the app mid-run (routine on low-end Android).
  const [hasActiveJob, setHasActiveJob] = useState<boolean | undefined>(undefined);

  // Reset on any session change so a fresh sign-in re-decides from a clean spinner.
  useEffect(() => {
    setProfile(undefined);
    setHasActiveJob(undefined);
  }, [session]);

  const loadProfile = useCallback(async () => {
    if (!session) return;
    try {
      setProfile(await getProfile(session.token));
    } catch {
      // First-load failure → null (show the app); a re-check failure keeps prev.
      setProfile((prev) => (prev === undefined ? null : prev));
    }
  }, [session]);

  const refreshActiveJob = useCallback(async () => {
    // The SecureStore READ must be inside the try, not just the parse: expo-secure-store
    // throws (DecryptException, a missing/unknown scheme, GeneralSecurityException) as
    // well as returning null. This is called as `void refreshActiveJob()`, so a rejection
    // would leave hasActiveJob permanently `undefined` — and a non-verified driver would
    // sit on the gate's spinner below forever, with no retry and no reachable Sign out,
    // identically on every relaunch. Before this gate existed they reached Onboarding.
    //
    // Fails to FALSE, deliberately. A snapshot we cannot read is one HomeScreen cannot
    // restore either (its restore has the same shape), so routing them to Tabs buys the
    // driver nothing, while Onboarding at least keeps Sign out reachable.
    let raw: string | null = null;
    try {
      raw = await loadActiveJob();
      if (!raw) return setHasActiveJob(false);
      const status = (JSON.parse(raw) as { status?: string }).status;
      setHasActiveJob(status === 'assigned' || status === 'picked_up' || status === 'in_transit');
    } catch {
      setHasActiveJob(false); // unreadable or unparseable snapshot — treat as no job
    }
  }, []);

  useEffect(() => {
    void loadProfile();
    void refreshActiveJob();
  }, [loadProfile, refreshActiveJob]);

  // What HomeScreen calls when it believes a lapsed driver is clear. BOTH facts must be
  // re-read: refreshing only the profile would leave `hasActiveJob` stale-true from the
  // cold start, so Root would send them straight back to Tabs and HomeScreen would ask
  // again — a re-fetch loop. HomeScreen clears the snapshot before calling, so this read
  // is deterministic rather than racing its own persist effect.
  const redecideRouting = useCallback(async () => {
    await Promise.all([loadProfile(), refreshActiveJob()]);
  }, [loadProfile, refreshActiveJob]);

  if (loading || (session && profile === undefined)) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.textPrimary} size="large" />
      </View>
    );
  }
  if (!session) return <LoginScreen />;
  // Not-yet-verified drivers (unverified / in_review / suspended / banned) get the
  // onboarding + verification flow; only `verified` reaches the tabbed app.
  if (profile && profile.verification_status !== 'verified') {
    // THE MID-JOB EXCEPTION, applied at cold start too. Deciding on the profile alone
    // sent a suspended driver whose app the OS killed mid-run straight to Onboarding:
    // job snapshot unread, lifecycle buttons gone, offline queue undrained, and the
    // customer's cash unaccounted for. urafro-next does not re-check verification on the
    // lifecycle transitions — it expects them to finish — so let them.
    // Only blocks the non-verified path; a verified driver never waits on this read.
    if (hasActiveJob === undefined) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.textPrimary} size="large" />
        </View>
      );
    }
    if (!hasActiveJob) {
      return <Onboarding token={session.token} profile={profile} onReload={loadProfile} />;
    }
    // Holding a delivery → fall through to the tabbed app. They finish the run, then
    // HomeScreen hands routing back here and this gate sends them to Onboarding.
  }
  // A driver's verification can lapse WHILE they're in here (ops suspend, or a document
  // re-upload drops them to in_review). Root only fetches the profile on mount, so
  // without this they'd stay in the tabbed app — being refused by the server on every
  // claim — until the app restarted. HomeScreen already re-fetches the profile on its
  // shift tick; this lets it hand the decision back so the re-render routes them to
  // Onboarding, which owns the per-state explanation. HomeScreen holds the call back
  // while they're mid-delivery (see lib/verification).
  return <Tabs onProfileStale={redecideRouting} />;
}

export default function App() {
  return (
    <SessionProvider>
      <ActiveJobProvider>
        <ToastProvider>
          <Root />
          <StatusBar style="dark" />
        </ToastProvider>
      </ActiveJobProvider>
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1 },
  hidden: { display: 'none' },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 18,
    paddingTop: 8,
  },
  tabBtn: { flex: 1, alignItems: 'center', gap: 3 },
  tabLabel: { fontFamily: FONT, color: colors.textFaint, fontSize: 12 },
  tabActive: { color: colors.tabActive, fontWeight: '700' },
  jobChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.badgeBg,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  jobChipText: { fontFamily: FONT, flex: 1, color: colors.badgeText, fontSize: 14, fontWeight: '700' },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
