// Vitest config for Image Harvest
// Two test surfaces:
//   - tests/**/*.test.ts   → pure-function tests for shared/*.ts. Run in
//                            Node, no DOM needed.
//   - tests/**/*.test.tsx  → Preact component tests (stage 5 of the
//                            ImageCard migration). Run in jsdom so
//                            @testing-library/preact can mount real DOM.
//
// `environmentMatchGlobs` lets us keep the fast Node default for the bulk
// of unit tests while opting individual .tsx files into jsdom.

import { defineConfig } from 'vitest/config';
import { htmlIncludePlugin } from './vite-html-include';

export default defineConfig({
  // Match the production esbuild config so .tsx files compile with the
  // Preact JSX automatic runtime under vitest too.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  // htmlIncludePlugin is harmless under vitest (only touches .html) but
  // keeps the resolver happy if any test ever imports an HTML partial.
  plugins: [htmlIncludePlugin()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    environmentMatchGlobs: [['tests/**/*.test.tsx', 'jsdom']],
    // setupFiles are loaded for every test file but the imports inside are
    // jsdom-safe (jest-dom + cleanup) — no-op under the node environment
    // because @testing-library/preact never runs there.
    setupFiles: ['tests/_helpers/preact-setup.ts'],
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
