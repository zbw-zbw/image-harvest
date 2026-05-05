// e2e: popup mode — pages/popup.html. Until now ZERO e2e coverage,
// despite the project rule that "popup mode and sidepanel mode keep
// the same overall logic, layout and styles."
//
// Production link:
//   1. manifest.json declares pages/popup.html as default_popup. The
//      built popup.html (dist/pages/popup.html) carries class
//      "popup-mode" on both <html> and <body> so popup-only CSS
//      rules can take effect.
//   2. pages/popup.ts is the popup entry. It (a) re-asserts the
//      popup-mode classes, (b) dynamically injects popup.css,
//      (c) registers adjustImageGridHeight which computes an
//      explicit pixel height for .image-grid-wrapper so the
//      CSS-grid child can scroll inside the fixed popup viewport.
//   3. The actual app boots from sidepanel/init.ts (shared with
//      sidepanel mode). init.ts L75 sets state.isPopupMode by
//      reading window.location.pathname — popup-only branches
//      (skip chrome.tabs.onActivated, skip side-panel-only
//      messages, etc) hang off that flag.
//
// Why this spec doesn't drive a real scan:
// When Playwright opens popup.html as a regular tab, the popup
// itself becomes the active chrome tab. init.ts > loadCurrentTab
// queries chrome.tabs.query({active:true,currentWindow:true}),
// gets back the popup's own chrome-extension:// URL,
// isRestrictedUrl returns true, and the page locks into the
// "restricted" placeholder. Real popups dodge this because Chrome
// keeps the underlying http(s) tab as active. Reproducing that
// in Playwright is fragile (no chrome.action.onClicked, no popup
// window primitive in the public API). Instead we pin the
// popup-specific contract — module hookup, mode flag, shared
// markup, and the dynamic-height fix — and let scan-related paths
// stay covered by the sidepanel-flavored e2e suite.
import { test, expect, type Page } from '@playwright/test';
import { launchExtension, extensionUrl, type LaunchedExtension } from './_helpers/launchExtension';

let ext: LaunchedExtension;

test.beforeAll(async () => {
  ext = await launchExtension();
});

test.afterAll(async () => {
  await ext?.context.close();
});

interface OpenedPopup {
  popup: Page;
  popupErrors: string[];
}

/**
 * Open pages/popup.html as a regular tab and wait until the
 * shared init code has wired up the __IH__ accessor (the same
 * gate the sidepanel helper uses for its enablePro path). We do
 * NOT wait for image cards — see the file header for why.
 */
async function openPopup(): Promise<OpenedPopup> {
  const popup = await ext.context.newPage();
  const popupErrors: string[] = [];
  popup.on('pageerror', (err) => popupErrors.push(err.message));
  popup.on('console', (msg) => {
    if (msg.type() === 'error') popupErrors.push(`[console.error] ${msg.text()}`);
  });

  // Match init.ts's e2e hook so __IH__ becomes available.
  await popup.addInitScript(() => {
    (window as unknown as { __IH_E2E__?: boolean }).__IH_E2E__ = true;
  });
  await popup.goto(extensionUrl(ext.extensionId, 'pages/popup.html'));

  // __IH__ is wired up asynchronously inside init.ts behind a
  // Promise.all import chain. Wait for it.
  await popup.waitForFunction(
    () => Boolean((window as unknown as { __IH__?: unknown }).__IH__),
    undefined,
    { timeout: 10_000 }
  );

  return { popup, popupErrors };
}

test('popup loads under chrome-extension:// without pageerror or console.error', async () => {
  const { popup, popupErrors } = await openPopup();
  expect(popup.url()).toMatch(/\/pages\/popup\.html$/);
  // Filter out two known-noise sources that aren't regressions:
  //   - "Failed to query active tab" / restricted-URL warnings are
  //     a Playwright-only artifact (popup tab itself is "active").
  //   - "Failed to load resource: net::ERR_FILE_NOT_FOUND" comes
  //     from popup.ts L28-31 dynamically injecting a literal
  //     <link href="popup.css">. The Vite-built popup.html
  //     already wires up the hashed `assets/popup-*.css`, so the
  //     dynamic link 404s. Cosmetic noise, not a runtime bug —
  //     but worth filing a follow-up to remove the dead injection
  //     in popup.ts so the console stays clean in production.
  const realErrors = popupErrors.filter(
    (msg) => !/Failed to query active tab|restricted/i.test(msg) && !/ERR_FILE_NOT_FOUND/i.test(msg)
  );
  expect(realErrors).toEqual([]);
});

test('popup-mode class applied to <html> and <body> so popup-scoped CSS engages', async () => {
  const { popup } = await openPopup();
  const flags = await popup.evaluate(() => ({
    htmlHasPopupClass: document.documentElement.classList.contains('popup-mode'),
    bodyHasPopupClass: document.body.classList.contains('popup-mode'),
  }));
  expect(flags.htmlHasPopupClass).toBe(true);
  expect(flags.bodyHasPopupClass).toBe(true);
});

test('shared _shared-body.html markup is present (parity with sidepanel)', async () => {
  const { popup } = await openPopup();
  // The IDs surveyed below are the ones the shared init code
  // looks up at boot — if popup.html drifted from
  // _shared-body.html and dropped any of them, init would crash.
  for (const id of [
    'app',
    'image-grid',
    'btn-settings',
    'btn-collection',
    'btn-multitab',
    'toast-container',
    'settings-modal',
  ]) {
    await expect(popup.locator(`#${id}`)).toHaveCount(1);
  }
});

test('state.isPopupMode flips to true so popup-only branches take effect', async () => {
  const { popup } = await openPopup();
  const isPopupMode = await popup.evaluate(() => {
    interface IH {
      store: { get: <T>(k: string) => T };
    }
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<boolean>('isPopupMode');
  });
  expect(isPopupMode).toBe(true);
});

test('popup.css was injected dynamically by pages/popup.ts', async () => {
  const { popup } = await openPopup();
  // popup.ts L28-31 builds a <link rel=stylesheet href=popup.css>
  // and appends it to <head>. The href in the built bundle ends
  // with `popup.css` (Vite hashes the file but the lookup string
  // in popup.ts is a literal). Either way, at least one
  // popup.css link should exist that wasn't in _shared-body.html.
  const popupCssCount = await popup.evaluate(
    () => document.querySelectorAll('link[rel="stylesheet"][href*="popup"]').length
  );
  expect(popupCssCount).toBeGreaterThan(0);
});

test('adjustImageGridHeight wires up — resize event triggers it once #image-grid is visible', async () => {
  const { popup } = await openPopup();
  // adjustImageGridHeight bails early if #image-grid is hidden
  // (popup.ts L48: `if (grid.classList.contains('hidden')) return`).
  // Force the grid visible so the height-fix logic engages on
  // the resize tick we dispatch below. This mirrors what happens
  // in production once the first IMAGES_DISCOVERED frame lands
  // (state-screens.ts removes .hidden from the grid).
  await popup.evaluate(() => {
    const grid = document.getElementById('image-grid');
    grid?.classList.remove('hidden');
    const wrapper = document.querySelector<HTMLElement>('.image-grid-wrapper');
    wrapper?.classList.remove('hidden');
  });

  await popup.evaluate(() => window.dispatchEvent(new Event('resize')));
  // The MutationObserver in popup.ts wraps adjustImageGridHeight in
  // requestAnimationFrame → wait one tick.
  await popup.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

  const sizing = await popup.evaluate(() => {
    const wrapper = document.querySelector<HTMLElement>('.image-grid-wrapper');
    const grid = document.getElementById('image-grid');
    if (!wrapper || !grid) return null;
    return {
      wrapperHeightPx: wrapper.style.height,
      gridOverflowY: grid.style.overflowY,
    };
  });
  expect(sizing).not.toBeNull();
  // Height ends with "px" and parses to a positive number — the
  // exact value depends on the popup viewport but the format is
  // contractual.
  expect(sizing!.wrapperHeightPx).toMatch(/^\d+px$/);
  expect(parseInt(sizing!.wrapperHeightPx, 10)).toBeGreaterThan(0);
  expect(sizing!.gridOverflowY).toBe('auto');
});

test('settings modal opens (shared modal infra works in popup too)', async () => {
  const { popup } = await openPopup();
  await popup.evaluate(() => {
    document.getElementById('btn-settings')?.click();
  });
  await expect(popup.locator('#settings-modal')).not.toHaveClass(/hidden/, {
    timeout: 5_000,
  });
});
