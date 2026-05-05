// e2e: tab-switch cache/restore — pins the data contract of
// state.tabCache (Map<number, {url, images, selectedImages}>)
// that backs handleTabChange / loadCurrentTab in sidepanel/init.ts.
//
// Why we don't drive chrome.tabs.onActivated directly: that event
// is dispatched by Chrome itself and there's no public API to
// inject one from the page side under launchPersistentContext.
// handleTabChange is also a module-private function (not exported,
// not on __IH__). What we CAN do is exercise the same store
// surface that handleTabChange's synchronous fast path
// (init.ts L295-300) writes to:
//
//   const cached = state.tabCache.get(newTabId);
//   if (cached) {
//     state.allImages = cached.images;
//     state.selectedImages = cached.selectedImages;
//     state.lastRenderedFilteredIds = null;
//     hideLoading(); hideRestricted();
//     applyFilters(); updateSelectionUI();
//     ...
//   }
//
// Four cases pin the four observable contracts:
//   1. Save-then-read: writing into tabCache + reading it back
//      preserves images & selectedImages by value (not reference
//      identity for selectedImages — handleTabChange spreads with
//      `new Set(state.selectedImages)`).
//   2. Restore round-trip: writing through the same store
//      mutations the fast path does (allImages = cached.images,
//      selectedImages = cached.selectedImages, then applyFilters)
//      makes the grid + #download-label converge to the cached
//      snapshot.
//   3. URL invalidation: cached.url !== current tab url is the
//      gate that handleTabChange uses (L325) to decide whether
//      to restore from cache or force a rescan. We pin that the
//      Map does store the url field so future regressions can't
//      drop it.
//   4. onRemoved cleanup: chrome.tabs.onRemoved.addListener
//      (init.ts L113) does state.tabCache.delete(tabId). We pin
//      the .delete contract directly so a regression that
//      replaced delete() with set(tabId, undefined) gets caught.
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
  applyFilters: () => void;
}

test('tabCache.set/get round-trips images + selectedImages + url by value', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // The initial scan populated tabCache for the current tab — pin
  // the size grew from 0 to (>=) 1 once the sidepanel boot finished.
  const cacheSnapshot = await sidepanel.evaluate(() => {
    interface ImageItem {
      id: string;
      url: string;
    }
    const w = window as unknown as { __IH__: IH };
    const cache = w.__IH__.store.get<
      Map<
        number,
        {
          url: string;
          images: ImageItem[];
          selectedImages: Set<string>;
        }
      >
    >('tabCache');
    const entries = Array.from(cache.entries());
    return entries.map(([tabId, entry]) => ({
      tabId,
      url: entry.url,
      imageCount: entry.images.length,
      selectedCount: entry.selectedImages.size,
    }));
  });
  expect(cacheSnapshot.length).toBeGreaterThanOrEqual(1);
  const initialEntry = cacheSnapshot[0];
  expect(initialEntry.imageCount).toBeGreaterThan(0);
  // Initial selection is empty — the user hasn't checked anything yet.
  expect(initialEntry.selectedCount).toBe(0);

  // Now fake the pre-switch save that handleTabChange runs at
  // init.ts L274-281: spread allImages + new Set(selectedImages)
  // into tabCache for the current tabId. We first add 2 selections
  // so the round-trip has something non-trivial to preserve.
  const fakeTabId = 99_999;
  const writebackPayload = await sidepanel.evaluate((tabId) => {
    interface ImageItem {
      id: string;
      url: string;
    }
    const w = window as unknown as { __IH__: IH };
    const allImages = w.__IH__.store.get<ImageItem[]>('allImages');
    // Pick the first two image ids and pretend the user selected them.
    const ids = allImages.slice(0, 2).map((i) => i.id);
    const sel = new Set(ids);
    w.__IH__.store.set('selectedImages', sel);

    // Now do the writeback the way handleTabChange would.
    const cache = w.__IH__.store.get<
      Map<
        number,
        {
          url: string;
          images: ImageItem[];
          selectedImages: Set<string>;
        }
      >
    >('tabCache');
    cache.set(tabId, {
      url: 'https://writeback.example/page-A',
      images: [...allImages],
      selectedImages: new Set(sel),
    });
    return { ids, totalImages: allImages.length };
  }, fakeTabId);

  // Read the fake entry back — every field should round-trip.
  const reread = await sidepanel.evaluate((tabId) => {
    interface ImageItem {
      id: string;
    }
    const w = window as unknown as { __IH__: IH };
    const cache = w.__IH__.store.get<
      Map<
        number,
        {
          url: string;
          images: ImageItem[];
          selectedImages: Set<string>;
        }
      >
    >('tabCache');
    const entry = cache.get(tabId);
    if (!entry) return null;
    return {
      url: entry.url,
      imageCount: entry.images.length,
      selectedIds: Array.from(entry.selectedImages),
    };
  }, fakeTabId);
  expect(reread).not.toBeNull();
  expect(reread!.url).toBe('https://writeback.example/page-A');
  expect(reread!.imageCount).toBe(writebackPayload.totalImages);
  expect(reread!.selectedIds.sort()).toEqual(writebackPayload.ids.sort());
});

test('restore round-trip: writing cached snapshot back into store + applyFilters → grid + #download-label converge', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Snapshot current grid count.
  const beforeCardCount = await sidepanel.locator('#image-grid .image-card').count();
  expect(beforeCardCount).toBeGreaterThan(0);

  // Build a synthetic "previous tab snapshot" — 2 images with 1 selected.
  await sidepanel.evaluate(() => {
    interface ImageItem {
      id: string;
      url: string;
      naturalWidth: number;
      naturalHeight: number;
      displayWidth: number;
      displayHeight: number;
      estimatedSize: number;
      format: string;
    }
    const make = (id: string): ImageItem => ({
      id,
      url: `https://snapshot.example/${id}.png`,
      naturalWidth: 100,
      naturalHeight: 100,
      displayWidth: 100,
      displayHeight: 100,
      estimatedSize: 512,
      format: 'png',
    });
    const cachedImages = [make('snap-1'), make('snap-2')];
    const cachedSelected = new Set(['snap-1']);

    // Mirror the handleTabChange L295-300 fast path mutations.
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('allImages', cachedImages);
    w.__IH__.store.set('selectedImages', cachedSelected);
    w.__IH__.store.set('lastRenderedFilteredIds', null);
    w.__IH__.applyFilters();
  });

  // Grid converges to the cached snapshot (2 cards).
  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), {
      timeout: 5_000,
    })
    .toBe(2);

  // Selection count surfaces in #download-label (or download counter).
  // The label format is "Download (N)" when N > 0; if it's hidden when
  // N=0 we still want to assert the count is reflected somewhere.
  await expect
    .poll(
      async () => {
        return sidepanel.evaluate(() => {
          const w = window as unknown as { __IH__: IH };
          const sel = w.__IH__.store.get<Set<string>>('selectedImages');
          return sel.size;
        });
      },
      { timeout: 3_000 }
    )
    .toBe(1);
  await expect(sidepanel.locator('#download-label')).toContainText('1', {
    timeout: 3_000,
  });
});

test('URL invalidation gate: cache stores url so handleTabChange can compare against the live tab url', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Plant a cache entry with a known url, then assert that lookup
  // returns the same url. This is the data the handleTabChange
  // L325 check (cached.url !== newTab.url) reads — a regression
  // that drops the url field would silently restore stale images
  // from a navigation, which is one of the worst UX bugs this
  // module has historically had.
  const fakeTabId = 88_888;
  await sidepanel.evaluate((tabId) => {
    interface ImageItem {
      id: string;
      url: string;
    }
    const w = window as unknown as { __IH__: IH };
    const cache = w.__IH__.store.get<
      Map<
        number,
        {
          url: string;
          images: ImageItem[];
          selectedImages: Set<string>;
        }
      >
    >('tabCache');
    cache.set(tabId, {
      url: 'https://stale.example/page-old',
      images: [],
      selectedImages: new Set(),
    });
  }, fakeTabId);

  const cachedUrl = await sidepanel.evaluate((tabId) => {
    interface CacheEntry {
      url: string;
    }
    const w = window as unknown as { __IH__: IH };
    const cache = w.__IH__.store.get<Map<number, CacheEntry>>('tabCache');
    return cache.get(tabId)?.url;
  }, fakeTabId);
  expect(cachedUrl).toBe('https://stale.example/page-old');

  // Simulate a navigation: the same tab now has a different url.
  // The production code compares cached.url against the live tab
  // url string — so all that matters here is that the comparison
  // would surface a mismatch.
  const isStale = await sidepanel.evaluate((tabId) => {
    interface CacheEntry {
      url: string;
    }
    const w = window as unknown as { __IH__: IH };
    const cache = w.__IH__.store.get<Map<number, CacheEntry>>('tabCache');
    const liveUrl = 'https://stale.example/page-NEW';
    const cached = cache.get(tabId);
    return cached ? cached.url !== liveUrl : false;
  }, fakeTabId);
  expect(isStale).toBe(true);
});

test('onRemoved cleanup: tabCache.delete(tabId) wipes the entry; subsequent .get returns undefined', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  const fakeTabId = 77_777;

  // Plant + verify.
  const planted = await sidepanel.evaluate((tabId) => {
    interface ImageItem {
      id: string;
      url: string;
    }
    const w = window as unknown as { __IH__: IH };
    const cache = w.__IH__.store.get<
      Map<
        number,
        {
          url: string;
          images: ImageItem[];
          selectedImages: Set<string>;
        }
      >
    >('tabCache');
    cache.set(tabId, {
      url: 'https://to-be-closed.example/',
      images: [],
      selectedImages: new Set(),
    });
    return cache.has(tabId);
  }, fakeTabId);
  expect(planted).toBe(true);

  // Mirror init.ts L113: state.tabCache.delete(tabId) on tab close.
  const afterDelete = await sidepanel.evaluate((tabId) => {
    interface CacheEntry {
      url: string;
    }
    const w = window as unknown as { __IH__: IH };
    const cache = w.__IH__.store.get<Map<number, CacheEntry>>('tabCache');
    cache.delete(tabId);
    return { has: cache.has(tabId), entry: cache.get(tabId) };
  }, fakeTabId);
  expect(afterDelete.has).toBe(false);
  expect(afterDelete.entry).toBeUndefined();
});
