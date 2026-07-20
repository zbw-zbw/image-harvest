// Unit tests for content/state.ts — the shared in-memory state bag + the
// extension-context validity probe used by every content-script entry
// point before it touches chrome.runtime.
//
// These 33 lines were entirely unmeasured until coverage.include widened
// beyond shared/**. Small file, pure logic → highest ROI sweep.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evictOldestSeenUrls, isExtensionContextValid, state } from '../content/state';

// Preserve the original singleton across tests so mutations inside one
// case never leak into another.
const INITIAL = {
  isExtracting: state.isExtracting,
  liveObserver: state.liveObserver,
};

beforeEach(() => {
  state.isExtracting = INITIAL.isExtracting;
  state.liveObserver = INITIAL.liveObserver;
  state.seenUrls.clear();
});

afterEach(() => {
  // Restore globals any case may have clobbered.
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

// ─────────────────────────────────────────────────────────────────────
// state singleton — default shape + mutability
// ─────────────────────────────────────────────────────────────────────

describe('state', () => {
  it('exposes the three documented fields with the expected defaults', () => {
    // Pin the initial shape. Any drift here (e.g. someone adding a field
    // without updating the ContentState interface) would surface as a
    // TypeScript error rather than a runtime bug, so we pin values too.
    expect(state.isExtracting).toBe(false);
    expect(state.liveObserver).toBeNull();
    expect(state.seenUrls).toBeInstanceOf(Set);
    expect(state.seenUrls.size).toBe(0);
  });

  it('is mutable in place — writes persist across imports (singleton contract)', () => {
    // Pin: content modules rely on `state` being a live singleton. If
    // a refactor accidentally exported a new frozen object on every
    // import, this case would fail — and every content script would
    // silently lose its extraction-in-progress flag.
    state.isExtracting = true;
    state.seenUrls.add('https://example.com/a.png');
    expect(state.isExtracting).toBe(true);
    expect(state.seenUrls.has('https://example.com/a.png')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// isExtensionContextValid — chrome.runtime probe
// ─────────────────────────────────────────────────────────────────────

describe('isExtensionContextValid', () => {
  it('returns true when chrome.runtime.id is present (normal extension lifecycle)', () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { id: 'test-extension-id' },
    };
    expect(isExtensionContextValid()).toBe(true);
  });

  it('returns false when chrome.runtime exists but id is empty (guard against half-initialized runtime)', () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { id: '' },
    };
    expect(isExtensionContextValid()).toBe(false);
  });

  it('returns false when chrome.runtime is undefined (optional chaining guard)', () => {
    // Pin: `chrome.runtime?.id` — runtime undefined should short-circuit
    // to undefined not throw. Any refactor dropping the `?.` would cause
    // every post-reload content script to crash on its first IPC.
    (globalThis as unknown as { chrome: unknown }).chrome = {};
    expect(isExtensionContextValid()).toBe(false);
  });

  it('returns false when the whole chrome global is gone (catch branch)', () => {
    // After extension reload the old content script stays alive but
    // `chrome` itself becomes undefined on some browsers — the top-level
    // property access throws ReferenceError, which the try/catch must
    // swallow and return false (not propagate).
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    expect(isExtensionContextValid()).toBe(false);
  });

  it('returns false when accessing chrome.runtime throws ("Extension context invalidated")', () => {
    // Reproduce the classic post-reload failure: the `chrome` proxy
    // throws on any runtime access. The try/catch must swallow it.
    (globalThis as unknown as { chrome: unknown }).chrome = new Proxy(
      {},
      {
        get() {
          throw new Error('Extension context invalidated.');
        },
      }
    );
    expect(isExtensionContextValid()).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────
// evictOldestSeenUrls — approximate-LRU bound on the dedup set
// ──────────────────────────────────────────────────────────────

describe('evictOldestSeenUrls', () => {
  it('is a no-op when size <= max', () => {
    state.seenUrls.add('a');
    state.seenUrls.add('b');
    evictOldestSeenUrls(10);
    expect(state.seenUrls.size).toBe(2);
    expect(state.seenUrls.has('a')).toBe(true);
  });

  it('evicts oldest first, keeping the newest ~half, when size exceeds max', () => {
    // Set preserves insertion order, so url-0 is the oldest.
    for (let i = 0; i < 12; i++) state.seenUrls.add(`url-${i}`);
    evictOldestSeenUrls(10); // 12 > 10 → evict down to floor(10/2)=5 newest
    expect(state.seenUrls.size).toBe(5);
    expect(state.seenUrls.has('url-0')).toBe(false); // oldest evicted
    expect(state.seenUrls.has('url-6')).toBe(false); // boundary evicted
    expect(state.seenUrls.has('url-7')).toBe(true); // boundary kept
    expect(state.seenUrls.has('url-11')).toBe(true); // newest kept
  });
});
