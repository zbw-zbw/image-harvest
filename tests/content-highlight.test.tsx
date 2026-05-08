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

  it('removeFAB cleans up stale #image-harvest-fab-host elements', async () => {
    const stale = document.createElement('div');
    stale.id = 'image-harvest-fab-host';
    document.body.appendChild(stale);
    const stale2 = document.createElement('div');
    stale2.id = 'image-harvest-fab-host';
    document.body.appendChild(stale2);

    const { removeFAB } = await import('../content/highlight');
    removeFAB();
    expect(document.querySelectorAll('#image-harvest-fab-host')).toHaveLength(0);
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
    expect(document.querySelectorAll('.image-harvest-highlight-border')).toHaveLength(0);
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
    expect(document.querySelectorAll('.image-harvest-highlight-border')).toHaveLength(1);
  });

  it('appends a fixed-position border with data-highlight-url=URL', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/border.jpg';
    stubRect(img, 200, 100);
    document.body.appendChild(img);

    const { addHighlight } = await import('../content/highlight');
    addHighlight('https://example.com/border.jpg', false);

    const border = document.querySelector('.image-harvest-highlight-border') as HTMLDivElement;
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

    expect(document.querySelector('.image-harvest-overlay')).not.toBeNull();
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
    expect(document.querySelectorAll('.image-harvest-highlight-border')).toHaveLength(1);

    removeSingleHighlight('https://example.com/single.jpg');
    expect(document.querySelectorAll('.image-harvest-highlight-border')).toHaveLength(0);
  });

  it('removes overlay when the LAST highlight is removed', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/last.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { addHighlight, removeSingleHighlight } = await import('../content/highlight');
    addHighlight('https://example.com/last.jpg', false);
    expect(document.querySelector('.image-harvest-overlay')).not.toBeNull();

    removeSingleHighlight('https://example.com/last.jpg');
    expect(document.querySelector('.image-harvest-overlay')).toBeNull();
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
    expect(document.querySelector('.image-harvest-overlay')).not.toBeNull();
    expect(document.querySelectorAll('.image-harvest-highlight-border')).toHaveLength(1);
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
    expect(document.querySelectorAll('.image-harvest-highlight-border')).toHaveLength(3);

    removeAllHighlights();
    expect(document.querySelectorAll('.image-harvest-highlight-border')).toHaveLength(0);
    expect(document.querySelector('.image-harvest-overlay')).toBeNull();
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
    expect(document.querySelectorAll('.image-harvest-highlight-border')).toHaveLength(2);
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
    expect(document.querySelectorAll('.image-harvest-highlight-border')).toHaveLength(2);

    // Re-sync with only "keep".
    syncHighlights(['https://example.com/keep.jpg']);
    const remaining = document.querySelectorAll('.image-harvest-highlight-border');
    expect(remaining).toHaveLength(1);
    expect((remaining[0] as HTMLElement).dataset.highlightUrl).toBe('https://example.com/keep.jpg');
  });

  it('does NOT re-create borders for URLs that are already highlighted (idempotent intersection)', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/stable.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { syncHighlights } = await import('../content/highlight');
    syncHighlights(['https://example.com/stable.jpg']);
    const firstBorder = document.querySelector('.image-harvest-highlight-border');

    // Re-sync with same URL — should be the SAME border element.
    syncHighlights(['https://example.com/stable.jpg']);
    const secondBorder = document.querySelector('.image-harvest-highlight-border');

    expect(secondBorder).toBe(firstBorder);
    expect(document.querySelectorAll('.image-harvest-highlight-border')).toHaveLength(1);
  });

  it('empty input list clears all highlights and removes overlay', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/clear.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { syncHighlights } = await import('../content/highlight');
    syncHighlights(['https://example.com/clear.jpg']);
    expect(document.querySelectorAll('.image-harvest-highlight-border')).toHaveLength(1);

    syncHighlights([]);
    expect(document.querySelectorAll('.image-harvest-highlight-border')).toHaveLength(0);
    expect(document.querySelector('.image-harvest-overlay')).toBeNull();
  });

  it('silently skips URLs with no matching element (passes through, no border created)', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/exists.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { syncHighlights } = await import('../content/highlight');
    syncHighlights(['https://example.com/exists.jpg', 'https://example.com/ghost.jpg']);
    // Only ONE border (for the existing img); ghost URL contributes nothing.
    expect(document.querySelectorAll('.image-harvest-highlight-border')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// findImageElement — deep fallback branches (background / lazy / meta)
// ─────────────────────────────────────────────────────────────────────
// Pin: findImageElement is the sole URL→Element bridge for the highlight
// feature. When a scanned URL doesn't match any <img>, <video> or <picture>,
// these fallback branches are the last line of defense. A regression
// here surfaces as "the side panel says this image exists but clicking
// highlight does nothing" — the #2 most-reported support issue.
//
// Branches pinned below:
//   - section 8: background-image via getComputedStyle
//   - section 8: ::before / ::after pseudo-element content:url(...)
//   - section 9: data-src / data-bg / data-background lazy attrs on
//                non-<img> elements
//   - section 11: <link rel="icon" | "apple-touch-icon" | "mask-icon">
//   - section 12: <meta property="og:image" | "twitter:image"> etc.

describe('addHighlight — background-image / lazy-data / link / meta fallbacks', () => {
  it('matches an element whose CSS background-image URL equals the target', async () => {
    // section 8 fallback — the most common "CSS-painted hero image" case.
    const div = document.createElement('div');
    div.id = 'hero';
    stubRect(div);
    document.body.appendChild(div);

    // jsdom's getComputedStyle returns empty strings by default — stub
    // it to return the CSS background-image we want findImageElement
    // to see. Keep the pseudo-element branch silent for this test.
    const originalGcs = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((
      el: Element,
      pseudo?: string | null
    ) => {
      if (pseudo) return { content: 'none', backgroundImage: 'none' } as CSSStyleDeclaration;
      if (el === div) {
        return {
          backgroundImage: 'url(https://example.com/bg.jpg)',
          content: '',
        } as CSSStyleDeclaration;
      }
      return originalGcs(el);
    }) as typeof window.getComputedStyle);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/bg.jpg').found).toBe(true);
  });

  it('matches ::before pseudo-element content:url(...) when no direct image exists', async () => {
    // section 8 fallback — `content: url(...)` on ::before / ::after is
    // how some sites smuggle icon images into otherwise-empty spans.
    const span = document.createElement('span');
    span.id = 'pseudo-target';
    stubRect(span);
    document.body.appendChild(span);

    const originalGcs = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((
      el: Element,
      pseudo?: string | null
    ) => {
      if (el === span && pseudo === '::before') {
        return {
          content: 'url(https://example.com/icon.png)',
          backgroundImage: 'none',
        } as CSSStyleDeclaration;
      }
      if (el === span) {
        return { backgroundImage: 'none', content: '' } as CSSStyleDeclaration;
      }
      return originalGcs(el, pseudo as string | null);
    }) as typeof window.getComputedStyle);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/icon.png').found).toBe(true);
  });

  it('matches data-src on a non-<img> element (common for lazyload libs)', async () => {
    // section 9 fallback — libraries like lazysizes put data-src on
    // <div> and swap to <img> on intersection. We must still be able
    // to highlight these before the swap happens.
    const div = document.createElement('div');
    div.setAttribute('data-src', 'https://example.com/lazyload.jpg');
    stubRect(div);
    document.body.appendChild(div);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/lazyload.jpg').found).toBe(true);
  });

  it('matches data-bg url(...) wrapper syntax on a non-<img> element', async () => {
    // section 9 fallback with the url() unwrap branch — some lazyload
    // libraries (notably vanilla-lazyload) store the CSS url() wrapper
    // form in data-bg. The regex `/url\(['"]?([^'")]+)['"]?\)/` must
    // extract the inner URL before comparison.
    const div = document.createElement('div');
    div.setAttribute('data-bg', 'url("https://example.com/wrap.png")');
    stubRect(div);
    document.body.appendChild(div);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/wrap.png').found).toBe(true);
  });

  it('returns {found:true} for metadata elements (<link>, <meta>) WITHOUT actually highlighting', async () => {
    // section 11 fallback + isMetadataElement early-ack — favicons live
    // in <head> and can't be scrolled to / highlighted, but the side
    // panel must still show them as "found on this page". Without the
    // {found:true} acknowledge, users see a false "not found" toast
    // when clicking highlight on a favicon in the result list.
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = 'https://example.com/favicon.ico';
    document.head.appendChild(link);

    const { addHighlight } = await import('../content/highlight');
    const result = addHighlight('https://example.com/favicon.ico');
    expect(result.found).toBe(true);
    // Metadata early-ack: NO border created even though found=true.
    expect(document.querySelectorAll('.image-harvest-highlight-border')).toHaveLength(0);
  });

  it('matches <link rel="apple-touch-icon">', async () => {
    const link = document.createElement('link');
    link.rel = 'apple-touch-icon';
    link.href = 'https://example.com/apple-touch.png';
    document.head.appendChild(link);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/apple-touch.png').found).toBe(true);
  });

  it('matches <meta property="og:image"> (OpenGraph preview image)', async () => {
    // section 12 fallback — og:image is the canonical "page hero" for
    // social sharing previews. Scanners surface it from document.head;
    // highlight must acknowledge it (no visual highlight possible in
    // <head>, but the found ack prevents a false negative toast).
    const meta = document.createElement('meta');
    meta.setAttribute('property', 'og:image');
    meta.content = 'https://example.com/og-preview.jpg';
    document.head.appendChild(meta);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/og-preview.jpg').found).toBe(true);
  });

  it('matches <meta name="twitter:image:src"> (Twitter card variant)', async () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'twitter:image:src');
    meta.content = 'https://example.com/twitter-card.jpg';
    document.head.appendChild(meta);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/twitter-card.jpg').found).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// findImageElement — Shadow DOM deep-dive (section 10)
// ─────────────────────────────────────────────────────────────────────
// Pin: Shadow DOM has become common in web components (Lit, Stencil,
// any framework rendering into a shadow host). Without this branch,
// component libraries like Ionic, Material Web Components, etc. would
// surface images in the scan results but highlight would say "not found".
// collectShadowRoots is mocked in the global setup to return [] so these
// tests override the mock to return a real ShadowRoot attached to a host.

describe('findImageElement — Shadow DOM fallbacks (section 10)', () => {
  async function mountShadow(): Promise<ShadowRoot> {
    const host = document.createElement('div');
    host.id = 'shadow-host';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    // Override the default mock that returns [] with one that returns
    // our freshly-mounted shadow root. Must happen BEFORE the dynamic
    // import below — vi.mocked() hoists identity-mapping even in
    // async blocks.
    const shadowIframeMod = await import('../content/shadow-iframe');
    vi.mocked(shadowIframeMod.collectShadowRoots).mockReturnValueOnce([shadow]);

    return shadow;
  }

  it('matches <img src> inside shadow DOM', async () => {
    const shadow = await mountShadow();
    const img = document.createElement('img');
    img.src = 'https://example.com/shadow-img.jpg';
    stubRect(img);
    shadow.appendChild(img);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/shadow-img.jpg').found).toBe(true);
  });

  it('matches <img srcset> inside shadow DOM', async () => {
    const shadow = await mountShadow();
    const img = document.createElement('img');
    img.srcset = 'https://example.com/shadow-s.jpg 320w, https://example.com/shadow-l.jpg 800w';
    stubRect(img);
    shadow.appendChild(img);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/shadow-l.jpg').found).toBe(true);
  });

  it('matches <img data-src> (shadow DOM lazy-load variant)', async () => {
    const shadow = await mountShadow();
    const img = document.createElement('img');
    img.setAttribute('data-src', 'https://example.com/shadow-lazy.jpg');
    stubRect(img);
    shadow.appendChild(img);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/shadow-lazy.jpg').found).toBe(true);
  });

  it('matches <picture> > <source srcset> inside shadow DOM', async () => {
    const shadow = await mountShadow();
    const picture = document.createElement('picture');
    const source = document.createElement('source');
    source.srcset = 'https://example.com/shadow-pic.jpg 1x';
    const img = document.createElement('img');
    stubRect(img);
    picture.appendChild(source);
    picture.appendChild(img);
    shadow.appendChild(picture);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/shadow-pic.jpg').found).toBe(true);
  });

  it('matches <video poster> inside shadow DOM', async () => {
    const shadow = await mountShadow();
    const video = document.createElement('video');
    video.poster = 'https://example.com/shadow-poster.jpg';
    stubRect(video);
    shadow.appendChild(video);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/shadow-poster.jpg').found).toBe(true);
  });

  it('matches <input type="image"> inside shadow DOM', async () => {
    const shadow = await mountShadow();
    const input = document.createElement('input');
    input.type = 'image';
    input.src = 'https://example.com/shadow-btn.png';
    stubRect(input);
    shadow.appendChild(input);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/shadow-btn.png').found).toBe(true);
  });

  it('matches <object data> inside shadow DOM', async () => {
    const shadow = await mountShadow();
    const obj = document.createElement('object');
    obj.data = 'https://example.com/shadow-obj.svg';
    stubRect(obj);
    shadow.appendChild(obj);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/shadow-obj.svg').found).toBe(true);
  });

  it('matches <embed src> inside shadow DOM', async () => {
    const shadow = await mountShadow();
    const embed = document.createElement('embed');
    embed.src = 'https://example.com/shadow-embed.svg';
    stubRect(embed);
    shadow.appendChild(embed);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/shadow-embed.svg').found).toBe(true);
  });

  it('matches background-image on an element inside shadow DOM', async () => {
    // The shadow DOM branch queries `shadowRoot.querySelectorAll('*')`
    // and calls window.getComputedStyle on each. Stub that call to
    // return a CSS url() for our target element.
    const shadow = await mountShadow();
    const div = document.createElement('div');
    stubRect(div);
    shadow.appendChild(div);

    const originalGcs = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((
      el: Element,
      pseudo?: string | null
    ) => {
      if (el === div && !pseudo) {
        return {
          backgroundImage: 'url(https://example.com/shadow-bg.jpg)',
          content: '',
        } as CSSStyleDeclaration;
      }
      return originalGcs(el, pseudo as string | null);
    }) as typeof window.getComputedStyle);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/shadow-bg.jpg').found).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Overlay lifecycle — ESC key + click-to-dismiss + CLEAR_SELECTION notify
// ─────────────────────────────────────────────────────────────────────
// Pin: when highlights are visible, pressing ESC (capture-phase) or
// clicking the dimmed overlay must both (a) remove every highlight and
// (b) fire chrome.runtime.sendMessage({type:'CLEAR_SELECTION'}) so the
// sidepanel can unsync its selected state. A regression that stops
// forwarding the message would leave the sidepanel thinking everything
// is still selected after the user bailed via ESC.

describe('overlay lifecycle — ESC / click-to-dismiss', () => {
  it('ESC key removes all highlights AND fires CLEAR_SELECTION', async () => {
    // Arrange: add a highlight so the overlay + ESC handler get installed.
    const img = document.createElement('img');
    img.src = 'https://example.com/esc-target.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { addHighlight } = await import('../content/highlight');
    addHighlight('https://example.com/esc-target.jpg');
    expect(document.querySelector('.image-harvest-overlay')).not.toBeNull();

    // Act: fire ESC in capture phase (the handler uses addEventListener
    // with useCapture=true so we dispatch on document).
    const escEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(escEvent);

    // Assert: highlights + overlay gone, CLEAR_SELECTION fired exactly once.
    expect(document.querySelector('.image-harvest-overlay')).toBeNull();
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    const msg = sendMessageSpy.mock.calls[0][0];
    expect(msg.type).toBe('CLEAR_SELECTION');
  });

  it('non-ESC key on document does NOT tear down the overlay', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/keep.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { addHighlight } = await import('../content/highlight');
    addHighlight('https://example.com/keep.jpg');

    // A random key like Tab / Enter must be ignored. Otherwise any page
    // keystroke would kill the highlight — regression-prone since the
    // ESC check is one line inside a shared keydown listener.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.querySelector('.image-harvest-overlay')).not.toBeNull();
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it('clicking the overlay dismisses all highlights AND fires CLEAR_SELECTION', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/click-target.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { addHighlight } = await import('../content/highlight');
    addHighlight('https://example.com/click-target.jpg');
    const overlay = document.querySelector('.image-harvest-overlay') as HTMLDivElement;
    expect(overlay).not.toBeNull();

    overlay.click();

    expect(document.querySelector('.image-harvest-overlay')).toBeNull();
    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CLEAR_SELECTION' })
    );
  });

  it('dismiss swallows chrome.runtime.sendMessage exceptions (extension context invalidated)', async () => {
    sendMessageSpy.mockImplementation(() => {
      // Real MV3 throws "Extension context invalidated" after reload
      // if the content script is still alive but chrome.* is gone.
      throw new Error('Extension context invalidated');
    });

    const img = document.createElement('img');
    img.src = 'https://example.com/ctx-invalid.jpg';
    stubRect(img);
    document.body.appendChild(img);

    const { addHighlight } = await import('../content/highlight');
    addHighlight('https://example.com/ctx-invalid.jpg');

    // Must NOT bubble the throw into the keydown handler — if it did,
    // the page's own ESC handler would swallow subsequent events and
    // the user would never escape the highlight state cleanly.
    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }).not.toThrow();
    expect(document.querySelector('.image-harvest-overlay')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// findImageElement — the remaining dispatch branches
// ─────────────────────────────────────────────────────────────────────
// Pin: each of these exotic sources (picture/source, inline SVG,
// canvas.toDataURL, <link rel="icon">, og:image) is a real shape
// observed in production DOMs. Dropping any branch would silently
// refuse to locate/scroll to images that ARE visible in the sidepanel
// grid (extracted by content/main.ts's scan) but then report
// "not found" when the user clicks "Locate on page".

describe('addHighlight — exotic source dispatch', () => {
  it('matches <picture> > <source srcset> candidate URLs', async () => {
    const picture = document.createElement('picture');
    const source = document.createElement('source');
    source.setAttribute(
      'srcset',
      'https://example.com/pic-480.webp 480w, https://example.com/pic-960.webp 960w'
    );
    picture.appendChild(source);
    const fallbackImg = document.createElement('img');
    fallbackImg.src = 'https://example.com/pic-fallback.jpg';
    stubRect(fallbackImg);
    picture.appendChild(fallbackImg);
    stubRect(picture);
    document.body.appendChild(picture);

    const { addHighlight } = await import('../content/highlight');
    // Matching the srcset URL should locate the picture (via its <img>).
    expect(addHighlight('https://example.com/pic-960.webp').found).toBe(true);
  });

  it('matches <picture> > <source src> (non-srcset fallback)', async () => {
    const picture = document.createElement('picture');
    const source = document.createElement('source');
    source.setAttribute('src', 'https://example.com/src-attr.webp');
    picture.appendChild(source);
    const fallbackImg = document.createElement('img');
    stubRect(fallbackImg);
    picture.appendChild(fallbackImg);
    stubRect(picture);
    document.body.appendChild(picture);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/src-attr.webp').found).toBe(true);
  });

  it('matches inline <svg> via data:image/svg+xml URI', async () => {
    // Inline SVGs are serialized then data-URI encoded so the URL in
    // the sidepanel grid is the CANONICAL form. We mount a real <svg>
    // and derive its own data URI via the same btoa/encode chain the
    // production code uses — this way we can't accidentally test the
    // wrong hash.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '10');
    svg.setAttribute('height', '10');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    stubRect(svg);
    document.body.appendChild(svg);

    const serialized = new XMLSerializer().serializeToString(svg);
    const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(serialized)));

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight(dataUri).found).toBe(true);
  });

  it('matches <canvas> via data:image/png URI (toDataURL comparison)', async () => {
    // jsdom does NOT implement HTMLCanvasElement.toDataURL out of the
    // box (it requires the optional `canvas` npm peer). Stub it so the
    // findImageElement canvas branch can actually run — this mirrors
    // the production contract (any data:image/png URI the sidepanel
    // grid extracted from this canvas must round-trip back to the
    // same element when the user clicks "locate").
    const fakeDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAA=';
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    stubRect(canvas);
    document.body.appendChild(canvas);
    vi.spyOn(canvas, 'toDataURL').mockReturnValue(fakeDataUri);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight(fakeDataUri).found).toBe(true);
  });

  it('silently skips tainted canvases (toDataURL throwing SecurityError)', async () => {
    // Cross-origin canvases throw on toDataURL. The catch block keeps
    // findImageElement scanning the remaining elements instead of
    // aborting — regression here would make a single tainted canvas
    // on the page break "locate" for every other image.
    const fakeDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAA=';
    const taintedCanvas = document.createElement('canvas');
    stubRect(taintedCanvas);
    document.body.appendChild(taintedCanvas);
    vi.spyOn(taintedCanvas, 'toDataURL').mockImplementation(() => {
      throw new Error('SecurityError: Tainted canvases may not be exported');
    });

    const { addHighlight } = await import('../content/highlight');
    // No match anywhere → found:false, but crucially NO uncaught throw.
    expect(addHighlight(fakeDataUri).found).toBe(false);
  });

  it('matches <link rel="apple-touch-icon"> in <head> (non-data URI)', async () => {
    const link = document.createElement('link');
    link.rel = 'apple-touch-icon';
    link.href = 'https://example.com/apple-icon.png';
    document.head.appendChild(link);

    const { addHighlight } = await import('../content/highlight');
    // <link> IS a metadata element so scroll is skipped but the
    // "found" contract must still be true — that's how the sidepanel
    // decides whether to show the "not on this page" tooltip.
    expect(addHighlight('https://example.com/apple-icon.png').found).toBe(true);
  });

  it('matches <meta property="og:image"> in <head>', async () => {
    const meta = document.createElement('meta');
    meta.setAttribute('property', 'og:image');
    meta.setAttribute('content', 'https://example.com/og.jpg');
    document.head.appendChild(meta);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('https://example.com/og.jpg').found).toBe(true);
  });

  it('does NOT match <link> / <meta> when the search is for a data: URI', async () => {
    // The link/meta branch is explicitly gated behind `!isTargetDataUri`
    // because data: URIs can never appear as href/content on these
    // elements in production — skipping the scan is a pure perf win.
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = 'data:image/png;base64,iVBORw0KGgo=';
    document.head.appendChild(link);

    const { addHighlight } = await import('../content/highlight');
    expect(addHighlight('data:image/png;base64,iVBORw0KGgo=').found).toBe(false);
  });
});
