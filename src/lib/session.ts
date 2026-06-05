import * as SecureStore from 'expo-secure-store';

// The driver's bearer token is a credential — it's kept in the OS secure keystore
// (Keychain / Keystore), never in plain AsyncStorage. A session = the token (for
// the Authorization header) + the driver id it belongs to.

const TOKEN_KEY = 'driver_token';
const DRIVER_ID_KEY = 'driver_id';

export interface Session {
  token: string;
  driverId: string;
}

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, session.token);
  await SecureStore.setItemAsync(DRIVER_ID_KEY, session.driverId);
}

export async function loadSession(): Promise<Session | null> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  const driverId = await SecureStore.getItemAsync(DRIVER_ID_KEY);
  return token && driverId ? { token, driverId } : null;
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(DRIVER_ID_KEY);
}
