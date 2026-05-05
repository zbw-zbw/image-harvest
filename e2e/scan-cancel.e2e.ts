// e2e: clicking the scan-overlay's cancel button (#btn-scan-cancel)
// aborts an in-flight scan via scan.ts > handleScanCancel.
//
// Contract (scan.ts L25-40):
//   - state.scanAborted flips false → true (so fetchImages /
//     rescanWithProgress can detect the abort after their awaited
//     sendMessage resolves and stop pushing more images).
//   - state.isScanning + state.isFetching flip false (clears the
//     in-flight guards so the user can immediately retry).
//   - hideScanOverlay() flips state.scanProgress.visible → false
//     (ScanProgressOverlay re-renders with the .hidden class).
//   - hideLoading() collapses the loading state.
//   - If allImages has anything → applyFilters + 'Scan cancelled · N
//     images found' toast. Otherwise → showEmpty + 'Scan cancelled'.
//
// Setup: a static fixture's scan completes faster than Playwright
// can race the cancel click, so we drive state directly to put the
// app in a "scan in progress" state with images already discovered,
// then exercise the cancel path. This pins handleScanCancel's
// observable contract end-to-end without needing a custom slow-scan
// fixture.
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

test('clicking #btn-scan-cancel hides the overlay, flips scanAborted, and clears in-flight guards', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  await sidepanel.waitForFunction(() =>
    Boolean((window as unknown as { __IH__?: unknown }).__IH__)
  );

  // Force a "scan in progress" state. We keep the existing
  // allImages so handleScanCancel takes the 'images found' branch
  // (applyFilters + per-count toast) — exercising the more
  // interesting path. The empty-grid branch is symmetric.
  await sidepanel.evaluate(() => {
    interface IH {
      store: {
        get: (k: string) => unknown;
        set: (k: string, v: unknown) => void;
      };
    }
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('isScanning', true);
    w.__IH__.store.set('isFetching', true);
    w.__IH__.store.set('scanAborted', false);
    w.__IH__.store.set('scanProgress', {
      visible: true,
      indeterminate: false,
      title: 'Scanning...',
      current: 3,
      total: 10,
      currentUrl: 'https://example.com/img-3.png',
    });
  });

  // Overlay is now visible.
  await expect(sidepanel.locator('#scan-overlay')).not.toHaveClass(/hidden/, {
    timeout: 2_000,
  });
  await expect(sidepanel.locator('#btn-scan-cancel')).toBeVisible();

  // Click cancel. evaluate() is enough — the click handler is bound
  // imperatively in init.ts L924 to the #btn-scan-cancel id and
  // doesn't care whether the click came from a real pointer event.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-scan-cancel')?.click();
  });

  // Overlay collapses (state.scanProgress.visible → false →
  // ScanProgressOverlay re-renders with .hidden).
  await expect(sidepanel.locator('#scan-overlay')).toHaveClass(/hidden/, {
    timeout: 2_000,
  });

  // State contract: scanAborted true; isScanning + isFetching false.
  const stateAfter = await sidepanel.evaluate(() => {
    interface IH {
      store: {
        get: (k: 'scanAborted' | 'isScanning' | 'isFetching') => boolean;
      };
    }
    const w = window as unknown as { __IH__: IH };
    return {
      scanAborted: w.__IH__.store.get('scanAborted'),
      isScanning: w.__IH__.store.get('isScanning'),
      isFetching: w.__IH__.store.get('isFetching'),
    };
  });
  expect(stateAfter).toEqual({
    scanAborted: true,
    isScanning: false,
    isFetching: false,
  });

  // Toast surfaces with the 'images found' suffix because we kept
  // allImages populated. The toast container id is #toast-container
  // and individual toasts have class .toast.
  await expect(sidepanel.locator('.toast').last()).toContainText('Scan cancelled', {
    timeout: 2_000,
  });
});
