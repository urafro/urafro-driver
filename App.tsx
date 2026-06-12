import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SessionProvider, useSession } from './src/state/session';
import { ActiveJobProvider, useActiveJob } from './src/state/activeJob';
import { colors } from './src/theme';
import LoginScreen from './src/screens/LoginScreen';
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
  return (
    <View style={styles.root}>
      <View style={[styles.screen, tab !== 'shift' && styles.hidden]}>
        <HomeScreen />
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

// Session-gated root: rehydrate the stored token (loading spinner), then the
// tabbed app if signed in, else the OTP Login.
function Root() {
  const { session, loading } = useSession();
  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.textPrimary} size="large" />
      </View>
    );
  }
  return session ? <Tabs /> : <LoginScreen />;
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
