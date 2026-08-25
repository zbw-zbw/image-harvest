// e2e: gallery deep-resolve bar (v1.1.0 link penetration, Pro) — pages full
// of thumbnail→detail-page links surface a "Found N gallery links · Resolve
// originals" hint bar. Clicking it (as a Pro user) sends RESOLVE_LINK_IMAGES
// to the background, which fetches each detail page and extracts its
// og:image original.
//
// The real background fetch path is deliberately NOT driven here: the
// fixture server binds 127.0.0.1, which shared/url-validator.ts
// (isAllowedFetchUrl) refuses on purpose — the resolver must never fetch
// loopback/private hosts. Instead we stub chrome.runtime.sendMessage in the
// sidepanel (the same wrapping technique the helper's enablePro option uses
// for VALIDATE_LICENSE) to intercept RESOLVE_LINK_IMAGES and answer with
// synthetic resolved originals. What this spec pins:
//
//   1. The bar appears with the correct candidate count (galleryLinks
//      plumbed from the scan response through to the store).
//   2. Clicking forwards exactly the gallery-link URLs to the background.
//   3. The response items are merged into the grid (URL-deduped) with the
//      "Resolved" badge and survive the default visible-only filter.
//
// The og:image extraction itself (meta ladder, security guards, timeouts)
// is covered by tests/background-link-resolver.test.ts; the free-tier
// quota gate by tests/feature-quota.test.ts.
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

test('gallery bar shows the candidate count; resolve click merges originals into the grid (Pro)', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    fixture: FIXTURE,
    enablePro: true,
  });

  // Initial grid (visible-only ON): 6 data-URI images + the linked-full-1.jpg
  // original — same baseline as link-image.e2e.ts.
  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), { timeout: 15_000 })
    .toBe(7);

  // The hint bar renders below the toolbar with the exact candidate count.
  const bar = sidepanel.locator('#gallery-resolve-bar');
  await expect(bar).toBeAttached();
  // Count text lives on the expand/collapse toggle (v1.1.0 smoke feedback:
  // a bare count left users unable to see WHICH links were found).
  await expect(bar.locator('.gallery-resolve-bar-toggle')).toContainText('2');

  // Expanding the toggle reveals the candidate link list (capped at 20):
  // fixture has 2 gallery links, both rendered with their (truncated) URL.
  await bar.locator('.gallery-resolve-bar-toggle').click();
  await expect(bar.locator('.gallery-resolve-links li')).toHaveCount(2);
  await expect(bar.locator('.gallery-resolve-links li').first()).toContainText('gallery-detail');
  // Collapse again — the list must not linger.
  await bar.locator('.gallery-resolve-bar-toggle').click();
  await expect(bar.locator('.gallery-resolve-links')).toHaveCount(0);

  // Intercept RESOLVE_LINK_IMAGES before clicking. The stub records the
  // forwarded URL payload (pins that the bar sends the gallery links, not
  // the image URLs) and answers with one synthetic link-resolved original
  // per candidate. `visible: true` is required: the default filter state
  // has showVisibleOnly enabled and filterByVisibility drops anything
  // without an explicit visible===true flag.
  await sidepanel.evaluate(() => {
    interface ChromeRuntime {
      runtime?: { sendMessage?: (...args: unknown[]) => Promise<unknown> };
    }
    interface ResolveRequest {
      type?: string;
      urls?: string[];
    }
    interface SyntheticResolvedImage {
      url: string;
      displayWidth: number;
      displayHeight: number;
      type: string;
      format: string;
      sourceDomain: string;
      checked: boolean;
      visible: boolean;
    }
    const w = window as unknown as {
      chrome: ChromeRuntime;
      __IH_RESOLVE_URLS__?: string[];
    };
    const c = w.chrome;
    if (!c.runtime?.sendMessage) return;
    const original = c.runtime.sendMessage.bind(c.runtime);
    c.runtime.sendMessage = ((req: unknown, ...rest: unknown[]) => {
      const r = req as ResolveRequest;
      if (r && r.type === 'RESOLVE_LINK_IMAGES' && Array.isArray(r.urls)) {
        w.__IH_RESOLVE_URLS__ = r.urls.slice();
        const images: SyntheticResolvedImage[] = r.urls.map((u: string, i: number) => ({
          url: `http://resolved.example/original-${i + 1}.jpg`,
          displayWidth: 0,
          displayHeight: 0,
          type: 'link-resolved',
          format: 'jpg',
          sourceDomain: new URL(u).hostname,
          checked: false,
          visible: true,
        }));
        return Promise.resolve({
          success: true,
          images,
          resolved: images.length,
          failed: 0,
        });
      }
      return original(req, ...rest);
    }) as typeof c.runtime.sendMessage;
  });

  await sidepanel.locator('#btn-gallery-resolve').click();

  // Grid grows by the two resolved originals, each carrying the Resolved
  // badge. The originals' URLs are new (no dedup drop) and visible:true
  // survives the visible-only filter.
  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), { timeout: 15_000 })
    .toBe(9);
  await expect(sidepanel.locator('.link-resolved-badge')).toHaveCount(2);

  // The bar forwarded exactly the two gallery-detail links from the scan,
  // in DOM order.
  const resolveUrls = await sidepanel.evaluate(
    () => (window as unknown as { __IH_RESOLVE_URLS__?: string[] }).__IH_RESOLVE_URLS__ ?? []
  );
  expect(resolveUrls).toHaveLength(2);
  expect(resolveUrls[0]).toContain('gallery-detail-1.html');
  expect(resolveUrls[1]).toContain('gallery-detail-2.html');

  // The busy state cleared — the button is interactive again.
  await expect(sidepanel.locator('#btn-gallery-resolve')).toBeEnabled();
});

test('total resolve failure → error toast, grid unchanged (no "Added 0" success toast)', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    fixture: FIXTURE,
    enablePro: true,
  });

  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), { timeout: 15_000 })
    .toBe(7);

  // Every candidate fails — exactly what the security guard produces for
  // loopback/private hosts, and anti-bot 4xx/timeout sites produce in the
  // wild. resolveLinkImages swallows per-link failures, so this arrives as
  // success:true with images:[] — the bar must treat it as failure, not
  // show a success "Added 0 original images" toast.
  await sidepanel.evaluate(() => {
    interface ChromeRuntime {
      runtime?: { sendMessage?: (...args: unknown[]) => Promise<unknown> };
    }
    interface ResolveRequest {
      type?: string;
    }
    const c = (window as unknown as { chrome: ChromeRuntime }).chrome;
    if (!c.runtime?.sendMessage) return;
    const original = c.runtime.sendMessage.bind(c.runtime);
    c.runtime.sendMessage = ((req: unknown, ...rest: unknown[]) => {
      const r = req as ResolveRequest;
      if (r && r.type === 'RESOLVE_LINK_IMAGES') {
        return Promise.resolve({ success: true, images: [], resolved: 0, failed: 2 });
      }
      return original(req, ...rest);
    }) as typeof c.runtime.sendMessage;
  });

  await sidepanel.locator('#btn-gallery-resolve').click();

  // Failure toast surfaces ("Could not resolve images from this link"); the
  // grid does not grow.
  await expect(sidepanel.locator('.toast').last()).toContainText(/could not resolve/i, {
    timeout: 10_000,
  });
  await expect
    .poll(async () => sidepanel.locator('#image-grid .image-card').count(), { timeout: 5_000 })
    .toBe(7);
  await expect(sidepanel.locator('.link-resolved-badge')).toHaveCount(0);
});
