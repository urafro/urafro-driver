import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SessionProvider, useSession } from './src/state/session';
import { colors } from './src/theme';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ProfileScreen from './src/screens/ProfileScreen';

type Tab = 'shift' | 'history' | 'profile';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'shift', label: 'Shift', icon: '🛵' },
  { key: 'history', label: 'Jobs', icon: '🗂️' },
  { key: 'profile', label: 'Profile', icon: '👤' },
];

// Hand-rolled tabs (no nav lib — three screens don't earn a dependency on 2G
// budgets). CRITICAL: the Shift screen is HIDDEN, never unmounted — its polls and
// AppState listener are the on-shift liveness heartbeat; unmounting them while the
// driver browses History would stop offer notifications and (eventually) get them
// swept off shift. History/Profile mount fresh per visit (cheap; refetch on open).
function Tabs() {
  const [tab, setTab] = useState<Tab>('shift');
  return (
    <View style={styles.root}>
      <View style={[styles.screen, tab !== 'shift' && styles.hidden]}>
        <HomeScreen />
      </View>
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
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={styles.tabBtn} onPress={() => setTab(t.key)}>
            <Text style={styles.tabIcon}>{t.icon}</Text>
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
      <Root />
      <StatusBar style="dark" />
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
  tabBtn: { flex: 1, alignItems: 'center', gap: 2 },
  tabIcon: { fontSize: 18 },
  tabLabel: { color: colors.textFaint, fontSize: 12 },
  tabActive: { color: colors.tabActive, fontWeight: '700' },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
