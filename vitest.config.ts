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
      // Widen the surface to all first-party production code. The former
      // shared/**-only setup was a convenient lie — it showed 100% while
      // background/content/sidepanel (the bulk of the extension) were
      // silently unmeasured.
      include: [
        'shared/**/*.ts',
        'background/**/*.ts',
        'content/**/*.ts',
        'pages/**/*.ts',
        'sidepanel/**/*.{ts,tsx}',
      ],
      exclude: [
        // Pulls in chrome.* / fetch / IndexedDB — needs heavy mocking, skip
        'shared/storage.ts',
        'shared/license.ts',
        'shared/collection.ts',
        'shared/types.ts',
        // Type-only modules (no executable statements, v8 treats them as
        // 0/0 and the tooling sometimes reports NaN% which poisons the
        // aggregate).
        '**/types.ts',
        // Preact components without a dedicated .test.tsx are currently
        // covered by e2e only. Including them here would drag the overall
        // percentage down with zero signal value — revisit per-component
        // as unit tests are added.
        'sidepanel/components/CollectionModal.tsx',
        'sidepanel/components/ConfirmDialog.tsx',
        'sidepanel/components/DedupModal.tsx',
        'sidepanel/components/DownloadProgressModal.tsx',
        'sidepanel/components/LiveIndicator.tsx',
        'sidepanel/components/MultitabModal.tsx',
        'sidepanel/components/ProStatusBadge.tsx',
        'sidepanel/components/ProUpgradeModal.tsx',
        'sidepanel/components/ScanProgressOverlay.tsx',
        'sidepanel/components/SettingsModal.tsx',
        'sidepanel/components/SkeletonCard.tsx',
        'sidepanel/components/StateScreens.tsx',
        'sidepanel/components/StatusCounts.tsx',
        'sidepanel/components/ToastContainer.tsx',
        'sidepanel/components/mount.tsx',
      ],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
