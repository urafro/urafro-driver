import * as SecureStore from 'expo-secure-store';

// The driver's bearer token is a credential — it's kept in the OS secure keystore
// (Keychain / Keystore), never in plain AsyncStorage. A session = the token (for
// the Authorization header) + the driver id it belongs to.

const TOKEN_KEY = 'driver_token';
const DRIVER_ID_KEY = 'driver_id';
const ACTIVE_JOB_KEY = 'active_job_id';

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
  await SecureStore.deleteItemAsync(ACTIVE_JOB_KEY);
}

// The driver's in-flight delivery id, persisted so a relaunch — e.g. the OS killed the
// app mid-delivery, which low-end Android does aggressively — can resume the job
// instead of stranding the driver on the shift screen. Not a secret, but kept here so
// there's one storage surface and clearSession() wipes it on logout.
export async function saveActiveJobId(id: string): Promise<void> {
  await SecureStore.setItemAsync(ACTIVE_JOB_KEY, id);
}

export async function loadActiveJobId(): Promise<string | null> {
  return SecureStore.getItemAsync(ACTIVE_JOB_KEY);
}

export async function clearActiveJobId(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_JOB_KEY);
}
