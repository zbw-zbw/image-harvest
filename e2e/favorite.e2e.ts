// e2e: clicking the per-card favorite (★) button.
//
// Two paths to pin:
//   - Free user: handleFavorite (ImageCard.tsx L194) early-returns and
//     calls showProUpgradeModal — same Pro guard pattern as the toolbar
//     Pro buttons but enforced INSIDE the click handler (not a capture-
//     phase interceptor like bindProGuards). So even Pro-gated cards
//     receive the click; the handler decides what to do.
//
//   - Pro user: handleFavorite calls addToCollection (pro-features.ts
//     L136), which writes a row into IndexedDB ImageSnatcherDB.collections
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

test('free user clicking ★ on a card opens the Pro upgrade modal (no IndexedDB write)', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Pre-condition: pro-upgrade-modal hidden.
  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);

  // Click first card's favorite button.
  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('#image-grid .image-card .btn-favorite')?.click();
  });

  // ProUpgradeModal opens (showProUpgradeModal sets store state.
  // proUpgradeModalState.open).
  await expect(sidepanel.locator('#pro-upgrade-modal')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });

  // Card stays un-favorited (no .favorited class added).
  await expect(sidepanel.locator('#image-grid .image-card .btn-favorite').first()).not.toHaveClass(
    /favorited/
  );

  // No IndexedDB row was written. Open the DB and assert the
  // collections store is empty (or doesn't exist yet).
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
  expect(rowCount).toBe(0);
});

test('Pro user clicking ★ on a card writes to IndexedDB and toggles the .favorited class', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
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
