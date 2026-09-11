#!/usr/bin/env node
// Adds a single i18n key to every locale's messages.json.
// Usage: node scripts/add-i18n-key.mjs <key> '<{"en":"...","zh_CN":"..."}>'
// Locales without an explicit entry fall back to the "en" text.
// Keeps files deterministic: 2-space indent + trailing newline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , key, messagesJson] = process.argv;
if (!key || !messagesJson) {
  console.error('Usage: node scripts/add-i18n-key.mjs <key> \'<{"en":"...","zh_CN":"..."}>\'');
  process.exit(1);
}
const messages = JSON.parse(messagesJson);
const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '_locales');
for (const locale of fs.readdirSync(localesDir)) {
  const file = path.join(localesDir, locale, 'messages.json');
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const text = messages[locale] ?? messages.en;
  data[key] = { message: text };
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`${locale}: ${key} = ${text}`);
}
