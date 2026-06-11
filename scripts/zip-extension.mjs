#!/usr/bin/env node
// Pack the production `dist/` folder into image-harvest-vX.Y.Z.zip.
//
// Used by `npm run zip` and (indirectly) by .github/workflows/release.yml's
// "Package extension zip" step. Kept as a standalone .mjs file (rather than
// inlined into package.json scripts) so the shell quoting stays sane on
// Windows + zsh + bash alike.
//
// Important: the Chrome Web Store rejects archives whose top-level entry
// is a directory. We therefore zip the *contents* of dist/ from inside it,
// not the dist/ directory itself.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(repoRoot, 'dist');

if (!existsSync(distDir)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

// ── Safety check: reject builds that accidentally baked in localhost ──
// This catches the case where a developer runs `npm run zip` with
// VITE_API_BASE=http://localhost:3000 in .env.local — the resulting
// extension would send users to localhost instead of the production site.
import { readdirSync } from 'node:fs';

function scanForLocalhost(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      scanForLocalhost(fullPath);
    } else if (/\.(js|html)$/.test(entry.name)) {
      const content = readFileSync(fullPath, 'utf8');
      const match = content.match(/https?:\/\/localhost[:\d]*/);
      if (match) {
        console.error(
          `\n✖ BLOCKED: production build contains "${match[0]}" in ${entry.name}\n` +
            '  This usually means .env.local has VITE_API_BASE=http://localhost:3000.\n' +
            '  Remove or comment it out, rebuild, then re-run this script.\n'
        );
        process.exit(1);
      }
    }
  }
}

scanForLocalhost(distDir);

const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const zipName = `image-harvest-v${pkg.version}.zip`;
const zipPath = resolve(repoRoot, zipName);

// Replace any stale archive with the same name to avoid `zip` appending
// new entries to a previous build.
if (existsSync(zipPath)) {
  rmSync(zipPath);
}

execSync(`zip -r ${JSON.stringify(zipPath)} .`, {
  cwd: distDir,
  stdio: 'inherit',
});

console.log(`\n✔ Created ${zipName}`);
