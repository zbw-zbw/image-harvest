// Prettier config for Image Harvest
// Intentionally conservative — matches the existing code style so adopting
// Prettier doesn't reformat the entire repo. Tweak if/when the team agrees.

import type { Config } from 'prettier';

const config: Config = {
  // Match the existing 2-space indentation already used across the codebase
  tabWidth: 2,
  useTabs: false,

  // Existing files use single quotes for JS strings
  singleQuote: true,

  // Keep trailing commas where ES5 allows (objects, arrays) — leaves
  // function args alone to avoid noisy diffs in older code
  trailingComma: 'es5',

  // Always use semicolons (existing style)
  semi: true,

  // Wide enough to avoid pointless line breaks on common chrome.* calls
  printWidth: 100,

  // Preserve LF; the repo is Unix-only
  endOfLine: 'lf',

  // Don't add parens around single arrow-fn args (matches existing style)
  arrowParens: 'always',
};

export default config;
