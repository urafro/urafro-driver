// jest-expo setup hook for component tests. Global native-module mocks that every
// render needs go here; per-test mocks live in the spec files.
//
import { jest } from '@jest/globals';
//
// The design-system primitives (src/components/ui) transitively import three native
// modules that jest-expo does not auto-mock. Any component that imports the ui barrel
// pulls these in, so they are stubbed once here (behaviour is exercised on-device, not
// in jest). Each stub is the minimal surface the primitives actually call.

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    seekTo: jest.fn(async () => {}),
    remove: jest.fn(),
    volume: 1,
  })),
  setAudioModeAsync: jest.fn(async () => {}),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => () => {}),
    fetch: jest.fn(async () => ({ type: 'wifi', isConnected: true, isInternetReachable: true, details: null })),
  },
}));
