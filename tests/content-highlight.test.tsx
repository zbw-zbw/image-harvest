// Unit tests for content/highlight.ts — focused on:
//   - toggleFAB / removeFAB: legacy stub + stale FAB cleanup
//   - addHighlight: findImageElement dispatch + scroll guard +
//     metadata-element early-acknowledge contract
//   - removeSingleHighlight / removeAllHighlights: cleanup + overlay
//     teardown when entry count hits zero
//   - syncHighlights: diff-based add/remove against current selection
//
// Out of scope: the rAF position-tracking loop (e2e-only) and the
// findImageElement deep recursion through Shadow DOM / pseudo-elements
// (covered structurally by the canonical img/video/input/object/embed
// branches).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shared/utils', () => ({
  resolveUrl: vi.fn((u: string) => u), // identity — test URLs are absolute
  isDataUri: vi.fn((u: string) => u.startsWith('data:')),
  generateDataUriKey: vi.fn((u: string) => `key-${u}`),
  extractBackgroundUrls: vi.fn((bg: string) => {
    const matches = bg.match(/url\(['"]?([^'")]+)['"]?\)/g) || [];
    return matches.map((m) => m.replace(/url\(['"]?([^'")]+)['"]?\)/, '$1'));
  }),
}));

vi.mock('../content/utils', () => ({
  parseSrcset: vi.fn((srcset: string) =>
    srcset.split(',').map((part) => {
      const [url] = part.trim().split(/\s+/);
      return { url, width: 0 };
    })
  ),
}));

vi.mock('../content/shadow-iframe', () => ({
  collectShadowRoots: vi.fn(() => []),
}));

// Mock chrome.runtime so dismissAllHighlights doesn't blow up.
const sendMessageSpy = vi.fn();
beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  // Reset chrome global per-test.
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { sendMessage: sendMessageSpy },
  };
  sendMessageSpy.mockReset();
  // jsdom doesn't implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  // Stub rAF to fire ONCE then stop — prevents leaking infinite frames
  // across tests (real impl recursively schedules).
  let rafCount = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => {
      // Run only the first scheduled frame; subsequent ones become no-ops.
      if (rafCount++ === 0) cb(0);
      return rafCount;
    })
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(async () => {
  // Sweep highlights between cases via removeAllHighlights — module-level
  // Map state otherwise leaks across tests.
  const { removeAllHighlights } = await import('../content/highlight');
  removeAllHighlights();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Helper — stub getBoundingClientRect (jsdom returns 0).
function stubRect(el: Element, w = 100, h = 100): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({
      width: w,
      height: h,
      top: 50,
      left: 50,
      right: 50 + w,
      bottom: 50 + h,
      x: 50,
      y: 50,
      toJSON: () => ({}),
    }),
    configurable: true,
  });
}

// ─────────────────────────────────────────────────────────────────────
// toggleFAB / removeFAB
// ─────────────────────────────────────────────────────────────────────

describe('toggleFAB / removeFAB', () => {
  it('toggleFAB is a no-op (legacy stub since v2.0)', async () => {
    const { toggleFAB } = await import('../content/highlight');
    // Should not throw and not mutate the DOM.
    const before = document.body.innerHTML;
    toggleFAB();
    expect(document.body.innerHTML).toBe(before);
  });

  it('removeFAB cleans up stale #image-snatcher-fab-host elements', async () => {
    const stale = document.createElement('div');
    stale.id = 'image-snatcher-fab-host';
    document.body.appendChild(stale);
    const stale2 = document.createElement('div');
    stale2.id = 'image-snatcher-fab-host';
    document.body.appendChild(stale2);

    const { removeFAB } = await import('../content/highlight');
    removeFAB();
    expect(document.querySelectorAll('#image-snatcher-fab-host')).toHaveLength(0);
  });

  it('removeFAB is a no-op when no stale FAB exists', async () => {
    const { removeFAB } = await import('../content/highlight');
    expect(() => removeFAB()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────
// addHighlight — findImageElement dispatch + scroll/found contract
// ─────────────────────────────────────────────────────────────────────

describe('addHighlight', () => {
  it('returns {found:false} when URL has no matching element on the page', async () => {
    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://no-such-image.example.com/x.jpg')).toEqual({
      found: false,
    });
  });

  it('returns {found:true} for matching <img src=...>', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/photo.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/photo.jpg')).toEqual({ found: true });
  });

  it('matches <img srcset> candidate URLs', async () => {
    const img = document.createElement('img');
    img.srcset = 'https://example.com/small.jpg 320w, https://example.com/large.jpg 800w';
    stubRect(img);
    document.body.appendChild(img);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/large.jpg').found).toBe(true);
  });

  it('matches <img data-src> lazy-load attribute', async () => {
    const img = document.createElement('img');
    img.setAttribute('data-src', 'https://example.com/lazy.jpg');
    stubRect(img);
    document.body.appendChild(img);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/lazy.jpg').found).toBe(true);
  });

  it('matches <video poster>', async () => {
    const video = document.createElement('video');
    video.poster = 'https://example.com/cover.jpg';
    stubRect(video);
    document.body.appendChild(video);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/cover.jpg').found).toBe(true);
  });

  it('matches <input type="image">', async () => {
    const input = document.createElement('input');
    input.type = 'image';
    input.src = 'https://example.com/submit.png';
    stubRect(input);
    document.body.appendChild(input);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/submit.png').found).toBe(true);
  });

  it('matches <object data=...> with image type', async () => {
    const obj = document.createElement('object');
    obj.data = 'https://example.com/graphic.png';
    stubRect(obj);
    document.body.appendChild(obj);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/graphic.png').found).toBe(true);
  });

  it('matches <embed src=...> with image type', async () => {
    const embed = document.createElement('embed');
    embed.src = 'https://example.com/graphic.jpg';
    stubRect(embed);
    document.body.appendChild(embed);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/graphic.jpg').found).toBe(true);
  });

  it('returns {found:true} for metadata elements (<link>, <meta>) WITHOUT actually highlighting', async () => {
    // Pin the contract: <link>/<meta> live in <head>, can't be visually
    // highlighted, but addHighlight still acknowledges they exist so
    // the sidepanel won't show "not found" when the user clicks.
    const meta = document.createElement('meta');
    meta.setAttribute('property', 'og:image');
    meta.setAttribute('content', 'https://example.com/og.jpg');
    document.head.appendChild(meta);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/og.jpg')).toEqual({ found: true });
    // No border element should have been appended for metadata.
    expect(document.querySelectorAll('.image-snatcher-highlight-border')).toHaveLength(0);
  });

  it('calls scrollIntoView on the target by default (shouldScroll=true)', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/scroll-me.jpg';
    stubRect(img);
    document.body.appendChild(img);
    const scrollSpy = vi.spyOn(img, 'scrollIntoView');

    const { addHighlight } = await import('../content/highlight');
    addHighlight('https://example.com/scroll-me.jpg');
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('skips scrollIntoView when shouldScroll=false', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/no-scroll.jpg';
    stubRect(img);
    document.body.appendChild(img);
    const scrollSpy = vi.spyOn(img, 'scrollIntoView');

    const { addHighlight } = await import('../content/highlight');
    addHighlight('https://example.com/no-scroll.jpg', false);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('idempotent: calling addHighlight twice on the same URL returns {found:true} both times without duplicating border', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/idempotent.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/idempotent.jpg').found).toBe(true);
    expect(addHighlight('https://example.com/idempotent.jpg').found).toBe(true);
    // Only ONE border element should exist.
    expect(document.querySelectorAll('.image-snatcher-highlight-border')).toHaveLength(1);
  });

  it('appends a fixed-position border with data-highlight-url=URL', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/border.jpg';
    stubRect(img, 200, 100);
    document.body.appendChild(img);

    const { addHighlight } = await import('../content/highlight');
    addHighlight('https://example.com/border.jpg', false);

    const border = document.querySelector('.image-snatcher-highlight-border') as HTMLDivElement;
    expect(border).not.toBeNull();
    expect(border.dataset.highlightUrl).toBe('https://example.com/border.jpg');
    expect(border.style.position).toBe('fixed');
  });

  it('installs a full-viewport overlay on first highlight', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/overlay.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { addHighlight } = await import('../content/highlight');
    addHighlight('https://example.com/overlay.jpg', false);

    expect(document.querySelector('.image-snatcher-overlay')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// removeSingleHighlight
// ─────────────────────────────────────────────────────────────────────

describe('removeSingleHighlight', () => {
  it('removes border + entry for the given URL', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/single.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { addHighlight, removeSingleHighlight } = await import('../content/highlight');
    addHighlight('https://example.com/single.jpg', false);
    expect(document.querySelectorAll('.image-snatcher-highlight-border')).toHaveLength(1);

    removeSingleHighlight('https://example.com/single.jpg');
    expect(document.querySelectorAll('.image-snatcher-highlight-border')).toHaveLength(0);
  });

  it('removes overlay when the LAST highlight is removed', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/last.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { addHighlight, removeSingleHighlight } = await import('../content/highlight');
    addHighlight('https://example.com/last.jpg', false);
    expect(document.querySelector('.image-snatcher-overlay')).not.toBeNull();

    removeSingleHighlight('https://example.com/last.jpg');
    expect(document.querySelector('.image-snatcher-overlay')).toBeNull();
  });

  it('preserves overlay when there are still highlights remaining', async () => {
    const img1 = document.createElement('img');
    img1.src = 'https://example.com/keep1.jpg';
    stubRect(img1);
    document.body.appendChild(img1);
    const img2 = document.createElement('img');
    img2.src = 'https://example.com/keep2.jpg';
    stubRect(img2);
    document.body.appendChild(img2);

    const { addHighlight, removeSingleHighlight } = await import('../content/highlight');
    addHighlight('https://example.com/keep1.jpg', false);
    addHighlight('https://example.com/keep2.jpg', false);

    removeSingleHighlight('https://example.com/keep1.jpg');
    expect(document.querySelector('.image-snatcher-overlay')).not.toBeNull();
    expect(document.querySelectorAll('.image-snatcher-highlight-border')).toHaveLength(1);
  });

  it('is a no-op for an unknown URL (silent failure)', async () => {
    const { removeSingleHighlight } = await import('../content/highlight');
    expect(() => removeSingleHighlight('https://nope.example.com/x.jpg')).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────
// removeAllHighlights
// ─────────────────────────────────────────────────────────────────────

describe('removeAllHighlights', () => {
  it('clears all borders + overlay in one call', async () => {
    for (const url of ['a.jpg', 'b.jpg', 'c.jpg']) {
      const img = document.createElement('img');
      img.src = `https://example.com/${url}`;
      stubRect(img);
      document.body.appendChild(img);
    }

    const { addHighlight, removeAllHighlights } = await import('../content/highlight');
    addHighlight('https://example.com/a.jpg', false);
    addHighlight('https://example.com/b.jpg', false);
    addHighlight('https://example.com/c.jpg', false);
    expect(document.querySelectorAll('.image-snatcher-highlight-border')).toHaveLength(3);

    removeAllHighlights();
    expect(document.querySelectorAll('.image-snatcher-highlight-border')).toHaveLength(0);
    expect(document.querySelector('.image-snatcher-overlay')).toBeNull();
  });

  it('is a no-op when no highlights exist', async () => {
    const { removeAllHighlights } = await import('../content/highlight');
    expect(() => removeAllHighlights()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────
// syncHighlights — diff-based add/remove
// ─────────────────────────────────────────────────────────────────────

describe('syncHighlights', () => {
  it('adds new highlights from input list (none existed before)', async () => {
    const img1 = document.createElement('img');
    img1.src = 'https://example.com/sync1.jpg';
    stubRect(img1);
    document.body.appendChild(img1);
    const img2 = document.createElement('img');
    img2.src = 'https://example.com/sync2.jpg';
    stubRect(img2);
    document.body.appendChild(img2);

    const { syncHighlights } = await import('../content/highlight');
    syncHighlights(['https://example.com/sync1.jpg', 'https://example.com/sync2.jpg']);
    expect(document.querySelectorAll('.image-snatcher-highlight-border')).toHaveLength(2);
  });

  it('removes highlights that are no longer in the input list', async () => {
    const img1 = document.createElement('img');
    img1.src = 'https://example.com/keep.jpg';
    stubRect(img1);
    document.body.appendChild(img1);
    const img2 = document.createElement('img');
    img2.src = 'https://example.com/drop.jpg';
    stubRect(img2);
    document.body.appendChild(img2);

    const { syncHighlights } = await import('../content/highlight');
    syncHighlights(['https://example.com/keep.jpg', 'https://example.com/drop.jpg']);
    expect(document.querySelectorAll('.image-snatcher-highlight-border')).toHaveLength(2);

    // Re-sync with only "keep".
    syncHighlights(['https://example.com/keep.jpg']);
    const remaining = document.querySelectorAll('.image-snatcher-highlight-border');
    expect(remaining).toHaveLength(1);
    expect((remaining[0] as HTMLElement).dataset.highlightUrl).toBe(
      'https://example.com/keep.jpg'
    );
  });

  it('does NOT re-create borders for URLs that are already highlighted (idempotent intersection)', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/stable.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { syncHighlights } = await import('../content/highlight');
    syncHighlights(['https://example.com/stable.jpg']);
    const firstBorder = document.querySelector('.image-snatcher-highlight-border');

    // Re-sync with same URL — should be the SAME border element.
    syncHighlights(['https://example.com/stable.jpg']);
    const secondBorder = document.querySelector('.image-snatcher-highlight-border');

    expect(secondBorder).toBe(firstBorder);
    expect(document.querySelectorAll('.image-snatcher-highlight-border')).toHaveLength(1);
  });

  it('empty input list clears all highlights and removes overlay', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/clear.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { syncHighlights } = await import('../content/highlight');
    syncHighlights(['https://example.com/clear.jpg']);
    expect(document.querySelectorAll('.image-snatcher-highlight-border')).toHaveLength(1);

    syncHighlights([]);
    expect(document.querySelectorAll('.image-snatcher-highlight-border')).toHaveLength(0);
    expect(document.querySelector('.image-snatcher-overlay')).toBeNull();
  });

  it('silently skips URLs with no matching element (passes through, no border created)', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/exists.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { syncHighlights } = await import('../content/highlight');
    syncHighlights([
      'https://example.com/exists.jpg',
      'https://example.com/ghost.jpg',
    ]);
    // Only ONE border (for the existing img); ghost URL contributes nothing.
    expect(document.querySelectorAll('.image-snatcher-highlight-border')).toHaveLength(1);
  });
});
