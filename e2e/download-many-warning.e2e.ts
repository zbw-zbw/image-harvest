// e2e: actions.ts L323 — when a user tries to download more than
// 100 images at once, we surface a confirm dialog ("Download Many
// Images") to give them an explicit "yes I really do want a 200-file
// zip" gate. The dialog is suppressed when state.appSettings
// .noManyFilesWarning is true (set via a checkbox in Settings).
//
// Two branches:
//   - confirm → continues into the JSZip pipeline → exactly one
//     chrome.downloads.download call lands with a blob: URL +
//     .zip filename.
//   - cancel  → returns early → no download call.
//
// Test setup:
//   - Pro user (free tier hits FREE_LIMITS.MAX_ZIP_IMAGES first and
//     would short-circuit into ProUpgradeModal before our dialog).
//   - 150 synthetic images injected via store.setMany — bypasses the
//     real scan pipeline so we don't have to hand-author a fixture
//     with 100+ <img> tags. We then call applyFilters() so they
//     populate state.filteredImages, since downloadSelectedAsZip
//     reads selected = filteredImages.filter(selectedImages.has).
//   - selectedImages set to all 150 ids.
//   - stubDownloads so the asserted chrome.downloads.download is
//     captured instead of polluting the user's Downloads folder.
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

/**
 * Inject 150 synthetic images into the store and select them all,
 * then click the toolbar's Download button to trigger the > 100
 * warning path.
 */
async function seedManyAndClickDownload(
  sidepanel: Awaited<ReturnType<typeof openSidepanelWithImages>>['sidepanel']
): Promise<void> {
  await sidepanel.waitForFunction(() =>
    Boolean((window as unknown as { __IH__?: unknown }).__IH__)
  );
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
    interface IH {
      store: {
        get: (k: 'appSettings') => Record<string, unknown>;
        set: (k: string, v: unknown) => void;
      };
      applyFilters: () => void;
    }
    const w = window as unknown as { __IH__: IH };

    const synthetic: ImageItem[] = Array.from({ length: 150 }, (_, i) => ({
      id: `synthetic-${i}`,
      url: `https://example.com/img-${i}.png`,
      naturalWidth: 200,
      naturalHeight: 200,
      displayWidth: 200,
      displayHeight: 200,
      estimatedSize: 1024,
      format: 'png',
    }));

    // Make sure the warning isn't suppressed by a stale setting from
    // a previous test run sharing this user-data-dir.
    const appSettings = { ...w.__IH__.store.get('appSettings'), noManyFilesWarning: false };
    w.__IH__.store.set('appSettings', appSettings);

    w.__IH__.store.set('isProUser', true);
    w.__IH__.store.set('allImages', synthetic);
    w.__IH__.applyFilters();
    w.__IH__.store.set('selectedImages', new Set(synthetic.map((i) => i.id)));
  });

  // Trigger the download. The Download button hits downloadSelectedAsZip
  // when the selection has 2+ images.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-download')?.click();
  });

  // Wait for the warning dialog to actually open (it's the title that
  // disambiguates from any other confirm dialog).
  await expect(sidepanel.locator('#confirm-dialog')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });
  await expect(sidepanel.locator('#confirm-dialog-title')).toHaveText('Download Many Images', {
    timeout: 1_000,
  });
  await expect(sidepanel.locator('#confirm-dialog-message')).toContainText('150');
}

test('selecting >100 images and clicking Download opens the warning dialog; confirming proceeds to a single .zip download', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    stubDownloads: true,
  });

  // Stub window.fetch BEFORE seeding so the JSZip pipeline doesn't
  // actually walk out to https://example.com/img-N.png 150 times
  // (which can take minutes per request before timing out and would
  // dominate the test runtime). We return a tiny in-memory blob for
  // every request so zip building finishes in ~1s.
  await sidepanel.evaluate(() => {
    const tinyPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // "‰PNG" — enough for jszip.file
    window.fetch = (() => {
      return Promise.resolve(
        new Response(tinyPng, { status: 200, headers: { 'Content-Type': 'image/png' } })
      );
    }) as typeof window.fetch;
  });

  await seedManyAndClickDownload(sidepanel);

  // Click Download (confirm button).
  await sidepanel.evaluate(() => {
    document.getElementById('confirm-dialog-confirm')?.click();
  });

  // The JSZip pipeline runs and emits exactly one chrome.downloads
  // .download call with a blob: URL + .zip filename. The stubbed
  // fetch resolves instantly so 150 images zip in a few seconds
  // including the lazy jszip chunk import.
  await expect
    .poll(async () => (await readDownloadCalls(sidepanel)).length, {
      timeout: 30_000,
    })
    .toBe(1);

  const [call] = await readDownloadCalls(sidepanel);
  expect(call.url).toMatch(/^blob:/);
  expect(call.filename).toMatch(/\.zip$/);
});

test('selecting >100 images and clicking Download opens the warning dialog; cancelling fires no download', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    stubDownloads: true,
  });

  await seedManyAndClickDownload(sidepanel);

  // Click Cancel.
  await sidepanel.evaluate(() => {
    document.getElementById('confirm-dialog-cancel')?.click();
  });

  // Dialog should close.
  await expect(sidepanel.locator('#confirm-dialog')).toHaveClass(/hidden/, {
    timeout: 2_000,
  });

  // Give the download path a chance to misfire — and assert it didn't.
  await sidepanel.waitForTimeout(800);
  expect(await readDownloadCalls(sidepanel)).toHaveLength(0);
});
