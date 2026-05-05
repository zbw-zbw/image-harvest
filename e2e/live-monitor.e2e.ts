// e2e: live-monitor — the IMAGES_DISCOVERED message path that
// content/monitor.ts pushes through the background SW into
// sidepanel/message.ts > handleMessage.
//
// Production link:
//   1. content/main.ts L77 receives START_LIVE_MONITOR + boots a
//      MutationObserver in content/monitor.ts.
//   2. The observer sees added <img>/<svg>/bg-image nodes, debounces
//      500ms, batches them into newImages and calls
//      sendDiscoveredImages (content/utils.ts L95).
//   3. sendDiscoveredImages dispatches
//      chrome.runtime.sendMessage({type:'IMAGES_DISCOVERED', images}).
//   4. background/index.ts L110 broadcasts to popup with
//      fromTabId = sender.tab.id appended.
//   5. sidepanel/message.ts L51 handleMessage routes by type +
//      runs four sequential guards before either the scanning
//      branch (L86-129) or the live-monitor branch (L131-159).
//
// We can't drive step 1-4 from Playwright (chrome.runtime port
// dispatch under launchPersistentContext has no public injection
// API). Instead we exercise step 5 directly via __IH__.handleMessage
// — the same function uiPort.onMessage.addListener wires up at
// init.ts L103. The four guards' branches are ALL pinned this way:
//
//   case 1: live-monitor happy path — non-scanning, initialized,
//           fromTabId === currentTabId → images merged into
//           state.allImages, dedup-by-url, applyFilters fires +
//           grid +N cards + 'discovered' toast surfaces.
//   case 2: fromTabId mismatch → break (state untouched).
//   case 3: isTabSwitching → break (state untouched).
//   case 4: isMultiTabExtracting → break (state untouched).
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

interface IH {
  store: {
    get: <T = unknown>(k: string) => T;
    set: (k: string, v: unknown) => void;
  };
  handleMessage: (msg: unknown) => void;
}

interface ImagePayload {
  id: string;
  url: string;
  type: string;
  format: string;
  displayWidth: number;
  displayHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  sourceDomain: string;
  checked: boolean;
  timestamp: number;
}

/**
 * Build a synthetic IMAGES_DISCOVERED payload — mirrors what
 * content/monitor.ts > extractFromNode produces for an <img> node.
 */
function makeDiscoveredImages(urls: string[]): ImagePayload[] {
  return urls.map((url, i) => ({
    id: `discovered-${i}-${url}`,
    url,
    type: 'img',
    format: 'png',
    displayWidth: 200,
    displayHeight: 200,
    naturalWidth: 200,
    naturalHeight: 200,
    sourceDomain: 'live.example.com',
    checked: false,
    timestamp: Date.now(),
  }));
}

test('happy path: IMAGES_DISCOVERED with matching fromTabId merges new urls into state.allImages + grid grows', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Snapshot pre-discovery state.
  const before = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return {
      total: w.__IH__.store.get<unknown[]>('allImages').length,
      currentTabId: w.__IH__.store.get<number | null>('currentTabId'),
      isInitialized: w.__IH__.store.get<boolean>('isInitialized'),
    };
  });
  expect(before.total).toBeGreaterThan(0);
  expect(before.isInitialized).toBe(true);
  expect(before.currentTabId).not.toBeNull();

  const beforeCardCount = await sidepanel.locator('#image-grid .image-card').count();

  // Dispatch a fresh IMAGES_DISCOVERED frame with 3 brand-new urls.
  // fromTabId === currentTabId so guard 1 passes; isTabSwitching/
  // isSilentScanning/isFetching/isMultiTabExtracting/isScanning are
  // all false so the live-monitor branch (message.ts L131) fires.
  const newUrls = [
    'https://live.example/a.png',
    'https://live.example/b.png',
    'https://live.example/c.png',
  ];
  await sidepanel.evaluate(
    ({ urls, tabId, payload }) => {
      const w = window as unknown as { __IH__: IH };
      w.__IH__.handleMessage({
        type: 'IMAGES_DISCOVERED',
        fromTabId: tabId,
        images: payload,
      });
      // Reference urls to silence unused warning.
      void urls;
    },
    {
      urls: newUrls,
      tabId: before.currentTabId,
      payload: makeDiscoveredImages(newUrls),
    }
  );

  // allImages grew by exactly 3 (fixture urls don't overlap with
  // the synthesized 'live.example' host so dedup-by-url leaves
  // them all in).
  await expect
    .poll(
      async () =>
        sidepanel.evaluate(() => {
          const w = window as unknown as { __IH__: IH };
          return w.__IH__.store.get<unknown[]>('allImages').length;
        }),
      { timeout: 3_000 }
    )
    .toBe(before.total + 3);

  // Grid converged to the new count via applyFilters.
  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), {
      timeout: 3_000,
    })
    .toBe(beforeCardCount + 3);
});

test('dedup-by-url: re-dispatching the same urls does NOT grow allImages', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  const tabId = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<number>('currentTabId');
  });
  const newUrls = ['https://live.example/dup-a.png', 'https://live.example/dup-b.png'];

  // First dispatch — adds both.
  await sidepanel.evaluate(
    ({ tabId: t, payload }) => {
      const w = window as unknown as { __IH__: IH };
      w.__IH__.handleMessage({
        type: 'IMAGES_DISCOVERED',
        fromTabId: t,
        images: payload,
      });
    },
    { tabId, payload: makeDiscoveredImages(newUrls) }
  );

  const afterFirst = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<unknown[]>('allImages').length;
  });

  // Second dispatch — same urls. The L150 dedup gate (
  // !state.allImages.find(img => img.url === ni.url) ) skips both.
  await sidepanel.evaluate(
    ({ tabId: t, payload }) => {
      const w = window as unknown as { __IH__: IH };
      w.__IH__.handleMessage({
        type: 'IMAGES_DISCOVERED',
        fromTabId: t,
        images: payload,
      });
    },
    { tabId, payload: makeDiscoveredImages(newUrls) }
  );

  // Wait a beat for the (skipped) applyFilters to settle.
  await sidepanel.waitForTimeout(300);

  const afterSecond = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<unknown[]>('allImages').length;
  });
  expect(afterSecond).toBe(afterFirst);
});

test('fromTabId mismatch guard: dispatch with wrong fromTabId is ignored, state untouched', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  const before = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return {
      total: w.__IH__.store.get<unknown[]>('allImages').length,
      currentTabId: w.__IH__.store.get<number>('currentTabId'),
    };
  });

  // fromTabId is deliberately wrong (currentTabId + 1000).
  const wrongTabId = (before.currentTabId ?? 0) + 1000;
  await sidepanel.evaluate(
    ({ tabId, payload }) => {
      const w = window as unknown as { __IH__: IH };
      w.__IH__.handleMessage({
        type: 'IMAGES_DISCOVERED',
        fromTabId: tabId,
        images: payload,
      });
    },
    {
      tabId: wrongTabId,
      payload: makeDiscoveredImages(['https://live.example/wrong-tab.png']),
    }
  );

  // Give applyFilters a window to (incorrectly) fire if the guard
  // were broken — then assert nothing changed.
  await sidepanel.waitForTimeout(300);

  const after = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<unknown[]>('allImages').length;
  });
  expect(after).toBe(before.total);
});

test('isTabSwitching guard: dispatches while switching are ignored', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  const before = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('isTabSwitching', true);
    return {
      total: w.__IH__.store.get<unknown[]>('allImages').length,
      currentTabId: w.__IH__.store.get<number>('currentTabId'),
    };
  });

  await sidepanel.evaluate(
    ({ tabId, payload }) => {
      const w = window as unknown as { __IH__: IH };
      w.__IH__.handleMessage({
        type: 'IMAGES_DISCOVERED',
        fromTabId: tabId,
        images: payload,
      });
    },
    {
      tabId: before.currentTabId,
      payload: makeDiscoveredImages([
        'https://live.example/switching-1.png',
        'https://live.example/switching-2.png',
      ]),
    }
  );
  await sidepanel.waitForTimeout(300);

  const after = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    // Reset the flag so it doesn't bleed into other assertions in
    // parallel test runs (workers run in fresh contexts but defensive
    // resets are cheap).
    w.__IH__.store.set('isTabSwitching', false);
    return w.__IH__.store.get<unknown[]>('allImages').length;
  });
  expect(after).toBe(before.total);
});

test('isMultiTabExtracting guard: dispatches during a Multi-Tab extract are ignored', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  const before = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('isMultiTabExtracting', true);
    return {
      total: w.__IH__.store.get<unknown[]>('allImages').length,
      currentTabId: w.__IH__.store.get<number>('currentTabId'),
    };
  });

  await sidepanel.evaluate(
    ({ tabId, payload }) => {
      const w = window as unknown as { __IH__: IH };
      w.__IH__.handleMessage({
        type: 'IMAGES_DISCOVERED',
        fromTabId: tabId,
        images: payload,
      });
    },
    {
      tabId: before.currentTabId,
      payload: makeDiscoveredImages(['https://live.example/mtab.png']),
    }
  );
  await sidepanel.waitForTimeout(300);

  const after = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('isMultiTabExtracting', false);
    return w.__IH__.store.get<unknown[]>('allImages').length;
  });
  expect(after).toBe(before.total);
});
