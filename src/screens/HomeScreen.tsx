import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { goOffline, goOnline } from '../lib/api';
import { useSession } from '../state/session';

// The "shift" home screen: go online/offline. Location streaming + job offers come
// in the next phases — going online without a location keeps the driver available
// but not yet eligible for offers (the server needs a recent location to rank
// them), which is exactly the right behaviour until GPS lands.
export default function HomeScreen() {
  const { session, signOut } = useSession();
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const next = !online;
      const state = next ? await goOnline(session.token) : await goOffline(session.token);
      setOnline(state.status === 'available');
    } catch {
      setError('Could not update your status — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your shift</Text>
      <Text style={styles.status}>
        {online ? '🟢  Online — waiting for offers' : '⚪  Offline'}
      </Text>

      <Pressable
        style={[styles.toggle, online ? styles.offBtn : styles.onBtn, busy && styles.busy]}
        onPress={toggle}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.toggleText}>{online ? 'Go offline' : 'Go online'}</Text>
        )}
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Text style={styles.meta}>Driver {session?.driverId.slice(0, 8)}…</Text>
        <Pressable onPress={signOut}>
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 24, paddingTop: 80 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  status: { color: '#cbd5e1', fontSize: 18, marginTop: 24 },
  toggle: { borderRadius: 12, paddingVertical: 18, alignItems: 'center', marginTop: 28 },
  onBtn: { backgroundColor: '#22c55e' },
  offBtn: { backgroundColor: '#f59e0b' },
  busy: { opacity: 0.6 },
  toggleText: { color: '#0f172a', fontSize: 18, fontWeight: '700' },
  error: { color: '#fca5a5', fontSize: 14, marginTop: 16 },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  meta: { color: '#64748b', fontSize: 13 },
  link: { color: '#94a3b8', fontSize: 14 },
});
