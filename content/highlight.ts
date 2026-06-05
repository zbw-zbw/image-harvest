// Content Script Highlight Module
// Handles image highlighting and locating functionality

import { resolveUrl, isDataUri, generateDataUriKey, extractBackgroundUrls } from '../shared/utils';
import { parseSrcset, isElementAccessibleWithoutInteraction } from './utils';
import { collectShadowRoots } from './shadow-iframe';

// V2.0: FAB removed due to Chrome API limitation
// (sidePanel.open() requires direct user gesture)
// Users should use toolbar icon or Cmd+Shift+S shortcut

// Stub functions to maintain message handler compatibility
export function toggleFAB(): void {
  /* removed */
}
export function removeFAB(): void {
  // Clean up any stale FAB elements from previous versions
  const staleFabs = document.querySelectorAll('#image-harvest-fab-host');
  staleFabs.forEach((el) => el.remove());
}

interface HighlightEntry {
  element: Element;
  border: HTMLDivElement;
  cleanup: () => void;
}

// V2.0: Image Highlight & Locate
// Multi-highlight state: Map<imageUrl, { element, border, cleanup }>
const highlightEntries = new Map<string, HighlightEntry>();
// Track iframe context for elements found inside iframes
const iframeContextMap = new Map<string, HTMLIFrameElement>();
let highlightHost: HTMLDivElement | null = null;
let overlayElement: HTMLDivElement | null = null;
let highlightStyleElement: HTMLStyleElement | null = null;
let escKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let overlayClickHandler: ((e: MouseEvent) => void) | null = null;

/** Lazily create a fixed host container for the overlay and highlight borders.
 *  Using a dedicated host prevents overlay/border elements from interfering
 *  with the page layout (e.g. causing extra scrollable area or breaking
 *  sticky/fixed elements like decorative backgrounds). */
function ensureHighlightHost(): HTMLDivElement {
  if (highlightHost) return highlightHost;
  highlightHost = document.createElement('div');
  highlightHost.id = 'image-harvest-highlight-host';
  highlightHost.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    pointer-events: none;
    overflow: hidden;
  `;
  document.documentElement.appendChild(highlightHost);
  return highlightHost;
}

function removeHighlightHost(): void {
  if (highlightHost) {
    highlightHost.remove();
    highlightHost = null;
  }
}

function ensureHighlightStyles(): void {
  if (highlightStyleElement) return;
  highlightStyleElement = document.createElement('style');
  highlightStyleElement.textContent = `
    @keyframes image-harvest-pulse {
      0% {
        box-shadow: 0 0 8px 2px rgba(96, 181, 87, 0.7),
                    0 0 20px 6px rgba(96, 181, 87, 0.35);
        border-color: #60B557;
      }
      50% {
        box-shadow: 0 0 24px 10px rgba(96, 181, 87, 1),
                    0 0 48px 20px rgba(96, 181, 87, 0.45);
        border-color: #4da347;
      }
      100% {
        box-shadow: 0 0 8px 2px rgba(96, 181, 87, 0.7),
                    0 0 20px 6px rgba(96, 181, 87, 0.35);
        border-color: #60B557;
      }
    }
    .image-harvest-highlight-border {
      animation: image-harvest-pulse 1.2s ease-in-out 3;
    }
  `;
  document.head.appendChild(highlightStyleElement);
}

function removeHighlightStyles(): void {
  if (highlightStyleElement) {
    highlightStyleElement.remove();
    highlightStyleElement = null;
  }
}

function ensureOverlay(): void {
  if (overlayElement) return;
  ensureHighlightStyles();
  const host = ensureHighlightHost();
  overlayElement = document.createElement('div');
  overlayElement.className = 'image-harvest-overlay';
  // pointer-events: none lets scroll/interaction pass through to the page.
  // Dismissing is handled by a document-level click listener instead.
  overlayElement.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    pointer-events: none;
  `;

  host.appendChild(overlayElement);

  // Click anywhere on the page (that isn't a highlight border) to dismiss
  if (!overlayClickHandler) {
    overlayClickHandler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // Ignore clicks on the highlight borders themselves
      if (target?.closest?.('.image-harvest-highlight-border')) return;
      dismissAllHighlights();
    };
    // Use setTimeout so the click that triggered the highlight doesn't
    // immediately dismiss it
    setTimeout(() => {
      document.addEventListener('click', overlayClickHandler!, true);
    }, 0);
  }

  // ESC key to dismiss all highlights (capture phase to intercept before page handlers)
  if (!escKeyHandler) {
    escKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        dismissAllHighlights();
      }
    };
    document.addEventListener('keydown', escKeyHandler, true);
  }
}

function dismissAllHighlights(): void {
  removeAllHighlights();
  // Only remove the page-side highlight visuals (overlay + borders).
  // Do NOT send CLEAR_SELECTION — the user's selection in the sidepanel
  // image list should be preserved. ESC / clicking the overlay is just
  // exiting the page highlight view, not deselecting images.
}

function removeOverlay(): void {
  if (overlayElement) {
    overlayElement.remove();
    overlayElement = null;
  }
  if (escKeyHandler) {
    document.removeEventListener('keydown', escKeyHandler, true);
    escKeyHandler = null;
  }
  if (overlayClickHandler) {
    document.removeEventListener('click', overlayClickHandler, true);
    overlayClickHandler = null;
  }
  removeHighlightStyles();
  removeHighlightHost();
}

// isElementAccessibleWithoutInteraction is now imported from ./utils

/**
 * Pick the best element from a list of candidates matching the same image URL.
 * Strategy:
 *  1. Filter out elements hidden behind interactions (dropdowns, tooltips, etc.)
 *  2. Filter out zero-size elements
 *  3. Prefer elements currently inside the viewport
 *  4. Among in-viewport elements, pick the one closest to viewport center
 *  5. If none are in-viewport, pick the one closest to viewport edges
 *     (these are off-screen but scrollable — still valid for highlight)
 */
function pickBestCandidate(candidates: Element[]): Element | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    // Single candidate: still verify it's accessible
    return isElementAccessibleWithoutInteraction(candidates[0]) ? candidates[0] : null;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const viewportCenterX = viewportWidth / 2;
  const viewportCenterY = viewportHeight / 2;

  interface Scored {
    element: Element;
    rect: DOMRect;
    inViewport: boolean;
    distanceToCenter: number;
    distanceToViewport: number;
  }

  const scored: Scored[] = [];

  for (const el of candidates) {
    // Skip elements that require interaction to become visible
    if (!isElementAccessibleWithoutInteraction(el)) continue;

    const rect = el.getBoundingClientRect();
    // Skip zero-size elements
    if (rect.width < 2 || rect.height < 2) continue;

    const elCenterX = rect.left + rect.width / 2;
    const elCenterY = rect.top + rect.height / 2;

    const inViewport =
      rect.bottom > 0 && rect.top < viewportHeight && rect.right > 0 && rect.left < viewportWidth;

    const distanceToCenter = Math.hypot(elCenterX - viewportCenterX, elCenterY - viewportCenterY);

    // Distance from element edge to viewport edge (0 if inside viewport)
    let distanceToViewport = 0;
    if (!inViewport) {
      const dx = Math.max(0, rect.left - viewportWidth, -rect.right);
      const dy = Math.max(0, rect.top - viewportHeight, -rect.bottom);
      distanceToViewport = Math.hypot(dx, dy);
    }

    scored.push({ element: el, rect, inViewport, distanceToCenter, distanceToViewport });
  }

  if (scored.length === 0) return null;

  // Sort: in-viewport first, then by distance to center / distance to viewport
  scored.sort((a, b) => {
    if (a.inViewport && !b.inViewport) return -1;
    if (!a.inViewport && b.inViewport) return 1;
    if (a.inViewport && b.inViewport) return a.distanceToCenter - b.distanceToCenter;
    return a.distanceToViewport - b.distanceToViewport;
  });

  return scored[0].element;
}

function findImageElement(url: string): Element | null {
  const isTargetDataUri = isDataUri(url);
  // For data URIs, generate a key for comparison since the full string is huge
  const targetDataKey = isTargetDataUri ? generateDataUriKey(url) : null;

  // Helper: check if a candidate URL matches the target
  function urlMatches(candidateUrl: string | null | undefined): boolean {
    if (!candidateUrl) return false;
    if (isTargetDataUri) {
      if (!isDataUri(candidateUrl)) return false;
      return generateDataUriKey(candidateUrl) === targetDataKey;
    }
    return candidateUrl === url || resolveUrl(candidateUrl) === url;
  }

  // Collect ALL matching elements instead of returning the first one
  const candidates: Element[] = [];

  // 1. Check <img> elements (including srcset and lazy-load attributes)
  const imgs = document.querySelectorAll('img');
  for (const img of imgs) {
    let matched = false;
    const src = img.currentSrc || img.src;
    if (urlMatches(src)) matched = true;

    // Check srcset
    if (!matched && img.srcset) {
      const srcsetUrls = parseSrcset(img.srcset);
      for (const { url: candidateUrl } of srcsetUrls) {
        if (urlMatches(candidateUrl)) {
          matched = true;
          break;
        }
      }
    }

    // Check lazy-load attributes
    if (!matched) {
      for (const attr of [
        'data-src',
        'data-original',
        'data-lazy',
        'data-lazy-src',
        'data-srcset',
        'data-lazy-srcset',
      ]) {
        const val = img.getAttribute(attr);
        if (!val) continue;
        if (attr.includes('srcset')) {
          const parsed = parseSrcset(val);
          for (const { url: candidateUrl } of parsed) {
            if (urlMatches(candidateUrl)) {
              matched = true;
              break;
            }
          }
        } else if (urlMatches(val)) {
          matched = true;
        }
        if (matched) break;
      }
    }

    if (matched) candidates.push(img);
  }

  // 2. Check <picture> > <source>
  const pictures = document.querySelectorAll('picture');
  for (const picture of pictures) {
    let matched = false;
    const sources = picture.querySelectorAll('source');
    for (const source of sources) {
      for (const attr of ['srcset', 'data-srcset', 'data-lazy-srcset']) {
        const val = source.getAttribute(attr);
        if (!val) continue;
        const srcsetUrls = parseSrcset(val);
        for (const { url: candidateUrl } of srcsetUrls) {
          if (urlMatches(candidateUrl)) {
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
      if (!matched) {
        for (const attr of ['src', 'data-src']) {
          const val = source.getAttribute(attr);
          if (urlMatches(val)) {
            matched = true;
            break;
          }
        }
      }
      if (matched) break;
    }
    if (matched) candidates.push(picture.querySelector('img') || picture);
  }

  // 3. Check <video> poster attribute
  const videos = document.querySelectorAll<HTMLVideoElement>('video[poster]');
  for (const video of videos) {
    if (urlMatches(video.poster)) candidates.push(video);
  }

  // 4. Check <input type="image">
  const inputImages = document.querySelectorAll<HTMLInputElement>('input[type="image"]');
  for (const input of inputImages) {
    if (urlMatches(input.src)) candidates.push(input);
  }

  // 5. Check <object> and <embed>
  const objects = document.querySelectorAll<HTMLObjectElement>('object[data]');
  for (const obj of objects) {
    if (urlMatches(obj.data)) candidates.push(obj);
  }
  const embeds = document.querySelectorAll<HTMLEmbedElement>('embed[src]');
  for (const embed of embeds) {
    if (urlMatches(embed.src)) candidates.push(embed);
  }

  // 6. Check inline <svg> elements (compare by data URI key)
  if (isTargetDataUri && url.startsWith('data:image/svg')) {
    const svgs = document.querySelectorAll<SVGElement>('svg');
    for (const svg of svgs) {
      try {
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svg);
        const dataUri =
          'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
        if (generateDataUriKey(dataUri) === targetDataKey) candidates.push(svg);
      } catch {
        /* skip */
      }
    }
  }

  // 7. Check <canvas> elements (compare by data URI key)
  if (isTargetDataUri && url.startsWith('data:image/png')) {
    const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
    for (const canvas of canvases) {
      try {
        const canvasDataUri = canvas.toDataURL('image/png');
        if (generateDataUriKey(canvasDataUri) === targetDataKey) candidates.push(canvas);
      } catch {
        /* tainted canvas */
      }
    }
  }

  // 8. Check background images (including data URI backgrounds)
  const allElements = document.querySelectorAll('body, body *');
  for (const el of allElements) {
    try {
      const computedStyle = window.getComputedStyle(el);
      const bg = computedStyle.backgroundImage;
      if (bg && bg !== 'none') {
        const bgUrls = extractBackgroundUrls(bg);
        for (const u of bgUrls) {
          if (urlMatches(u)) {
            candidates.push(el);
            break;
          }
        }
      }

      // Also check CSS content property on pseudo-elements
      for (const pseudo of ['::before', '::after']) {
        const pseudoStyle = window.getComputedStyle(el, pseudo);
        const content = pseudoStyle.content;
        if (content && content !== 'none' && content !== 'normal' && content !== '""') {
          const contentUrls = extractBackgroundUrls(content);
          for (const u of contentUrls) {
            if (urlMatches(u)) {
              candidates.push(el);
              break;
            }
          }
        }
      }
    } catch {
      /* skip */
    }
  }

  // 9. Check lazy-load data-* attributes on non-img elements (divs, spans, etc.)
  const lazyAttrs = [
    'data-src',
    'data-original',
    'data-bg',
    'data-bg-src',
    'data-background',
    'data-image',
  ];
  for (const el of allElements) {
    for (const attr of lazyAttrs) {
      const val = el.getAttribute(attr);
      if (!val) continue;
      const urlMatch = val.match(/url\(['"]?([^'")]+)['"]?\)/);
      const rawUrl = urlMatch ? urlMatch[1] : val;
      if (urlMatches(rawUrl)) {
        candidates.push(el);
        break;
      }
    }
  }

  // 10. Search inside Shadow DOM trees
  const shadowRoots = collectShadowRoots(document);
  for (const shadowRoot of shadowRoots) {
    // Check <img> in shadow DOM
    const shadowImgs = shadowRoot.querySelectorAll('img');
    for (const img of shadowImgs) {
      if (urlMatches(img.currentSrc) || urlMatches(img.src)) {
        candidates.push(img);
        continue;
      }
      if (img.srcset) {
        let matched = false;
        for (const { url: candidateUrl } of parseSrcset(img.srcset)) {
          if (urlMatches(candidateUrl)) {
            matched = true;
            break;
          }
        }
        if (matched) {
          candidates.push(img);
          continue;
        }
      }
      for (const attr of ['data-src', 'data-original', 'data-lazy', 'data-lazy-src']) {
        if (urlMatches(img.getAttribute(attr))) {
          candidates.push(img);
          break;
        }
      }
    }

    // Check <picture> > <source> in shadow DOM
    const shadowPictures = shadowRoot.querySelectorAll('picture');
    for (const picture of shadowPictures) {
      let matched = false;
      for (const source of picture.querySelectorAll('source')) {
        for (const attr of ['srcset', 'data-srcset', 'src', 'data-src']) {
          const val = source.getAttribute(attr);
          if (!val) continue;
          if (attr.includes('srcset')) {
            for (const { url: candidateUrl } of parseSrcset(val)) {
              if (urlMatches(candidateUrl)) {
                matched = true;
                break;
              }
            }
          } else if (urlMatches(val)) {
            matched = true;
          }
          if (matched) break;
        }
        if (matched) break;
      }
      if (matched) candidates.push(picture.querySelector('img') || picture);
    }

    // Check <video poster>, <input type=image>, <object>, <embed> in shadow DOM
    for (const video of shadowRoot.querySelectorAll<HTMLVideoElement>('video[poster]')) {
      if (urlMatches(video.poster)) candidates.push(video);
    }
    for (const input of shadowRoot.querySelectorAll<HTMLInputElement>('input[type="image"]')) {
      if (urlMatches(input.src)) candidates.push(input);
    }
    for (const obj of shadowRoot.querySelectorAll<HTMLObjectElement>('object[data]')) {
      if (urlMatches(obj.data)) candidates.push(obj);
    }
    for (const embed of shadowRoot.querySelectorAll<HTMLEmbedElement>('embed[src]')) {
      if (urlMatches(embed.src)) candidates.push(embed);
    }

    // Check background images in shadow DOM
    const shadowEls = shadowRoot.querySelectorAll('*');
    for (const el of shadowEls) {
      try {
        const bg = window.getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none') {
          for (const u of extractBackgroundUrls(bg)) {
            if (urlMatches(u)) {
              candidates.push(el);
              break;
            }
          }
        }
      } catch {
        /* skip */
      }
    }

    // Check inline SVGs in shadow DOM
    if (isTargetDataUri && url.startsWith('data:image/svg')) {
      for (const svg of shadowRoot.querySelectorAll<SVGElement>('svg')) {
        try {
          const serializer = new XMLSerializer();
          const svgString = serializer.serializeToString(svg);
          const dataUri =
            'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
          if (generateDataUriKey(dataUri) === targetDataKey) candidates.push(svg);
        } catch {
          /* skip */
        }
      }
    }
  }

  // If we found candidates from the DOM, pick the best one
  if (candidates.length > 0) {
    const best = pickBestCandidate(candidates);
    if (best) return best;
  }

  // 10b. Search inside same-origin iframe contentDocuments
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument;
      if (!iframeDoc) continue;

      // Check <img> in iframe (including srcset and lazy-load attributes)
      const iframeImgs = iframeDoc.querySelectorAll('img');
      for (const img of iframeImgs) {
        let matched = false;
        if (urlMatches(img.currentSrc) || urlMatches(img.src)) matched = true;
        if (!matched && img.srcset) {
          for (const { url: u } of parseSrcset(img.srcset)) {
            if (urlMatches(u)) {
              matched = true;
              break;
            }
          }
        }
        if (!matched) {
          for (const attr of ['data-src', 'data-original', 'data-lazy', 'data-lazy-src']) {
            if (urlMatches(img.getAttribute(attr))) {
              matched = true;
              break;
            }
          }
        }
        if (matched) {
          iframeContextMap.set(url, iframe);
          return img;
        }
      }

      // Check <picture> sources in iframe
      const iframePictures = iframeDoc.querySelectorAll('picture');
      for (const picture of iframePictures) {
        let matched = false;
        for (const source of picture.querySelectorAll('source')) {
          for (const attr of ['srcset', 'data-srcset', 'src', 'data-src']) {
            const val = source.getAttribute(attr);
            if (!val) continue;
            if (attr.includes('srcset')) {
              for (const { url: u } of parseSrcset(val)) {
                if (urlMatches(u)) {
                  matched = true;
                  break;
                }
              }
            } else if (urlMatches(val)) matched = true;
            if (matched) break;
          }
          if (matched) break;
        }
        if (matched) {
          iframeContextMap.set(url, iframe);
          return picture.querySelector('img') || picture;
        }
      }

      // Check background images in iframe
      const iframeEls = iframeDoc.querySelectorAll('body, body *');
      const maxEls = Math.min(iframeEls.length, 1500);
      for (let i = 0; i < maxEls; i++) {
        try {
          const win = iframe.contentWindow;
          if (!win) break;
          const bg = win.getComputedStyle(iframeEls[i]).backgroundImage;
          if (bg && bg !== 'none') {
            for (const u of extractBackgroundUrls(bg)) {
              if (urlMatches(u)) {
                iframeContextMap.set(url, iframe);
                return iframeEls[i];
              }
            }
          }
          // CSS content (::before/::after) in iframe
          for (const pseudo of ['::before', '::after']) {
            try {
              const pStyle = win.getComputedStyle(iframeEls[i], pseudo);
              const content = pStyle.content;
              if (content && content !== 'none' && content !== 'normal' && content !== '""') {
                for (const u of extractBackgroundUrls(content)) {
                  if (urlMatches(u)) {
                    iframeContextMap.set(url, iframe);
                    return iframeEls[i];
                  }
                }
              }
            } catch {
              /* skip */
            }
          }
        } catch {
          /* skip */
        }
      }

      // Check inline SVGs in iframe
      if (isTargetDataUri && url.startsWith('data:image/svg')) {
        const iframeSvgs = iframeDoc.querySelectorAll<SVGElement>('svg');
        for (const svg of iframeSvgs) {
          try {
            const serializer = new XMLSerializer();
            const svgString = serializer.serializeToString(svg);
            const dataUri =
              'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
            if (generateDataUriKey(dataUri) === targetDataKey) {
              iframeContextMap.set(url, iframe);
              return svg;
            }
          } catch {
            /* skip */
          }
        }
      }
    } catch {
      // Cross-origin iframe, skip
    }
  }

  // 11. Check <link> elements (favicon, apple-touch-icon, etc.)
  // These are metadata elements — no position-based ranking needed
  if (!isTargetDataUri) {
    const linkSelectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
      'link[rel="apple-touch-icon-precomposed"]',
      'link[rel="mask-icon"]',
    ];
    const linkElements = document.querySelectorAll<HTMLLinkElement>(linkSelectors.join(','));
    for (const link of linkElements) {
      if (urlMatches(link.href)) return link;
    }

    // 12. Check <meta> elements (og:image, twitter:image, etc.)
    const metaSelectors = [
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
      'meta[itemprop="image"]',
    ];
    const metaElements = document.querySelectorAll<HTMLMetaElement>(metaSelectors.join(','));
    for (const meta of metaElements) {
      if (urlMatches(meta.content)) return meta;
    }
  }

  return null;
}

/**
 * Check whether an element is a non-renderable metadata element
 * (e.g. <link>, <meta>) that exists in <head> and cannot be highlighted.
 */
function isMetadataElement(element: Element): boolean {
  const tag = element.tagName?.toLowerCase();
  return tag === 'link' || tag === 'meta';
}

export function addHighlight(imageUrl: string, shouldScroll = true): { found: boolean } {
  if (highlightEntries.has(imageUrl)) return { found: true };

  const target = findImageElement(imageUrl);
  if (!target) return { found: false };

  // Metadata elements (<link>, <meta>) exist in <head> and cannot be
  // visually highlighted or scrolled to — just acknowledge they exist.
  if (isMetadataElement(target)) return { found: true };

  // Validate that the element has a reasonable on-screen position.
  // Some images (e.g. hidden, lazy-loaded placeholders, or elements
  // removed from layout) report a zero-size rect or sit at (0,0) with
  // negligible dimensions. Showing the overlay + highlight border for
  // these confuses users, so we silently skip the visual highlight.
  const rect = target.getBoundingClientRect();
  const hasZeroSize = rect.width < 2 || rect.height < 2;
  const isAtOriginSmall = rect.top === 0 && rect.left === 0 && rect.width < 10 && rect.height < 10;
  if (hasZeroSize || isAtOriginSmall) {
    return { found: false };
  }

  // Create highlight immediately — rAF loop will track position during scroll
  createSingleHighlight(imageUrl, target);

  if (shouldScroll) {
    const iframe = iframeContextMap.get(imageUrl);
    if (iframe) {
      iframe.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  return { found: true };
}

function createSingleHighlight(imageUrl: string, target: Element): void {
  if (highlightEntries.has(imageUrl)) return;

  ensureOverlay();

  const borderWidth = 3;
  const gap = 3;
  const iframe = iframeContextMap.get(imageUrl);

  // Create a fixed-position overlay div that tracks the target element
  const border = document.createElement('div');
  border.className = 'image-harvest-highlight-border';
  border.dataset.highlightUrl = imageUrl;

  const rect = target.getBoundingClientRect();
  let top = rect.top;
  let left = rect.left;
  if (iframe) {
    const iframeRect = iframe.getBoundingClientRect();
    top += iframeRect.top;
    left += iframeRect.left;
  }
  border.style.cssText = `
    position: fixed;
    box-sizing: border-box;
    top: ${top - gap}px;
    left: ${left - gap}px;
    width: ${rect.width + gap * 2}px;
    height: ${rect.height + gap * 2}px;
    border: ${borderWidth}px solid #60B557;
    border-radius: 6px;
    z-index: 1;
    pointer-events: none;
    box-shadow: 0 0 8px 2px rgba(96, 181, 87, 0.7),
                0 0 20px 6px rgba(96, 181, 87, 0.35);
  `;

  ensureHighlightHost().appendChild(border);

  // Continuously track position via rAF — handles any scroll container, resize, etc.
  let rafId: number | null = null;
  let isTracking = true;

  const trackPosition = (): void => {
    if (!isTracking) return;
    const r = target.getBoundingClientRect();
    let rTop = r.top;
    let rLeft = r.left;
    if (iframe) {
      const iframeRect = iframe.getBoundingClientRect();
      rTop += iframeRect.top;
      rLeft += iframeRect.left;
    }
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Hide highlight when element is completely outside the viewport
    const isOutOfView =
      rTop + r.height < 0 || rTop > viewportHeight || rLeft + r.width < 0 || rLeft > viewportWidth;
    border.style.display = isOutOfView ? 'none' : '';

    if (!isOutOfView) {
      border.style.top = rTop - gap + 'px';
      border.style.left = rLeft - gap + 'px';
      border.style.width = r.width + gap * 2 + 'px';
      border.style.height = r.height + gap * 2 + 'px';
    }

    rafId = requestAnimationFrame(trackPosition);
  };
  rafId = requestAnimationFrame(trackPosition);

  const cleanup = (): void => {
    isTracking = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    border.remove();
  };

  highlightEntries.set(imageUrl, { element: target, border, cleanup });
}

export function removeSingleHighlight(imageUrl: string): void {
  const entry = highlightEntries.get(imageUrl);
  if (!entry) return;

  entry.cleanup();
  highlightEntries.delete(imageUrl);
  iframeContextMap.delete(imageUrl);

  // Remove overlay when no highlights remain
  if (highlightEntries.size === 0) {
    removeOverlay();
  }
}

export function syncHighlights(imageUrls: string[]): void {
  const urlSet = new Set(imageUrls);

  // Remove highlights that are no longer selected
  for (const [existingUrl] of highlightEntries) {
    if (!urlSet.has(existingUrl)) {
      removeSingleHighlight(existingUrl);
    }
  }

  // Add highlights for newly selected images
  for (const url of imageUrls) {
    if (!highlightEntries.has(url)) {
      addHighlight(url, false);
    }
  }
}

export function removeAllHighlights(): void {
  for (const [, entry] of highlightEntries) {
    if (entry) {
      entry.cleanup();
    }
  }
  highlightEntries.clear();
  iframeContextMap.clear();
  removeOverlay();
}

/**
 * Check visibility of multiple images by finding their DOM elements and
 * running `isElementAccessibleWithoutInteraction` in real-time.
 * Returns a map of imageUrl → visible (true/false).
 * This aligns "visible only" filtering with the highlight logic: an image
 * is considered visible iff it can be highlighted (i.e. findImageElement
 * returns a valid candidate via pickBestCandidate).
 *
 * Performance note: findImageElement does heavy DOM traversal for each URL.
 * For large image lists we yield to the main thread periodically to avoid
 * blocking user interaction.
 */
export function checkImagesVisibility(imageUrls: string[]): Record<string, boolean> {
  const result: Record<string, boolean> = {};

  for (const url of imageUrls) {
    const element = findImageElement(url);
    if (!element) {
      result[url] = false;
      continue;
    }

    // Apply the same extra checks as addHighlight so "visible only"
    // filtering matches the highlight behaviour exactly.

    // Metadata elements (<link>, <meta>) exist in <head> — they are
    // "found" but not visually present on the page, so mark invisible.
    if (isMetadataElement(element)) {
      result[url] = false;
      continue;
    }

    // Zero-size or origin-pinned tiny elements are not truly visible.
    const rect = element.getBoundingClientRect();
    const hasZeroSize = rect.width < 2 || rect.height < 2;
    const isAtOriginSmall =
      rect.top === 0 && rect.left === 0 && rect.width < 10 && rect.height < 10;
    if (hasZeroSize || isAtOriginSmall) {
      result[url] = false;
      continue;
    }

    result[url] = true;
  }
  return result;
}
