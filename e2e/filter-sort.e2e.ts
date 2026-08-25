// e2e: filter + sort
//
// Drives the sidepanel store directly via the window.__IH__ test hook
// (set up in init.ts when window.__IH_E2E__ is true; launchExtension
// installs the flag via addInitScript before the page boots). This is
// intentionally store-driven rather than UI-click-driven — clicking
// through 4-deep dropdown menus is fragile, and what actually matters
// is the store ↔ DOM bridge.
import { test, expect, type BrowserContext } from '@playwright/test';
import {
  launchExtension,
  openSidepanelWithImages,
  startFixtureServer,
  type FixtureServer,
  type OpenedSidepanel,
} from './_helpers/launchExtension';

let context: BrowserContext;
let extensionId: string;
let fixtureServer: FixtureServer;
let opened: OpenedSidepanel;

test.beforeEach(async () => {
  fixtureServer = await startFixtureServer();
  ({ context, extensionId } = await launchExtension());
  opened = await openSidepanelWithImages(context, fixtureServer, extensionId);
  // Wait for window.__IH__ to be wired up (init.ts attaches it
  // asynchronously after both state.ts + filter.ts module promises
  // resolve). Without this guard the first mutateStore call races init.
  await opened.sidepanel.waitForFunction(
    () => Boolean((window as unknown as { __IH__?: unknown }).__IH__),
    null,
    {
      timeout: 10_000,
    }
  );
});

test.afterEach(async () => {
  await context.close();
  await fixtureServer.close();
});

/** Card ids in render order. ImageCard exposes `data-id`. */
async function collectCardIds(): Promise<string[]> {
  return opened.sidepanel
    .locator('#image-grid .image-card')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id ?? ''));
}

/**
 * Mutate the sidepanel store + re-run the filter pipeline so filteredImages
 * / sort order take effect, then wait for Preact to flush a frame.
 */
async function mutateStore(patch: Record<string, unknown>): Promise<void> {
  await opened.sidepanel.evaluate((p) => {
    const ih = (
      window as unknown as {
        __IH__: { store: { setMany: (v: unknown) => void }; applyFilters: () => void };
      }
    ).__IH__;
    ih.store.setMany(p);
    ih.applyFilters();
  }, patch);
  // One rAF tick is enough for Preact to commit; we don't need a hard wait.
  await opened.sidepanel.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  );
}

test('changing sort mode reorders the rendered image cards', async () => {
  // The fixture images all share the same dimensions, so size-desc and
  // size-asc both fall through to the deterministic id tiebreaker
  // (filter.ts sortImagesArray) and produce the SAME order — the reverse
  // assertion below would never hold. Give each image a distinct size so
  // the two modes become strict inverses.
  await opened.sidepanel.evaluate(() => {
    const ih = (
      window as unknown as {
        __IH__: {
          store: {
            get: <T>(k: string) => T;
            set: (k: string, v: unknown) => void;
          };
          applyFilters: () => void;
        };
      }
    ).__IH__;
    interface Img {
      naturalWidth: number;
      naturalHeight: number;
      displayWidth: number;
      displayHeight: number;
    }
    const imgs = ih.store.get<Img[]>('allImages');
    imgs.forEach((img, i) => {
      img.naturalWidth = (i + 1) * 100;
      img.naturalHeight = 100;
      img.displayWidth = (i + 1) * 100;
      img.displayHeight = 100;
    });
    ih.store.set('allImages', [...imgs]);
    ih.applyFilters();
  });
  await opened.sidepanel.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  );

  // Baseline order under explicit size-desc. The store's default
  // currentSortMode is 'natural' (DOM order = allImages order), which
  // would make the asc flip below a no-op since the synthetic sizes are
  // already ascending by index — pin size-desc explicitly so the two
  // modes are strict inverses regardless of the default.
  await mutateStore({ currentSortMode: 'size-desc' });
  const initialIds = await collectCardIds();
  expect(initialIds.length).toBeGreaterThan(1);

  // Flip to size-asc — order should reverse.
  await mutateStore({ currentSortMode: 'size-asc' });

  // Poll for the reorder rather than hard-waiting; Preact + applyFilters
  // are sync but DOM commit needs a paint cycle.
  await expect
    .poll(async () => collectCardIds(), { timeout: 5_000, intervals: [100, 250, 500] })
    .toEqual([...initialIds].reverse());

  expect(opened.sidepanelErrors).toEqual([]);
});

test('filtering by a non-matching format hides all cards', async () => {
  const before = await collectCardIds();
  expect(before.length).toBeGreaterThan(0);

  // Fixtures are SVG data URLs — filtering to 'gif' guarantees zero matches.
  // aiTagFilter must be present: filterByAiTag reads it unconditionally and
  // a partial activeFilters object would crash applyFilters.
  await mutateStore({
    activeFilters: {
      size: 'all',
      sizeMin: 0,
      sizeMax: Number.POSITIVE_INFINITY,
      types: ['gif'],
      layout: 'all',
      urlKeyword: '',
      color: null,
      aiTagFilter: [],
    },
  });

  await expect
    .poll(async () => opened.sidepanel.locator('#image-grid .image-card').count(), {
      timeout: 5_000,
    })
    .toBe(0);

  // Clearing the filter restores the original count.
  await mutateStore({
    activeFilters: {
      size: 'all',
      sizeMin: 0,
      sizeMax: Number.POSITIVE_INFINITY,
      types: [],
      layout: 'all',
      urlKeyword: '',
      color: null,
      aiTagFilter: [],
    },
  });
  await expect
    .poll(async () => opened.sidepanel.locator('#image-grid .image-card').count(), {
      timeout: 5_000,
    })
    .toBe(before.length);

  expect(opened.sidepanelErrors).toEqual([]);
});
