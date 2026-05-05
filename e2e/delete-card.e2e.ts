// e2e: clicking the per-card delete (🗑) button.
//
// handleDelete (ImageCard.tsx) flow after the Pro-guard refactor:
//   1. e.stopPropagation() so the card-click selection toggle doesn't fire
//   2. Pro guard up-front: if (!isProUser) → showProUpgradeModal +
//      toast, return immediately. The confirm dialog never appears for
//      free users — fast-fail UX matching handleFavorite.
//   3. await showConfirmDialog({ title: 'Remove Image', ... }) which
//      flips state.confirmDialog to { open: true, ..., resolve: fn }
//      and the Preact <ConfirmDialog> shell renders #confirm-dialog
//      without the .hidden class
//   4. user clicks #confirm-dialog-confirm → ConfirmDialog calls
//      resolve(true) → handleDelete continues
//   5. removeImageById(img.id) (pro-features.ts) splices the row
//      out of state.allImages and re-runs filters → grid re-renders
//      with one fewer card. removeImageById is now a pure business
//      inverse with no Pro check inside (callers gate).
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

test('Pro user: clicking the trash button on a card opens the confirm dialog and removes the card on confirm', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  await sidepanel.waitForFunction(() =>
    Boolean((window as unknown as { __IH__?: unknown }).__IH__)
  );

  const initialCount = await sidepanel.locator('#image-grid .image-card').count();
  expect(initialCount).toBeGreaterThan(0);

  // Capture the first card's id BEFORE deletion so we can assert that
  // exact id is what got removed (not just any card).
  const firstId = await sidepanel.evaluate(() => {
    return document.querySelector<HTMLElement>('#image-grid .image-card')?.getAttribute('data-id');
  });
  expect(firstId).toBeTruthy();

  // Click the first card's trash button.
  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('#image-grid .image-card .btn-delete')?.click();
  });

  // ConfirmDialog renders. The <ConfirmDialog> component watches
  // state.confirmDialog.open and removes .hidden when true.
  await expect(sidepanel.locator('#confirm-dialog')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });
  await expect(sidepanel.locator('#confirm-dialog-title')).toContainText(/Remove Image/i);

  // Click the confirm button → handleDelete continues, removeImageById
  // splices the row out of state.allImages.
  // Use evaluate-driven click rather than locator.click() — the modal
  // overlay sits on the same z-index plane and can intercept the
  // synthetic-event hit-test in Playwright's headed mode. A direct
  // .click() bypasses hit-testing entirely and triggers the Preact
  // delegated onClick correctly.
  await sidepanel.evaluate(() => {
    document.getElementById('confirm-dialog-confirm')?.click();
  });

  // Dialog closes.
  await expect(sidepanel.locator('#confirm-dialog')).toHaveClass(/hidden/, {
    timeout: 3_000,
  });

  // Card count drops by exactly 1, and the deleted id is gone.
  await expect(sidepanel.locator('#image-grid .image-card')).toHaveCount(initialCount - 1, {
    timeout: 3_000,
  });
  await expect(sidepanel.locator(`#image-grid .image-card[data-id="${firstId}"]`)).toHaveCount(0);

  // state.allImages shrinks by 1 too (not just the filtered view).
  const allImagesCount = await sidepanel.evaluate(() => {
    interface IH {
      store: { get: (k: 'allImages') => unknown[] | undefined };
    }
    const w = window as unknown as { __IH__: IH };
    return (w.__IH__.store.get('allImages') as unknown[]).length;
  });
  expect(allImagesCount).toBe(initialCount - 1);
});

test('Pro user: clicking cancel in the confirm dialog leaves the card in place', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  const initialCount = await sidepanel.locator('#image-grid .image-card').count();
  expect(initialCount).toBeGreaterThan(0);

  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('#image-grid .image-card .btn-delete')?.click();
  });

  await expect(sidepanel.locator('#confirm-dialog')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });

  // Cancel → showConfirmDialog resolves with false → handleDelete
  // returns early, no removeImageById call. Same evaluate-driven click
  // for consistency with the confirm path.
  await sidepanel.evaluate(() => {
    document.getElementById('confirm-dialog-cancel')?.click();
  });

  await expect(sidepanel.locator('#confirm-dialog')).toHaveClass(/hidden/, {
    timeout: 3_000,
  });

  // Count is unchanged.
  await expect(sidepanel.locator('#image-grid .image-card')).toHaveCount(initialCount);
});

test('free user clicking 🗑 fast-fails into the ProUpgradeModal without showing the confirm dialog', async () => {
  // Pins the bug fix that moved the Pro guard from removeImageById's
  // body up to handleDelete: free users used to dismiss a confirm
  // dialog only to silently land in the upgrade modal afterwards.
  // Now the guard runs FIRST so the confirm dialog never appears.
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  const initialCount = await sidepanel.locator('#image-grid .image-card').count();
  expect(initialCount).toBeGreaterThan(0);

  // Pre-conditions: both modals hidden.
  await expect(sidepanel.locator('#confirm-dialog')).toHaveClass(/hidden/);
  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);

  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('#image-grid .image-card .btn-delete')?.click();
  });

  // ProUpgradeModal opens (handleDelete's Pro guard).
  await expect(sidepanel.locator('#pro-upgrade-modal')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });

  // Confirm dialog must NEVER have appeared. We give it a beat and
  // assert it stays hidden — the regression we're guarding against
  // would surface as the confirm dialog showing up briefly before
  // (or instead of) the upgrade modal.
  await sidepanel.waitForTimeout(300);
  await expect(sidepanel.locator('#confirm-dialog')).toHaveClass(/hidden/);

  // Card count unchanged.
  await expect(sidepanel.locator('#image-grid .image-card')).toHaveCount(initialCount);
});
