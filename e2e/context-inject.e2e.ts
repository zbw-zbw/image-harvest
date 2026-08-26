// e2e: context-menu item injection (v1.1.0 layer B) — the delivery half of
// "right-click → Extract image / Extract linked image".
//
// chrome.contextMenus itself can't be driven from Playwright (the native
// context menu is browser UI, not page DOM), so menu registration and the
// onClicked routing are covered by tests/background-index.test.ts instead.
// What this spec pins is everything AFTER the click:
//
//   1. Live injection — the background broadcasts CONTEXT_ITEM_INJECTED
//      over the UI port; the sidepanel merges the item (URL-deduped) and
//      toasts "Image added to results". We dispatch through
//      window.__IH__.handleMessage — the same handler wired into
//      uiPort.onMessage, so the production path runs verbatim (same
//      technique as live-monitor.e2e.ts).
//   2. Duplicate injection — right-clicking an image already in the grid
//      is a no-op: no growth, no success toast.
//   3. Closed-panel fallback (B3) — the background also queues every
//      injection into chrome.storage.session (pendingContextItems); when
//      the panel boots it drains the queue through the same merge path
//      and clears the key. We pre-seed the queue, reload the panel, and
//      assert the item lands.
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

const FIXTURE = 'page-with-links.html';

/** Mirrors background buildContextImageItem — visible:true is mandatory:
 * the default filter state drops anything without an explicit visible flag.
 * userInjected:true is equally mandatory: injected items are persisted
 * per-tab (storage.session) and survive panel reloads / rescans only when
 * flagged as user-injected (see sidepanel/injected-items.ts). */
function contextItem(url: string): Record<string, unknown> {
  return {
    id: `ctx-${url}`,
    url,
    displayWidth: 0,
    displayHeight: 0,
    type: 'context-image',
    format: 'png',
    sourceDomain: 'context.example',
    checked: false,
    timestamp: Date.now(),
    visible: true,
    userInjected: true,
  };
}

test('live CONTEXT_ITEM_INJECTED merge: new item joins the grid with toast; duplicate is a no-op', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    fixture: FIXTURE,
  });

  // Baseline: 6 visible data-URI images + the link-image original.
  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), { timeout: 15_000 })
    .toBe(7);

  // Right-clicked image arrives (the background builds type 'context-image'
  // with visible:true so it survives the default visible-only filter).
  await sidepanel.evaluate((item: Record<string, unknown>) => {
    const w = window as unknown as {
      __IH__?: { handleMessage: (msg: Record<string, unknown>) => void };
    };
    w.__IH__!.handleMessage({ type: 'CONTEXT_ITEM_INJECTED', item });
  }, contextItem('http://context.example/right-clicked.png'));

  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), { timeout: 5_000 })
    .toBe(8);
  await expect(sidepanel.locator('.toast').last()).toContainText('Image added to results');

  // Same URL again (user right-clicks an image already in the grid):
  // mergeContextItem dedupes — no growth, and an explicit info toast says
  // the image already exists (silence made the click look like a failed
  // no-op in smoke testing; v1.1.1 shortened the wording).
  await sidepanel.evaluate((item: Record<string, unknown>) => {
    const w = window as unknown as {
      __IH__?: { handleMessage: (msg: Record<string, unknown>) => void };
    };
    w.__IH__!.handleMessage({ type: 'CONTEXT_ITEM_INJECTED', item });
  }, contextItem('http://context.example/right-clicked.png'));

  await sidepanel.waitForTimeout(500);
  expect(await sidepanel.locator('#image-grid .image-card').count()).toBe(8);
  await expect(sidepanel.locator('.toast').last()).toContainText('Image already exists');
});

test('closed-panel fallback: pendingContextItems queued in storage.session drain into the grid on boot', async () => {
  const { fixturePage, sidepanel } = await openSidepanelWithImages(
    ext.context,
    fixtureServer,
    ext.extensionId,
    { fixture: FIXTURE }
  );

  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), { timeout: 15_000 })
    .toBe(7);

  // Simulate the background's queue-while-closed write (injectContextItem
  // pushes into storage.session before broadcasting). Extension pages are
  // trusted contexts and share storage.session with the service worker.
  await sidepanel.evaluate((item: Record<string, unknown>) => {
    const c = (
      window as unknown as {
        chrome: { storage: { session: { set: (o: object) => Promise<void> } } };
      }
    ).chrome;
    return c.storage.session.set({ pendingContextItems: [{ item }] });
  }, contextItem('http://context.example/queued-while-closed.png'));

  // Re-focus the fixture so the reloaded panel's loadCurrentTab resolves
  // the fixture tab as the active one (not the chrome-extension tab).
  await fixturePage.bringToFront();
  await sidepanel.reload();

  // Panel re-scans (7 cards) and drains the queue → the queued item joins.
  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), {
      timeout: 30_000,
      intervals: [500, 1000, 2000],
    })
    .toBe(8);

  // The queue is consumed — a second reload must NOT re-add the item.
  await fixturePage.bringToFront();
  await sidepanel.reload();
  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), {
      timeout: 30_000,
      intervals: [500, 1000, 2000],
    })
    .toBe(8);

  // And the storage key itself is gone (drained once, not left behind).
  const queueAfter = await sidepanel.evaluate(() => {
    const c = (
      window as unknown as {
        chrome: { storage: { session: { get: (k: string) => Promise<Record<string, unknown>> } } };
      }
    ).chrome;
    return c.storage.session.get('pendingContextItems');
  });
  expect(queueAfter['pendingContextItems']).toBeUndefined();
});
