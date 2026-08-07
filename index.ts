// Sentry FIRST, before every other import. `sentry.ts` installs the global JS error
// handler and starts the native crash handler at import time, so anything imported
// ahead of it can fail without ever being reported. It is completely inert unless
// EXPO_PUBLIC_SENTRY_DSN is set at build time. See src/lib/observability/sentry.ts.
import './src/lib/observability/sentry';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
