// e2e: clicking the per-card copy-url (📋) button writes the image URL
// to the system clipboard and surfaces a success toast.
//
// handleCopyUrl (ImageCard.tsx) flow:
//   1. e.stopPropagation() (don't toggle card selection)
//   2. copyImageUrl(img.url) (actions.ts L472):
//      - await navigator.clipboard.writeText(url)
//      - showToast('URL copied!', 'success')   on success
//      - showToast('Failed to copy URL', 'error')   on rejection
//
// Why stub navigator.clipboard rather than grant browser permissions?
// The sidepanel runs at chrome-extension://<id>/sidepanel/sidepanel.html.
// Playwright's BrowserContext.grantPermissions rejects this origin as
// opaque ("Permission can't be granted to opaque origins"), so the
// real clipboard API isn't writable in headed Chromium. Stubbing
// navigator.clipboard and recording every writeText call is the
// idiomatic alternative — same pattern as readDownloadCalls for
// chrome.downloads.download.
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

test('clicking the copy-url button writes the image URL to the clipboard and shows a toast', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Install a clipboard stub on the sidepanel page. Records every
  // writeText() call into window.__IH_CLIPBOARD_CALLS__ so we can
  // assert what got written without relying on the (opaque-origin-
  // gated) browser clipboard API.
  await sidepanel.evaluate(() => {
    interface ClipboardWindow extends Window {
      __IH_CLIPBOARD_CALLS__?: string[];
    }
    const w = window as ClipboardWindow;
    w.__IH_CLIPBOARD_CALLS__ = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          w.__IH_CLIPBOARD_CALLS__!.push(text);
          return Promise.resolve();
        },
      },
    });
  });

  // Capture the first card's URL before the click — this is what we
  // expect to land in the clipboard.
  const firstUrl = await sidepanel.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>('#image-grid .image-card img');
    return img?.src ?? '';
  });
  expect(firstUrl).toBeTruthy();

  // Click the first card's copy-url button.
  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('#image-grid .image-card .btn-copy-url')?.click();
  });

  // copyImageUrl awaits writeText (now resolved by stub) → records the
  // arg → showToast fires.
  await expect
    .poll(
      async () =>
        sidepanel.evaluate(() => {
          const w = window as Window & { __IH_CLIPBOARD_CALLS__?: string[] };
          return w.__IH_CLIPBOARD_CALLS__ ?? [];
        }),
      { timeout: 5_000 }
    )
    .toEqual([firstUrl]);

  // showToast('URL copied!', 'success') renders into #toast-container.
  await expect(sidepanel.locator('#toast-container')).toContainText(/URL copied/i, {
    timeout: 2_000,
  });
});
