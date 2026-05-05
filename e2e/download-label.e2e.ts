// e2e regression: deleting a selected image must update the
// "Download (N)" toolbar label.
//
// The bug: state.selectedImages is a Set, and pro-features.removeImage
// ById used to call state.selectedImages.delete(id). Set.delete is a
// mutating method that bypasses the store's Proxy trap, so selector
// subscribers watching s.selectedImages.size — including
// StatusCounts.DownloadLabel which renders `#download-label` —
// silently went stale.
//
// The fix reassigns the Set when the deleted image was selected:
//   if (state.selectedImages.has(id)) {
//     const next = new Set(state.selectedImages);
//     next.delete(id);
//     state.selectedImages = next;
//   }
// which goes through the Proxy.set trap → notifySelectors fires →
// DownloadLabel re-renders.
//
// This e2e drives the full path (Pro user clicks 🗑 → confirm →
// removeImageById → label re-renders) so a regression on either
// the bug fix OR the StatusCounts subscription would surface here.
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

test('deleting a selected image updates #download-label from "Download (N)" to "Download (N-1)"', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  await sidepanel.waitForFunction(() =>
    Boolean((window as unknown as { __IH__?: unknown }).__IH__)
  );

  // Seed a 3-image selection through the store.
  const firstId = await sidepanel.evaluate(() => {
    interface ImageItem {
      id: string;
    }
    interface IH {
      store: {
        get: (k: 'filteredImages') => ImageItem[] | undefined;
        set: (k: 'selectedImages', v: Set<string>) => void;
      };
    }
    const w = window as unknown as { __IH__: IH };
    const filtered = w.__IH__.store.get('filteredImages') as ImageItem[];
    const ids = filtered.slice(0, 3).map((i) => i.id);
    w.__IH__.store.set('selectedImages', new Set(ids));
    return ids[0];
  });
  expect(firstId).toBeTruthy();

  // Initial label reflects the seeded selection.
  await expect(sidepanel.locator('#download-label')).toHaveText('Download (3)', {
    timeout: 3_000,
  });

  // Trigger the delete flow on the first card. Pro user → confirm
  // dialog opens.
  await sidepanel.evaluate((targetId) => {
    document.querySelector<HTMLElement>(`.image-card[data-id="${targetId}"] .btn-delete`)?.click();
  }, firstId);
  await expect(sidepanel.locator('#confirm-dialog')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });

  // Confirm via document.click() (overlay-hit-test workaround).
  await sidepanel.evaluate(() => {
    document.getElementById('confirm-dialog-confirm')?.click();
  });

  // After removeImageById fires:
  //   - the card is gone from the grid
  //   - state.selectedImages is reassigned (size 3 → 2)
  //   - DownloadLabel selector subscriber fires → label re-renders
  await expect(sidepanel.locator(`.image-card[data-id="${firstId}"]`)).toHaveCount(0, {
    timeout: 3_000,
  });
  await expect(sidepanel.locator('#download-label')).toHaveText('Download (2)', {
    timeout: 3_000,
  });
});

test('deleting an UN-selected image leaves #download-label unchanged', async () => {
  // Pairs with the unit test 'does NOT reallocate selectedImages when
  // removing an un-selected image' — verifies the optimization holds
  // end-to-end (no needless re-render churn for an unrelated delete).
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  // Seed a 2-image selection but leave the first card un-selected.
  const targetId = await sidepanel.evaluate(() => {
    interface ImageItem {
      id: string;
    }
    interface IH {
      store: {
        get: (k: 'filteredImages') => ImageItem[] | undefined;
        set: (k: 'selectedImages', v: Set<string>) => void;
      };
    }
    const w = window as unknown as { __IH__: IH };
    const filtered = w.__IH__.store.get('filteredImages') as ImageItem[];
    // Select images 1 and 2; we'll delete image 0.
    w.__IH__.store.set('selectedImages', new Set([filtered[1].id, filtered[2].id]));
    return filtered[0].id;
  });

  await expect(sidepanel.locator('#download-label')).toHaveText('Download (2)', {
    timeout: 3_000,
  });

  await sidepanel.evaluate((id) => {
    document.querySelector<HTMLElement>(`.image-card[data-id="${id}"] .btn-delete`)?.click();
  }, targetId);
  await expect(sidepanel.locator('#confirm-dialog')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });
  await sidepanel.evaluate(() => {
    document.getElementById('confirm-dialog-confirm')?.click();
  });

  await expect(sidepanel.locator(`.image-card[data-id="${targetId}"]`)).toHaveCount(0, {
    timeout: 3_000,
  });
  // Label unchanged — selection size still 2.
  await expect(sidepanel.locator('#download-label')).toHaveText('Download (2)');
});
