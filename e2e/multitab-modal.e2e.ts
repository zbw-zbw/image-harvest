// e2e: the Multi-Tab Extract modal (#multitab-modal) lists every
// tab in the current window as a checkbox row, lets the user pick
// any subset, and posts EXTRACT messages to those tabs when they
// click "Start Extraction".
//
// This spec covers the modal's rendering + selection contract end-
// to-end, but stops short of actually invoking startMultiTabExtract
// — that would broadcast EXTRACT to every real Chromium tab and
// race the content-script lifecycle in Playwright's headed runner.
// We pin:
//   - Pro guard works (free user → ProUpgradeModal, Pro user →
//     modal opens).
//   - chrome.tabs.query({currentWindow:true}) → tab-item rows
//     rendered with checkboxes + favicons + "Current" badge on
//     the active tab.
//   - select-all toggle flips every per-row checkbox.
//   - clicking "Start Extraction" with zero selected surfaces the
//     "Select at least one tab" error toast (init.ts L933).
//   - cancel/close button hides the modal.
import { test, expect } from '@playwright/test';
import {
  launchExtension,
  openSidepanelWithImages,
  startFixtureServer,
  type FixtureServer,
  type LaunchedExtension,
} from './_helpers/launchExtension';

let ext: LaunchedExtension;
let fixtureServer: FixtureServer;

test.beforeAll(async () => {
  fixtureServer = await startFixtureServer();
  ext = await launchExtension();
});

test.afterAll(async () => {
  await ext?.context.close();
  await fixtureServer?.close();
});

test('free user clicking Multi-Tab Extract is gated into the upgrade modal', async () => {
  // Pro-guard contract: the capture-phase listener in settings.ts >
  // bindProGuards intercepts #btn-multitab clicks for free users
  // and surfaces ProUpgradeModal instead of opening the multitab
  // modal. enablePro is intentionally NOT set so the guard fires.
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  await expect(sidepanel.locator('#multitab-modal')).toHaveClass(/hidden/);
  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);

  await sidepanel.evaluate(() => {
    document.getElementById('btn-multitab')?.click();
  });

  await expect(sidepanel.locator('#pro-upgrade-modal')).not.toHaveClass(/hidden/, {
    timeout: 2_000,
  });
  // multitab modal stayed closed.
  await expect(sidepanel.locator('#multitab-modal')).toHaveClass(/hidden/);
});

test('Pro user opens the multitab modal — chrome.tabs.query renders tab rows + select-all toggles every checkbox + cancel closes', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  // Open the modal.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-multitab')?.click();
  });

  await expect(sidepanel.locator('#multitab-modal')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });

  // Wait for chrome.tabs.query to resolve and innerHTML to populate.
  // At minimum the fixture http page is in the window; the sidepanel
  // chrome-extension:// page is filtered out by isRestrictedUrl.
  await expect
    .poll(async () => sidepanel.locator('#multitab-list .tab-item').count(), { timeout: 3_000 })
    .toBeGreaterThan(0);

  const itemCount = await sidepanel.locator('#multitab-list .tab-item').count();

  // Active fixture tab is sorted to the top with a "Current" badge.
  await expect(sidepanel.locator('#multitab-list .tab-item').first()).toHaveClass(/tab-current/);
  await expect(sidepanel.locator('#multitab-list .tab-current-badge').first()).toBeVisible();

  // Every tab-item has a checkbox starting unchecked.
  const initiallyChecked = await sidepanel
    .locator('#multitab-list .tab-checkbox input:checked')
    .count();
  expect(initiallyChecked).toBe(0);

  // Click select-all → every checkbox flips on.
  await sidepanel.evaluate(() => {
    document.getElementById('multitab-select-all')?.click();
  });
  await expect
    .poll(async () => sidepanel.locator('#multitab-list .tab-checkbox input:checked').count(), {
      timeout: 2_000,
    })
    .toBe(itemCount);

  // Click select-all again → every checkbox flips off (toggle).
  await sidepanel.evaluate(() => {
    document.getElementById('multitab-select-all')?.click();
  });
  await expect
    .poll(async () => sidepanel.locator('#multitab-list .tab-checkbox input:checked').count(), {
      timeout: 2_000,
    })
    .toBe(0);

  // Clicking Start Extraction with 0 selected surfaces the error
  // toast and does NOT trigger startMultiTabExtract. (init.ts L933)
  await sidepanel.evaluate(() => {
    document.getElementById('btn-start-extraction')?.click();
  });
  await expect(sidepanel.locator('.toast').last()).toContainText('Select at least one tab', {
    timeout: 2_000,
  });
  // Modal should stay open after a no-op click — the user just gets
  // a hint and can pick something.
  await expect(sidepanel.locator('#multitab-modal')).not.toHaveClass(/hidden/);

  // Cancel closes the modal.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-cancel-multitab')?.click();
  });
  await expect(sidepanel.locator('#multitab-modal')).toHaveClass(/hidden/, {
    timeout: 2_000,
  });
});
