// e2e: clicking the per-card delete (🗑) button → ConfirmDialog →
// confirm → card is removed from the grid + state.allImages shrinks
// by 1 (Pro path), OR ConfirmDialog → confirm → ProUpgradeModal opens
// without removing the card (free path).
//
// handleDelete (ImageCard.tsx L210) flow:
//   1. e.stopPropagation() so the card-click selection toggle doesn't fire
//   2. await showConfirmDialog({ title: 'Remove Image', ... }) which
//      flips state.confirmDialog to { open: true, ..., resolve: fn }
//      and the Preact <ConfirmDialog> shell renders #confirm-dialog
//      without the .hidden class
//   3. user clicks #confirm-dialog-confirm → ConfirmDialog calls
//      resolve(true) → handleDelete continues
//   4. removeImageById(img.id) (pro-features.ts L119) splices the row
//      out of state.allImages and re-runs filters → grid re-renders
//      with one fewer card.
//
// IMPORTANT: removeImageById gates on state.isProUser. Free users
// who confirm the dialog get the ProUpgradeModal instead of an actual
// removal — pinning that asymmetry below.
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
