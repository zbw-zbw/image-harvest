/**
 * Serves e2e/fixtures over a hostname that looks like a real site.
 *
 * Shared by take-store-screenshots.mjs and record-hero-video.mjs. Both drive
 * Chromium with `--host-resolver-rules=MAP <DEMO_HOST> 127.0.0.1:<port>`, so
 * every image URL the extension prints reads `http://fieldnotes.test/demo/…`
 * instead of `127.0.0.1:54321/demo/…`. Nothing leaves the machine.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEMO_HOST = 'fieldnotes.test';

const REPO = resolve(fileURLToPath(import.meta.url), '..', '..');
const FIXTURES = join(REPO, 'e2e', 'fixtures');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

export function startFixtureServer() {
  return new Promise((resolveStart, rejectStart) => {
    const server = createServer((req, res) => {
      // The panel asks for each image's size with a cross-origin HEAD before it
      // can show "87.6 KB", and the ZIP pipeline fetches the bytes with a
      // cross-origin GET. Answering only GET made every size lookup 405 and the
      // batch download land zero files.
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (!req.url || (req.method !== 'GET' && req.method !== 'HEAD')) {
        res.statusCode = 405;
        res.end();
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      const path = decodeURIComponent(req.url.split('?')[0]);
      const fullPath = join(FIXTURES, path);
      if (!fullPath.startsWith(FIXTURES)) {
        res.statusCode = 403;
        res.end();
        return;
      }
      try {
        const body = readFileSync(fullPath);
        res.setHeader('Content-Type', MIME[extname(fullPath)] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(body.byteLength));
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        res.end(body);
      } catch {
        res.statusCode = 404;
        res.end();
      }
    });
    server.on('error', rejectStart);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveStart({
        port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
