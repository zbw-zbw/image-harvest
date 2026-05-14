#!/usr/bin/env node
// Bidirectional converter between Chrome _locales/ format and i18next locales/ format.
//
// Usage:
//   node scripts/convert-locales.mjs to-i18next   # _locales/ → locales/
//   node scripts/convert-locales.mjs to-chrome     # locales/ → _locales/
//
// Chrome format:  { "key": { "message": "Hello {name}", "description": "..." } }
// i18next format: { "key": "Hello {{name}}" }

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CHROME_DIR = resolve(ROOT, '_locales');
const I18NEXT_DIR = resolve(ROOT, 'locales');

// Chrome _locales directory names → i18next locale codes
const LOCALE_MAP = {
  en: 'en',
  zh_CN: 'zh-CN',
  zh_TW: 'zh-TW',
  ja: 'ja',
  es: 'es',
  ko: 'ko',
  de: 'de',
  fr: 'fr',
  pt: 'pt',
  ru: 'ru',
  ar: 'ar',
  hi: 'hi',
  th: 'th',
  it: 'it',
  nl: 'nl',
};

// Reverse map: i18next code → Chrome dir name
const REVERSE_MAP = Object.fromEntries(
  Object.entries(LOCALE_MAP).map(([chrome, i18n]) => [i18n, chrome])
);

/** Convert Chrome {var} interpolation to i18next {{var}} */
function chromeToI18next(msg) {
  return msg.replace(/\{([a-zA-Z_]\w*)\}/g, '{{$1}}');
}

/** Convert i18next {{var}} interpolation to Chrome {var} */
function i18nextToChrome(msg) {
  return msg.replace(/\{\{([a-zA-Z_]\w*)\}\}/g, '{$1}');
}

function toI18next() {
  mkdirSync(I18NEXT_DIR, { recursive: true });
  const dirs = readdirSync(CHROME_DIR);
  let total = 0;
  for (const dir of dirs) {
    const chromeFile = resolve(CHROME_DIR, dir, 'messages.json');
    if (!existsSync(chromeFile)) continue;
    const locale = LOCALE_MAP[dir] || dir;
    const chrome = JSON.parse(readFileSync(chromeFile, 'utf-8'));
    const i18next = {};
    for (const [key, val] of Object.entries(chrome)) {
      i18next[key] = chromeToI18next(val.message);
    }
    const outPath = resolve(I18NEXT_DIR, `${locale}.json`);
    writeFileSync(outPath, JSON.stringify(i18next, null, 2) + '\n', 'utf-8');
    console.log(`✓ ${dir} → locales/${locale}.json (${Object.keys(i18next).length} keys)`);
    total++;
  }
  console.log(`\nConverted ${total} locale(s) to i18next format.`);
}

function toChrome() {
  const files = readdirSync(I18NEXT_DIR).filter((f) => f.endsWith('.json'));
  let total = 0;
  for (const file of files) {
    const locale = basename(file, '.json');
    const chromeDir = REVERSE_MAP[locale] || locale;
    const i18next = JSON.parse(readFileSync(resolve(I18NEXT_DIR, file), 'utf-8'));
    const chrome = {};
    for (const [key, msg] of Object.entries(i18next)) {
      chrome[key] = { message: i18nextToChrome(msg) };
    }
    const outDir = resolve(CHROME_DIR, chromeDir);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      resolve(outDir, 'messages.json'),
      JSON.stringify(chrome, null, 2) + '\n',
      'utf-8'
    );
    console.log(
      `✓ locales/${file} → _locales/${chromeDir}/messages.json (${Object.keys(chrome).length} keys)`
    );
    total++;
  }
  console.log(`\nConverted ${total} locale(s) to Chrome format.`);
}

const cmd = process.argv[2];
if (cmd === 'to-i18next') toI18next();
else if (cmd === 'to-chrome') toChrome();
else {
  console.error('Usage: node scripts/convert-locales.mjs <to-i18next|to-chrome>');
  process.exit(1);
}
