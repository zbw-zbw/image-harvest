// ESLint flat config for Image Harvest (post-migration: TypeScript + Vite + crxjs).
//
// All sources are .ts ES modules. Build/test config files (vite.config.ts,
// vitest.config.ts, prettier.config.ts, manifest.config.ts) are also .ts.
//
// Run:
//   npm run lint           # report
//   npm run lint:fix       # auto-fix where possible
//
// To enable @typescript-eslint rules, install:
//   npm i -D typescript-eslint --legacy-peer-deps
// then uncomment the typescript-eslint preset block below.

import globals from 'globals';
import type { Linter } from 'eslint';

const config: Linter.Config[] = [
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
    files: ['**/*.{ts,js}'],
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

      // Style soft warnings
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },

  // Background service worker — service worker globals
  {
    files: ['background/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        ...globals.webextensions,
      },
    },
  },

  // Node-only build/test config files
  {
    files: ['*.config.ts', 'tests/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Vitest tests get its globals (describe / it / expect / ...)
  {
    files: ['tests/**/*.ts'],
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
