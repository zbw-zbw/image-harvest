// createDefaultDeps().observeMutations — real MutationObserver coverage.
//
// The node-environment content-auto-scroll.test.ts mocks observeMutations
// entirely, so the 2026-10-13 swap-src fix (attributeFilter on src/srcset)
// is invisible there. This file runs under jsdom (environmentMatchGlobs
// maps *.test.tsx), where MutationObserver is real: an existing <img> whose
// data-src is swapped to src must count as lazy-load activity, otherwise
// deep scan aborts such pages as 'stalled' after three "idle" steps.

import { describe, expect, it } from 'vitest';
import { createDefaultDeps } from '../content/auto-scroll';

function tick(): Promise<void> {
  // MutationObserver callbacks are microtask-scheduled; one macrotask hop
  // guarantees delivery.
  return new Promise((r) => setTimeout(r, 0));
}

describe('createDefaultDeps observeMutations (jsdom)', () => {
  it('counts a data-src → src swap on an existing <img> as activity', async () => {
    document.body.innerHTML = '<img data-src="https://example.com/lazy.png" alt="">';
    const calls: number[] = [];
    const stop = createDefaultDeps(
      async () => [],
      () => []
    ).observeMutations((added) => calls.push(added));

    const el = document.querySelector('img')!;
    el.src = 'https://example.com/lazy.png';

    await tick();
    stop();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('counts srcset changes on <source> elements', async () => {
    document.body.innerHTML =
      '<picture><source data-srcset="https://example.com/a.webp" type="image/webp"><img alt=""></picture>';
    const calls: number[] = [];
    const stop = createDefaultDeps(
      async () => [],
      () => []
    ).observeMutations((added) => calls.push(added));

    document.querySelector('source')!.srcset = 'https://example.com/a.webp';

    await tick();
    stop();

    expect(calls.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('still counts newly appended <img> nodes (childList path)', async () => {
    document.body.innerHTML = '';
    const calls: number[] = [];
    const stop = createDefaultDeps(
      async () => [],
      () => []
    ).observeMutations((added) => calls.push(added));

    const img = document.createElement('img');
    img.src = 'https://example.com/new.png';
    document.body.appendChild(img);

    await tick();
    stop();

    expect(calls.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('ignores attribute changes on non-image elements', async () => {
    document.body.innerHTML = '<div class="x"></div>';
    const calls: number[] = [];
    const stop = createDefaultDeps(
      async () => [],
      () => []
    ).observeMutations((added) => calls.push(added));

    document.querySelector('div')!.className = 'y';

    await tick();
    stop();

    expect(calls).toHaveLength(0);
  });

  it('ignores data-alt changes on an <img> (filter scope)', async () => {
    document.body.innerHTML = '<img alt="">';
    const calls: number[] = [];
    const stop = createDefaultDeps(
      async () => [],
      () => []
    ).observeMutations((added) => calls.push(added));

    document.querySelector('img')!.alt = 'decorative';

    await tick();
    stop();

    expect(calls).toHaveLength(0);
  });
});
