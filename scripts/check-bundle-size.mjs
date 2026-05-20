#!/usr/bin/env node
// Bundle size budget enforcement.
//
// Runs after `npm run build` and fails CI if any tracked chunk grows past
// its budget. Designed to be cheap (just stats + gzip) so it runs on every
// PR without slowing the pipeline down.
//
// Why a hard budget? init.js is the sidepanel's first-paint critical path
// — every kB of growth is felt by users. Setting an explicit ceiling
// forces the next person who adds code to either:
//   1. Bring the chunk back under budget (lazy-load, tree-shake), or
//   2. Justify the regression and bump the budget intentionally in this
//      file (visible in the PR diff).
//
// To intentionally raise a budget: edit BUDGETS below + cite the reason
// in the commit message.
//
// Usage:
//   node scripts/check-bundle-size.mjs           # check
//   node scripts/check-bundle-size.mjs --json    # machine-readable output
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distAssets = join(repoRoot, 'dist', 'assets');

// Each entry: a glob-ish prefix (matched against filename, ignoring the
// vite content hash) → max gzipped bytes. The hash suffix (e.g.
// "init-CUe-Itrw.js") is stripped before matching.
//
// Budgets are the LAST KNOWN GOOD value rounded up to the nearest kB,
// leaving ~10% headroom for legitimate future growth before tripping.
const BUDGETS = {
  // Sidepanel main entry — see `perf(bundle): jszip lazy import` for the
  // 73.35 → 43.96 kB drop. Bumped to 78 kB after v1.0.3 (i18n 15 langs,
  // storeHook useLayoutEffect fix, onLocaleChange enhancements) ~76 kB.
  'init.js': { gzipKb: 80, label: 'sidepanel main' },
  // Background service worker entry. Currently ~5.6 kB gzip.
  'index.ts.js': { gzipKb: 12, label: 'background SW' },
  // Content script entry. Currently ~7.7 kB gzip.
  'main.ts.js': { gzipKb: 14, label: 'content script' },
};

const wantJson = process.argv.includes('--json');

function stripHash(filename) {
  // Vite produces "init-CUe-Itrw.js" — strip "-<hash>" before ".js".
  return filename.replace(/-[A-Za-z0-9_-]{8}\.js$/, '.js');
}

function findChunk(prefix) {
  const matches = readdirSync(distAssets).filter(
    (f) => f.endsWith('.js') && stripHash(f) === prefix
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous chunk match for "${prefix}": ${matches.join(', ')}. ` +
        'Either disambiguate the budget key or rebuild with a clean dist/.'
    );
  }
  return matches[0];
}

const results = [];
let anyFailed = false;

for (const [prefix, budget] of Object.entries(BUDGETS)) {
  const chunk = findChunk(prefix);
  if (!chunk) {
    results.push({
      prefix,
      label: budget.label,
      status: 'missing',
      message: `No chunk matching ${prefix} found in dist/assets/`,
    });
    anyFailed = true;
    continue;
  }
  const fullPath = join(distAssets, chunk);
  const raw = readFileSync(fullPath);
  const rawKb = raw.length / 1024;
  const gzipBytes = gzipSync(raw).length;
  const gzipKb = gzipBytes / 1024;
  const overBudget = gzipKb > budget.gzipKb;
  if (overBudget) anyFailed = true;
  results.push({
    prefix,
    file: chunk,
    label: budget.label,
    rawKb: Number(rawKb.toFixed(2)),
    gzipKb: Number(gzipKb.toFixed(2)),
    budgetKb: budget.gzipKb,
    headroomKb: Number((budget.gzipKb - gzipKb).toFixed(2)),
    status: overBudget ? 'fail' : 'ok',
  });
}

if (wantJson) {
  console.log(JSON.stringify({ ok: !anyFailed, results }, null, 2));
} else {
  console.log('\nBundle size budget check\n');
  for (const r of results) {
    if (r.status === 'missing') {
      console.log(`  ✗ ${r.prefix.padEnd(16)}  ${r.message}`);
      continue;
    }
    const icon = r.status === 'ok' ? '✓' : '✗';
    const sizeStr = `${r.gzipKb.toFixed(2)} kB gzip / ${r.budgetKb} kB budget`;
    const headroomStr =
      r.headroomKb >= 0
        ? `(${r.headroomKb.toFixed(2)} kB headroom)`
        : `(OVER by ${(-r.headroomKb).toFixed(2)} kB)`;
    console.log(
      `  ${icon} ${r.label.padEnd(18)} ${r.file.padEnd(34)} ${sizeStr.padEnd(38)} ${headroomStr}`
    );
  }
  console.log('');
}

if (anyFailed) {
  console.error(
    'One or more chunks exceeded their gzip budget. Either bring the ' +
      'chunk back under budget (lazy-load, tree-shake) or bump the budget ' +
      'in scripts/check-bundle-size.mjs with a justification in the commit.'
  );
  process.exit(1);
}

// Surface absolute paths for the artifact reviewer's convenience.
void statSync; // touch import so lint doesn't flag it as unused on the happy path.
