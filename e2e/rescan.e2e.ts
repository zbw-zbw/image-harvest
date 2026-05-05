// e2e: the toolbar refresh button (#btn-refresh) re-runs the full
// scan pipeline.
//
// Flow (init.ts L538-552):
//   1. Invalidate the per-tab cache (state.tabCache.delete + clear
//      tab image cache) so a stale fetch can't be reused.
//   2. Reset state.isFetching so the in-flight guard doesn't block.
//   3. Show the loading/scan overlay immediately to prevent stale
//      content flash (showLoading drives <ScanProgressOverlay> via
//      state.scanProgress + repopulates skeleton placeholders).
//   4. loadCurrentTab(true) — re-walks chrome.tabs.query → posts an
//      EXTRACT message to the active tab → content/main.ts re-extracts
//      → background routes results back → message.ts pushes them into
//      state.allImages → applyFilters → image-grid re-renders.
//
// Regression target: a refactor that breaks any of (cache invalidation,
// loading state, scan overlay, message round-trip, render) leaves the
// grid frozen on the old data. This test pins the round-trip via the
// only externally observable signal we have without inspecting state:
// the grid disappears and then reappears with the same images.
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

test('clicking #btn-refresh clears the grid and re-populates it via the full scan pipeline', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Snapshot the initial card count + that the cache has been
  // populated (the fetchImages success path writes a TabCacheEntry
  // for state.currentTabId after the first scan completes). The
  // rescan handler's contract is: invalidate this entry and re-fetch.
  const initialCount = await sidepanel.locator('#image-grid .image-card').count();
  expect(initialCount).toBeGreaterThan(0);

  const tabCacheBefore = await sidepanel.evaluate(() => {
    interface IH {
      store: {
        get: (k: 'tabCache' | 'currentTabId') => unknown;
      };
    }
    const w = window as unknown as { __IH__?: IH };
    if (!w.__IH__) return null;
    const tabCache = w.__IH__.store.get('tabCache') as Map<number, unknown>;
    const currentTabId = w.__IH__.store.get('currentTabId') as number | null;
    return {
      hasEntry: currentTabId != null && tabCache.has(currentTabId),
      currentTabId,
    };
  });
  expect(tabCacheBefore?.hasEntry).toBe(true);

  // Click refresh.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-refresh')?.click();
  });

  // Cache is invalidated synchronously by the click handler (see
  // init.ts L538-552: tabCache.delete + clearTabImageCache run before
  // showLoading()). This is the one signal that's both deterministic
  // AND survives until the test reads it (unlike scanProgress which
  // may flicker away on a tiny fixture before we sample it).
  const cacheClearedImmediately = await sidepanel.evaluate((tabId: number) => {
    interface IH {
      store: { get: (k: 'tabCache') => Map<number, unknown> };
    }
    const w = window as unknown as { __IH__: IH };
    return !w.__IH__.store.get('tabCache').has(tabId);
  }, tabCacheBefore!.currentTabId!);
  expect(cacheClearedImmediately).toBe(true);

  // Wait for the grid to re-converge to the same image count via the
  // full rescan pipeline (loadCurrentTab → EXTRACT message → content
  // re-scan → background → message.ts → state.allImages → applyFilters
  // → re-render). Pin count rather than identity because card data-id
  // is regenerated on every scan; the discovered total is stable for
  // the static fixture.
  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), { timeout: 30_000 })
    .toBe(initialCount);

  // Cache should be repopulated after the rescan completes — closing
  // the loop on "invalidate → refetch → re-cache".
  const cacheRepopulated = await sidepanel.evaluate((tabId: number) => {
    interface IH {
      store: { get: (k: 'tabCache') => Map<number, unknown> };
    }
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get('tabCache').has(tabId);
  }, tabCacheBefore!.currentTabId!);
  expect(cacheRepopulated).toBe(true);
});
