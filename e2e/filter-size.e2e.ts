// e2e: the Size dropdown's custom min/max width/height inputs feed
// state.appSettings.{enableMinSize,minWidth,minHeight,enableMaxSize,
// maxWidth,maxHeight}, which gate filterByMinSize / filterByMaxSize
// in filter.ts (L177-195).
//
// Flow (init.ts L707-715 + filter.ts > applyCustomSizeInputs):
//   1. User types into #filter-min-width / #filter-min-height /
//      #filter-max-width / #filter-max-height. Each input fires the
//      'input' event handler which calls applyCustomSizeInputs().
//   2. applyCustomSizeInputs() reads all four values, sets the
//      enable* flags + dimension thresholds on state.appSettings,
//      resets state.activeFilters.size to 'all' (so the preset and
//      custom paths don't double-filter), and calls applyFilters().
//   3. filterByMinSize/filterByMaxSize compare img.naturalWidth /
//      naturalHeight against the thresholds with AND semantics — an
//      image must satisfy BOTH dimensions to pass.
//
// Fixture has 6 images at widths 200/60/90/120/150/180 (one is the
// css-inlined background svg at 200x120, the other 5 are <img> tags
// at 60/90/120/150/180 squares). minWidth=100 keeps the 200, 120,
// 150, 180 cards and drops the 60 + 90 cards.
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

test('typing into #filter-min-width filters out smaller images and clearing it restores the full grid', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  const initialCount = await sidepanel.locator('#image-grid .image-card').count();
  expect(initialCount).toBeGreaterThan(2); // need enough images for the threshold to bite

  // Capture the per-image width distribution so we can compute the
  // exact expected count after applying minWidth=100 — this stays
  // robust even if the fixture grows new images later.
  const widths = await sidepanel.evaluate(() => {
    interface IH {
      store: {
        get: (k: 'allImages') => Array<{ naturalWidth?: number; displayWidth?: number }>;
      };
    }
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get('allImages').map((img) => img.naturalWidth ?? img.displayWidth ?? 0);
  });
  const expectedAfterMinWidth = widths.filter((w) => w >= 100).length;
  expect(expectedAfterMinWidth).toBeGreaterThan(0);
  expect(expectedAfterMinWidth).toBeLessThan(initialCount);

  // Open the Size dropdown so the inputs become visible (not strictly
  // required for the input events to fire, but mirrors real usage).
  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('.filter-btn[data-filter="size"]')?.click();
  });
  await expect(sidepanel.locator('#filter-size')).not.toHaveClass(/hidden/, {
    timeout: 2_000,
  });

  // Type a min-width threshold of 100 and dispatch the 'input' event
  // (init.ts wires 'input', not 'change'). Setting .value alone does
  // NOT trigger the listener.
  await sidepanel.evaluate(() => {
    const input = document.getElementById('filter-min-width') as HTMLInputElement;
    input.value = '100';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Grid converges to the filtered set.
  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), { timeout: 3_000 })
    .toBe(expectedAfterMinWidth);

  // state.activeFilters was updated correctly (applyCustomSizeInputs writes
  // to activeFilters, not appSettings — the global defaults stay intact).
  const filters = await sidepanel.evaluate(() => {
    interface IH {
      store: {
        get: (k: 'activeFilters') => {
          customMinEnabled?: boolean;
          customMinWidth?: number;
          customMinHeight?: number;
          customMaxEnabled?: boolean;
        };
      };
    }
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get('activeFilters');
  });
  expect(filters.customMinEnabled).toBe(true);
  expect(filters.customMinWidth).toBe(100);
  expect(filters.customMinHeight).toBe(0);

  // Clear the input → applyCustomSizeInputs sees no min and no max
  // → enableMinSize flips false → filter passes everything again.
  await sidepanel.evaluate(() => {
    const input = document.getElementById('filter-min-width') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), { timeout: 3_000 })
    .toBe(initialCount);

  const filtersAfter = await sidepanel.evaluate(() => {
    interface IH {
      store: { get: (k: 'activeFilters') => { customMinEnabled?: boolean } };
    }
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get('activeFilters');
  });
  expect(filtersAfter.customMinEnabled).toBe(false);
});
