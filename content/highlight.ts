// Content Script Highlight Module
// Handles image highlighting and locating functionality

import { resolveUrl, isDataUri, generateDataUriKey, extractBackgroundUrls } from '../shared/utils';
import { parseSrcset } from './utils';
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
let overlayElement: HTMLDivElement | null = null;
let highlightStyleElement: HTMLStyleElement | null = null;
let escKeyHandler: ((e: KeyboardEvent) => void) | null = null;

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
  overlayElement = document.createElement('div');
  overlayElement.className = 'image-harvest-overlay';
  overlayElement.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    z-index: 2147483646;
    pointer-events: auto;
    cursor: pointer;
  `;

  // Click overlay to dismiss all highlights
  overlayElement.addEventListener('click', () => {
    dismissAllHighlights();
  });

  document.documentElement.appendChild(overlayElement);

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
  removeHighlightStyles();
}

/**
 * Detect whether an element is truly visible to the user without requiring
 * interaction (click, hover, dropdown expand, etc.).
 *
 * Returns false for elements inside:
 *  - display:none ancestors
 *  - visibility:hidden / opacity:0 ancestors
 *  - collapsed containers (overflow:hidden with near-zero effective size)
 *  - popover / dropdown / tooltip containers that are not currently shown
 *
 * Returns true for elements that are simply off-screen (next-page / below
 * the fold) — these can be scrolled into view without user interaction.
 */
function isElementAccessibleWithoutInteraction(element: Element): boolean {
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    const style = window.getComputedStyle(current);

    // display:none — element is completely removed from layout
    if (style.display === 'none') return false;

    // visibility:hidden or collapse — element occupies space but is invisible
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;

    // opacity:0 — fully transparent (often used for hidden interactive elements)
    if (parseFloat(style.opacity) === 0) return false;

    // Check for clipped-away content: an ancestor with overflow:hidden and
    // a very small size that effectively hides children. This catches
    // collapsed accordion panels, unexpanded dropdowns, etc.
    // Exception: the element itself (we already checked its rect in the caller)
    if (current !== element) {
      const overflow = style.overflow + style.overflowX + style.overflowY;
      if (overflow.includes('hidden')) {
        const rect = current.getBoundingClientRect();
        // If the clipping container is tiny (< 4px in either dimension),
        // children are effectively invisible to the user.
        if (rect.width < 4 || rect.height < 4) return false;
      }
    }

    // Common patterns for hidden interactive containers:
    // aria-hidden="true" on an ancestor means it's not presented to the user
    if (current !== element && current.getAttribute('aria-hidden') === 'true') return false;

    // Popover / dropdown / collapse patterns: check for closed state
    if (current !== element) {
      const ariaExpanded = current.getAttribute('aria-expanded');
      // If this container explicitly says it's collapsed, skip
      if (ariaExpanded === 'false') {
        // Only treat as hidden if the container is also small / clipped
        const rect = current.getBoundingClientRect();
        if (rect.height < 4 || rect.width < 4) return false;
      }
    }

    current = current.parentElement;
  }

  return true;
}

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
    return pickBestCandidate(candidates);
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
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return { found: true };
}

function createSingleHighlight(imageUrl: string, target: Element): void {
  if (highlightEntries.has(imageUrl)) return;

  ensureOverlay();

  const borderWidth = 3;
  const gap = 3;

  // Create a fixed-position overlay div that tracks the target element
  const border = document.createElement('div');
  border.className = 'image-harvest-highlight-border';
  border.dataset.highlightUrl = imageUrl;

  const rect = target.getBoundingClientRect();
  border.style.cssText = `
    position: fixed;
    box-sizing: border-box;
    top: ${rect.top - gap}px;
    left: ${rect.left - gap}px;
    width: ${rect.width + gap * 2}px;
    height: ${rect.height + gap * 2}px;
    border: ${borderWidth}px solid #60B557;
    border-radius: 6px;
    z-index: 2147483647;
    pointer-events: none;
    box-shadow: 0 0 8px 2px rgba(96, 181, 87, 0.7),
                0 0 20px 6px rgba(96, 181, 87, 0.35);
  `;

  document.documentElement.appendChild(border);

  // Continuously track position via rAF — handles any scroll container, resize, etc.
  let rafId: number | null = null;
  let isTracking = true;

  const trackPosition = (): void => {
    if (!isTracking) return;
    const r = target.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Hide highlight when element is completely outside the viewport
    const isOutOfView =
      r.bottom < 0 || r.top > viewportHeight || r.right < 0 || r.left > viewportWidth;
    border.style.display = isOutOfView ? 'none' : '';

    if (!isOutOfView) {
      border.style.top = r.top - gap + 'px';
      border.style.left = r.left - gap + 'px';
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
  removeOverlay();
}
