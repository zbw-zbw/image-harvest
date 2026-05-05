// e2e: clicking the download progress modal's cancel button
// (#btn-progress-close) aborts an in-flight zip-download via the
// callback registered in actions.ts L334:
//
//   showProgress('Downloading...', () => {
//     aborted = true;
//     showToast('Download cancelled', 'info');
//   });
//
// The zip pipeline checks `if (aborted) return;` at the top of every
// loop iteration AND before chrome.downloads.download fires at the
// end — so a fast cancel must satisfy two contracts:
//   1. modal closes (state.downloadProgress.visible flips false →
//      <DownloadProgressModal> re-renders with .hidden).
//   2. zero chrome.downloads.download calls land — the user
//      explicitly bailed, no zip should be saved.
//
// Race control: a real fetch over fast network would resolve faster
// than Playwright can sample the modal and click cancel. We stub
// window.fetch with a 50ms delay per request — enough that 50
// images take ~2.5s to zip, giving the test a comfortable window
// to click cancel after seeing the modal open.
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

test('clicking #btn-progress-close mid-download closes the modal, fires the abort toast, and emits zero downloads', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    stubDownloads: true,
  });

  // Slow-fetch stub so the zip loop runs long enough for us to race
  // the cancel click. Without the delay 50 in-memory images zip in
  // <50ms — faster than the test can sample the modal.
  await sidepanel.evaluate(() => {
    const tinyPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    window.fetch = (() => {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(
            new Response(tinyPng, {
              status: 200,
              headers: { 'Content-Type': 'image/png' },
            })
          );
        }, 50);
      });
    }) as typeof window.fetch;
  });

  // Seed 50 synthetic images + Pro user + select all. We use 50 (not
  // 150) to stay under the 100-image "Download Many Images" warning
  // dialog so that path doesn't intercept and we go straight into the
  // zip pipeline + showProgress.
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
      store: { set: (k: string, v: unknown) => void };
      applyFilters: () => void;
    }
    const w = window as unknown as { __IH__: IH };
    const synthetic: ImageItem[] = Array.from({ length: 50 }, (_, i) => ({
      id: `synthetic-${i}`,
      url: `https://example.com/img-${i}.png`,
      naturalWidth: 200,
      naturalHeight: 200,
      displayWidth: 200,
      displayHeight: 200,
      estimatedSize: 1024,
      format: 'png',
    }));
    w.__IH__.store.set('isProUser', true);
    w.__IH__.store.set('allImages', synthetic);
    w.__IH__.applyFilters();
    w.__IH__.store.set('selectedImages', new Set(synthetic.map((i) => i.id)));
  });

  // Trigger the zip download.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-download')?.click();
  });

  // Progress modal opens within ~1s (jszip lazy-import + first
  // showProgress call).
  await expect(sidepanel.locator('#progress-modal')).not.toHaveClass(/hidden/, {
    timeout: 5_000,
  });

  // Wait until the loop has progressed past the first few items so
  // we know we're really racing an in-flight zip and not the empty
  // "before-loop" branch. We poll downloadProgress.current > 1.
  await expect
    .poll(
      async () =>
        sidepanel.evaluate(() => {
          interface IH {
            store: {
              get: (k: 'downloadProgress') => { current?: number };
            };
          }
          const w = window as unknown as { __IH__: IH };
          return w.__IH__.store.get('downloadProgress').current ?? 0;
        }),
      { timeout: 3_000 }
    )
    .toBeGreaterThan(1);

  // Click cancel.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-progress-close')?.click();
  });

  // Modal closes.
  await expect(sidepanel.locator('#progress-modal')).toHaveClass(/hidden/, {
    timeout: 2_000,
  });

  // Abort toast surfaces.
  await expect(sidepanel.locator('.toast').last()).toContainText('Download cancelled', {
    timeout: 2_000,
  });

  // Critical contract: zero chrome.downloads.download calls landed.
  // Wait long enough for any straggling pre-abort iteration to
  // finish (50ms per image × a few more iterations + zip finalize),
  // then re-check.
  await sidepanel.waitForTimeout(1_500);
  expect(await readDownloadCalls(sidepanel)).toHaveLength(0);
});
