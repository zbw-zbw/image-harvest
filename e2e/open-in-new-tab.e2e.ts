// e2e: ImageCard's 🔗 button (.btn-open) opens the image in a new tab
// adjacent to the user's current active tab.
//
// Flow (ImageCard.tsx > handleOpen → actions.ts L498 openInNewTab):
//   1. chrome.tabs.query({active:true, currentWindow:true}) — find the
//      tab the user is looking at.
//   2. chrome.tabs.create({url, active:true, index: activeTab.index+1})
//      — open beside it (so the new tab lands right next to the
//      origin page, not at the far end of the strip). Falls back to
//      omitting `index` if the query throws.
//
// Stub strategy: we replace chrome.tabs.create via the helper's
// stubTabs option so the new tab never actually opens. Otherwise the
// new tab would steal focus from the fixture page, and subsequent
// chrome.tabs.query results would change underfoot.
import { test, expect } from '@playwright/test';
import {
  launchExtension,
  openSidepanelWithImages,
  readTabsCreateCalls,
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

test('clicking 🔗 on an image card calls chrome.tabs.create with that image url and active:true', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    stubTabs: true,
  });

  // Capture the first card's image URL — that's what 🔗 should open.
  const firstUrl = await sidepanel.evaluate(() => {
    return document.querySelector<HTMLImageElement>('#image-grid .image-card img')?.src ?? '';
  });
  expect(firstUrl).toBeTruthy();

  // Sanity: nothing recorded yet.
  expect(await readTabsCreateCalls(sidepanel)).toHaveLength(0);

  // Click 🔗 on the first card.
  await sidepanel.evaluate(() => {
    document.querySelector<HTMLElement>('#image-grid .image-card .btn-open')?.click();
  });

  // Exactly one chrome.tabs.create call lands with the image url +
  // active:true. We don't pin `index` because it depends on the
  // current tab strip's resolution to chrome.tabs.query (which itself
  // depends on which page has focus at the moment of the click — and
  // we don't want to over-couple the test to that).
  await expect
    .poll(async () => (await readTabsCreateCalls(sidepanel)).length, {
      timeout: 3_000,
    })
    .toBe(1);

  const [call] = await readTabsCreateCalls(sidepanel);
  expect(call.url).toBe(firstUrl);
  expect(call.active).toBe(true);
});
