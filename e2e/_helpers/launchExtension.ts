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
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
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
