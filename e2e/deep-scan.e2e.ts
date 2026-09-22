// e2e: deep scan (v1.2.0) — the full auto-scroll pipeline against a
// lazy-loading fixture:
//   click #btn-deep-scan → START_DEEP_SCAN → content auto-scrolls → the
//   fixture appends image batches on scroll → final extract merges.
//
// Free-tier quota is daily (3/day). Case B exhausts it by pre-writing
// chrome.storage.local (featureQuota.daily.<UTC today>.deepScan = 3) —
// the same key shared/feature-quota.ts reads, so the gate fires without
// clicking through 3 real runs.
import { test, expect, type Page } from '@playwright/test';
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

interface IHStore {
  store: { get: <T = unknown>(k: string) => T };
}

async function allImagesCount(sidepanel: Page): Promise<number> {
  return sidepanel.evaluate(() => {
    const w = window as unknown as { __IH__?: IHStore };
    return (w.__IH__?.store.get('allImages') as unknown[] | undefined)?.length ?? -1;
  });
}

/** Pre-write today's UTC daily record with the deep-scan quota exhausted. */
async function exhaustDeepScanQuota(sidepanel: Page): Promise<void> {
  await sidepanel.evaluate(async () => {
    const d = new Date();
    const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
      d.getUTCDate()
    ).padStart(2, '0')}`;
    // 'featureQuota' === STORAGE_KEYS.FEATURE_QUOTA (shared/constants.ts).
    await chrome.storage.local.set({
      featureQuota: {
        monthly: {},
        daily: { [day]: { batchHighlight: 0, deepScan: 3 } },
      },
    });
  });
}

test('A: free user — deep scan discovers lazy-loaded images beyond the initial scan', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    fixture: 'page-lazy-scroll.html',
  });
  const initial = await allImagesCount(sidepanel);
  expect(initial).toBeGreaterThanOrEqual(5);

  await sidepanel.evaluate(() => {
    document.getElementById('btn-deep-scan')?.click();
  });

  // The run scrolls ~4-6 steps; generous timeout covers slow CI machines.
  await sidepanel.waitForFunction(
    (min) => {
      const w = window as unknown as { __IH__?: IHStore };
      const imgs = w.__IH__?.store.get('allImages') as unknown[] | undefined;
      return (imgs?.length ?? 0) >= min;
    },
    initial + 6,
    { timeout: 60_000 }
  );

  const final = await allImagesCount(sidepanel);
  expect(final).toBeGreaterThanOrEqual(initial + 6);

  // Completion toast mentions the deep-scan delta (en locale default).
  await expect(
    sidepanel.locator('#toast-container .toast').filter({ hasText: /new/i })
  ).toBeVisible({ timeout: 5_000 });

  // No wall for the first run of the day.
  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);
});

test('B: free user at daily quota → Pro upgrade wall with deep_scan copy, no scan runs', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    fixture: 'page-lazy-scroll.html',
  });
  const initial = await allImagesCount(sidepanel);
  await exhaustDeepScanQuota(sidepanel);

  await sidepanel.evaluate(() => {
    document.getElementById('btn-deep-scan')?.click();
  });

  await expect(sidepanel.locator('#pro-upgrade-modal')).not.toHaveClass(/hidden/, {
    timeout: 5_000,
  });
  // Wall headline is the deep_scan copy (i18n: pro_wall_headline_deep_scan).
  await expect(sidepanel.locator('#pro-upgrade-modal')).toContainText(/lazy/i);
  // Daily-exhausted toast wording (quota_exhausted_daily).
  await expect(
    sidepanel.locator('#toast-container .toast').filter({ hasText: /per day/i })
  ).toBeVisible({ timeout: 3_000 });

  // No scan ran: image list untouched.
  expect(await allImagesCount(sidepanel)).toBe(initial);
});

test('C: Pro user at exhausted quota → NO wall, deep scan runs', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    fixture: 'page-lazy-scroll.html',
    enablePro: true,
  });
  const initial = await allImagesCount(sidepanel);
  await exhaustDeepScanQuota(sidepanel); // Pro bypasses the gate entirely

  await sidepanel.evaluate(() => {
    document.getElementById('btn-deep-scan')?.click();
  });

  await sidepanel.waitForFunction(
    (min) => {
      const w = window as unknown as { __IH__?: IHStore };
      const imgs = w.__IH__?.store.get('allImages') as unknown[] | undefined;
      return (imgs?.length ?? 0) >= min;
    },
    initial + 6,
    { timeout: 60_000 }
  );
  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);
});

test('D: cancel mid-scan keeps already-discovered images', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    fixture: 'page-lazy-scroll.html',
  });
  const initial = await allImagesCount(sidepanel);

  // chrome.storage.local is shared extension-wide: case B/C pre-wrote an
  // exhausted daily record, which would make THIS free-user run hit the
  // quota wall instead of scanning. Reset it so the gate opens.
  await sidepanel.evaluate(async () => {
    await chrome.storage.local.remove('featureQuota');
  });

  await sidepanel.evaluate(() => {
    document.getElementById('btn-deep-scan')?.click();
  });

  // Wait for the scan overlay, give the scroll a beat to start, then cancel.
  // (Plan said `scanProgress !== undefined`, but scanProgress is ALWAYS an
  // object — initial value { visible: false, ... } — so that condition was
  // immediately true and never actually waited. Wait for visible===true.)
  await sidepanel.waitForFunction(
    () => {
      const w = window as unknown as { __IH__?: IHStore };
      return (
        (w.__IH__?.store.get('scanProgress') as { visible?: boolean } | undefined)?.visible === true
      );
    },
    undefined,
    { timeout: 10_000 }
  );
  await sidepanel.waitForTimeout(800);
  await sidepanel.evaluate(() => {
    document.getElementById('btn-scan-cancel')?.click();
  });

  // Overlay hidden + cancel toast + the initial images are still there.
  await expect(
    sidepanel.locator('#toast-container .toast').filter({ hasText: /cancelled/i })
  ).toBeVisible({ timeout: 5_000 });
  expect(await allImagesCount(sidepanel)).toBeGreaterThanOrEqual(initial);
});
