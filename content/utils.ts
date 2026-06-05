// Content-script local utilities shared across content modules.
// Distinct from `shared/utils.ts` which targets all extension surfaces.

import { MESSAGE_TYPES } from '../shared/constants';
import type { ImageItem } from '../shared/types';
import { state, isExtensionContextValid } from './state';

export interface SrcsetCandidate {
  url: string;
  width: number;
}

/** Parse an srcset attribute value into an array of {url, width} candidates,
 *  sorted by descending width. */
export function parseSrcset(srcset: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  const parts = srcset.split(',');

  for (const part of parts) {
    const [url, descriptor] = part.trim().split(/\s+/);
    if (!url) continue;

    let width = 0;
    if (descriptor) {
      if (descriptor.endsWith('w')) {
        width = parseInt(descriptor, 10);
      } else if (descriptor.endsWith('x')) {
        width = parseFloat(descriptor) * 1000; // Approximate
      }
    }

    candidates.push({ url, width });
  }

  // Sort by width descending
  return candidates.sort((a, b) => b.width - a.width);
}

/** Check whether a DOM element is visible on the page.
 *  Uses bounding rect, computed style, and viewport intersection. */
export function isElementVisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  // Check if element is within the document's scroll area (not just viewport)
  const docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const docWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (rect.bottom < 0 || rect.top > docHeight || rect.right < 0 || rect.left > docWidth) {
    return false;
  }
  return true;
}

/**
 * Detect whether an element is truly accessible to the user without requiring
 * interaction (click, hover, dropdown expand, etc.). Shares the same logic
 * used by the image-highlight feature so "visible" images in the filter are
 * exactly those that can be found and highlighted on the page.
 *
 * Returns false for elements inside:
 *  - display:none ancestors
 *  - visibility:hidden / opacity:0 ancestors
 *  - collapsed containers (overflow:hidden with near-zero effective size)
 *  - popover / dropdown / tooltip containers that are not currently shown
 *
 * Returns true for elements that are simply off-screen (below the fold) —
 * these can be scrolled into view without user interaction.
 */
export function isElementAccessibleWithoutInteraction(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    const style = window.getComputedStyle(current);

    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (parseFloat(style.opacity) === 0) return false;

    if (current !== element) {
      const overflow = style.overflow + style.overflowX + style.overflowY;
      if (overflow.includes('hidden')) {
        const parentRect = current.getBoundingClientRect();
        if (parentRect.width < 4 || parentRect.height < 4) return false;
      }
    }

    if (current !== element && current.getAttribute('aria-hidden') === 'true') return false;

    if (current !== element) {
      const ariaExpanded = current.getAttribute('aria-expanded');
      if (ariaExpanded === 'false') {
        const parentRect = current.getBoundingClientRect();
        if (parentRect.height < 4 || parentRect.width < 4) return false;
      }
    }

    current = current.parentElement;
  }

  return true;
}

/** Given a list of srcset candidates (already sorted by width desc),
 *  return only the highest-resolution URL. */
export function pickBestSrcsetUrl(candidates: SrcsetCandidate[]): string | null {
  if (candidates.length === 0) return null;
  return candidates[0].url || null;
}

/** Wait for an `<img>` to finish loading (or timeout after 500ms).
 *  We only need the image to be loaded enough to read naturalWidth/Height;
 *  a short timeout avoids blocking the entire extraction pipeline. */
export function ensureImageLoaded(img: HTMLImageElement): Promise<void> {
  if (img.complete && img.naturalWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(), 500);

    img.addEventListener(
      'load',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );

    img.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

/** Decide whether `extractBackgroundImages` should skip an element. */
export function skipElement(el: Element): boolean {
  const tagName = el.tagName?.toLowerCase();

  // Skip script, style, and other non-visual elements
  if (['script', 'style', 'link', 'meta', 'title', 'head', 'html', 'noscript'].includes(tagName)) {
    return true;
  }

  // Skip hidden elements
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return true;
  }

  // Skip very small elements (likely icons/decorations)
  const rect = el.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) {
    return true;
  }

  return false;
}

/** Send newly discovered images to the background / UI. If the extension
 *  context is invalid (e.g. after a reload), tears down the live observer
 *  inline to avoid a circular import on `./monitor`. */
export function sendDiscoveredImages(images: ImageItem[]): void {
  try {
    if (!isExtensionContextValid()) return;
    chrome.runtime
      .sendMessage({
        type: MESSAGE_TYPES.IMAGES_DISCOVERED,
        images,
      })
      .catch(() => {
        /* ignore */
      });
  } catch {
    if (state.liveObserver) {
      state.liveObserver.disconnect();
      state.liveObserver = null;
    }
  }
}
