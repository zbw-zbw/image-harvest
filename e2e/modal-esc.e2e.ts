// e2e: pressing the Escape key closes whichever modal is currently
// open. Pins the keyboard shortcut contract in sidepanel/message.ts
// > handleKeyDown (L246-275).
//
// The handler reads modal state directly from the store (not from
// classList on stale cached refs) and chains close functions in a
// fixed priority: settings → dedup → collection → multitab. Whichever
// one is .open gets its close function called and the handler
// returns. This test pins two of the four (settings + collection)
// since dedup/multitab are lazy-loaded chunks already exercised by
// dedup.e2e.ts and multitab.e2e.ts.
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

test('pressing Escape with the settings modal open closes it', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Open settings via the toolbar button (real click path).
  await sidepanel.evaluate(() => {
    document.getElementById('btn-settings')?.click();
  });
  await expect(sidepanel.locator('#settings-modal')).not.toHaveClass(/hidden/, {
    timeout: 5_000,
  });

  // Press Escape. handleKeyDown branch 1 (settingsModalState.open) →
  // closeSettings → state.settingsModalState.open = false → Settings
  // shell adds .hidden back.
  await sidepanel.keyboard.press('Escape');

  await expect(sidepanel.locator('#settings-modal')).toHaveClass(/hidden/, {
    timeout: 3_000,
  });
});

test('pressing Escape with the collection modal open closes it', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  // Open collection (Pro user, so the bindProGuards capture interceptor
  // is bypassed and the lazy showCollectionModal chunk runs).
  await sidepanel.evaluate(() => {
    document.getElementById('btn-collection')?.click();
  });
  await expect(sidepanel.locator('#collection-modal')).not.toHaveClass(/hidden/, {
    timeout: 5_000,
  });

  // Press Escape. handleKeyDown branch 3 (collectionModalState.open) →
  // closeCollectionModal → state flip → modal hides.
  await sidepanel.keyboard.press('Escape');

  await expect(sidepanel.locator('#collection-modal')).toHaveClass(/hidden/, {
    timeout: 3_000,
  });
});

test('pressing Escape with no modal open PRESERVES the selection (only exits highlight view)', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  await sidepanel.waitForFunction(() =>
    Boolean((window as unknown as { __IH__?: unknown }).__IH__)
  );

  // Seed a non-empty selection via the store.
  await sidepanel.evaluate(() => {
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
    w.__IH__.store.set('selectedImages', new Set(filtered.slice(0, 2).map((i) => i.id)));
  });

  // Confirm the selection registered (cards get the .selected class).
  await expect(sidepanel.locator('#image-grid .image-card.selected')).toHaveCount(2);

  await sidepanel.keyboard.press('Escape');

  // handleKeyDown's no-modal branch intentionally PRESERVES the
  // selection — ESC now only removes page highlights and closes
  // dropdowns (message.ts: "Only remove page highlights — preserve
  // selection state and scroll position. ESC is just exiting the page
  // highlight view, not deselecting images in the list.").
  // Give the (potential) deselection a tick to misfire, then pin that
  // it didn't.
  await sidepanel.waitForTimeout(500);
  await expect(sidepanel.locator('#image-grid .image-card.selected')).toHaveCount(2);
});
