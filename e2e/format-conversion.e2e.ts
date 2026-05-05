// e2e: download-format dropdown (#download-dropdown) gates non-original
// formats behind Pro and routes Pro users into downloadSelectedAsZip
// with the chosen format string.
//
// Flow (init.ts L599-643):
//   1. Click #btn-download-toggle → toggleDownloadDropdown removes
//      .hidden from #download-dropdown.
//   2. Click a .dropdown-item with [data-format="png|jpg|webp"]:
//        - free user → showToast 'Format conversion is a Pro feature'
//          + showProUpgradeModal + hideDownloadDropdown, no download.
//        - Pro user → set the format as the active dropdown item,
//          route through downloadSingle/downloadSelectedAsZip with
//          convertFormat = the chosen string. With ≥2 selected images
//          → downloadSelectedAsZip, which lazy-loads jszip and emits
//          one chrome.downloads.download call with a blob: URL +
//          .zip filename.
//
// data-format="original" stays free for everyone (not gated).
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

test('free user picking PNG from the format dropdown opens the upgrade modal (no download)', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    stubDownloads: true,
  });

  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);

  // Open the dropdown.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-download-toggle')?.click();
  });
  await expect(sidepanel.locator('#download-dropdown')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });

  // Pick PNG (Pro-gated for free users).
  await sidepanel.evaluate(() => {
    document
      .querySelector<HTMLElement>('#download-dropdown .dropdown-item[data-format="png"]')
      ?.click();
  });

  // Pro upgrade modal opens, dropdown auto-hides, no download fired.
  await expect(sidepanel.locator('#pro-upgrade-modal')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });
  await expect(sidepanel.locator('#download-dropdown')).toHaveClass(/hidden/);
  await sidepanel.waitForTimeout(300);
  expect(await readDownloadCalls(sidepanel)).toHaveLength(0);
});

test('Pro user picking JPG from the format dropdown triggers a single .zip download', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
    stubDownloads: true,
  });

  await sidepanel.waitForFunction(() =>
    Boolean((window as unknown as { __IH__?: unknown }).__IH__)
  );

  // Seed a 2-image selection so the multi-image branch fires.
  await sidepanel.evaluate(() => {
    interface ImageItem {
      id: string;
    }
    interface IH {
      store: {
        get: (k: 'filteredImages') => ImageItem[] | undefined;
        set: (k: 'selectedImages', v: Set<string>) => void;
      };
    }
    const w = window as unknown as { __IH__: IH };
    const filtered = w.__IH__.store.get('filteredImages') as ImageItem[];
    w.__IH__.store.set('selectedImages', new Set(filtered.slice(0, 2).map((i) => i.id)));
  });

  await sidepanel.evaluate(() => {
    document.getElementById('btn-download-toggle')?.click();
  });
  await expect(sidepanel.locator('#download-dropdown')).not.toHaveClass(/hidden/);

  await sidepanel.evaluate(() => {
    document
      .querySelector<HTMLElement>('#download-dropdown .dropdown-item[data-format="jpg"]')
      ?.click();
  });

  // ProUpgradeModal must NOT open for Pro users.
  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);

  // Wait for the zip download.
  await expect
    .poll(async () => (await readDownloadCalls(sidepanel)).length, { timeout: 8_000 })
    .toBe(1);

  const [call] = await readDownloadCalls(sidepanel);
  expect(call.url).toMatch(/^blob:/);
  expect(call.filename).toMatch(/\.zip$/);

  // The picked item gets the .active class (visual feedback).
  await expect(
    sidepanel.locator('#download-dropdown .dropdown-item[data-format="jpg"]')
  ).toHaveClass(/active/);
});
