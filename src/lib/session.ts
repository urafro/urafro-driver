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

// The driver's in-flight delivery SNAPSHOT (full JSON), persisted so a relaunch —
// e.g. the OS killed the app mid-delivery, which low-end Android does aggressively —
// renders the job IMMEDIATELY from cache even with no signal (a dead-zone relaunch
// must not strand the driver on the shift screen). The active-job poll then
// refreshes/clears it against the server when connectivity returns. Not a secret,
// but kept here so there's one storage surface and clearSession() wipes it on logout.
export async function saveActiveJob(jobJson: string): Promise<void> {
  await SecureStore.setItemAsync(ACTIVE_JOB_KEY, jobJson);
}

export async function loadActiveJob(): Promise<string | null> {
  return SecureStore.getItemAsync(ACTIVE_JOB_KEY);
}

export async function clearActiveJob(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_JOB_KEY);
}
