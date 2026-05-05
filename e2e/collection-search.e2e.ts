// e2e: the #collection-search input inside the collection modal
// drives a live filter via collection-ui.ts L36-39:
//
//   searchInput.oninput = () => {
//     loadCollection(searchInput.value.trim());
//   };
//
// loadCollection(query) (L45-62) lowercases the query and matches
// against item.url, item.sourceTitle, item.sourceUrl, and item.tags
// (case-insensitive includes). Empty matches surface the
// .collection-empty state with the "No matching images found" copy
// (L69 — different from the vanilla "No images in collection yet"
// shown for an empty store).
//
// We bypass the real ★ → addToCollection flow and inject three
// distinguishable fixture rows directly into IndexedDB — the fixture
// images all use data: URLs which can't be told apart by substring,
// and we want the test to pin search behavior, not the favorite
// flow (favorite.e2e.ts + collection-modal.e2e.ts already cover
// that).
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
 * Insert three rows into ImageSnatcherDB.collections directly. Two
 * of them have "photo" in their url, one has "logo". The same DB
 * schema (keyPath: 'id', indexes on tags/sourceUrl/createdAt) is
 * created by shared/collection.ts > collectionInit on first read,
 * so we trigger that by calling collectionGetAll-equivalent before
 * writing if the store doesn't exist yet.
 */
async function seedCollection(
  sidepanel: Awaited<ReturnType<typeof openSidepanelWithImages>>['sidepanel']
): Promise<void> {
  await sidepanel.evaluate(async () => {
    const items = [
      {
        id: 'seed-photo-1',
        url: 'https://example.com/photo-mountain.jpg',
        sourceTitle: 'Photo Gallery',
        sourceUrl: 'https://gallery.example.com/',
        tags: ['nature'],
        createdAt: Date.now() - 3000,
      },
      {
        id: 'seed-photo-2',
        url: 'https://example.com/photo-ocean.jpg',
        sourceTitle: 'Photo Gallery',
        sourceUrl: 'https://gallery.example.com/',
        tags: ['nature'],
        createdAt: Date.now() - 2000,
      },
      {
        id: 'seed-logo-1',
        url: 'https://example.com/logo-brand.png',
        sourceTitle: 'Brand Page',
        sourceUrl: 'https://brand.example.com/',
        tags: ['design'],
        createdAt: Date.now() - 1000,
      },
    ];

    return new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('ImageSnatcherDB', 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('collections')) {
          const store = db.createObjectStore('collections', { keyPath: 'id' });
          store.createIndex('tags', 'tags', { multiEntry: true });
          store.createIndex('sourceUrl', 'sourceUrl', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['collections'], 'readwrite');
        const store = tx.objectStore('collections');
        items.forEach((item) => store.add(item));
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  });
}

test('typing in #collection-search live-filters the modal grid; clearing restores the full set', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  await seedCollection(sidepanel);

  // Open the collection modal — showCollectionModal binds the
  // oninput handler against #collection-search and calls
  // loadCollection() with no query (full list).
  await sidepanel.evaluate(() => {
    document.getElementById('btn-collection')?.click();
  });
  await expect(sidepanel.locator('#collection-modal')).not.toHaveClass(/hidden/, {
    timeout: 5_000,
  });

  // All three seeded rows render.
  await expect
    .poll(async () => sidepanel.locator('#collection-modal .collection-card').count(), {
      timeout: 5_000,
    })
    .toBe(3);

  // Type "photo" → expect 2 matches (url contains "photo").
  await sidepanel.evaluate(() => {
    const input = document.getElementById('collection-search') as HTMLInputElement;
    input.value = 'photo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect
    .poll(async () => sidepanel.locator('#collection-modal .collection-card').count(), {
      timeout: 3_000,
    })
    .toBe(2);
  // Empty state should NOT be visible while we have matches.
  await expect(sidepanel.locator('#collection-modal .collection-empty')).toHaveCount(0);

  // Type "logo" → expect 1 match.
  await sidepanel.evaluate(() => {
    const input = document.getElementById('collection-search') as HTMLInputElement;
    input.value = 'logo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect
    .poll(async () => sidepanel.locator('#collection-modal .collection-card').count(), {
      timeout: 3_000,
    })
    .toBe(1);

  // Search by tag too — collection-ui.ts L60 also checks item.tags.
  await sidepanel.evaluate(() => {
    const input = document.getElementById('collection-search') as HTMLInputElement;
    input.value = 'design';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect
    .poll(async () => sidepanel.locator('#collection-modal .collection-card').count(), {
      timeout: 3_000,
    })
    .toBe(1);

  // Type something with zero matches → empty state with the
  // search-specific copy (collection-ui.ts L69 picks the
  // "No matching images found" branch when searchQuery is non-empty).
  await sidepanel.evaluate(() => {
    const input = document.getElementById('collection-search') as HTMLInputElement;
    input.value = 'nonexistent-keyword-xyz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(sidepanel.locator('#collection-modal .collection-card')).toHaveCount(0, {
    timeout: 3_000,
  });
  await expect(sidepanel.locator('#collection-modal .collection-empty')).toBeVisible();
  await expect(sidepanel.locator('#collection-modal .collection-empty')).toContainText(
    'No matching images found'
  );

  // Clear the input → empty query path → all 3 rows render again.
  await sidepanel.evaluate(() => {
    const input = document.getElementById('collection-search') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect
    .poll(async () => sidepanel.locator('#collection-modal .collection-card').count(), {
      timeout: 3_000,
    })
    .toBe(3);
});
