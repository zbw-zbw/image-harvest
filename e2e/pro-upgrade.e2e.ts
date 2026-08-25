// e2e: Pro feature click guard regression coverage.
//
// Sprint 3.5 "first wow" strategy changed the free-tier surface:
//   - Collection: fully free to open (limit enforced on SAVES inside
//     addToCollection, covered by unit tests) — free users get the
//     modal directly, no interception.
//   - Multi-Tab: the modal button reaches showMultiTabModal, whose
//     internal quota gate (MAX_MONTHLY_MULTI_TAB = 0 = Pro-exclusive)
//     redirects free users to the upgrade modal + toast
//     (pro_feature_upgrade_required). The old capture-phase
//     proLockedButtons interceptor in settings.ts is now an EMPTY array
//     — these tests pin the NEW contract so a future refactor can't
//     silently re-lock or break either path.
//
// We deliberately DO NOT pass enablePro:true for the free-tier tests —
// the whole point is to observe the free-user flow.
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

test('free user clicking #btn-collection opens the Collection modal directly (free-tier allowance, no interception)', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Wait for __IH__ to land so we can read store state.
  await sidepanel.waitForFunction(() =>
    Boolean((window as unknown as { __IH__?: unknown }).__IH__)
  );

  // Sanity: both modals start hidden, isProUser false.
  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);
  await expect(sidepanel.locator('#collection-modal')).toHaveClass(/hidden/);
  expect(await readProUpgradeOpen(sidepanel)).toBe(false);

  // Real DOM click — free user opens the lazy showCollectionModal path.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-collection')?.click();
  });

  // Collection modal opens directly — the save-count limit is enforced
  // inside addToCollection, not at the button.
  await expect(sidepanel.locator('#collection-modal')).not.toHaveClass(/hidden/, {
    timeout: 5_000,
  });
  // Pro upgrade modal stays hidden — no interception.
  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);
  expect(await readProUpgradeOpen(sidepanel)).toBe(false);
});

test('free user clicking #btn-multitab hits the quota gate → Pro upgrade modal (Multi-Tab modal stays closed)', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  await sidepanel.waitForFunction(() =>
    Boolean((window as unknown as { __IH__?: unknown }).__IH__)
  );

  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);
  await expect(sidepanel.locator('#multitab-modal')).toHaveClass(/hidden/);

  await sidepanel.evaluate(() => {
    document.getElementById('btn-multitab')?.click();
  });

  // MAX_MONTHLY_MULTI_TAB = 0 (Pro-exclusive) → showMultiTabModal's
  // internal quota gate redirects free users to the upgrade modal.
  await expect(sidepanel.locator('#pro-upgrade-modal')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });
  expect(await readProUpgradeOpen(sidepanel)).toBe(true);

  // The Multi-Tab modal must NOT open — that's the entire purpose of
  // the gate. Use a short timeout: if it ever opens, it does so
  // synchronously after the click handler runs.
  await sidepanel.waitForTimeout(500);
  await expect(sidepanel.locator('#multitab-modal')).toHaveClass(/hidden/);

  // limit = 0 → quotaBlockedMessage uses pro_feature_upgrade_required
  // ("This feature requires Pro. Upgrade to unlock!") instead of the
  // confusing "0 per month" wording.
  await expect(
    sidepanel.locator('#toast-container .toast').filter({
      hasText: /requires Pro/i,
    })
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
