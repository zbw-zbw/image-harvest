// Unit tests for content/utils.ts — focused on:
//   - parseSrcset: pure string → SrcsetCandidate[] parsing with
//     descriptor handling (Nw / Nx / no descriptor) and width-desc sort
//   - skipElement: defensive guards for non-visual elements +
//     hidden CSS + tiny bounding rect
//
// Out of scope (timer/IPC):
//   - ensureImageLoaded (timer + addEventListener)
//   - sendDiscoveredImages (chrome.runtime IPC)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../content/state', () => ({
  state: {
    seenUrls: new Set<string>(),
    liveObserver: null,
  },
  isExtensionContextValid: vi.fn(() => true),
}));

import { parseSrcset, skipElement } from '../content/utils';

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
    const result = parseSrcset(
      'small.jpg 320w, medium.jpg 800w, large.jpg 1600w'
    );
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
