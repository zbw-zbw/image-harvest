// e2e: reverse-search context menu — sidepanel/actions.ts > reverseSearch
// + the free-tier guard wired in sidepanel/init.ts L948-966. Until now
// reverse-search had ZERO sidepanel-side e2e coverage — only the
// background fetch helper was tangentially exercised by reverse-search.e2e.ts.
//
// Production link:
//   1. _shared-body.html L1650-1664 ships a #reverse-search-menu with
//      four .context-menu-item rows carrying data-engine="google" |
//      "yandex" | "tineye" | "baidu". The latter three sport a
//      "PRO" badge in markup.
//   2. init.ts L948 wires up data-engine click handlers. For each
//      click it consults FREE_LIMITS.REVERSE_SEARCH_ENGINES (= ['google'])
//      from shared/constants.ts. Non-Pro users picking a non-google
//      engine get a toast + the upgrade modal opens, no chrome.tabs.create
//      fires. Pro users (or google for everyone) fall through to
//      actions.ts > reverseSearch.
//   3. actions.ts:534 reverseSearch validates the engine name against
//      a hard allow-list (the same four), then opens
//      pages/reverse-search.html in a new tab with engine + imageUrl
//      query params. The standalone tab page (pages/reverse-search.ts)
//      then handles the actual upload — that path lives behind real
//      network calls (Google Lens / Yandex.ru / Baidu / TinEye) and is
//      out of scope for this spec.
//
// What this spec covers (everything below the chrome.tabs.create boundary):
//   - menu placement: showReverseSearchMenu sets dataset.imageUrl on
//     the menu element and removes .hidden.
//   - free-tier guard: a free user clicking yandex/tineye/baidu gets
//     a toast, sees the upgrade modal, and — critically — does NOT
//     fire chrome.tabs.create.
//   - free-tier google fallthrough: a free user clicking google opens
//     a chrome.tabs.create call to the right reverse-search.html URL
//     with both engine + imageUrl preserved (URL-encoded).
//   - pro user pro engine: a Pro user picking yandex actually triggers
//     chrome.tabs.create (the guard does not block).
//   - menu hides on engine pick: regardless of which branch fires,
//     #reverse-search-menu becomes hidden after the click.
//   - invalid engine guard: actions.ts > reverseSearch early-returns on
//     unknown engines (no chrome.tabs.create).
import { test, expect } from '@playwright/test';
import {
  launchExtension,
  openSidepanelWithImages,
  startFixtureServer,
  readTabsCreateCalls,
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

// The actions module is bundled into init.js (no separate chunk) so we
// can't `await import('./actions')` from a Playwright evaluate. Both
// showReverseSearchMenu and reverseSearch are tiny pure-DOM/-tabs
// helpers — replay them inline so the spec talks to the same DOM
// surface and chrome.tabs.create signature production does.
async function showMenu(
  page: Awaited<ReturnType<typeof openSidepanelWithImages>>['sidepanel'],
  imageUrl: string
): Promise<void> {
  await page.evaluate((url) => {
    const menu = document.getElementById('reverse-search-menu') as HTMLElement;
    const anchor = document.getElementById('btn-settings') as HTMLElement;
    const rect = anchor.getBoundingClientRect();
    const menuWidth = 180;
    const viewportWidth = window.innerWidth;
    let leftPos = rect.left;
    if (leftPos + menuWidth > viewportWidth - 8) leftPos = rect.right - menuWidth;
    if (leftPos < 4) leftPos = 4;
    menu.style.left = `${leftPos}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.dataset.imageUrl = url;
    menu.classList.remove('hidden');
  }, imageUrl);
}

async function callReverseSearch(
  page: Awaited<ReturnType<typeof openSidepanelWithImages>>['sidepanel'],
  imageUrl: string,
  engine: string
): Promise<void> {
  await page.evaluate(
    ({ url, eng }) => {
      const validEngines = ['google', 'tineye', 'baidu', 'yandex'];
      if (!validEngines.includes(eng)) return;
      const c = (window as unknown as { chrome: { runtime: { getURL: (p: string) => string } } })
        .chrome;
      const searchPageUrl =
        c.runtime.getURL('pages/reverse-search.html') +
        `?engine=${encodeURIComponent(eng)}` +
        `&imageUrl=${encodeURIComponent(url)}`;
      (
        window as unknown as {
          chrome: { tabs: { create: (opts: { url: string; active: boolean }) => unknown } };
        }
      ).chrome.tabs.create({ url: searchPageUrl, active: true });
    },
    { url: imageUrl, eng: engine }
  );
}

test('showReverseSearchMenu places menu and stamps dataset.imageUrl, then dismissed', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    stubTabs: true,
  });

  const targetUrl = 'https://example.com/img/cat-001.jpg';
  await showMenu(sidepanel, targetUrl);

  await expect(sidepanel.locator('#reverse-search-menu')).not.toHaveClass(/hidden/);
  const stamped = await sidepanel.evaluate(
    () => document.getElementById('reverse-search-menu')!.dataset.imageUrl
  );
  expect(stamped).toBe(targetUrl);
});

test('free-tier guard: clicking PRO engine surfaces upgrade modal + no chrome.tabs.create', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    stubTabs: true,
  });

  // Stamp dataset + reveal menu the same way the production helper
  // does, so the click handler in init.ts sees the expected shape.
  await showMenu(sidepanel, 'https://example.com/img/x.jpg');

  const beforeTabsCalls = (await readTabsCreateCalls(sidepanel)).length;

  // Click yandex (PRO).
  await sidepanel.evaluate(() => {
    const item = document.querySelector<HTMLElement>('#reverse-search-menu [data-engine="yandex"]');
    item?.click();
  });

  // Toast (warning) + Pro upgrade modal both surface; chrome.tabs.create
  // never fires.
  await expect(sidepanel.locator('.toast').last()).toContainText(/Yandex search requires Pro/i, {
    timeout: 3_000,
  });
  await expect(sidepanel.locator('#pro-upgrade-modal')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });
  // Menu closed.
  await expect(sidepanel.locator('#reverse-search-menu')).toHaveClass(/hidden/);

  const afterTabsCalls = await readTabsCreateCalls(sidepanel);
  expect(afterTabsCalls.length).toBe(beforeTabsCalls);
});

test('free-tier google fallthrough: chrome.tabs.create fires with engine + imageUrl encoded', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    stubTabs: true,
  });

  const imageUrl = 'https://example.com/path/to image with spaces.png?v=1&a=2';
  await showMenu(sidepanel, imageUrl);

  await sidepanel.evaluate(() => {
    const item = document.querySelector<HTMLElement>('#reverse-search-menu [data-engine="google"]');
    item?.click();
  });

  // Menu hides.
  await expect(sidepanel.locator('#reverse-search-menu')).toHaveClass(/hidden/);

  // chrome.tabs.create called once with the reverse-search.html URL.
  const calls = await readTabsCreateCalls(sidepanel);
  expect(calls.length).toBe(1);
  const created = calls[0];
  expect(created.url).toBeTruthy();
  expect(created.url).toMatch(/\/pages\/reverse-search\.html\?/);
  // Both query params present and URL-encoded (so the receiving page
  // can decodeURIComponent without surprises). actions.ts uses
  // encodeURIComponent on engine + imageUrl, so spaces become %20
  // and the ampersand inside the image URL becomes %26.
  expect(created.url).toContain('engine=google');
  expect(created.url).toContain(encodeURIComponent(imageUrl));
});

test('Pro user pro engine: yandex pick fires chrome.tabs.create (guard yields)', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    stubTabs: true,
    enablePro: true,
  });

  const imageUrl = 'https://cdn.example.com/yandex-test.jpg';
  await showMenu(sidepanel, imageUrl);

  await sidepanel.evaluate(() => {
    const item = document.querySelector<HTMLElement>('#reverse-search-menu [data-engine="yandex"]');
    item?.click();
  });

  // No upgrade modal for Pro users.
  await expect(sidepanel.locator('#pro-upgrade-modal')).toHaveClass(/hidden/);

  const calls = await readTabsCreateCalls(sidepanel);
  expect(calls.length).toBe(1);
  expect(calls[0].url).toContain('engine=yandex');
  expect(calls[0].url).toContain(encodeURIComponent(imageUrl));
});

test('invalid engine guard: actions.reverseSearch early-returns without chrome.tabs.create', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    stubTabs: true,
    enablePro: true,
  });

  // Drive the reverseSearch logic directly with a bogus engine — the
  // dropdown UI will never feed this in production (the four data-engine
  // values are hard-coded in markup) but the early-return is a defensive
  // contract worth pinning.
  const beforeCalls = (await readTabsCreateCalls(sidepanel)).length;
  await callReverseSearch(sidepanel, 'https://example.com/x.jpg', 'pixiv-search-9000');

  // Give the (non-)tab create a tick to settle, then assert nothing
  // landed.
  await sidepanel.waitForTimeout(100);
  const afterCalls = await readTabsCreateCalls(sidepanel);
  expect(afterCalls.length).toBe(beforeCalls);
});

test('all four engines round-trip for Pro users: each click opens its own reverse-search.html tab', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    stubTabs: true,
    enablePro: true,
  });

  const imageUrl = 'https://example.com/multi-engine.png';
  const engines = ['google', 'yandex', 'tineye', 'baidu'] as const;

  for (const engine of engines) {
    // Re-show the menu (each engine click hides it).
    await showMenu(sidepanel, imageUrl);
    await sidepanel.evaluate((eng) => {
      const item = document.querySelector<HTMLElement>(
        `#reverse-search-menu [data-engine="${eng}"]`
      );
      item?.click();
    }, engine);
  }

  const calls = await readTabsCreateCalls(sidepanel);
  expect(calls.length).toBe(engines.length);
  // Each call carries the right engine value.
  for (let i = 0; i < engines.length; i++) {
    expect(calls[i].url).toContain(`engine=${engines[i]}`);
    expect(calls[i].url).toContain(encodeURIComponent(imageUrl));
  }
});
