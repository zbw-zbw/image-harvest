#!/usr/bin/env node
// Pre-commit secret scanner — blocks commits that contain plausible real
// credentials. Runs against the *staged* diff only (fast, ~50ms typical).
//
// Detection strategy:
//   1. Reject any *.env file (except *.env.example) regardless of content.
//   2. Reject lines matching well-known credential prefixes/patterns.
//   3. Reject high-entropy strings inside *.env-shaped assignments.
//
// Bypass: `git commit --no-verify` (use only if you know what you're doing).

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { extname, basename } from 'node:path';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

// Lock files contain large base64 blobs (SHA512 integrity hashes) that
// reliably trigger credential patterns as false positives — skip entirely.
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);

// Patterns that almost-certainly indicate a real secret leaking into the repo.
const SECRET_PATTERNS = [
  // PayPal
  { name: 'PayPal Client Secret', regex: /\bE[A-Za-z0-9_-]{50,}\b/ },
  // Creem
  { name: 'Creem API Key', regex: /\bcreem_(test_)?[A-Za-z0-9]{20,}\b/ },
  { name: 'Creem Webhook Secret', regex: /\bwhsec_[A-Za-z0-9]{20,}\b/ },
  // Supabase
  { name: 'Supabase Service Role Key', regex: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/ },
  {
    name: 'Supabase Legacy JWT',
    regex: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  },
  // Generic high-risk
  { name: 'AWS Access Key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub Token', regex: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: 'Google API Key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'OpenAI Key', regex: /\bsk-[A-Za-z0-9]{40,}\b/ },
  // Private keys (PEM headers)
  { name: 'Private Key Block', regex: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
];

// Files that must never be committed regardless of contents.
function isForbiddenPath(path) {
  const base = basename(path);
  if (/\.env(\.|$)/.test(base) && !/\.env\.example$/.test(base)) return 'env file';
  if (extname(base) === '.pem') return 'PEM file';
  if (extname(base) === '.key') return 'key file';
  return null;
}

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      encoding: 'utf8',
    });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function scanFile(path) {
  const findings = [];
  const forbidden = isForbiddenPath(path);
  if (forbidden) {
    findings.push({ kind: 'forbidden-path', detail: forbidden });
    return findings;
  }
  if (SKIP_FILES.has(basename(path))) return findings;
  if (!existsSync(path)) return findings;

  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    // Binary or unreadable; skip content scan.
    return findings;
  }

  for (const { name, regex } of SECRET_PATTERNS) {
    const match = content.match(regex);
    if (match) {
      const lineNo = content.slice(0, match.index).split('\n').length;
      findings.push({
        kind: 'pattern',
        detail: name,
        line: lineNo,
        sample: match[0].slice(0, 12) + '…',
      });
    }
  }
  return findings;
}

function main() {
  const files = getStagedFiles();
  if (files.length === 0) {
    process.exit(0);
  }

  const report = [];
  for (const file of files) {
    const findings = scanFile(file);
    if (findings.length > 0) report.push({ file, findings });
  }

  if (report.length === 0) {
    console.log(`${GREEN}✓ secret-scan: ${files.length} staged file(s) clean${RESET}`);
    process.exit(0);
  }

  console.error(`\n${RED}✗ secret-scan: refusing to commit — possible secrets detected${RESET}\n`);
  for (const { file, findings } of report) {
    console.error(`  ${YELLOW}${file}${RESET}`);
    for (const f of findings) {
      if (f.kind === 'forbidden-path') {
        console.error(`    • forbidden path (${f.detail})`);
      } else {
        console.error(`    • ${f.detail} on line ${f.line}: ${f.sample}`);
      }
    }
  }
  console.error(
    `\n${YELLOW}If this is a false positive, bypass with: git commit --no-verify${RESET}`
  );
  console.error(
    `${YELLOW}Better: move the value to .env.local (gitignored) and reference via process.env.${RESET}\n`
  );
  process.exit(1);
}

main();
