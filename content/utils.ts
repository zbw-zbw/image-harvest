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

/** Wait for an `<img>` to finish loading (or timeout after 2s). */
export function ensureImageLoaded(img: HTMLImageElement): Promise<void> {
  if (img.complete && img.naturalWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(), 2000);

    img.addEventListener('load', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });

    img.addEventListener('error', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
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
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      images
    }).catch(() => { /* ignore */ });
  } catch {
    if (state.liveObserver) {
      state.liveObserver.disconnect();
      state.liveObserver = null;
    }
  }
}
