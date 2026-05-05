// Vite + @crxjs/vite-plugin build config for Image Harvest (Chrome MV3).
//
// Strategy: incremental migration.
//   • Stage 0 (now): wire up Vite + crxjs so we can run `npm run dev` /
//     `npm run build` and load `dist/` into chrome://extensions. Existing
//     classic-script `<script src="...">` references in popup/sidepanel HTML
//     are preserved by copying static asset folders into `dist/`. crxjs will
//     handle the popup/sidepanel HTML entry points, the service worker, and
//     the content scripts declared in `manifest.config.ts`.
//   • Later stages will replace the classic <script> chain with a single
//     ESM entry per page, at which point `publicDir` mirroring of `shared/`
//     and `sidepanel/` can be removed.
//
// See `manifest.config.ts` for the typed MV3 manifest used by crxjs.

import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { visualizer } from 'rollup-plugin-visualizer';
import manifest from './manifest.config';
import { htmlIncludePlugin } from './vite-html-include';

// Toggle bundle-size analysis with `ANALYZE=1 npm run build`. The visualizer
// emits dist/stats.html (treemap) — useful for spotting which deps dominate
// the largest chunks. Off by default so production builds stay clean.
const analyze = process.env.ANALYZE === '1';

export default defineConfig({
  // Preact JSX automatic runtime — matches the tsconfig "jsxImportSource":
  // "preact" setting so `.tsx` files compile without an explicit `h` import.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  resolve: {
    // virtua hard-imports from 'react' / 'react-dom' / 'react/jsx-runtime'.
    // Reroute those to Preact's compat layer so virtua can run on Preact.
    // Our own code uses 'preact' / 'preact/hooks' directly and bypasses
    // this alias, so the only ~6.6 KB of compat code that ships is the
    // subset virtua actually touches (useLayoutEffect / useEffect /
    // useRef / memo / forwardRef / useReducer / flushSync / jsx).
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  plugins: [
    // Run the include/conditional pass BEFORE crxjs sees the HTML so the
    // crxjs entry-point analyzer parses a fully-expanded document.
    htmlIncludePlugin(),
    crx({ manifest }),
    ...(analyze
      ? [
          // Treemap for human eyeballing.
          visualizer({
            filename: 'dist/stats.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
            open: false,
          }),
          // Plain-text list for diffing in CI / commit messages.
          visualizer({
            filename: 'dist/stats.txt',
            template: 'list',
            gzipSize: true,
            brotliSize: true,
            open: false,
          }),
        ]
      : []),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    // Keep the bundle structure flat-ish so it's easy to inspect in dist/.
    rollupOptions: {
      output: {
        // crxjs sets these per-input, but we keep an explicit hint for any
        // additional shared chunks Rollup decides to extract.
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  // Vite copies anything in `publicDir` verbatim into `dist/`. We don't
  // need it during the Stage 0 POC (the dummy entries pull in their own CSS
  // via Rollup). Later stages will set this to a folder that mirrors the
  // legacy assets (`icons/`, `assets/`, `lib/`, etc.) so dist/ is loadable
  // by Chrome without needing every file to go through Vite first.
  publicDir: false,
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
});
