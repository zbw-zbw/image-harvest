// Unit tests for content/shadow-iframe.ts — focused on:
//   - collectShadowRoots: TreeWalker recursion across nested
//     attachShadow trees (Web Component composition)
//   - querySelectorAllDeep: same-selector results from light DOM AND
//     all reachable shadow roots
//   - extractFromShadowDom: 6 sub-extractors (img / bg / picture /
//     video poster / svg / canvas) all writing into a shared Map
//   - extractFromIframes: same-origin contentDocument access + cross-
//     origin try/catch + iframe.src as base URL for relative URLs
//
// jsdom Shadow DOM API is fully spec-compliant (attachShadow,
// shadowRoot getter, mode 'open'). Same-origin iframe is mocked via
// <iframe srcdoc=...> which gives a real contentDocument.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const seenUrls = new Set<string>();
vi.mock('../content/state', () => ({
  state: {
    isExtracting: false,
    get seenUrls() {
      return seenUrls;
    },
  },
  isExtensionContextValid: vi.fn(() => true),
}));

vi.mock('../shared/utils', () => ({
  generateId: vi.fn((url: string) => `id-${url.slice(0, 24)}`),
  generateDataUriKey: vi.fn((dataUri: string) => `key-${dataUri}`),
  resolveUrl: vi.fn((u: string, base?: string) => {
    if (!u) return u;
    if (u.startsWith('http') || u.startsWith('data:')) return u;
    if (base) {
      try {
        return new URL(u, base).href;
      } catch {
        return u;
      }
    }
    return u;
  }),
  getDomain: vi.fn((u: string) => {
    try {
      return new URL(u).hostname;
    } catch {
      return '';
    }
  }),
  getFileFormat: vi.fn((u: string) => {
    if (!u) return 'unknown';
    if (u.includes('.png')) return 'png';
    if (u.includes('.jpg')) return 'jpg';
    if (u.includes('.svg')) return 'svg';
    return 'unknown';
  }),
  isDataUri: vi.fn((u: string) => u.startsWith('data:')),
  isImageDataUri: vi.fn((u: string) => u.startsWith('data:image/')),
  extractBackgroundUrls: vi.fn((value: string) => {
    if (!value) return [];
    const matches = Array.from(value.matchAll(/url\(['"]?([^'")]+)['"]?\)/g));
    return matches.map((m) => m[1]);
  }),
  isGradient: vi.fn((u: string) => u.includes('gradient(')),
}));

vi.mock('../content/utils', () => ({
  ensureImageLoaded: vi.fn(() => Promise.resolve()),
  parseSrcset: vi.fn((srcset: string) =>
    srcset.split(',').map((part) => {
      const [url] = part.trim().split(/\s+/);
      return { url, width: 0 };
    })
  ),
}));

vi.mock('../content/extract-advanced', () => ({
  extractInlineSvg: vi.fn(() => null),
  extractCanvasImage: vi.fn(() => null),
}));

beforeAll(() => {
  // Stub getComputedStyle defaults (jsdom returns empty strings).
  // Individual cases override via vi.spyOn for backgroundImage tests.
});

import {
  collectShadowRoots,
  querySelectorAllDeep,
  extractFromShadowDom,
  extractFromIframes,
} from '../content/shadow-iframe';
import type { ImageItem } from '../shared/types';

beforeEach(() => {
  seenUrls.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  seenUrls.clear();
  vi.restoreAllMocks();
});

// Helper: stub getBoundingClientRect.
function stubRect(el: Element, w = 100, h = 100): void {
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

// Helper: build a host element with an open shadow root holding HTML.
function attachShadowWithHTML(host: Element, innerHTML: string): ShadowRoot {
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = innerHTML;
  return shadow;
}

// ─────────────────────────────────────────────────────────────────────
// collectShadowRoots
// ─────────────────────────────────────────────────────────────────────

describe('collectShadowRoots', () => {
  it('returns [] when document has no shadow roots', () => {
    document.body.innerHTML = '<div><span>no shadow</span></div>';
    expect(collectShadowRoots()).toEqual([]);
  });

  it('finds a single top-level shadow root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = attachShadowWithHTML(host, '<p>inside</p>');

    const roots = collectShadowRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0]).toBe(shadow);
  });

  it('finds multiple sibling shadow roots', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.appendChild(a);
    document.body.appendChild(b);
    attachShadowWithHTML(a, '<p>a</p>');
    attachShadowWithHTML(b, '<p>b</p>');

    expect(collectShadowRoots()).toHaveLength(2);
  });

  it('recurses into nested shadow roots (Web Component composition)', () => {
    // outer host -> shadow contains inner host -> shadow contains <p>
    // Pin recursion depth: any framework that composes Web Components
    // (e.g. lit-element wrappers around custom widgets) creates this
    // layout, and missing recursion would cause silent image loss.
    const outerHost = document.createElement('div');
    document.body.appendChild(outerHost);
    const outerShadow = attachShadowWithHTML(outerHost, '');

    const innerHost = document.createElement('div');
    outerShadow.appendChild(innerHost);
    attachShadowWithHTML(innerHost, '<p>deep</p>');

    const roots = collectShadowRoots();
    expect(roots).toHaveLength(2);
  });

  it('accepts a ShadowRoot as the start node (not just document)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = attachShadowWithHTML(host, '<div></div>');

    const innerHost = shadow.querySelector('div')!;
    attachShadowWithHTML(innerHost, '<p>nested-from-shadow</p>');

    // Starting from `shadow`, we should find ONLY the inner one.
    const fromShadow = collectShadowRoots(shadow);
    expect(fromShadow).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// querySelectorAllDeep
// ─────────────────────────────────────────────────────────────────────

describe('querySelectorAllDeep', () => {
  it('returns matches from light DOM only when no shadow roots', () => {
    document.body.innerHTML = '<img src="a.jpg"><img src="b.jpg">';
    const imgs = querySelectorAllDeep('img');
    expect(imgs).toHaveLength(2);
  });

  it('returns matches from BOTH light DOM AND shadow roots', () => {
    document.body.innerHTML = '<img src="light.jpg">';
    const host = document.createElement('div');
    document.body.appendChild(host);
    attachShadowWithHTML(host, '<img src="shadow.jpg">');

    const imgs = querySelectorAllDeep('img');
    expect(imgs).toHaveLength(2);
  });

  it('aggregates matches across multiple shadow roots (and nested)', () => {
    // 1 light + 1 shadow + 1 nested-shadow = 3 hits
    document.body.innerHTML = '<img src="light.jpg">';
    const outer = document.createElement('div');
    document.body.appendChild(outer);
    const outerShadow = attachShadowWithHTML(outer, '<img src="outer.jpg"><div></div>');
    const innerHost = outerShadow.querySelector('div')!;
    attachShadowWithHTML(innerHost, '<img src="inner.jpg">');

    const imgs = querySelectorAllDeep('img');
    expect(imgs).toHaveLength(3);
  });

  it('returns [] when nothing matches in light DOM or any shadow root', () => {
    document.body.innerHTML = '<div><span></span></div>';
    const host = document.createElement('div');
    document.body.appendChild(host);
    attachShadowWithHTML(host, '<p>no images here</p>');

    expect(querySelectorAllDeep('img')).toHaveLength(0);
  });

  it('respects the root parameter (scoped, not document-wide)', () => {
    document.body.innerHTML = '<img src="outside.jpg">';
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = attachShadowWithHTML(host, '<img src="scoped.jpg">');

    // Scoping to `shadow` should NOT pick up the light-DOM <img>.
    const imgs = querySelectorAllDeep('img', shadow);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('scoped.jpg');
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractFromShadowDom — 6 sub-extractors
// ─────────────────────────────────────────────────────────────────────

describe('extractFromShadowDom', () => {
  it('returns immediately (no work) when no shadow roots exist', async () => {
    document.body.innerHTML = '<div><img src="https://example.com/light.jpg"></div>';
    const images = new Map<string, ImageItem>();

    await extractFromShadowDom(images);
    // Only light-DOM images would be picked up by extractImgTags in
    // the main pipeline, NOT by extractFromShadowDom. Pin: this fn is
    // strictly a shadow-DOM augmenter, not a fallback for regular img.
    expect(images.size).toBe(0);
  });

  it('extracts <img src> from a shadow root with type="img"', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    attachShadowWithHTML(host, '<img src="https://example.com/shadow.jpg">');
    const images = new Map<string, ImageItem>();

    await extractFromShadowDom(images);
    const item = Array.from(images.values()).find((i) => i.url.includes('shadow.jpg'));
    expect(item).toBeDefined();
    expect(item?.type).toBe('img');
  });

  it('aggregates srcset + 4 lazy-load data-* attrs from shadow <img>', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = attachShadowWithHTML(host, '');
    const img = document.createElement('img');
    img.src = 'https://example.com/main.jpg';
    img.srcset = 'https://example.com/sm.jpg 320w, https://example.com/lg.jpg 800w';
    img.setAttribute('data-src', 'https://example.com/lazy.jpg');
    img.setAttribute('data-original', 'https://example.com/orig.jpg');
    img.setAttribute('data-lazy', 'https://example.com/lazy2.jpg');
    img.setAttribute('data-lazy-src', 'https://example.com/lazy3.jpg');
    shadow.appendChild(img);

    const images = new Map<string, ImageItem>();
    await extractFromShadowDom(images);
    const urls = Array.from(images.values()).map((i) => i.url);
    expect(urls.some((u) => u.includes('main.jpg'))).toBe(true);
    expect(urls.some((u) => u.includes('lg.jpg'))).toBe(true);
    expect(urls.some((u) => u.includes('lazy.jpg'))).toBe(true);
    expect(urls.some((u) => u.includes('orig.jpg'))).toBe(true);
    expect(urls.some((u) => u.includes('lazy2.jpg'))).toBe(true);
    expect(urls.some((u) => u.includes('lazy3.jpg'))).toBe(true);
  });

  it('skips non-image data: URIs in shadow <img>', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = attachShadowWithHTML(host, '');
    const img = document.createElement('img');
    img.src = 'data:text/plain;base64,SGk=';
    shadow.appendChild(img);

    const images = new Map<string, ImageItem>();
    await extractFromShadowDom(images);
    expect(images.size).toBe(0);
  });

  it('handles ensureImageLoaded rejection gracefully (try/catch swallow)', async () => {
    const { ensureImageLoaded } = await import('../content/utils');
    vi.mocked(ensureImageLoaded).mockRejectedValueOnce(new Error('load fail'));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = attachShadowWithHTML(host, '');
    const failingImg = document.createElement('img');
    failingImg.src = 'https://example.com/fail.jpg';
    const okImg = document.createElement('img');
    okImg.src = 'https://example.com/ok.jpg';
    shadow.appendChild(failingImg);
    shadow.appendChild(okImg);

    const images = new Map<string, ImageItem>();
    await extractFromShadowDom(images);
    // okImg still extracted despite failingImg's rejection.
    expect(Array.from(images.values()).some((i) => i.url.includes('ok.jpg'))).toBe(true);
  });

  it('extracts background-image from shadow root with type="bg"', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = attachShadowWithHTML(host, '');
    const styled = document.createElement('div');
    styled.setAttribute(
      'style',
      "background-image: url('https://example.com/shadow-bg.jpg')"
    );
    stubRect(styled, 600, 400);
    shadow.appendChild(styled);

    const images = new Map<string, ImageItem>();
    await extractFromShadowDom(images);
    const item = Array.from(images.values()).find((i) => i.url.includes('shadow-bg.jpg'));
    expect(item?.type).toBe('bg');
    expect(item?.displayWidth).toBe(600);
    expect(item?.displayHeight).toBe(400);
  });

  it('skips gradient() in shadow background-image', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = attachShadowWithHTML(host, '');
    const styled = document.createElement('div');
    styled.setAttribute('style', 'background-image: linear-gradient(red, blue)');
    shadow.appendChild(styled);

    const images = new Map<string, ImageItem>();
    await extractFromShadowDom(images);
    expect(images.size).toBe(0);
  });

  it('extracts <picture><source srcset> from shadow root', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = attachShadowWithHTML(host, '');
    const picture = document.createElement('picture');
    const source = document.createElement('source');
    source.setAttribute(
      'srcset',
      'https://example.com/pic-sm.jpg 320w, https://example.com/pic-lg.jpg 1200w'
    );
    const fallback = document.createElement('img');
    fallback.src = 'https://example.com/pic-fb.jpg';
    Object.defineProperty(fallback, 'naturalWidth', { value: 1200 });
    Object.defineProperty(fallback, 'naturalHeight', { value: 800 });
    picture.appendChild(source);
    picture.appendChild(fallback);
    shadow.appendChild(picture);

    const images = new Map<string, ImageItem>();
    await extractFromShadowDom(images);
    const urls = Array.from(images.values()).map((i) => i.url);
    expect(urls.some((u) => u.includes('pic-sm.jpg'))).toBe(true);
    expect(urls.some((u) => u.includes('pic-lg.jpg'))).toBe(true);
    // Fallback img dimensions inherited.
    const lg = Array.from(images.values()).find((i) => i.url.includes('pic-lg.jpg'));
    expect(lg?.displayWidth).toBe(1200);
    expect(lg?.displayHeight).toBe(800);
  });

  it('extracts video[poster] from shadow root with type="video-poster"', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = attachShadowWithHTML(host, '');
    const video = document.createElement('video');
    video.setAttribute('poster', 'https://example.com/poster.jpg');
    Object.defineProperty(video, 'videoWidth', { value: 1920 });
    Object.defineProperty(video, 'videoHeight', { value: 1080 });
    shadow.appendChild(video);

    const images = new Map<string, ImageItem>();
    await extractFromShadowDom(images);
    const item = Array.from(images.values()).find((i) => i.url.includes('poster.jpg'));
    expect(item?.type).toBe('video-poster');
    expect(item?.displayWidth).toBe(1920);
    expect(item?.displayHeight).toBe(1080);
  });

  it('delegates <svg> extraction to extractInlineSvg (via mock returning ImageItem)', async () => {
    const { extractInlineSvg } = await import('../content/extract-advanced');
    const fakeItem = {
      id: 'svg-id-1',
      url: 'data:image/svg+xml;base64,xxx',
      type: 'svg',
    } as unknown as ImageItem;
    vi.mocked(extractInlineSvg).mockReturnValueOnce(fakeItem);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = attachShadowWithHTML(host, '');
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    shadow.appendChild(svg);

    const images = new Map<string, ImageItem>();
    await extractFromShadowDom(images);
    expect(extractInlineSvg).toHaveBeenCalledWith(svg);
    expect(images.get('svg-id-1')).toBe(fakeItem);
  });

  it('skips <svg> when extractInlineSvg returns null (e.g. tiny / inert SVG)', async () => {
    const { extractInlineSvg } = await import('../content/extract-advanced');
    vi.mocked(extractInlineSvg).mockReturnValue(null);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = attachShadowWithHTML(host, '');
    const svgNs = 'http://www.w3.org/2000/svg';
    shadow.appendChild(document.createElementNS(svgNs, 'svg'));

    const images = new Map<string, ImageItem>();
    await extractFromShadowDom(images);
    expect(images.size).toBe(0);
  });

  it('delegates <canvas> extraction to extractCanvasImage', async () => {
    const { extractCanvasImage } = await import('../content/extract-advanced');
    const fakeItem = {
      id: 'canvas-id-1',
      url: 'data:image/png;base64,yyy',
      type: 'canvas',
    } as unknown as ImageItem;
    vi.mocked(extractCanvasImage).mockReturnValueOnce(fakeItem);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = attachShadowWithHTML(host, '');
    const canvas = document.createElement('canvas');
    shadow.appendChild(canvas);

    const images = new Map<string, ImageItem>();
    await extractFromShadowDom(images);
    expect(extractCanvasImage).toHaveBeenCalledWith(canvas);
    expect(images.get('canvas-id-1')).toBe(fakeItem);
  });

  it('dedups via state.seenUrls — same URL across light + shadow not double-counted', async () => {
    // Pre-seed seenUrls as if extractImgTags already saw the URL.
    seenUrls.add('https://example.com/dup.jpg');

    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = attachShadowWithHTML(host, '');
    const img = document.createElement('img');
    img.src = 'https://example.com/dup.jpg';
    shadow.appendChild(img);

    const images = new Map<string, ImageItem>();
    await extractFromShadowDom(images);
    // Pin: state.seenUrls is the cross-extractor dedup contract; if a
    // refactor accidentally bypassed it (e.g. private dedup per extractor),
    // we'd see the same image twice in the gallery.
    expect(images.size).toBe(0);
  });

  it('recurses into nested shadow roots (img in inner-shadow IS extracted)', async () => {
    const outerHost = document.createElement('div');
    document.body.appendChild(outerHost);
    const outerShadow = attachShadowWithHTML(outerHost, '<div></div>');
    const innerHost = outerShadow.querySelector('div')!;
    const innerShadow = attachShadowWithHTML(innerHost, '');
    const img = document.createElement('img');
    img.src = 'https://example.com/deep.jpg';
    innerShadow.appendChild(img);

    const images = new Map<string, ImageItem>();
    await extractFromShadowDom(images);
    expect(Array.from(images.values()).some((i) => i.url.includes('deep.jpg'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractFromIframes
// ─────────────────────────────────────────────────────────────────────

describe('extractFromIframes', () => {
  // Helper: create a same-origin iframe and directly populate its
  // contentDocument.body. Avoids the jsdom srcdoc quirks where:
  //   1. data: URIs in srcdoc HTML can get sanitized/normalized away
  //   2. setting both .src and .srcdoc creates load-event races
  //   3. contentDocument property read can be inconsistent
  // Returns the iframe with contentDocument ready to query.
  function attachIframeWithBody(bodyHTML: string, fakeSrc?: string): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    // jsdom assigns an about:blank contentDocument synchronously after
    // appendChild — no need to wait for load event.
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = bodyHTML;
    if (fakeSrc) {
      // Override .src getter without triggering navigation. Pin: the
      // production code reads iframe.src to compute iframeBase for
      // relative-URL resolution, so we need to control what .src returns
      // without actually navigating (which would replace contentDocument).
      Object.defineProperty(iframe, 'src', {
        get: () => fakeSrc,
        configurable: true,
      });
    }
    return iframe;
  }

  it('does nothing when no iframes exist', async () => {
    const images = new Map<string, ImageItem>();
    await extractFromIframes(images);
    expect(images.size).toBe(0);
  });

  it('extracts <img> from a same-origin iframe with type="img"', async () => {
    attachIframeWithBody('<img src="https://example.com/inside.jpg">');

    const images = new Map<string, ImageItem>();
    await extractFromIframes(images);
    const item = Array.from(images.values()).find((i) => i.url.includes('inside.jpg'));
    expect(item).toBeDefined();
    expect(item?.type).toBe('img');
  });

  it('skips iframe whose contentDocument is null (cross-origin / sandboxed)', async () => {
    // Create an iframe but force contentDocument to throw / be null.
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    Object.defineProperty(iframe, 'contentDocument', {
      get: () => null,
      configurable: true,
    });

    const images = new Map<string, ImageItem>();
    await expect(extractFromIframes(images)).resolves.toBeUndefined();
    expect(images.size).toBe(0);
  });

  it('survives iframe.contentDocument throwing SecurityError (cross-origin guard)', async () => {
    // Pin: cross-origin iframe access throws SecurityError. The outer
    // try/catch must swallow so other iframes still get processed.
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    Object.defineProperty(iframe, 'contentDocument', {
      get: () => {
        throw new DOMException('cross-origin', 'SecurityError');
      },
      configurable: true,
    });

    const images = new Map<string, ImageItem>();
    await expect(extractFromIframes(images)).resolves.toBeUndefined();
    expect(images.size).toBe(0);
  });

  it('uses iframe.src as base URL for relative <img src> resolution', async () => {
    // Pin: relative URLs inside an iframe must resolve against the
    // iframe's src (not the parent page's location). Otherwise images
    // hosted on a CDN-iframe would all get the wrong absolute URL.
    // (Use raw createElement + manual <img> insert; jsdom auto-resolves
    // setAttribute('src','/relative.jpg') against the iframe's about:blank
    // base, which would defeat the test. Instead we craft an <img> whose
    // .src starts as a relative-looking URL by going through getAttribute.)
    const iframe = attachIframeWithBody('', 'https://cdn.example.com/foo/bar/');
    const img = iframe.contentDocument!.createElement('img');
    // Use Object.defineProperty to bypass jsdom's URL normalization on
    // the .src setter. The production code reads img.currentSrc || img.src;
    // here we make .src return our raw relative path so resolveUrl(url, iframeBase)
    // is what actually decides the absolute URL.
    Object.defineProperty(img, 'src', {
      get: () => '/relative.jpg',
      configurable: true,
    });
    iframe.contentDocument!.body.appendChild(img);

    const images = new Map<string, ImageItem>();
    await extractFromIframes(images);
    const item = Array.from(images.values()).find((i) => i.url.includes('relative.jpg'));
    // Mocked resolveUrl uses URL(u, base) — relative '/relative.jpg'
    // against 'https://cdn.example.com/foo/bar/' → cdn.example.com host.
    expect(item?.url).toContain('cdn.example.com');
  });

  it('handles data: image URI inside iframe <img>', async () => {
    // Build the iframe img with .src as a real data: URI. Going through
    // body.innerHTML can let jsdom sanitize/normalize unusual src values;
    // appending an Element with explicit setAttribute is more predictable.
    const iframe = attachIframeWithBody('');
    const img = iframe.contentDocument!.createElement('img');
    img.setAttribute('src', 'data:image/png;base64,iVBORw0KGgo=');
    iframe.contentDocument!.body.appendChild(img);

    const images = new Map<string, ImageItem>();
    await extractFromIframes(images);
    const item = Array.from(images.values()).find((i) => i.url.startsWith('data:image/png'));
    expect(item).toBeDefined();
    expect(item?.type).toBe('img');
  });

  it('skips non-image data: URI inside iframe <img>', async () => {
    const iframe = attachIframeWithBody('');
    const img = iframe.contentDocument!.createElement('img');
    img.setAttribute('src', 'data:text/plain;base64,SGVsbG8=');
    iframe.contentDocument!.body.appendChild(img);

    const images = new Map<string, ImageItem>();
    await extractFromIframes(images);
    expect(images.size).toBe(0);
  });

  it('extracts background-image from iframe elements with type="bg"', async () => {
    const iframe = attachIframeWithBody(
      "<div id='hero' style=\"background-image: url('https://example.com/iframe-bg.jpg')\"></div>"
    );
    const innerDiv = iframe.contentDocument!.querySelector('#hero')!;
    stubRect(innerDiv, 800, 400);

    const images = new Map<string, ImageItem>();
    await extractFromIframes(images);
    const item = Array.from(images.values()).find((i) => i.url.includes('iframe-bg.jpg'));
    expect(item?.type).toBe('bg');
  });

  it('dedups iframe images via state.seenUrls (cross-iframe contract)', async () => {
    seenUrls.add('https://example.com/already-seen.jpg');
    attachIframeWithBody('<img src="https://example.com/already-seen.jpg">');

    const images = new Map<string, ImageItem>();
    await extractFromIframes(images);
    expect(images.size).toBe(0);
  });

  it('skips iframe <img> with empty src/currentSrc', async () => {
    attachIframeWithBody('<img>');

    const images = new Map<string, ImageItem>();
    await extractFromIframes(images);
    expect(images.size).toBe(0);
  });
});
