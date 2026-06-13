import { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SessionProvider, useSession } from './src/state/session';
import { ActiveJobProvider, useActiveJob } from './src/state/activeJob';
import { getProfile, type DriverProfile } from './src/lib/api';
import { onNotificationResponse } from './src/lib/notifications';
import { colors } from './src/theme';
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
function Tabs() {
  const [tab, setTab] = useState<Tab>('shift');
  const { active } = useActiveJob();
  // Tapping a delivery notification (warm or cold-start) lands on the Shift tab where
  // offers live — its focus-refresh then pulls the offer in immediately.
  useEffect(() => {
    const sub = onNotificationResponse(() => setTab('shift'));
    return () => sub.remove();
  }, []);
  return (
    <View style={styles.root}>
      <View style={[styles.screen, tab !== 'shift' && styles.hidden]}>
        <HomeScreen focused={tab === 'shift'} />
      </View>
      {tab === 'earnings' ? (
        <View style={styles.screen}>
          <EarningsScreen />
        </View>
      ) : null}
      {tab === 'history' ? (
        <View style={styles.screen}>
          <HistoryScreen />
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

  // Reset on any session change so a fresh sign-in re-decides from a clean spinner.
  useEffect(() => {
    setProfile(undefined);
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

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

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
    return <Onboarding token={session.token} profile={profile} onReload={loadProfile} />;
  }
  return <Tabs />;
}

export default function App() {
  return (
    <SessionProvider>
      <ActiveJobProvider>
        <Root />
        <StatusBar style="dark" />
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
  tabLabel: { color: colors.textFaint, fontSize: 12 },
  tabActive: { color: colors.tabActive, fontWeight: '700' },
  jobChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.badgeBg,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  jobChipText: { flex: 1, color: colors.badgeText, fontSize: 14, fontWeight: '700' },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
