// e2e: scan-cancel during a real in-flight scan — pins both
// handleScanCancel (sidepanel/scan.ts L25) and the message.ts
// branching that depends on state.isScanning.
//
// e2e/scan-cancel.e2e.ts already covers the easy "drive overlay
// visible + click cancel" surface. What was missing:
//   - the scanning-branch IMAGES_DISCOVERED contract (message.ts
//     L83-130) — drives scanProgress.title to 'Found N images'
//     and increments scanDiscoveredCount/scanDiscoveredImages.
//   - the cancel-then-late-discovery contract — once cancel
//     flips isScanning=false, late IMAGES_DISCOVERED frames must
//     fall through to the live-monitor branch (L131) and NOT
//     re-touch scanProgress.title. A regression that forgot to
//     reset isScanning would silently keep painting "Found N"
//     into the (hidden) overlay forever.
//   - the with-images vs no-images split inside handleScanCancel
//     (scan.ts L33-38) — different toast copy + different
//     post-cancel screen.
//
// We drive the messaging side via __IH__.handleMessage (already
// exposed for the live-monitor spec), and the cancel itself by
// clicking #btn-scan-cancel. No real fetchImages call is started
// — that would race against the actual chrome.runtime + content
// script lifecycle, which the easy spec already pins.
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

interface IH {
  store: {
    get: <T = unknown>(k: string) => T;
    set: (k: string, v: unknown) => void;
  };
  handleMessage: (msg: unknown) => void;
}

interface ScanProgress {
  visible: boolean;
  title: string;
  current: number;
  total: number;
  currentUrl: string;
  indeterminate: boolean;
}

/**
 * Set up a synthetic in-flight scan: flip isScanning=true,
 * isFetching=true, scanAborted=false, scanProgress.visible=true.
 * Mirrors the state mutations fetchImages does at scan.ts L195-211
 * before its first await.
 */
async function startSyntheticScan(
  sidepanel: Awaited<ReturnType<typeof openSidepanelWithImages>>['sidepanel']
): Promise<void> {
  await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('isScanning', true);
    w.__IH__.store.set('isFetching', true);
    w.__IH__.store.set('scanAborted', false);
    w.__IH__.store.set('scanDiscoveredCount', 0);
    w.__IH__.store.set('scanDiscoveredImages', []);
    w.__IH__.store.set('scanProgress', {
      visible: true,
      title: 'Updating...',
      current: 0,
      total: 0,
      currentUrl: '',
      indeterminate: true,
    });
  });
}

test('scanning branch: in-flight IMAGES_DISCOVERED merges + drives scanProgress.title to "Found N images"', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  const beforeTotal = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<unknown[]>('allImages').length;
  });
  expect(beforeTotal).toBeGreaterThan(0);

  await startSyntheticScan(sidepanel);

  const tabId = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<number>('currentTabId');
  });

  // Dispatch a scanning-mode IMAGES_DISCOVERED frame.
  await sidepanel.evaluate((t) => {
    const w = window as unknown as { __IH__: IH };
    w.__IH__.handleMessage({
      type: 'IMAGES_DISCOVERED',
      fromTabId: t,
      images: [
        {
          id: 'inflight-1',
          url: 'https://inflight.example/scan-1.png',
          type: 'img',
          format: 'png',
          displayWidth: 200,
          displayHeight: 200,
          naturalWidth: 200,
          naturalHeight: 200,
          sourceDomain: 'inflight.example',
          checked: false,
          timestamp: Date.now(),
        },
        {
          id: 'inflight-2',
          url: 'https://inflight.example/scan-2.png',
          type: 'img',
          format: 'png',
          displayWidth: 200,
          displayHeight: 200,
          naturalWidth: 200,
          naturalHeight: 200,
          sourceDomain: 'inflight.example',
          checked: false,
          timestamp: Date.now(),
        },
      ],
    });
  }, tabId);

  // allImages grew by exactly 2 (dedup-by-url leaves both in).
  await expect
    .poll(
      async () =>
        sidepanel.evaluate(() => {
          const w = window as unknown as { __IH__: IH };
          return w.__IH__.store.get<unknown[]>('allImages').length;
        }),
      { timeout: 3_000 }
    )
    .toBe(beforeTotal + 2);

  // scanProgress.title flipped to 'Found N images' (scanning branch
  // L116-119). N here is the new total = beforeTotal + 2.
  const sp = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<ScanProgress>('scanProgress');
  });
  expect(sp.title).toBe(`Found ${beforeTotal + 2} images`);
  expect(sp.visible).toBe(true);

  // scanDiscoveredCount + scanDiscoveredImages both bumped by 2
  // (these are the dedup'd-irrespective counters that drive the
  // post-scan summary).
  const counters = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return {
      count: w.__IH__.store.get<number>('scanDiscoveredCount'),
      images: w.__IH__.store.get<unknown[]>('scanDiscoveredImages').length,
    };
  });
  expect(counters.count).toBe(2);
  expect(counters.images).toBe(2);
});

test('cancel with images: btn-scan-cancel sets all three flags + hides overlay + toasts the count', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  const total = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<unknown[]>('allImages').length;
  });
  expect(total).toBeGreaterThan(0);

  await startSyntheticScan(sidepanel);

  // Sanity: overlay visible.
  await expect(sidepanel.locator('#scan-overlay')).not.toHaveClass(/hidden/, {
    timeout: 2_000,
  });

  // Click cancel via DOM (avoids overlay click interception).
  await sidepanel.evaluate(() => {
    document.getElementById('btn-scan-cancel')?.click();
  });

  // All three flags reset (scan.ts L26-28).
  const flags = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return {
      scanAborted: w.__IH__.store.get<boolean>('scanAborted'),
      isScanning: w.__IH__.store.get<boolean>('isScanning'),
      isFetching: w.__IH__.store.get<boolean>('isFetching'),
      visible: w.__IH__.store.get<ScanProgress>('scanProgress').visible,
    };
  });
  expect(flags.scanAborted).toBe(true);
  expect(flags.isScanning).toBe(false);
  expect(flags.isFetching).toBe(false);
  expect(flags.visible).toBe(false);

  // Overlay hidden via the Preact projection of scanProgress.visible.
  await expect(sidepanel.locator('#scan-overlay')).toHaveClass(/hidden/, {
    timeout: 2_000,
  });

  // Toast surfaces with the existing count (scan.ts L33-34).
  await expect(sidepanel.locator('.toast').last()).toContainText(
    `Scan cancelled · ${total} images found`,
    { timeout: 2_000 }
  );
});

test('cancel with no images: btn-scan-cancel surfaces empty screen + plain toast', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Empty out allImages first to hit the no-images branch
  // (scan.ts L36-37).
  await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('allImages', []);
    w.__IH__.store.set('selectedImages', new Set());
  });

  await startSyntheticScan(sidepanel);

  await sidepanel.evaluate(() => {
    document.getElementById('btn-scan-cancel')?.click();
  });

  // showEmpty path → uiScreen flips to 'empty' → #empty-state visible.
  await expect(sidepanel.locator('#empty-state')).not.toHaveClass(/hidden/, {
    timeout: 2_000,
  });

  // Plain toast (no count suffix).
  await expect(sidepanel.locator('.toast').last()).toContainText('Scan cancelled', {
    timeout: 2_000,
  });
});

test('cancel-then-late-discovery: post-cancel IMAGES_DISCOVERED falls through to live-monitor branch (no scanProgress.title rewrite)', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  await startSyntheticScan(sidepanel);

  const tabId = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<number>('currentTabId');
  });

  // Cancel mid-scan.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-scan-cancel')?.click();
  });

  // Confirm the cancel landed before we send the late frame —
  // otherwise the assertion below is racy.
  await expect
    .poll(
      async () =>
        sidepanel.evaluate(() => {
          const w = window as unknown as { __IH__: IH };
          return w.__IH__.store.get<boolean>('isScanning');
        }),
      { timeout: 2_000 }
    )
    .toBe(false);

  // Snapshot scanProgress.title right after cancel — handleScanCancel
  // doesn't touch the title, only visible. We capture this so the
  // post-discovery assertion can verify it didn't change.
  const titleAfterCancel = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<ScanProgress>('scanProgress').title;
  });

  const beforeTotal = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<unknown[]>('allImages').length;
  });

  // Now dispatch a late IMAGES_DISCOVERED — simulates a content
  // script frame that the background SW had buffered before the
  // cancel landed.
  await sidepanel.evaluate((t) => {
    const w = window as unknown as { __IH__: IH };
    w.__IH__.handleMessage({
      type: 'IMAGES_DISCOVERED',
      fromTabId: t,
      images: [
        {
          id: 'late-1',
          url: 'https://inflight.example/late.png',
          type: 'img',
          format: 'png',
          displayWidth: 200,
          displayHeight: 200,
          naturalWidth: 200,
          naturalHeight: 200,
          sourceDomain: 'inflight.example',
          checked: false,
          timestamp: Date.now(),
        },
      ],
    });
  }, tabId);

  // allImages still grows (live-monitor branch L131-159 runs). This
  // is intentional — the new discovery is real, just not 'part of
  // the cancelled scan' anymore.
  await expect
    .poll(
      async () =>
        sidepanel.evaluate(() => {
          const w = window as unknown as { __IH__: IH };
          return w.__IH__.store.get<unknown[]>('allImages').length;
        }),
      { timeout: 3_000 }
    )
    .toBe(beforeTotal + 1);

  // CRITICAL: scanProgress.title did NOT get rewritten to
  // "Found N images". A regression that forgot to flip isScanning
  // back to false would silently keep painting that string into
  // the (hidden) overlay every time a late frame arrives.
  const titleAfterLate = await sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<ScanProgress>('scanProgress').title;
  });
  expect(titleAfterLate).toBe(titleAfterCancel);
  expect(titleAfterLate).not.toMatch(/^Found \d+ images$/);
});
