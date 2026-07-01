// Component/render tests run under jest-expo (it brings the React Native transform +
// Expo native-module mocks). Pure-logic tests stay on vitest (`npm test`); the two
// runners are split by extension — jest owns *.test.tsx, vitest owns *.test.ts (see
// vitest.config.ts). Test files are named *.test.tsx so the design-token colour gate
// (which exempts \.test\.) ignores them.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    // @expo/vector-icons' real entry loads expo-font (native) which jest can't resolve.
    '^@expo/vector-icons$': '<rootDir>/tests/mocks/vector-icons.js',
  },
};
