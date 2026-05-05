// e2e: Pro feature click guard regression coverage.
//
// settings.ts > bindProGuards attaches a CAPTURE-PHASE click listener to
// #btn-collection and #btn-multitab that:
//   1. Calls e.stopImmediatePropagation() — preventing the lazy
//      showCollectionModal / showMultiTabModal handlers from running
//   2. Calls showProUpgradeModal() — which sets
//      state.proUpgradeModalState = { open: true, errorText: '' }
//      so the <ProUpgradeModal> Preact shell un-hides the
//      #pro-upgrade-modal container.
//   3. Surfaces a toast warning ("Collection is a Pro feature ...")
//
// This is critical product logic: we burned a debug session believing it
// was a button-binding bug. These tests pin the contract so future
// refactors of the bindProGuards / Pro detection path can't silently
// remove the upsell path.
//
// We deliberately DO NOT pass enablePro:true — the whole point is to
// observe the free-user upsell flow.
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

async function readProUpgradeOpen(sidepanel: import('@playwright/test').Page): Promise<boolean> {
  return sidepanel.evaluate(() => {
    interface IH {
      store: { get: (k: 'proUpgradeModalState') => { open: boolean } | undefined };
    }
    const w = window as unknown as { __IH__: IH };
    return Boolean(w.__IH__.store.get('proUpgradeModalState')?.open);
  });
}

test('free user clicking #btn-collection opens the Pro upgrade modal (does NOT open Collection)', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Wait for __IH__ to land so we can read store state.
  await sidepanel.waitForFunction(() =>
    Boolean((window as unknown as { __IH__?: unknown }).__IH__)
  );

  // Sanity: both modals start hidden, isProUser false.
  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);
  await expect(sidepanel.locator('#collection-modal')).toHaveClass(/hidden/);
  expect(await readProUpgradeOpen(sidepanel)).toBe(false);

  // Real DOM click — exercises the production path through the
  // capture-phase guard.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-collection')?.click();
  });

  // Pro upgrade modal opens (capture-phase listener wins, then triggers
  // showProUpgradeModal → store mutation → Preact removes .hidden).
  await expect(sidepanel.locator('#pro-upgrade-modal')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });
  expect(await readProUpgradeOpen(sidepanel)).toBe(true);

  // Collection modal stays hidden — stopImmediatePropagation killed the
  // showCollectionModal handler before it could run.
  await expect(sidepanel.locator('#collection-modal')).toHaveClass(/hidden/);

  // Toast warning surfaces with the feature name.
  await expect(
    sidepanel.locator('#toast-container .toast').filter({ hasText: /Collection.*Pro feature/i })
  ).toBeVisible({ timeout: 3_000 });
});

test('free user clicking #btn-multitab opens the Pro upgrade modal (does NOT open Multi-Tab)', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  await sidepanel.waitForFunction(() =>
    Boolean((window as unknown as { __IH__?: unknown }).__IH__)
  );

  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);
  await expect(sidepanel.locator('#multitab-modal')).toHaveClass(/hidden/);

  await sidepanel.evaluate(() => {
    document.getElementById('btn-multitab')?.click();
  });

  await expect(sidepanel.locator('#pro-upgrade-modal')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });
  expect(await readProUpgradeOpen(sidepanel)).toBe(true);

  // The Multi-Tab modal must NOT open — that's the entire purpose of
  // the guard. Use a short timeout: if it ever opens, it does so
  // synchronously after the click handler runs.
  await sidepanel.waitForTimeout(500);
  await expect(sidepanel.locator('#multitab-modal')).toHaveClass(/hidden/);

  await expect(
    sidepanel.locator('#toast-container .toast').filter({ hasText: /Multi-Tab.*Pro feature/i })
  ).toBeVisible({ timeout: 3_000 });
});

test('Pro user clicking #btn-collection opens Collection (NOT the upgrade modal)', async () => {
  // Mirror image: prove enablePro:true bypasses the guard. This is the
  // contract that bug-3 (multitab e2e refactor) relies on.
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);
  await expect(sidepanel.locator('#collection-modal')).toHaveClass(/hidden/);

  await sidepanel.evaluate(() => {
    document.getElementById('btn-collection')?.click();
  });

  // Collection modal opens via the lazy showCollectionModal path.
  await expect(sidepanel.locator('#collection-modal')).not.toHaveClass(/hidden/, {
    timeout: 5_000,
  });
  // Pro upgrade modal stays hidden.
  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);
});
