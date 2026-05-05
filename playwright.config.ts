// Playwright config for Image Harvest e2e smoke tests.
//
// Loads the unpacked extension from dist/ via launchPersistentContext (the
// only way Chromium accepts MV3 extensions). Tests run in headed mode
// because MV3 service workers don't initialize reliably in headless shell —
// CI uses xvfb-run to provide a virtual display.
//
// See e2e/_helpers/launchExtension.ts for the actual context launch logic;
// this file only configures the Playwright runner.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts$/,
  // Extension load + service-worker boot is slow; give each spec headroom.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Run sequentially: each test launches its own persistent context with a
  // fresh user-data-dir, and parallel headed Chromium windows can fight for
  // the display socket on macOS / xvfb.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
});
