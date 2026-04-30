// Vitest config for Image Harvest
// Tests live under tests/ as *.test.ts and target the pure functions
// in shared/*.ts (Canvas/Chrome-API-dependent code is excluded).

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['shared/**/*.ts'],
      exclude: [
        // Pulls in chrome.* / fetch / IndexedDB — needs heavy mocking, skip
        'shared/storage.ts',
        'shared/license.ts',
        'shared/collection.ts',
        'shared/types.ts',
      ],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
