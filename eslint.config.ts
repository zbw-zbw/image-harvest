// ESLint flat config for Image Harvest (post-migration: TypeScript + Vite + crxjs).
//
// All sources are .ts/.tsx ES modules. Build/test config files
// (vite.config.ts, vitest.config.ts, prettier.config.ts, manifest.config.ts)
// are also .ts.
//
// Run:
//   npm run lint           # report
//   npm run lint:fix       # auto-fix where possible

import globals from 'globals';
import tseslint from 'typescript-eslint';
import type { Linter } from 'eslint';

// typescript-eslint's `configs.recommended` is an array of flat-config objects
// that brings in the parser, plugin, and a curated rule set. Spread it inline
// so we keep our project-specific tweaks below as overrides.
const config: Linter.Config[] = [
  // Don't flag historical `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
  // pragmas: the rule is now off project-wide, but ripping out 16 perfectly
  // valid escape-hatch comments adds noise without value.
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  ...(tseslint.configs.recommended as Linter.Config[]),
  // Global ignores
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'website/**', // separate Next.js project with its own ESLint
      'docs/**',
      'assets/**',
      'icons/**',
      '.aone_copilot/**',
      '.qoder/**',
      'scripts/icons/**', // generated/utility scripts
    ],
  },

  // Default rules for all sources
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      // Bug-prevention (errors)
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'warn',
      'no-constant-condition': ['error', { checkLoops: false }],

      // Project ES6+ conventions
      'no-var': 'error',
      'prefer-const': ['warn', { destructuring: 'all' }],

      // Style soft warnings.
      // Disable the core rule in favor of the TS-aware version below; the
      // core rule has many false positives on TS-only constructs (type
      // imports, declaration files, decorators, etc).
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      // We sometimes need `any` as an escape hatch for chrome.* mocks and
      // legacy-script interop. Don't make it a hard error.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Background service worker — service worker globals
  {
    files: ['background/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        ...globals.webextensions,
      },
    },
  },

  // Node-only build/test config files
  {
    files: ['*.config.ts', 'tests/**/*.{ts,tsx}', 'vite-html-include.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Vitest tests get its globals (describe / it / expect / ...)
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
  },
];

export default config;
