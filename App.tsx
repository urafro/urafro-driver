import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SessionProvider, useSession } from './src/state/session';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';

// Session-gated root: rehydrate the stored token (loading spinner), then show the
// Home "shift" screen if signed in, else the OTP Login. A router is added in a
// later phase, once there are multiple authenticated screens to route between.
function Root() {
  const { session, loading } = useSession();
  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }
  return session ? <HomeScreen /> : <LoginScreen />;
}

export default function App() {
  return (
    <SessionProvider>
      <Root />
      <StatusBar style="light" />
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' },
});
