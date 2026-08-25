// e2e: clicking the per-card favorite (★) button.
//
// Two paths to pin:
//   - Free user: Sprint 3.5 relaxed collection from fully-Pro to a
//     free-tier allowance (FREE_LIMITS.MAX_COLLECTION_ITEMS = 10).
//     handleFavorite (ImageCard.tsx) has NO Pro guard; the gate lives
//     inside addToCollection (pro-features.ts): below the allowance the
//     write lands directly, the upgrade modal only opens when the
//     allowance is full (that path is covered by unit tests).
//
//   - Pro user: handleFavorite calls addToCollection (pro-features.ts),
//     which writes a row into IndexedDB ImageSnatcherDB.collections
//     via shared/collection > collectionAdd. After the await resolves,
//     setIsFavorited(true) re-renders the button with the .favorited
//     class.
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

test('free user clicking ★ adds the first favorite directly (no upgrade modal below the allowance)', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Pre-condition: pro-upgrade-modal hidden.
  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);

  // Click first card's favorite button.
  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('#image-grid .image-card .btn-favorite')?.click();
  });

  // Below MAX_COLLECTION_ITEMS the write lands directly — the upgrade
  // modal only opens once the free allowance is full.
  await expect(sidepanel.locator('#image-grid .image-card .btn-favorite').first()).toHaveClass(
    /favorited/,
    { timeout: 5_000 }
  );

  // One IndexedDB row was written. Open the DB and count the
  // collections store.
  const rowCount = await sidepanel.evaluate(async () => {
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
  expect(rowCount).toBe(1);

  // Toggle back off so the next test (same user-data-dir → shared
  // IndexedDB) starts from a clean collection store. Without this, the
  // panel-boot IDB read restores the .favorited class onto the first
  // card and breaks the next test's "no .favorited cards" pre-condition.
  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('#image-grid .image-card .btn-favorite')?.click();
  });
  await expect(sidepanel.locator('#image-grid .image-card .btn-favorite.favorited')).toHaveCount(
    0,
    { timeout: 5_000 }
  );
});

test('Pro user clicking ★ on a card writes to IndexedDB and toggles the .favorited class', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  // Reset the collection store so this test's assertions are
  // independent of the free-tier test above (same user-data-dir →
  // shared IndexedDB; without this the first card is a duplicate and
  // collectionAdd never runs).
  await sidepanel.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const open = indexedDB.open('ImageSnatcherDB', 1);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('collections')) {
          db.close();
          resolve();
          return;
        }
        const tx = db.transaction(['collections'], 'readwrite');
        tx.objectStore('collections').clear();
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      };
      open.onerror = () => resolve();
    });
  });

  // Pre-condition: no .favorited cards yet.
  await expect(sidepanel.locator('#image-grid .image-card .btn-favorite.favorited')).toHaveCount(0);

  // Click first card's favorite button.
  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('#image-grid .image-card .btn-favorite')?.click();
  });

  // addToCollection awaits chrome.tabs.query + collectionAdd; once
  // resolved, setIsFavorited(true) triggers a re-render with the
  // .favorited class. Poll for the class.
  await expect(sidepanel.locator('#image-grid .image-card .btn-favorite').first()).toHaveClass(
    /favorited/,
    { timeout: 5_000 }
  );

  // IndexedDB row landed.
  const rowCount = await sidepanel.evaluate(async () => {
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
  expect(rowCount).toBe(1);

  // Pro upgrade modal must NOT have opened (the favorite handler's Pro
  // branch doesn't call showProUpgradeModal).
  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);
});
