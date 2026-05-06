// Unit tests for content/utils.ts — covers:
//   - parseSrcset: pure string → SrcsetCandidate[] parsing with
//     descriptor handling (Nw / Nx / no descriptor) and width-desc sort
//   - skipElement: defensive guards for non-visual elements +
//     hidden CSS + tiny bounding rect
//   - ensureImageLoaded: timer-based fallback for <img> ready-state
//   - sendDiscoveredImages: chrome.runtime IPC + live-observer teardown
//     on post-reload "Extension context invalidated" failures

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared mock state reference lets individual sendDiscoveredImages cases
// flip isExtensionContextValid's return value + inspect liveObserver
// teardown side-effects. vi.hoisted is mandatory here: vi.mock itself
// is hoisted above every const declaration, so referencing plain consts
// inside the factory would TDZ-throw ("Cannot access 'mockState' before
// initialization"). vi.hoisted runs before the hoisted vi.mock so the
// references resolve correctly.
const { mockState, mockIsValid } = vi.hoisted(() => ({
  mockState: {
    seenUrls: new Set<string>(),
    liveObserver: null as MutationObserver | null,
  },
  mockIsValid: vi.fn(() => true),
}));

vi.mock('../content/state', () => ({
  state: mockState,
  isExtensionContextValid: mockIsValid,
}));

import {
  ensureImageLoaded,
  parseSrcset,
  sendDiscoveredImages,
  skipElement,
} from '../content/utils';
import { MESSAGE_TYPES } from '../shared/constants';
import type { ImageItem } from '../shared/types';

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// parseSrcset — string → candidate[] + width-desc sort
// ─────────────────────────────────────────────────────────────────────

describe('parseSrcset', () => {
  it('parses "Nw" descriptors and sorts by width descending', () => {
    const result = parseSrcset('small.jpg 320w, medium.jpg 800w, large.jpg 1600w');
    expect(result).toEqual([
      { url: 'large.jpg', width: 1600 },
      { url: 'medium.jpg', width: 800 },
      { url: 'small.jpg', width: 320 },
    ]);
  });

  it('parses "Nx" density descriptors as N * 1000 (approximate width)', () => {
    // 1x → 1000, 2x → 2000, 3x → 3000 — pin the 1000 multiplier
    // so a refactor that switches to literal density doesn't silently
    // reverse the sort.
    const result = parseSrcset('low.jpg 1x, hi.jpg 2x, retina.jpg 3x');
    expect(result).toEqual([
      { url: 'retina.jpg', width: 3000 },
      { url: 'hi.jpg', width: 2000 },
      { url: 'low.jpg', width: 1000 },
    ]);
  });

  it('handles fractional density descriptors (1.5x → 1500)', () => {
    const result = parseSrcset('a.jpg 1x, b.jpg 1.5x');
    expect(result).toEqual([
      { url: 'b.jpg', width: 1500 },
      { url: 'a.jpg', width: 1000 },
    ]);
  });

  it('treats a candidate without descriptor as width=0 (sorted last)', () => {
    const result = parseSrcset('plain.jpg, sized.jpg 800w');
    expect(result).toEqual([
      { url: 'sized.jpg', width: 800 },
      { url: 'plain.jpg', width: 0 },
    ]);
  });

  it('mixes Nw and Nx in the same srcset (effectively-larger Nx wins via the *1000 approx)', () => {
    // 2x→2000 ranks above 800w; this is the documented "approximate"
    // semantics. If a refactor changes the multiplier, sort flips.
    const result = parseSrcset('a.jpg 800w, b.jpg 2x');
    expect(result).toEqual([
      { url: 'b.jpg', width: 2000 },
      { url: 'a.jpg', width: 800 },
    ]);
  });

  it('tolerates extra whitespace around commas and inside parts', () => {
    const result = parseSrcset('  a.jpg   320w  ,   b.jpg 800w   ');
    expect(result).toEqual([
      { url: 'b.jpg', width: 800 },
      { url: 'a.jpg', width: 320 },
    ]);
  });

  it('handles single-candidate srcset (just url, no descriptor)', () => {
    expect(parseSrcset('only.jpg')).toEqual([{ url: 'only.jpg', width: 0 }]);
  });

  it('returns [] for empty / whitespace-only srcset', () => {
    expect(parseSrcset('')).toEqual([]);
    // Whitespace-only string still splits into [' '], but trim().split
    // gives ['']  → !url filters it out.
    expect(parseSrcset('   ')).toEqual([]);
  });

  it('skips empty parts from leading/trailing/double commas (defensive)', () => {
    // ',a.jpg 1x,,b.jpg 2x,' should yield only 2 candidates.
    expect(parseSrcset(',a.jpg 1x,,b.jpg 2x,')).toEqual([
      { url: 'b.jpg', width: 2000 },
      { url: 'a.jpg', width: 1000 },
    ]);
  });

  it('parses absolute URLs preserving the entire URL token', () => {
    const result = parseSrcset(
      'https://cdn.example.com/a.jpg 800w, https://cdn.example.com/b.jpg 1600w'
    );
    expect(result[0].url).toBe('https://cdn.example.com/b.jpg');
    expect(result[1].url).toBe('https://cdn.example.com/a.jpg');
  });

  it('unrecognized descriptor suffix → width stays 0 (defensive default)', () => {
    // 'h' is neither 'w' nor 'x' — descriptor is ignored, width=0.
    const result = parseSrcset('a.jpg 100h, b.jpg 200w');
    expect(result).toEqual([
      { url: 'b.jpg', width: 200 },
      { url: 'a.jpg', width: 0 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// skipElement — non-visual / hidden / too-small guards
// ─────────────────────────────────────────────────────────────────────

describe('skipElement', () => {
  function makeEl(tag: string): Element {
    const el = document.createElement(tag);
    document.body.appendChild(el);
    return el;
  }

  function stubRect(el: Element, w: number, h: number): void {
    // jsdom's getBoundingClientRect returns 0; stub it.
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        width: w,
        height: h,
        top: 0,
        left: 0,
        right: w,
        bottom: h,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
      configurable: true,
    });
  }

  it.each(['script', 'style', 'link', 'meta', 'title', 'head', 'html', 'noscript'])(
    'skips <%s> element (non-visual tag)',
    (tag) => {
      const el = makeEl(tag);
      // Even if we stub a large rect, the tag-name guard fires first.
      stubRect(el, 100, 100);
      expect(skipElement(el)).toBe(true);
    }
  );

  it('skips an element with display:none (computed style)', () => {
    const el = makeEl('div');
    el.setAttribute('style', 'display: none');
    stubRect(el, 100, 100);
    expect(skipElement(el)).toBe(true);
  });

  it('skips an element with visibility:hidden', () => {
    const el = makeEl('div');
    el.setAttribute('style', 'visibility: hidden');
    stubRect(el, 100, 100);
    expect(skipElement(el)).toBe(true);
  });

  it('skips a tiny element (rect.width < 10)', () => {
    const el = makeEl('div');
    stubRect(el, 5, 100);
    expect(skipElement(el)).toBe(true);
  });

  it('skips a tiny element (rect.height < 10)', () => {
    const el = makeEl('div');
    stubRect(el, 100, 5);
    expect(skipElement(el)).toBe(true);
  });

  it('does NOT skip a normal visible div with sufficient size', () => {
    const el = makeEl('div');
    stubRect(el, 100, 100);
    expect(skipElement(el)).toBe(false);
  });

  it('does NOT skip an exactly-10×10 element (boundary is < 10, not <= 10)', () => {
    const el = makeEl('div');
    stubRect(el, 10, 10);
    expect(skipElement(el)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// ensureImageLoaded — Promise<void> that resolves on load / error / 2s timeout
// ─────────────────────────────────────────────────────────────────────

describe('ensureImageLoaded', () => {
  // Helper: fake <img> surface exposing the subset ensureImageLoaded
  // touches. Real HTMLImageElement under jsdom wouldn't actually fire
  // load/error without a network request, so we keep the stub explicit.
  interface FakeImg {
    complete: boolean;
    naturalWidth: number;
    addEventListener: ReturnType<typeof vi.fn>;
    handlers: { load?: () => void; error?: () => void };
  }

  function makeImg(complete: boolean, naturalWidth: number): FakeImg {
    const handlers: FakeImg['handlers'] = {};
    const addEventListener = vi.fn((evt: string, cb: () => void) => {
      if (evt === 'load') handlers.load = cb;
      if (evt === 'error') handlers.error = cb;
    });
    return {
      complete,
      naturalWidth,
      addEventListener,
      handlers,
    };
  }

  it('resolves immediately when img.complete && naturalWidth>0 (fast path, no listeners attached)', async () => {
    // Pin: the synchronous fast-path. A regression that always attached
    // listeners would add a micro-task delay to every already-decoded
    // image in a scan (hundreds of delays in practice).
    const img = makeImg(true, 800);
    await ensureImageLoaded(img as unknown as HTMLImageElement);
    expect(img.addEventListener).not.toHaveBeenCalled();
  });

  it('resolves when the <img> fires load (clearing the 2s timer)', async () => {
    vi.useFakeTimers();
    const img = makeImg(false, 0);
    const promise = ensureImageLoaded(img as unknown as HTMLImageElement);
    expect(img.addEventListener).toHaveBeenCalledTimes(2);
    // Fire the load handler registered by ensureImageLoaded.
    img.handlers.load?.();
    await promise;
    // Pin: once resolved via load, advancing past 2s must NOT cause any
    // double-resolve / stale timer callback — Promise already settled.
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
  });

  it('resolves when the <img> fires error (treats broken images same as loaded — no rejection)', async () => {
    // Pin the never-reject contract. Callers rely on ensureImageLoaded
    // always resolving so a single broken <img> never breaks the
    // Promise.all that wraps an entire scan batch.
    vi.useFakeTimers();
    const img = makeImg(false, 0);
    const promise = ensureImageLoaded(img as unknown as HTMLImageElement);
    img.handlers.error?.();
    await promise;
    vi.useRealTimers();
  });

  it('resolves after the 2s timeout when neither load nor error ever fires', async () => {
    vi.useFakeTimers();
    const img = makeImg(false, 0);
    const promise = ensureImageLoaded(img as unknown as HTMLImageElement);
    vi.advanceTimersByTime(2000);
    await promise;
    vi.useRealTimers();
  });

  it('attaches load+error with {once:true} so listeners self-clean', () => {
    const img = makeImg(false, 0);
    void ensureImageLoaded(img as unknown as HTMLImageElement);
    // Pin: both listeners registered with {once:true}. Without this a
    // long-lived <img> element (e.g. live monitoring path) would accrete
    // dead handlers on every ensureImageLoaded call.
    const calls = img.addEventListener.mock.calls;
    expect(calls[0][2]).toEqual({ once: true });
    expect(calls[1][2]).toEqual({ once: true });
  });

  it('treats complete=true but naturalWidth=0 as NOT loaded (broken <img> guard)', () => {
    // Pin: decoded-but-empty images (broken src, 404) have complete=true
    // naturalWidth=0. ensureImageLoaded must still attach listeners +
    // start the 2s timeout rather than resolve instantly.
    const img = makeImg(true, 0);
    void ensureImageLoaded(img as unknown as HTMLImageElement);
    expect(img.addEventListener).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// sendDiscoveredImages — IPC + post-reload teardown
// ─────────────────────────────────────────────────────────────────────

describe('sendDiscoveredImages', () => {
  const images: ImageItem[] = [{ id: 'a', url: 'https://x.com/a.png' } as ImageItem];

  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockIsValid.mockReturnValue(true);
    mockState.liveObserver = null;
    sendMessage = vi.fn().mockResolvedValue(undefined);
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { id: 'x', sendMessage },
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    mockIsValid.mockReset();
    mockIsValid.mockReturnValue(true);
  });

  it('returns without sending when isExtensionContextValid() is false (post-reload guard)', () => {
    mockIsValid.mockReturnValue(false);
    sendDiscoveredImages(images);
    // Pin: no IPC attempted. A regression dropping this guard would
    // throw "Extension context invalidated" noisily on every scan tick
    // after a dev-mode reload.
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends IMAGES_DISCOVERED with the payload on the happy path', () => {
    sendDiscoveredImages(images);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      images,
    });
  });

  it('swallows sendMessage rejection (fire-and-forget contract)', async () => {
    // Pin: the .catch(() => {}) means callers never see IPC failures.
    // A regression removing it would surface UnhandledPromiseRejection
    // warnings across every scan.
    sendMessage.mockRejectedValueOnce(new Error('receiver missing'));
    expect(() => sendDiscoveredImages(images)).not.toThrow();
    // Drain the microtask queue so the attached .catch actually runs.
    await Promise.resolve();
    await Promise.resolve();
  });

  it('catch branch: isExtensionContextValid throws → tears down liveObserver (disconnect + null)', () => {
    // Pin: the defensive catch. If the extension reload races with a
    // scan tick, the validity probe itself can throw. The contract is:
    // stop the observer (no further callbacks possible on dead runtime)
    // and null out the reference (future ticks short-circuit).
    const disconnect = vi.fn();
    const observer = { disconnect } as unknown as MutationObserver;
    mockState.liveObserver = observer;
    mockIsValid.mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    expect(() => sendDiscoveredImages(images)).not.toThrow();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(mockState.liveObserver).toBeNull();
  });

  it('catch branch with no liveObserver: no-op teardown, does not crash', () => {
    mockState.liveObserver = null;
    mockIsValid.mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    expect(() => sendDiscoveredImages(images)).not.toThrow();
  });
});
