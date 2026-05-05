// Tiny Vite plugin: HTML partial includes + mode-conditional blocks.
//
// Why not use vite-plugin-html / posthtml? Both pull in a heavy ecosystem of
// transforms we don't need. Our use case is a one-off de-duplication of two
// near-identical HTML entry points (popup.html + sidepanel.html). A 50-line
// plugin keeps the build pipeline boring.
//
// Supported syntax inside an HTML entry:
//
//   <!--@include path/to/partial.html-->
//     ↳ inlined verbatim (path is resolved relative to the including file).
//   <!--@if popup-->...<!--@endif-->
//     ↳ kept only when the file being processed is popup.html.
//   <!--@if sidepanel-->...<!--@endif-->
//     ↳ kept only when the file being processed is sidepanel.html.
//
// Conditions are matched against the *file basename* (without `.html`), so
// any future entry like `options.html` would naturally support `@if options`.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

const INCLUDE_RE = /<!--\s*@include\s+([^\s>]+)\s*-->/g;
const IF_BLOCK_RE = /<!--\s*@if\s+([\w-]+)\s*-->([\s\S]*?)<!--\s*@endif\s*-->/g;

function applyIncludes(html: string, basePath: string, depth = 0): string {
  if (depth > 10) {
    throw new Error('htmlIncludePlugin: include depth > 10, possible cycle');
  }
  return html.replace(INCLUDE_RE, (_match, relPath: string) => {
    const absPath = resolve(dirname(basePath), relPath);
    const partial = readFileSync(absPath, 'utf8');
    // Recurse: partials may include other partials.
    return applyIncludes(partial, absPath, depth + 1);
  });
}

function applyConditionals(html: string, mode: string): string {
  return html.replace(IF_BLOCK_RE, (_match, condition: string, body: string) => {
    return condition === mode ? body : '';
  });
}

export function htmlIncludePlugin(): Plugin {
  return {
    name: 'html-include',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // ctx.filename is the absolute path to the entry HTML being processed.
        // Strip the directory + extension to derive the mode (e.g. `popup`).
        const basename = ctx.filename.split(/[\\/]/).pop() ?? '';
        const mode = basename.replace(/\.html$/, '');

        // Order matters: expand includes first so the conditional pass sees
        // the merged document and can prune blocks regardless of which file
        // they originated in.
        const withIncludes = applyIncludes(html, ctx.filename);
        const withBranches = applyConditionals(withIncludes, mode);
        return withBranches;
      },
    },
  };
}
