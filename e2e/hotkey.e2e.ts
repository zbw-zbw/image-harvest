// e2e: keyboard shortcuts in sidepanel/message.ts > handleKeyDown.
//
// Two non-ESC branches to pin (ESC is covered by modal-esc.e2e.ts):
//   - Ctrl/Cmd+A → e.preventDefault() + selectAll() (actions.ts L61):
//     adds every state.filteredImages[].id to state.selectedImages →
//     re-render → every card gets the .selected class.
//   - Enter (when state.selectedImages.size > 0) → e.preventDefault() +
//     downloadSelectedAsZip(null) (actions.ts L295). With targetFormat
//     null AND ≤ FREE_LIMITS.MAX_ZIP_IMAGES selected, free users
//     bypass the Pro guards and the call lands on chrome.downloads.
//     download once with a blob: URL + .zip filename.
//
// The handler also early-returns if event.target is INPUT/TEXTAREA/
// SELECT (keystrokes inside form fields shouldn't trigger app-wide
// shortcuts). We don't pin that branch here because there's no
// always-present text input on the sidepanel surface to drive it
// from Playwright cleanly — covered in unit tests.
import { test, expect } from '@playwright/test';
import {
  launchExtension,
  openSidepanelWithImages,
  readDownloadCalls,
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

test('Ctrl+A selects every visible card via selectAll', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  const totalCards = await sidepanel.locator('#image-grid .image-card').count();
  expect(totalCards).toBeGreaterThan(0);

  // Pre-condition: nothing selected.
  await expect(sidepanel.locator('#image-grid .image-card.selected')).toHaveCount(0);

  // Drive the shortcut. Playwright translates Control+A → ctrlKey on the
  // KeyboardEvent, which matches handleKeyDown's (ctrlKey || metaKey)
  // branch. Focus the body first so the event target isn't an INPUT.
  await sidepanel.locator('body').click();
  await sidepanel.keyboard.press('Control+a');

  // selectAll mutates state.selectedImages and re-renders → every card
  // ends up with the .selected class.
  await expect(sidepanel.locator('#image-grid .image-card.selected')).toHaveCount(totalCards, {
    timeout: 3_000,
  });
});

test('Enter with a selection triggers downloadSelectedAsZip(null) → one chrome.downloads.download call', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    stubDownloads: true,
  });

  await sidepanel.waitForFunction(() =>
    Boolean((window as unknown as { __IH__?: unknown }).__IH__)
  );

  // Seed a 2-image selection through the store. Below FREE_LIMITS.
  // MAX_ZIP_IMAGES so the Pro guards in downloadSelectedAsZip don't
  // fire, and >1 so the init.ts router takes the zip branch.
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

  await expect(sidepanel.locator('#image-grid .image-card.selected')).toHaveCount(2);

  // Press Enter. handleKeyDown's Enter branch checks
  // state.selectedImages.size > 0 (true) → downloadSelectedAsZip(null).
  await sidepanel.locator('body').click();
  await sidepanel.keyboard.press('Enter');

  // Wait for the stubbed chrome.downloads.download call to land.
  await expect
    .poll(async () => (await readDownloadCalls(sidepanel)).length, { timeout: 5_000 })
    .toBe(1);

  const [call] = await readDownloadCalls(sidepanel);
  // Multi-image branch → blob: URL + .zip filename.
  expect(call.url).toMatch(/^blob:/);
  expect(call.filename).toMatch(/\.zip$/);
});

test('Enter with no selection is a no-op (no chrome.downloads call)', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    stubDownloads: true,
  });

  await expect(sidepanel.locator('#image-grid .image-card.selected')).toHaveCount(0);

  // Make sure document.activeElement is the body — otherwise a focused
  // toolbar button (most commonly #btn-download after init) would treat
  // Enter as a click and silently trigger downloadSelectedAsZip with
  // ALL filtered images (init.ts L578 falls back to filteredImages
  // when no selection exists). We blur via the document handle, then
  // dispatch the keydown directly on document so handleKeyDown is the
  // sole receiver.
  await sidepanel.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  // handleKeyDown's Enter branch guards on state.selectedImages.size > 0
  // — with an empty selection it falls through and downloadSelectedAsZip
  // is never called.
  await sidepanel.waitForTimeout(300);
  const calls = await readDownloadCalls(sidepanel);
  expect(calls).toHaveLength(0);
});
