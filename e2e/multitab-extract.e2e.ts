// e2e: the Pro-user happy path of Multi-Tab Extract — what
// multitab-modal.e2e.ts deliberately did NOT cover.
//
// Why deferred there: startMultiTabExtract (multitab.ts L290) calls
// chrome.runtime.sendMessage({type:'MULTI_TAB_EXTRACT', tabIds}) —
// the background SW then fans out chrome.tabs.sendMessage to every
// chosen tab and races each tab's content-script lifecycle. In a
// Playwright headed runner, the http fixture has a real content
// script but tabs the user opens for the test (chrome://newtab,
// the sidepanel chrome-extension page, etc.) don't, so the
// extraction either errors or hangs.
//
// Stub strategy: install a chrome.runtime.sendMessage shim that
// intercepts the MULTI_TAB_EXTRACT request and resolves with a
// synthesized {success:true, images:[...], tabCount:N} payload.
// Other message types pass through to the real handler so the
// sidepanel's other internal messaging keeps working. This pins
// every consumer-side contract of startMultiTabExtract:
//   1. progress modal opens (#progress-modal becomes visible)
//   2. response.images get merged into state.allImages, dedup'd
//      by url against existing entries
//   3. grouping mode auto-flips to 'tab'
//   4. multitab modal closes
//   5. 'Extracted N images from M tabs' toast surfaces
//   6. progress modal closes via the finally block
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

test('Pro user selects all tabs + Start Extraction → MULTI_TAB_EXTRACT response merges into state and modal closes', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  // Install the chrome.runtime.sendMessage stub. Pre-existing fixture
  // images live in state.allImages already; the stub returns 4 brand-
  // new urls so we can later assert "exactly 4 added".
  await sidepanel.evaluate(() => {
    interface ChromeRuntime {
      runtime?: {
        sendMessage?: (...args: unknown[]) => Promise<unknown>;
      };
    }
    interface MultiTabExtractRequest {
      type?: string;
      tabIds?: number[];
    }
    interface ImagePayload {
      id: string;
      url: string;
      naturalWidth: number;
      naturalHeight: number;
      displayWidth: number;
      displayHeight: number;
      estimatedSize: number;
      format: string;
      tabId?: number;
    }

    const c = (window as unknown as { chrome: ChromeRuntime }).chrome;
    const original = c.runtime!.sendMessage!.bind(c.runtime!);
    // Track calls so the test can assert the request shape.
    const calls: MultiTabExtractRequest[] = [];
    (window as unknown as { __IH_MTAB_CALLS__: MultiTabExtractRequest[] }).__IH_MTAB_CALLS__ =
      calls;

    c.runtime!.sendMessage = ((req: unknown, ...rest: unknown[]) => {
      const r = req as MultiTabExtractRequest;
      if (r && r.type === 'MULTI_TAB_EXTRACT') {
        calls.push(r);
        const tabIds = r.tabIds || [];
        const tabCount = tabIds.length;
        const images: ImagePayload[] = tabIds.flatMap((tabId, i) => [
          {
            id: '', // multitab.ts L313 will fill if missing
            url: `https://stub.example/tab-${tabId}-img-a-${i}.png`,
            naturalWidth: 200,
            naturalHeight: 200,
            displayWidth: 200,
            displayHeight: 200,
            estimatedSize: 1024,
            format: 'png',
            tabId,
          },
          {
            id: '',
            url: `https://stub.example/tab-${tabId}-img-b-${i}.png`,
            naturalWidth: 300,
            naturalHeight: 300,
            displayWidth: 300,
            displayHeight: 300,
            estimatedSize: 2048,
            format: 'png',
            tabId,
          },
        ]);
        return Promise.resolve({ success: true, images, tabCount });
      }
      return original(req, ...rest);
    }) as typeof c.runtime.sendMessage;
  });

  // Snapshot how many images we already have so we can compute the
  // expected post-merge count.
  const beforeCount = await sidepanel.evaluate(() => {
    interface IH {
      store: { get: (k: 'allImages') => unknown[] };
    }
    return (window as unknown as { __IH__: IH }).__IH__.store.get('allImages').length;
  });
  expect(beforeCount).toBeGreaterThan(0);

  // Open the multitab modal + wait for the tab list to populate.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-multitab')?.click();
  });
  await expect(sidepanel.locator('#multitab-modal')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });
  await expect
    .poll(async () => sidepanel.locator('#multitab-list .tab-item').count(), { timeout: 3_000 })
    .toBeGreaterThan(0);
  const tabItemCount = await sidepanel.locator('#multitab-list .tab-item').count();

  // Select all tabs.
  await sidepanel.evaluate(() => {
    document.getElementById('multitab-select-all')?.click();
  });
  await expect
    .poll(async () => sidepanel.locator('#multitab-list .tab-checkbox input:checked').count(), {
      timeout: 2_000,
    })
    .toBe(tabItemCount);

  // Click Start Extraction.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-start-extraction')?.click();
  });

  // The stub resolves quickly so we mostly skip the "progress modal
  // visible" intermediate state. Don't race it — go straight to the
  // post-extract assertions.

  // Multitab modal closes after a successful merge (multitab.ts L334).
  await expect(sidepanel.locator('#multitab-modal')).toHaveClass(/hidden/, {
    timeout: 5_000,
  });

  // The MULTI_TAB_EXTRACT request landed exactly once with the
  // selected tabIds.
  const calls = await sidepanel.evaluate(() => {
    interface MultiTabExtractRequest {
      type?: string;
      tabIds?: number[];
    }
    return (window as unknown as { __IH_MTAB_CALLS__: MultiTabExtractRequest[] }).__IH_MTAB_CALLS__;
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].type).toBe('MULTI_TAB_EXTRACT');
  expect(calls[0].tabIds!.length).toBe(tabItemCount);

  // allImages grew by exactly tabItemCount * 2 (two synth images per
  // tab in the stub). The merge dedup'd by url, but every stub url
  // is unique so all of them land.
  const afterCount = await sidepanel.evaluate(() => {
    interface IH {
      store: { get: (k: 'allImages') => unknown[] };
    }
    return (window as unknown as { __IH__: IH }).__IH__.store.get('allImages').length;
  });
  expect(afterCount).toBe(beforeCount + tabItemCount * 2);

  // Grouping mode auto-flipped to 'tab' (multitab.ts L325).
  const groupMode = await sidepanel.evaluate(() => {
    interface IH {
      store: { get: (k: 'currentGroupMode') => string };
    }
    return (window as unknown as { __IH__: IH }).__IH__.store.get('currentGroupMode');
  });
  expect(groupMode).toBe('tab');

  // Success toast surfaces with the right counts.
  await expect(sidepanel.locator('.toast').last()).toContainText(
    `Extracted ${tabItemCount * 2} images from ${tabItemCount} tabs`,
    { timeout: 3_000 }
  );

  // Progress modal closed via the finally block.
  await expect(sidepanel.locator('#progress-modal')).toHaveClass(/hidden/, {
    timeout: 3_000,
  });
});
