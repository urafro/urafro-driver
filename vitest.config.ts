import { defineConfig } from 'vitest/config';

// Vitest owns the pure-logic tests (*.test.ts). React-Native component/render tests
// (*.test.tsx) run under jest-expo instead (see jest.config.js) — RN needs jest-expo's
// transform + native mocks, which vitest can't provide. Splitting by extension keeps a
// single runner per job and stops each from trying to run the other's files.
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
  },
});
