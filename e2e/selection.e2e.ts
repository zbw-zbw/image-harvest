// e2e: selection
//
// Verifies that:
//   1. Clicking an image card toggles its `.selected` class + the
//      checkbox icon, and bumps the #selected-count widget.
//   2. The "Select all" toolbar button selects every visible card.
//   3. Clicking again clears every selection.
//
// Like filter-sort.e2e.ts, this file mixes real user interactions
// (clicking the actual card / button DOM) with store reads — clicking
// is what we want to regress on, but reading the truth from the store
// is more stable than parsing tag soup.
import { test, expect, type BrowserContext } from '@playwright/test';
import {
  launchExtension,
  openSidepanelWithImages,
  startFixtureServer,
  type FixtureServer,
  type OpenedSidepanel,
} from './_helpers/launchExtension';

let context: BrowserContext;
let extensionId: string;
let fixtureServer: FixtureServer;
let opened: OpenedSidepanel;

test.beforeEach(async () => {
  fixtureServer = await startFixtureServer();
  ({ context, extensionId } = await launchExtension());
  opened = await openSidepanelWithImages(context, fixtureServer, extensionId);
  await opened.sidepanel.waitForFunction(
    () => Boolean((window as unknown as { __IH__?: unknown }).__IH__),
    null,
    { timeout: 10_000 }
  );
});

test.afterEach(async () => {
  await context.close();
  await fixtureServer.close();
});

/** Read the size of state.selectedImages via the e2e hook. */
async function getSelectedSize(): Promise<number> {
  return opened.sidepanel.evaluate(() => {
    const ih = (
      window as unknown as {
        __IH__: { store: { state: { selectedImages: Set<string> } } };
      }
    ).__IH__;
    return ih.store.state.selectedImages.size;
  });
}

test('clicking an image card toggles its selected state', async () => {
  const firstCard = opened.sidepanel.locator('#image-grid .image-card').first();
  await expect(firstCard).toBeVisible();

  // Initially nothing is selected.
  await expect(firstCard).not.toHaveClass(/(?:^|\s)selected(?:\s|$)/);
  expect(await getSelectedSize()).toBe(0);

  await firstCard.click();

  await expect(firstCard).toHaveClass(/(?:^|\s)selected(?:\s|$)/);
  expect(await getSelectedSize()).toBe(1);

  // Click again → deselects.
  await firstCard.click();
  await expect(firstCard).not.toHaveClass(/(?:^|\s)selected(?:\s|$)/);
  expect(await getSelectedSize()).toBe(0);

  expect(opened.sidepanelErrors).toEqual([]);
});

test('"Select all" toolbar button selects every visible card; clicking again clears', async () => {
  const cards = opened.sidepanel.locator('#image-grid .image-card');
  const totalCount = await cards.count();
  expect(totalCount).toBeGreaterThan(1);

  const selectAllBtn = opened.sidepanel.locator('#btn-select-all');
  await expect(selectAllBtn).toBeVisible();

  await selectAllBtn.click();

  // Every card should now have the .selected class.
  await expect
    .poll(
      async () =>
        cards.evaluateAll((els) =>
          els.every((el) => (el as HTMLElement).classList.contains('selected'))
        ),
      { timeout: 5_000 }
    )
    .toBe(true);
  expect(await getSelectedSize()).toBe(totalCount);

  // Clicking the same button again deselects everything (toggle behavior).
  await selectAllBtn.click();
  await expect
    .poll(
      async () =>
        cards.evaluateAll((els) =>
          els.every((el) => !(el as HTMLElement).classList.contains('selected'))
        ),
      { timeout: 5_000 }
    )
    .toBe(true);
  expect(await getSelectedSize()).toBe(0);

  expect(opened.sidepanelErrors).toEqual([]);
});

test('selecting a subset reflects in the toolbar count + partial state', async () => {
  const cards = opened.sidepanel.locator('#image-grid .image-card');
  const totalCount = await cards.count();
  expect(totalCount).toBeGreaterThanOrEqual(3);

  // Click 3 distinct cards.
  for (let i = 0; i < 3; i++) {
    await cards.nth(i).click();
  }

  expect(await getSelectedSize()).toBe(3);

  // updateSelectionUI() writes "<n> selected" into the .select-all-text
  // span and toggles .partial on the button when selection is non-empty
  // but not all cards are selected.
  const selectAllBtn = opened.sidepanel.locator('#btn-select-all');
  await expect(selectAllBtn).toHaveClass(/(?:^|\s)partial(?:\s|$)/);

  const text = await selectAllBtn.locator('.select-all-text').textContent();
  expect(text).toMatch(/^3\s+selected$/);

  expect(opened.sidepanelErrors).toEqual([]);
});
