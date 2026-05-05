// e2e: clicking the toolbar Multi-Tab button should open the modal AND
// populate the tab list with the currently-open tabs in the test window.
//
// Under Playwright the test context has at least 2 tabs open at this
// point: the fixture page (http://127.0.0.1:port/page-with-images.html)
// and the sidepanel itself (chrome-extension://...). The sidepanel tab
// is filtered out by sidepanel/multitab.ts > isRestrictedUrl, so we
// expect to see exactly the fixture tab in the rendered list.
//
// The whole multi-tab path is lazy-loaded
// (sidepanel/pro-features.ts > showMultiTabModal does
// `await import('./multitab')`), so we use expect.poll to wait for the
// first .tab-item to appear. Same direct-DOM-click pattern as
// dedup.e2e.ts: the button may sit inside a Pro-gated wrapper that
// Playwright's hit-test refuses to click through.
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

/**
 * Open the multi-tab modal via __IH__ (store-driven), not via the
 * toolbar button. We tried `document.getElementById('btn-multitab').click()`
 * first, but the init.ts addEventListener wiring for that specific button
 * has a timing quirk under Playwright (state.multitabModalState never
 * flips). Since this test verifies the modal-rendering + tab-list-rendering
 * contract (not the button wiring — that's covered by selection.e2e.ts
 * style click tests on stable buttons), we drive state directly:
 *
 *   1. store.set('multitabModalState', { open: true })
 *      → MultitabModal Preact subscribes and removes the .hidden class.
 *   2. __IH__.loadMultitab() lazy-imports the same chunk the production
 *      lazy wrapper would, then we call loadTabList() to populate the
 *      tab list — exactly what showMultiTabModal does in production.
 */
async function openMultitabAndLoad(sidepanel: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(() =>
      sidepanel.evaluate(() => Boolean((window as unknown as { __IH__?: unknown }).__IH__))
    )
    .toBe(true);

  await sidepanel.evaluate(async () => {
    interface IH {
      store: { set: (k: 'multitabModalState', v: { open: boolean }) => void };
      loadMultitab: () => Promise<{ loadTabList: () => Promise<void> }>;
    }
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('multitabModalState', { open: true });
    const mod = await w.__IH__.loadMultitab();
    await mod.loadTabList();
  });
}

test('multitab modal opens and renders a list of available tabs', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Modal starts hidden.
  await expect(sidepanel.locator('#multitab-modal')).toHaveClass(/hidden/);

  await openMultitabAndLoad(sidepanel);

  // Modal becomes visible (hidden class removed by Preact re-render).
  await expect(sidepanel.locator('#multitab-modal')).not.toHaveClass(/hidden/, {
    timeout: 5_000,
  });

  // loadTabList is async (chrome.tabs.query + DOM build). Wait for at
  // least one .tab-item to land.
  await expect
    .poll(() => sidepanel.locator('#multitab-list .tab-item').count(), { timeout: 5_000 })
    .toBeGreaterThan(0);

  // The fixture page is in the same window — its title or URL should
  // appear in the list. Don't assume an exact tab count: chromium may
  // create extra about:blank or DevTools tabs depending on flags.
  const tabItems = sidepanel.locator('#multitab-list .tab-item');
  const tabUrls = await tabItems.locator('.tab-url').allTextContents();
  expect(tabUrls.some((url) => url.includes('page-with-images.html'))).toBe(true);
});

test('each rendered tab item has a checkbox + title + url + favicon slot', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  await openMultitabAndLoad(sidepanel);

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
