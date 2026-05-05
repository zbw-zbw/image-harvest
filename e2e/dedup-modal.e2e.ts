// e2e: the Dedup modal (#dedup-modal) renders state.similarGroups
// and the Remove Duplicates pipeline removes them from state.allImages.
//
// Note: unlike #btn-collection / #btn-multitab, the #btn-dedup
// toolbar button does NOT go through bindProGuards (init.ts L913
// binds it directly to showDedupModal). The Pro guard sits one
// level deeper, on #btn-remove-duplicates inside the modal
// (dedup-ui.ts L70). So even free users can OPEN the modal and
// see the similar groups; they just can't act on them.
//
// detectSimilarImages (pro-features.ts L22) is normally invoked
// off the scan pipeline once images have phash values. Static
// fixtures don't carry phash, so we directly seed state.allImages
// + state.similarGroups via __IH__.store.set, then click the
// toolbar button and exercise the modal.
//
// Two cases pin both Pro branches end-to-end:
//   - free user clicks Remove Duplicates → showProUpgradeModal opens,
//     state.allImages is unchanged.
//   - Pro user clicks Remove Duplicates with no manual selection →
//     defaults to "keep first, remove rest" per group → confirm
//     dialog opens → confirm → allImages shrinks by N-1 per group +
//     modal closes + 'Removed N duplicate images' toast.
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
 * Seed two similar groups into the store: group A has 3 images,
 * group B has 2 images. Returns the total count of duplicates that
 * a "keep first, remove rest" pass would delete: (3-1) + (2-1) = 3.
 */
async function seedSimilarGroups(
  sidepanel: Awaited<ReturnType<typeof openSidepanelWithImages>>['sidepanel']
): Promise<number> {
  await sidepanel.waitForFunction(() =>
    Boolean((window as unknown as { __IH__?: unknown }).__IH__)
  );
  return sidepanel.evaluate(() => {
    interface ImageItem {
      id: string;
      url: string;
      naturalWidth: number;
      naturalHeight: number;
      displayWidth: number;
      displayHeight: number;
      estimatedSize: number;
      format: string;
      phash: string | null;
    }
    interface IH {
      store: { set: (k: string, v: unknown) => void };
      applyFilters: () => void;
    }
    const w = window as unknown as { __IH__: IH };

    const make = (id: string, phash: string): ImageItem => ({
      id,
      url: `https://example.com/${id}.png`,
      naturalWidth: 200,
      naturalHeight: 200,
      displayWidth: 200,
      displayHeight: 200,
      estimatedSize: 1024,
      format: 'png',
      phash,
    });

    const groupA = [make('a1', 'aaaa'), make('a2', 'aaaa'), make('a3', 'aaaa')];
    const groupB = [make('b1', 'bbbb'), make('b2', 'bbbb')];
    const all = [...groupA, ...groupB];

    w.__IH__.store.set('allImages', all);
    w.__IH__.applyFilters();
    // Seed similarGroups directly. detectSimilarImages would normally
    // compute these from phash + Hamming distance; bypassing it keeps
    // the test focused on the modal/removal pipeline.
    w.__IH__.store.set('similarGroups', [groupA, groupB]);

    return groupA.length - 1 + (groupB.length - 1); // 3 expected removals
  });
}

test('free user opens Dedup modal, clicks Remove Duplicates → ProUpgradeModal opens, allImages unchanged', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  await seedSimilarGroups(sidepanel);

  // Open the dedup modal.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-dedup')?.click();
  });
  await expect(sidepanel.locator('#dedup-modal')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });

  // Two groups rendered with the right per-group sizes.
  await expect(sidepanel.locator('#dedup-modal .dedup-group')).toHaveCount(2, {
    timeout: 2_000,
  });
  await expect(
    sidepanel.locator('#dedup-modal .dedup-group').nth(0).locator('.dedup-image')
  ).toHaveCount(3);
  await expect(
    sidepanel.locator('#dedup-modal .dedup-group').nth(1).locator('.dedup-image')
  ).toHaveCount(2);

  // Snapshot allImages length so we can assert it doesn't change.
  const beforeCount = await sidepanel.evaluate(() => {
    interface IH {
      store: { get: (k: 'allImages') => unknown[] };
    }
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get('allImages').length;
  });
  expect(beforeCount).toBe(5);

  // Click Remove Duplicates → free guard fires.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-remove-duplicates')?.click();
  });

  await expect(sidepanel.locator('#pro-upgrade-modal')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });
  // Dedup modal auto-closes from the free-user guard (dedup-ui.ts L71).
  await expect(sidepanel.locator('#dedup-modal')).toHaveClass(/hidden/);

  // No removal happened.
  const afterCount = await sidepanel.evaluate(() => {
    interface IH {
      store: { get: (k: 'allImages') => unknown[] };
    }
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get('allImages').length;
  });
  expect(afterCount).toBe(5);
});

test('Pro user → Remove Duplicates with no manual selection → confirm dialog → allImages shrinks by N-1 per group', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  const expectedRemovals = await seedSimilarGroups(sidepanel);
  expect(expectedRemovals).toBe(3); // (3-1) + (2-1)

  await sidepanel.evaluate(() => {
    document.getElementById('btn-dedup')?.click();
  });
  await expect(sidepanel.locator('#dedup-modal')).not.toHaveClass(/hidden/);

  // Click Remove Duplicates. With no .dedup-image.selected,
  // removeDuplicates falls through to the "keep first, remove rest"
  // default + opens the confirm dialog.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-remove-duplicates')?.click();
  });
  await expect(sidepanel.locator('#confirm-dialog')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });
  await expect(sidepanel.locator('#confirm-dialog-title')).toHaveText('Remove Duplicates');
  await expect(sidepanel.locator('#confirm-dialog-message')).toContainText(
    String(expectedRemovals)
  );

  // Confirm.
  await sidepanel.evaluate(() => {
    document.getElementById('confirm-dialog-confirm')?.click();
  });

  // allImages shrinks from 5 → 2 (one survivor per group).
  await expect
    .poll(
      async () =>
        sidepanel.evaluate(() => {
          interface IH {
            store: { get: (k: 'allImages') => unknown[] };
          }
          const w = window as unknown as { __IH__: IH };
          return w.__IH__.store.get('allImages').length;
        }),
      { timeout: 3_000 }
    )
    .toBe(5 - expectedRemovals);

  // Dedup modal closes (closeDedupModal fired post-confirm).
  await expect(sidepanel.locator('#dedup-modal')).toHaveClass(/hidden/, {
    timeout: 2_000,
  });

  // Success toast surfaces with the right count.
  await expect(sidepanel.locator('.toast').last()).toContainText(
    `Removed ${expectedRemovals} duplicate images`,
    { timeout: 2_000 }
  );

  // No ProUpgradeModal triggered.
  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);
});
