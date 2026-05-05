// e2e helpers for loading the Image Harvest unpacked extension under
// Playwright. Chromium only accepts MV3 extensions through
// launchPersistentContext + the --load-extension flag, and the service
// worker won't initialize in headless-shell — we use the full headed
// chromium that `npx playwright install chromium` provides.
//
// Note about fixtures: content_scripts in manifest.config.ts only match
// http(s) — file:// pages would never get the extractor injected. We
// therefore serve fixture HTML from a local http server (see startFixture
// Server below) instead of using file:// URLs.
import { chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const extensionPath = join(repoRoot, 'dist');
const fixturesDir = join(repoRoot, 'e2e', 'fixtures');

export interface LaunchedExtension {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
}

/**
 * Launch a fresh Chromium with the built extension loaded.
 *
 * Each call gets its own tmp user-data-dir so chrome.storage / IndexedDB
 * state don't leak between tests. Caller must `context.close()` when done.
 */
export async function launchExtension(): Promise<LaunchedExtension> {
  if (!existsSync(extensionPath)) {
    throw new Error(
      `dist/ not found at ${extensionPath} — run \`npm run build\` before \`npm run test:e2e\`.`
    );
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'image-harvest-e2e-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    // Headed mode is mandatory for MV3 service workers under Chromium.
    // CI uses xvfb-run to provide a virtual display.
    headless: false,
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      // Disable the "Chrome was disabled" / first-run prompts so the test
      // can navigate immediately.
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  // Wait for the background service worker to register so we can extract
  // the extension id from its URL (chrome-extension://<id>/...).
  const serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(serviceWorker.url()).host;

  return { context, extensionId, serviceWorker };
}

/**
 * Build the chrome-extension URL for a packaged HTML page (e.g.
 * "pages/sidepanel.html"). Opening the sidepanel via chrome.sidePanel.open()
 * needs a user gesture from the action button — for e2e we sidestep that by
 * loading the page directly in a tab. The init logic still runs against the
 * "active tab", which is whatever fixture page we opened first.
 */
export function extensionUrl(extensionId: string, path: string): string {
  return `chrome-extension://${extensionId}/${path.replace(/^\//, '')}`;
}

/**
 * Tiny static file server for e2e/fixtures/. Returned object exposes the
 * base URL (e.g. `http://127.0.0.1:54321`) and a close() helper. Caller
 * must close the server in afterEach to avoid socket leaks across tests.
 */
export interface FixtureServer {
  baseUrl: string;
  close: () => Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

/**
 * Higher-level convenience wrapper used by feature tests: serves the named
 * fixture, opens it, opens the sidepanel, waits until the sidepanel has
 * extracted at least one image card, and returns both pages.
 *
 * Tests should prefer this over re-implementing the dance — it's the only
 * sequence we've found to reliably get the content script + sidepanel into
 * a stable "scan complete" state under Playwright. See smoke.e2e.ts for
 * the underlying primitives.
 */
export interface OpenedSidepanel {
  fixturePage: Page;
  sidepanel: Page;
  /** Errors captured on the sidepanel page (pageerror + console.error). */
  sidepanelErrors: string[];
}

export interface OpenSidepanelOptions {
  /** Fixture filename relative to e2e/fixtures/. Default: page-with-images.html. */
  fixture?: string;
  /** Max wait (ms) for the first image card to appear. Default: 30_000. */
  scanTimeout?: number;
  /**
   * If true, replaces chrome.downloads.download with a stub that records
   * each call into `window.__IH_DOWNLOAD_CALLS__` (an array of the
   * DownloadOptions argument) instead of actually starting a download.
   * Use `readDownloadCalls(sidepanel)` to inspect them in tests.
   */
  stubDownloads?: boolean;
  /**
   * If true, sets `state.isProUser=true` after init by writing through
   * `__IH__.store.set('isProUser', true)`. Without this flag the Pro
   * feature click guard in settings.ts (a capture-phase listener that
   * calls `stopImmediatePropagation`) intercepts clicks on
   * `#btn-collection` and `#btn-multitab` and surfaces the upgrade modal
   * instead of opening the underlying feature — which is correct
   * production behavior, but breaks tests that want to drive those
   * features end-to-end.
   *
   * Tests that exercise the upgrade-modal path itself should leave this
   * unset (default false).
   */
  enablePro?: boolean;
  /**
   * If true, replaces chrome.tabs.create with a stub that records each
   * call into `window.__IH_TABS_CREATE_CALLS__` instead of actually
   * opening a tab (which would steal focus + break the fixture's role
   * as the "active tab" and cascade into flaky chrome.tabs.query
   * results in subsequent assertions). Use `readTabsCreateCalls`.
   */
  stubTabs?: boolean;
}

/** Shape of a recorded chrome.downloads.download call. */
export interface RecordedDownloadCall {
  url: string;
  filename?: string;
  saveAs?: boolean;
}

/** Read recorded download calls from a sidepanel that was launched with stubDownloads:true. */
export async function readDownloadCalls(sidepanel: Page): Promise<RecordedDownloadCall[]> {
  return sidepanel.evaluate(() => {
    const w = window as unknown as { __IH_DOWNLOAD_CALLS__?: RecordedDownloadCall[] };
    return w.__IH_DOWNLOAD_CALLS__ ?? [];
  });
}

/** Shape of a recorded chrome.tabs.create call. */
export interface RecordedTabsCreateCall {
  url?: string;
  active?: boolean;
  index?: number;
}

/** Read recorded chrome.tabs.create calls from a sidepanel launched with stubTabs:true. */
export async function readTabsCreateCalls(sidepanel: Page): Promise<RecordedTabsCreateCall[]> {
  return sidepanel.evaluate(() => {
    const w = window as unknown as { __IH_TABS_CREATE_CALLS__?: RecordedTabsCreateCall[] };
    return w.__IH_TABS_CREATE_CALLS__ ?? [];
  });
}

export async function openSidepanelWithImages(
  context: BrowserContext,
  fixtureServer: FixtureServer,
  extensionId: string,
  options: OpenSidepanelOptions = {}
): Promise<OpenedSidepanel> {
  const fixture = options.fixture ?? 'page-with-images.html';
  const scanTimeout = options.scanTimeout ?? 30_000;
  const fixturePage = await context.newPage();
  await fixturePage.goto(`${fixtureServer.baseUrl}/${fixture}`);
  await fixturePage.waitForLoadState('networkidle');
  await fixturePage.bringToFront();

  const sidepanel = await context.newPage();
  const sidepanelErrors: string[] = [];
  sidepanel.on('pageerror', (err) => sidepanelErrors.push(err.message));
  sidepanel.on('console', (msg) => {
    if (msg.type() === 'error') sidepanelErrors.push(`[console.error] ${msg.text()}`);
  });
  // Enable the e2e hook BEFORE the page's modules load — init.ts checks
  // window.__IH_E2E__ inside its top-level guard and only then attaches
  // the window.__IH__ accessors that drive deterministic test scenarios.
  const stubDownloads = options.stubDownloads ?? false;
  const stubTabs = options.stubTabs ?? false;
  await sidepanel.addInitScript(
    ({ stub, tabs }: { stub: boolean; tabs: boolean }) => {
      (window as unknown as { __IH_E2E__?: boolean }).__IH_E2E__ = true;

      if (tabs) {
        // Wrap chrome.tabs.create so test cases can assert that the app
        // tried to open a new tab without actually opening one (which
        // would steal focus from the fixture and cascade into flaky
        // chrome.tabs.query results in subsequent assertions).
        interface RecordedTabsCreateCall {
          url?: string;
          active?: boolean;
          index?: number;
        }
        const tabCalls: RecordedTabsCreateCall[] = [];
        (
          window as unknown as { __IH_TABS_CREATE_CALLS__: RecordedTabsCreateCall[] }
        ).__IH_TABS_CREATE_CALLS__ = tabCalls;
        const installTabs = (): boolean => {
          const c = (
            window as unknown as {
              chrome?: { tabs?: { create?: (...args: unknown[]) => unknown } };
            }
          ).chrome;
          if (!c?.tabs) return false;
          c.tabs.create = (
            opts: RecordedTabsCreateCall,
            cb?: (tab: { id: number }) => void
          ): Promise<{ id: number }> => {
            tabCalls.push(opts);
            const fakeTab = { id: 0 };
            if (cb) cb(fakeTab);
            return Promise.resolve(fakeTab);
          };
          return true;
        };
        if (!installTabs()) {
          const t = setInterval(() => {
            if (installTabs()) clearInterval(t);
          }, 10);
          setTimeout(() => clearInterval(t), 2000);
        }
      }

      if (stub) {
        // Wrap chrome.downloads.download so test cases can assert that the
        // app tried to download something without polluting the user's
        // Downloads folder with synthetic blob URLs. Init scripts run at
        // document_start; chrome APIs are already defined on extension
        // pages at that point, but we guard with a tiny retry loop in case
        // the install order differs across Chromium versions.
        const calls: RecordedDownloadCall[] = [];
        (
          window as unknown as { __IH_DOWNLOAD_CALLS__: RecordedDownloadCall[] }
        ).__IH_DOWNLOAD_CALLS__ = calls;
        const install = (): boolean => {
          const c = (
            window as unknown as {
              chrome?: { downloads?: { download?: (...args: unknown[]) => unknown } };
            }
          ).chrome;
          if (!c?.downloads) return false;
          c.downloads.download = (
            opts: RecordedDownloadCall,
            cb?: (id: number) => void
          ): Promise<number> => {
            calls.push(opts);
            if (cb) cb(0);
            return Promise.resolve(0);
          };
          return true;
        };
        if (!install()) {
          const t = setInterval(() => {
            if (install()) clearInterval(t);
          }, 10);
          // Give up quietly after 2s — the test will fail later when the
          // assertion runs, with a clearer message than "interval forever".
          setTimeout(() => clearInterval(t), 2000);
        }
      }

      interface RecordedDownloadCall {
        url: string;
        filename?: string;
        saveAs?: boolean;
      }
    },
    { stub: stubDownloads, tabs: stubTabs }
  );
  await sidepanel.goto(extensionUrl(extensionId, 'pages/sidepanel.html'));

  // Re-focus fixture so chrome.tabs.query({active:true, currentWindow:true})
  // resolves to it (and not the chrome-extension:// sidepanel tab).
  await fixturePage.bringToFront();

  // Wait for the first real <ImageCard> to land. The sidepanel renders
  // skeleton cards first; the .image-card class only attaches to real ones.
  await expect
    .poll(
      async () => {
        if (sidepanel.isClosed()) return -1;
        return sidepanel.locator('#image-grid .image-card').count();
      },
      { timeout: scanTimeout, intervals: [500, 1000, 2000] }
    )
    .toBeGreaterThan(0);

  if (options.enablePro) {
    // __IH__ is wired up asynchronously inside init.ts behind a
    // Promise.all([import('./state'), import('./filter')]).then(...) so
    // we can't rely on it being present immediately after the first
    // image card renders. Wait for the hook, then flip the Pro flag.
    await sidepanel.waitForFunction(
      () => Boolean((window as unknown as { __IH__?: unknown }).__IH__),
      undefined,
      { timeout: 5_000 }
    );
    await sidepanel.evaluate(() => {
      interface IH {
        store: { set: (k: string, v: unknown) => void };
      }
      const w = window as unknown as { __IH__: IH };
      w.__IH__.store.set('isProUser', true);
    });
  }

  return { fixturePage, sidepanel, sidepanelErrors };
}

export function startFixtureServer(): Promise<FixtureServer> {
  return new Promise((resolveStart, rejectStart) => {
    const server: Server = createServer((req, res) => {
      // Only allow GET; reject anything else.
      if (!req.url || req.method !== 'GET') {
        res.statusCode = 405;
        res.end();
        return;
      }
      // Strip query string and resolve against fixtures dir; refuse to
      // serve anything outside it (defense in depth — local-only server,
      // but cheap to be safe).
      const path = req.url.split('?')[0];
      const fullPath = join(fixturesDir, decodeURIComponent(path));
      if (!fullPath.startsWith(fixturesDir)) {
        res.statusCode = 403;
        res.end();
        return;
      }
      try {
        const body = readFileSync(fullPath);
        res.setHeader('Content-Type', MIME[extname(fullPath)] ?? 'application/octet-stream');
        res.end(body);
      } catch {
        res.statusCode = 404;
        res.end();
      }
    });
    server.on('error', rejectStart);
    // Bind to localhost on a random free port.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolveStart({
        baseUrl,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => (err ? rejectClose(err) : resolveClose()));
          }),
      });
    });
  });
}
