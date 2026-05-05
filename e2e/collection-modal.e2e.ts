// e2e: collection modal CRUD paths that favorite.e2e.ts doesn't cover.
//
// favorite.e2e.ts already pins:
//   - free user clicks ★ → ProUpgradeModal, no IndexedDB write
//   - Pro user clicks ★ → addToCollection → IndexedDB rowCount=1 +
//     .btn-favorite gains .favorited class
//
// This spec extends to the rest of the lifecycle:
//   - Pro user clicks ★ a second time on the same card → toggle OFF
//     branch in handleFavorite (ImageCard.tsx L196): calls
//     removeFromCollection → IndexedDB rowCount drops to 0,
//     .favorited class is removed.
//   - Opening the collection modal (#collection-modal) lazy-loads
//     sidepanel/collection-ui.ts and renders one .image-card
//     .collection-card per IndexedDB row (with .btn-remove-collection,
//     .btn-search-collection, .btn-dl-collection, etc.).
//   - Clicking .btn-remove-collection inside the modal:
//       1. awaits collectionRemove → IndexedDB row deleted
//       2. main grid's .btn-favorite loses .favorited class
//          (collection-ui.ts L131-135 explicitly syncs this)
//       3. loadCollection() re-renders → empty state shown
//          ("No images in collection yet")
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
 * Read collection row count from the IndexedDB ImageSnatcherDB.collections
 * store. Returns 0 if the store doesn't exist yet (fresh user-data-dir),
 * -1 on any error.
 */
async function readCollectionCount(
  sidepanel: Awaited<ReturnType<typeof openSidepanelWithImages>>['sidepanel']
): Promise<number> {
  return sidepanel.evaluate(async () => {
    return new Promise<number>((resolve) => {
      const open = indexedDB.open('ImageSnatcherDB', 1);
      open.onerror = () => resolve(-1);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('collections')) {
          db.close();
          resolve(0);
          return;
        }
        const tx = db.transaction(['collections'], 'readonly');
        const req = tx.objectStore('collections').count();
        req.onsuccess = () => {
          const c = req.result;
          db.close();
          resolve(c);
        };
        req.onerror = () => {
          db.close();
          resolve(-1);
        };
      };
    });
  });
}

test('Pro user clicking ★ a second time toggles off — IndexedDB row removed + .favorited class cleared', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  const firstFavBtn = sidepanel.locator('#image-grid .image-card .btn-favorite').first();

  // 1. First click → favorited.
  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('#image-grid .image-card .btn-favorite')?.click();
  });
  await expect(firstFavBtn).toHaveClass(/favorited/, { timeout: 5_000 });
  expect(await readCollectionCount(sidepanel)).toBe(1);

  // 2. Second click → unfavorited (the toggle-off branch in
  //    handleFavorite that favorite.e2e.ts doesn't exercise).
  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('#image-grid .image-card .btn-favorite')?.click();
  });

  // .favorited class is removed once removeFromCollection awaits
  // resolve and setIsFavorited(false) re-renders.
  await expect(firstFavBtn).not.toHaveClass(/favorited/, { timeout: 5_000 });

  // IndexedDB row count drops back to 0.
  await expect.poll(async () => readCollectionCount(sidepanel), { timeout: 3_000 }).toBe(0);
});

test('Pro user opens collection modal — renders one collection-card per row + remove-button deletes from IDB and from the modal', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  const firstFavBtn = sidepanel.locator('#image-grid .image-card .btn-favorite').first();

  // Seed: add the first image to the collection.
  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('#image-grid .image-card .btn-favorite')?.click();
  });
  await expect(firstFavBtn).toHaveClass(/favorited/, { timeout: 5_000 });
  expect(await readCollectionCount(sidepanel)).toBe(1);

  // Open the collection modal. #btn-collection is the toolbar entry;
  // showCollectionModal lazy-imports sidepanel/collection-ui.ts and
  // calls loadCollection() which renders into elements.collectionBody.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-collection')?.click();
  });
  await expect(sidepanel.locator('#collection-modal')).not.toHaveClass(/hidden/, {
    timeout: 5_000,
  });

  // Wait for the lazy chunk to load + IndexedDB read + innerHTML
  // write to complete. Exactly one .collection-card lands.
  await expect
    .poll(async () => sidepanel.locator('#collection-modal .collection-card').count(), {
      timeout: 5_000,
    })
    .toBe(1);

  // The collection-card has the standard action buttons in its
  // .card-actions row: remove, download, reverse-search.
  await expect(
    sidepanel.locator('#collection-modal .collection-card .btn-remove-collection')
  ).toHaveCount(1);

  // Click remove-button. The handler awaits collectionRemove + syncs
  // the main grid's favorite class + re-runs loadCollection().
  await sidepanel.evaluate(() => {
    document
      .querySelector<HTMLElement>('#collection-modal .collection-card .btn-remove-collection')
      ?.click();
  });

  // IndexedDB row deleted.
  await expect.poll(async () => readCollectionCount(sidepanel), { timeout: 3_000 }).toBe(0);

  // Modal list re-renders into the empty state (collection-ui.ts L67).
  await expect(sidepanel.locator('#collection-modal .collection-card')).toHaveCount(0, {
    timeout: 3_000,
  });
  await expect(sidepanel.locator('#collection-modal .collection-empty')).toBeVisible({
    timeout: 3_000,
  });

  // Main-grid favorite button also lost its .favorited class — the
  // explicit sync at collection-ui.ts L131-135 keeps the two views
  // consistent without requiring a full grid re-render.
  await expect(firstFavBtn).not.toHaveClass(/favorited/);
});
