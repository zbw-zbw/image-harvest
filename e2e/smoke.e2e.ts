// Smoke e2e tests for Image Harvest.
//
// Verifies the critical path is alive end-to-end:
//   1. Extension loads into Chromium and registers a service worker.
//   2. Sidepanel page boots without runtime errors and renders core UI.
//   3. Content script extracts images from a fixture page and the sidepanel
//      eventually shows ≥ 1 image card (proving the bg ↔ content ↔ sidepanel
//      message round-trip works).
//
// We deliberately keep the assertions loose — this is a "is the wire still
// connected" gate, not a feature regression suite.
import { test, expect, type BrowserContext, type Worker } from '@playwright/test';
import {
  extensionUrl,
  launchExtension,
  startFixtureServer,
  type FixtureServer,
} from './_helpers/launchExtension';

let context: BrowserContext;
let extensionId: string;
let serviceWorker: Worker;
let fixtureServer: FixtureServer;

test.beforeEach(async () => {
  fixtureServer = await startFixtureServer();
  ({ context, extensionId, serviceWorker } = await launchExtension());
});

test.afterEach(async () => {
  await context.close();
  await fixtureServer.close();
});

test('extension loads and the service worker is reachable', async () => {
  expect(extensionId).toMatch(/^[a-z]{32}$/);
  expect(serviceWorker.url()).toContain('chrome-extension://');
  // The service worker should be able to evaluate against chrome.* APIs.
  const manifestVersion = await serviceWorker.evaluate(
    () => chrome.runtime.getManifest().manifest_version
  );
  expect(manifestVersion).toBe(3);
});

test('sidepanel page boots and renders core UI elements', async () => {
  const sidepanel = await context.newPage();

  // Wire error capture BEFORE navigation so we don't miss boot-time errors.
  const errors: string[] = [];
  sidepanel.on('pageerror', (err) => errors.push(err.message));

  await sidepanel.goto(extensionUrl(extensionId, 'pages/sidepanel.html'));

  // Core layout regions should be present. Use more specific selectors —
  // multiple .toolbar variants exist (actions / select-row / filters).
  await expect(sidepanel.locator('#image-grid')).toBeAttached({ timeout: 15_000 });
  await expect(sidepanel.locator('.toolbar-actions')).toBeAttached();
  await expect(sidepanel.locator('.status-bar')).toBeAttached();

  await sidepanel.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('scanning the fixture page surfaces at least one image card', async () => {
  // Serve the fixture over http://127.0.0.1 because content_scripts in
  // manifest.config.ts only match http(s) — file:// pages would never
  // get the extractor injected. The local server is started by
  // beforeEach (see startFixtureServer).
  const fixtureUrl = `${fixtureServer.baseUrl}/page-with-images.html`;

  const fixturePage = await context.newPage();
  await fixturePage.goto(fixtureUrl);
  await fixturePage.waitForLoadState('networkidle');
  await fixturePage.bringToFront();

  // Sanity check via service worker: the fixture tab should be visible
  // to chrome.tabs.query and the content script should have a chance to
  // attach (its registration is in the manifest).
  const fixtureTabId = await serviceWorker.evaluate(async (url: string) => {
    const tabs = await chrome.tabs.query({ url });
    return tabs[0]?.id ?? null;
  }, fixtureUrl);
  expect(fixtureTabId, 'fixture tab not found by SW').not.toBeNull();

  const sidepanel = await context.newPage();
  const sidepanelErrors: string[] = [];
  sidepanel.on('pageerror', (err) => sidepanelErrors.push(err.message));
  sidepanel.on('console', (msg) => {
    if (msg.type() === 'error') sidepanelErrors.push(`[console.error] ${msg.text()}`);
  });
  await sidepanel.goto(extensionUrl(extensionId, 'pages/sidepanel.html'));

  // Re-focus the fixture page so chrome.tabs.query({active:true,
  // currentWindow:true}) inside loadCurrentTab() resolves to it.
  await fixturePage.bringToFront();

  await expect
    .poll(
      async () => {
        if (sidepanel.isClosed()) return -1;
        return sidepanel.locator('#image-grid .image-card').count();
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] }
    )
    .toBeGreaterThan(0);

  if (sidepanelErrors.length > 0) {
    console.error('Sidepanel errors during scan:', sidepanelErrors);
  }

  // The bottom status bar's "Found N images" widget; #found-action-count is
  // the Preact-managed count that subscribes to filteredImages.
  const foundCountText = await sidepanel.locator('#found-action-count').textContent();
  expect(Number(foundCountText)).toBeGreaterThan(0);
});
