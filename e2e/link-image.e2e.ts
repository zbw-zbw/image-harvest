// e2e: link-image extraction stage (v1.1.0 pipeline stage 14) — `<a href>`
// targets that are direct image URLs become their own ImageItems (type
// 'link-image'), alongside the thumbnail the img-tags stage already captured.
//
// Fixture: e2e/fixtures/page-with-links.html
//   - 6 visible data-URI images (3 baseline squares + the thumbnail inside
//     the first link + 2 gallery thumbs) — all shown under the default
//     visible-only filter.
//   - linked-full-1.jpg: thumbnail→original link → link-image item with
//     visible:true inherited from the visible inner thumbnail. MUST be shown
//     under the default visible-only filter — that inheritance is the
//     stage's whole point (the user wants the original, not the 80×80
//     thumbnail).
//   - linked-plain-1.png: plain-text image link → link-image item with
//     visible:false — only surfaces once "visible only" is turned off.
//   - 2 gallery-detail-*.html candidates → never become cards (they drive
//     the GalleryResolveBar, covered by gallery-resolve.e2e.ts).
//
// The visible-inheritance assertion also guards the refreshVisibility
// exemption in sidepanel/filter.ts: link-image items have no DOM element of
// their own (the URL is an href, not an img src), so the CHECK_VISIBILITY
// re-check must NOT flip them to hidden.
//
// Single test on purpose: toggling #filter-visible-checkbox persists to
// chrome.storage.local, which would leak into a second test on the same
// profile (beforeAll context is shared).
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

test('thumbnail→original link is a visible link-image card with the Original badge; plain-text link appears once visible-only is off', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    fixture: FIXTURE,
  });

  // Default state (visible-only ON): 6 data-URI images + linked-full-1.jpg.
  // linked-plain-1.png (plain-text, visible:false) is filtered out.
  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), { timeout: 15_000 })
    .toBe(7);

  // Exactly one link-image badge under the default filter — the original.
  // Thumbnails and baseline squares carry no badge.
  await expect(sidepanel.locator('.link-image-badge')).toHaveCount(1);

  // Turn "visible only" off — the plain-text link item joins the grid and
  // carries the badge too. (The toggle persists to storage; see the header
  // comment for why both halves live in one test.) The checkbox input is
  // visually hidden (custom checkbox styling) — click its label instead,
  // exactly like a real user.
  await sidepanel.locator('#filter-visible-toggle').click();

  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), { timeout: 10_000 })
    .toBe(8);
  await expect(sidepanel.locator('.link-image-badge')).toHaveCount(2);
});
