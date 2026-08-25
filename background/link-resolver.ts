// Deep link-resolution (v1.1.0): fetch gallery/detail pages and extract the
// original image each one advertises.
//
// Runs in the service worker, which has no DOMParser — meta tags are pulled
// with regexes instead. Only standardized, high-signal tags are supported
// (og:image → twitter:image → image_src, first hit wins); this is NOT a
// generic HTML scraper.
//
// Telemetry is deliberately NOT sent from this module (e2e leak safety) —
// the sidepanel layer owns gallery_resolve_* events.

import { isAllowedFetchUrl } from '../shared/url-validator';
import { generateId, getDomain, getFileFormat } from '../shared/utils';
import type { ImageItem } from '../shared/types';

/** Hard cap on links resolved per request (matches content MAX_GALLERY_LINKS). */
export const MAX_LINKS_PER_REQUEST = 30;
/** Per-link fetch timeout — a slow site must not stall the whole batch. */
const FETCH_TIMEOUT_MS = 10_000;
/** Only the first slice of HTML is scanned — meta tags live in <head>. */
const HTML_SCAN_LIMIT = 512 * 1024;
/** Concurrent page fetches. */
const CONCURRENCY = 3;

// Attribute order inside <meta>/<link> is not guaranteed by any spec — match
// both orderings. Values are single- or double-quoted.
const OG_IMAGE_PATTERNS = [
  /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*?content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*?property=["']og:image(?::secure_url)?["']/i,
];
const TWITTER_IMAGE_PATTERNS = [
  /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]*?content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*?name=["']twitter:image(?::src)?["']/i,
];
const IMAGE_SRC_PATTERNS = [
  /<link[^>]+rel=["']image_src["'][^>]*?href=["']([^"']+)["']/i,
  /<link[^>]+href=["']([^"']+)["'][^>]*?rel=["']image_src["']/i,
];

/** og:image URLs are HTML-attribute values — undo the mandatory entity escaping. */
function decodeAttrEntities(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&#0?38;/g, '&');
}

/** First og:image → twitter:image → image_src hit, or null. */
function extractMetaImage(html: string): string | null {
  const groups = [OG_IMAGE_PATTERNS, TWITTER_IMAGE_PATTERNS, IMAGE_SRC_PATTERNS];
  for (const patterns of groups) {
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return match[1];
    }
  }
  return null;
}

export interface LinkResolveResult {
  images: ImageItem[];
  /** Links that yielded an image. */
  resolved: number;
  /** Links that failed (network error, non-HTML body, no meta image). */
  failed: number;
}

/**
 * Resolve detail-page links to their original images. Individual failures are
 * silently skipped and counted — one broken page must not sink the batch.
 */
export async function resolveLinkImages(urls: string[]): Promise<LinkResolveResult> {
  const targets = urls.filter((u) => typeof u === 'string' && u).slice(0, MAX_LINKS_PER_REQUEST);

  const images = new Map<string, ImageItem>();
  let resolved = 0;
  let failed = 0;

  // Simple worker pool: N workers pull from a shared index.
  let next = 0;
  async function worker(): Promise<void> {
    while (next < targets.length) {
      const url = targets[next++];
      try {
        const item = await resolveSingleLink(url);
        if (item) {
          resolved++;
          // Several detail pages can share the same og:image — dedup.
          if (!images.has(item.url)) images.set(item.url, item);
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  return { images: [...images.values()], resolved, failed };
}

/** Fetch one page and build an ImageItem from its advertised meta image. */
async function resolveSingleLink(linkUrl: string): Promise<ImageItem | null> {
  if (!isAllowedFetchUrl(linkUrl)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(linkUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    // Re-validate the final URL after redirects (same hardening as
    // fetchImageMetaProxy) to prevent DNS-rebinding bypasses.
    if (!isAllowedFetchUrl(response.url)) return null;

    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) return null;

    const html = (await response.text()).slice(0, HTML_SCAN_LIMIT);
    const rawImage = extractMetaImage(html);
    if (!rawImage) return null;

    // Resolve relative URLs against the final (post-redirect) page URL.
    let imageUrl: string;
    try {
      imageUrl = new URL(decodeAttrEntities(rawImage), response.url).href;
    } catch {
      return null;
    }
    if (!/^https?:/i.test(imageUrl)) return null;

    // visible: true — the user explicitly asked for these originals, so they
    // must survive the default visible-only filter chain in the grid.
    // userInjected: true — they must also survive rescans / panel reloads:
    // no page scan will ever rediscover them.
    return {
      id: generateId(imageUrl),
      url: imageUrl,
      displayWidth: 0,
      displayHeight: 0,
      type: 'link-resolved',
      format: getFileFormat(imageUrl),
      sourceDomain: getDomain(linkUrl),
      checked: false,
      timestamp: Date.now(),
      visible: true,
      userInjected: true,
    } as ImageItem;
  } finally {
    clearTimeout(timeout);
  }
}
