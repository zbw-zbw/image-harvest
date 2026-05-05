// e2e: clicking the toolbar Multi-Tab button should open the modal AND
// populate the tab list with the currently-open tabs in the test window.
//
// Multi-Tab is a Pro feature: settings.ts L780 attaches a capture-phase
// click listener on #btn-multitab that calls stopImmediatePropagation
// + opens the upgrade modal when state.isProUser is false. We pass
// enablePro:true to the launcher so that guard short-circuits and the
// real showMultiTabModal handler runs.
//
// Under Playwright the test context has at least 2 tabs open at this
// point: the fixture page (http://127.0.0.1:port/page-with-images.html)
// and the sidepanel itself (chrome-extension://...). The sidepanel tab
// is filtered out by sidepanel/multitab.ts > isRestrictedUrl, so we
// expect to see the fixture tab in the rendered list.
//
// The whole multi-tab path is lazy-loaded
// (sidepanel/pro-features.ts > showMultiTabModal does
// `await import('./multitab')`), so we use expect.poll to wait for the
// first .tab-item to appear.
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

test('multitab modal opens and renders a list of available tabs', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  // Modal starts hidden.
  await expect(sidepanel.locator('#multitab-modal')).toHaveClass(/hidden/);

  // Real click on the toolbar button — this is what a Pro user does.
  // We use direct DOM .click() (not Playwright's locator.click()) to
  // avoid the locator's hit-test, which can flake in headed mode if the
  // sidepanel hasn't fully laid out the icon row yet.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-multitab')?.click();
  });

  // showMultiTabModal in pro-features.ts dynamic-imports
  // sidepanel/multitab.ts. Wait for the modal to un-hide.
  await expect(sidepanel.locator('#multitab-modal')).not.toHaveClass(/hidden/, {
    timeout: 5_000,
  });

  // loadTabList runs chrome.tabs.query + builds the DOM. Wait for at
  // least one .tab-item to land.
  await expect
    .poll(() => sidepanel.locator('#multitab-list .tab-item').count(), { timeout: 5_000 })
    .toBeGreaterThan(0);

  // The fixture page is in the same window — its URL should appear in
  // the rendered list. We don't assume an exact tab count: chromium may
  // create extra about:blank or DevTools tabs depending on flags.
  const tabUrls = await sidepanel.locator('#multitab-list .tab-item .tab-url').allTextContents();
  expect(tabUrls.some((url) => url.includes('page-with-images.html'))).toBe(true);
});

test('each rendered tab item has a checkbox + title + url + favicon slot', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  await sidepanel.evaluate(() => {
    document.getElementById('btn-multitab')?.click();
  });

  await expect
    .poll(() => sidepanel.locator('#multitab-list .tab-item').count(), { timeout: 5_000 })
    .toBeGreaterThan(0);

  // Smoke-check the first row's structural pieces. We don't assert on
  // exact text/src — those depend on what tabs the chromium runner
  // happened to open — only on the presence of each child element.
  const firstTab = sidepanel.locator('#multitab-list .tab-item').first();
  await expect(firstTab.locator('.tab-checkbox input[type="checkbox"]')).toBeAttached();
  await expect(firstTab.locator('.tab-favicon')).toBeAttached();
  await expect(firstTab.locator('.tab-title')).toBeAttached();
  await expect(firstTab.locator('.tab-url')).toBeAttached();
});
