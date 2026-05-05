// e2e: view mode + grouping
//
// Verifies the two store fields that control how <ImageGrid> shapes the
// rendered tree:
//   - currentViewMode  ('grid' | 'list')   → grid CSS variant
//   - currentGroupMode ('none' | 'domain' | 'format' | 'size' | 'tab')
//                       → flat vs grouped (.group-header + .group-content)
//
// Both are flipped via the e2e __IH__ hook because the real UI lives in a
// double-nested filter dropdown that's painful to drive deterministically
// (and not what we're regressing on — the store ↔ DOM bridge is).
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
  await opened.sidepanel.waitForFunction(
    () => Boolean((window as unknown as { __IH__?: unknown }).__IH__),
    null,
    { timeout: 10_000 }
  );
});

test.afterEach(async () => {
  await context.close();
  await fixtureServer.close();
});

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
  // One rAF tick so Preact commits the new tree.
  await opened.sidepanel.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  );
}

test('switching to grid view mode removes list-view CSS hooks', async () => {
  // Default is 'list' — the FlatList wrapper applies .list-view on the
  // container that holds the cards.
  const flatContainer = opened.sidepanel.locator('#image-grid > .list-view, #image-grid.list-view');
  // Just confirm "some list-view markup exists" — which exact node carries
  // the class is an implementation detail of FlatList vs grouped paths.
  const initialListViewCount = await flatContainer.count();
  expect(initialListViewCount).toBeGreaterThan(0);

  await mutateStore({ currentViewMode: 'grid' });

  // After the switch, no descendant of #image-grid should still carry
  // .list-view (cards-only, no group bookkeeping in flat+none mode).
  await expect
    .poll(async () => opened.sidepanel.locator('#image-grid .list-view').count(), {
      timeout: 5_000,
    })
    .toBe(0);

  // Cards should still be there — view mode is presentation-only.
  expect(await opened.sidepanel.locator('#image-grid .image-card').count()).toBeGreaterThan(0);
  expect(opened.sidepanelErrors).toEqual([]);
});

test('grouping by domain renders group headers + collapsible content', async () => {
  // Default group mode is 'none' → no .group-header anywhere.
  expect(await opened.sidepanel.locator('#image-grid .group-header').count()).toBe(0);

  await mutateStore({ currentGroupMode: 'domain' });

  // Now we expect at least one group header (every fixture image comes from
  // the same fixture server origin, so we get exactly one domain bucket).
  await expect
    .poll(async () => opened.sidepanel.locator('#image-grid .group-header').count(), {
      timeout: 5_000,
    })
    .toBeGreaterThan(0);

  // Group content must contain the original image cards (count preserved).
  const cardsInGroups = await opened.sidepanel
    .locator('#image-grid .group-content .image-card')
    .count();
  expect(cardsInGroups).toBeGreaterThan(0);

  expect(opened.sidepanelErrors).toEqual([]);
});

test('toggling grouping back to none restores the flat layout', async () => {
  await mutateStore({ currentGroupMode: 'domain' });
  await expect
    .poll(async () => opened.sidepanel.locator('#image-grid .group-header').count(), {
      timeout: 5_000,
    })
    .toBeGreaterThan(0);

  await mutateStore({ currentGroupMode: 'none' });

  // No group bookkeeping should remain.
  await expect
    .poll(async () => opened.sidepanel.locator('#image-grid .group-header').count(), {
      timeout: 5_000,
    })
    .toBe(0);
  // But flat cards still render.
  expect(await opened.sidepanel.locator('#image-grid .image-card').count()).toBeGreaterThan(0);

  expect(opened.sidepanelErrors).toEqual([]);
});
