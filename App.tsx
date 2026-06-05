import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { API_BASE } from './src/config';

// Foundation placeholder. Phase 6.2 replaces this with the OTP login flow and the
// authenticated "shift" home screen (navigation added then).
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>urAfro Driver</Text>
      <Text style={styles.subtitle}>Foundation ready — login is next.</Text>
      <Text style={styles.meta}>API · {API_BASE}</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#cbd5e1', fontSize: 15, marginTop: 8 },
  meta: { color: '#64748b', fontSize: 12, marginTop: 24 },
});
