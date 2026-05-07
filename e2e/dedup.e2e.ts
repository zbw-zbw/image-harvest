// e2e: opening the dedup modal should render one .dedup-group block per
// SimilarGroup that we seed into the store, with the right number of
// .dedup-image children.
//
// We seed similarGroups directly via window.__IH__.store.set(...) instead
// of running the real perceptual-hash pipeline — the goal is to verify the
// modal-rendering contract, not to re-test pHash. The dedup chunk is
// lazy-loaded (sidepanel/pro-features.ts > showDedupModal does
// `await import('./dedup-ui')`), so we use expect.poll to wait for the
// first .dedup-group to appear instead of asserting synchronously.
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
 * Wait for window.__IH__ (set up by sidepanel/init.ts when __IH_E2E__ is on)
 * to be ready. The hook is installed via a dynamic import so it lands one
 * microtask after init runs.
 */
async function waitForIHHook(sidepanel: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(() =>
      sidepanel.evaluate(() => {
        const w = window as unknown as { __IH__?: unknown };
        return Boolean(w.__IH__);
      })
    )
    .toBe(true);
}

test('dedup modal renders one group per SimilarGroup with correct image counts', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);
  await waitForIHHook(sidepanel);

  // Seed two similar-image groups (3 + 2 images). The Similar button is
  // now always visible in the status bar (no hidden wrapper), so we only
  // need to populate the store — no manual class toggling required.
  await sidepanel.evaluate(() => {
    interface ImageItem {
      id: string;
      url: string;
    }
    interface IH {
      store: { set: (key: 'similarGroups', value: ImageItem[][]) => void };
    }
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('similarGroups', [
      [
        { id: 'sim-a-1', url: 'https://example.com/a1.png' },
        { id: 'sim-a-2', url: 'https://example.com/a2.png' },
        { id: 'sim-a-3', url: 'https://example.com/a3.png' },
      ],
      [
        { id: 'sim-b-1', url: 'https://example.com/b1.png' },
        { id: 'sim-b-2', url: 'https://example.com/b2.png' },
      ],
    ]);
  });

  // Trigger the dedup button via direct DOM .click(). The Similar button
  // is now always visible in the status bar — no hidden ancestor to bypass.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-dedup')?.click();
  });

  // dedup-ui chunk loads + renders. Wait for the first group to appear.
  await expect
    .poll(() => sidepanel.locator('#dedup-body .dedup-group').count(), { timeout: 5_000 })
    .toBe(2);

  const groups = sidepanel.locator('#dedup-body .dedup-group');
  await expect(groups.nth(0).locator('.dedup-image')).toHaveCount(3);
  await expect(groups.nth(1).locator('.dedup-image')).toHaveCount(2);

  // Group title shows the count too — sanity check the human-visible text.
  await expect(groups.nth(0).locator('.dedup-group-title')).toContainText('3 similar');
  await expect(groups.nth(1).locator('.dedup-group-title')).toContainText('2 similar');
});

test('dedup modal shows empty message when similarGroups is empty', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);
  await waitForIHHook(sidepanel);

  // Make sure no similarGroups are seeded (default state is []). The
  // Similar button is always visible — no hidden wrapper to toggle.
  await sidepanel.evaluate(() => {
    interface IH {
      store: { set: (key: 'similarGroups', value: unknown[]) => void };
    }
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('similarGroups', []);
  });

  // Direct DOM click on the always-visible Similar button.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-dedup')?.click();
  });

  // dedup-ui's empty branch writes a single <p class="empty-message"> into
  // #dedup-body. Wait for it to appear (lazy-loaded chunk).
  await expect(sidepanel.locator('#dedup-body .empty-message')).toBeVisible({
    timeout: 5_000,
  });
  await expect(sidepanel.locator('#dedup-body .empty-message')).toContainText(/no similar/i);
});
