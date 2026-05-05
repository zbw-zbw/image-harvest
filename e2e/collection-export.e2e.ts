// e2e: the #btn-collection-export button inside the collection modal
// runs collection-ui.ts > exportCollection, which lazy-loads jszip,
// fetches every collection item, packs them into a folder named
// "collection/" and ships one chrome.downloads.download call.
//
// Two cases pin both branches:
//   - empty collection → 'Collection is empty' toast surfaces and
//     ZERO chrome.downloads.download calls land. The progress modal
//     never opens (the empty-check at L210 returns before
//     showProgress fires).
//   - non-empty collection (2 items) → showProgress opens the
//     #progress-modal → jszip fetches both urls (stubbed fetch so
//     the pipeline finishes in <1s) → exactly one
//     chrome.downloads.download call lands with a blob: URL +
//     `collection-*.zip` filename → 'Collection exported' toast →
//     #progress-modal hides via the finally block.
import { test, expect } from '@playwright/test';
import {
  launchExtension,
  openSidepanelWithImages,
  readDownloadCalls,
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

/** Open the collection modal so #btn-collection-export becomes clickable. */
async function openCollectionModal(
  sidepanel: Awaited<ReturnType<typeof openSidepanelWithImages>>['sidepanel']
): Promise<void> {
  await sidepanel.evaluate(() => {
    document.getElementById('btn-collection')?.click();
  });
  await expect(sidepanel.locator('#collection-modal')).not.toHaveClass(/hidden/, {
    timeout: 5_000,
  });
}

test('Pro user with empty collection → clicking Export surfaces the empty toast and emits no downloads', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
    stubDownloads: true,
  });

  await openCollectionModal(sidepanel);

  // Empty state visible (no .collection-card rendered).
  await expect(sidepanel.locator('#collection-modal .collection-card')).toHaveCount(0);
  await expect(sidepanel.locator('#collection-modal .collection-empty')).toBeVisible();

  // Click export.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-collection-export')?.click();
  });

  // 'Collection is empty' toast.
  await expect(sidepanel.locator('.toast').last()).toContainText('Collection is empty', {
    timeout: 3_000,
  });

  // Progress modal NEVER opened (the early-return at L210 fires
  // before showProgress).
  await expect(sidepanel.locator('#progress-modal')).toHaveClass(/hidden/);

  // Zero downloads.
  await sidepanel.waitForTimeout(500);
  expect(await readDownloadCalls(sidepanel)).toHaveLength(0);
});

test('Pro user with 2 collection items → Export packs them into a `collection-*.zip` and fires one chrome.downloads.download', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
    stubDownloads: true,
  });

  // Stub fetch BEFORE seeding so the export pipeline doesn't try to
  // hit https://example.com/* (which hangs for tens of seconds).
  await sidepanel.evaluate(() => {
    const tinyPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    window.fetch = (() => {
      return Promise.resolve(
        new Response(tinyPng, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      );
    }) as typeof window.fetch;
  });

  // Seed: favorite the first two cards into the collection.
  const firstFavBtn = sidepanel.locator('#image-grid .image-card .btn-favorite').first();
  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('#image-grid .image-card .btn-favorite')?.click();
  });
  await expect(firstFavBtn).toHaveClass(/favorited/, { timeout: 5_000 });

  await sidepanel.evaluate(() => {
    const cards = document.querySelectorAll<HTMLElement>('#image-grid .image-card .btn-favorite');
    cards[1]?.click();
  });
  await expect(sidepanel.locator('#image-grid .image-card .btn-favorite.favorited')).toHaveCount(
    2,
    { timeout: 5_000 }
  );

  await openCollectionModal(sidepanel);

  // Both rows rendered.
  await expect
    .poll(async () => sidepanel.locator('#collection-modal .collection-card').count(), {
      timeout: 5_000,
    })
    .toBe(2);

  // Click export.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-collection-export')?.click();
  });

  // Wait for the chrome.downloads.download call. Stubbed fetch makes
  // 2-item zip finish well under 5s including the lazy jszip chunk
  // import (~150kb gzipped before parse).
  await expect
    .poll(async () => (await readDownloadCalls(sidepanel)).length, {
      timeout: 15_000,
    })
    .toBe(1);

  const [call] = await readDownloadCalls(sidepanel);
  expect(call.url).toMatch(/^blob:/);
  expect(call.filename).toMatch(/^collection-.*\.zip$/);
  expect(call.saveAs).toBe(false);

  // Success toast.
  await expect(sidepanel.locator('.toast').last()).toContainText('Collection exported', {
    timeout: 3_000,
  });

  // Progress modal closes via the finally block.
  await expect(sidepanel.locator('#progress-modal')).toHaveClass(/hidden/, {
    timeout: 3_000,
  });
});
