// e2e: selecting exactly one image and clicking the toolbar download
// button routes through downloadSingle (NOT downloadSelectedAsZip).
//
// init.ts L590 branches on imagesToDownload.length === 1: single → call
// downloadSingle (no zipping, original URL passed straight to
// chrome.downloads.download); >=2 → call downloadSelectedAsZip (lazy
// jszip + blob:). This test pins the single-item branch.
//
// Pairs with download-zip.e2e.ts which pins the multi-item branch.
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

test('selecting exactly one image + clicking download triggers a single non-zip download with the original URL', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    stubDownloads: true,
  });

  await sidepanel.waitForFunction(() =>
    Boolean((window as unknown as { __IH__?: unknown }).__IH__)
  );

  // Select exactly the first card. We drive selection through the store
  // (same pattern as download-zip.e2e.ts) for determinism.
  const firstUrl = await sidepanel.evaluate(() => {
    interface ImageItem {
      id: string;
      url: string;
    }
    interface IH {
      store: {
        get: (k: 'filteredImages') => ImageItem[] | undefined;
        set: (k: 'selectedImages', v: Set<string>) => void;
      };
    }
    const w = window as unknown as { __IH__: IH };
    const filtered = w.__IH__.store.get('filteredImages') as ImageItem[];
    const first = filtered[0];
    w.__IH__.store.set('selectedImages', new Set([first.id]));
    return first.url;
  });
  expect(firstUrl).toBeTruthy();

  // Trigger the toolbar download. With exactly one selected image,
  // init.ts L590 routes to downloadSingle.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-download')?.click();
  });

  // downloadSingle runs synchronously (no jszip, no awaiting blob fetch
  // when format is null). We still poll just in case the chrome.storage
  // round-trip in getActivePageInfo / generateFilename takes a tick.
  await expect
    .poll(async () => (await readDownloadCalls(sidepanel)).length, { timeout: 5_000 })
    .toBe(1);

  const [call] = await readDownloadCalls(sidepanel);
  // Original URL passed straight through — NOT a blob: URL (which would
  // indicate the zip path was taken by mistake).
  expect(call.url).toBe(firstUrl);
  expect(call.url).not.toMatch(/^blob:/);
  // Filename comes from generateFilename, which always emits SOMETHING
  // non-empty. Don't pin the exact format (it depends on user settings).
  expect(call.filename).toBeTruthy();
  expect(call.saveAs).toBe(false);
});
