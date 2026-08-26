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
// Last-rung fallback: SPA pages (JS-rendered) ship no og:image in their
// server HTML but often embed schema.org JSON-LD. Best-effort — malformed
// JSON or missing image field just falls through to "no meta image".
const JSON_LD_PATTERN =
  /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

// Cookie-scoping (security review): the candidate links come from PAGE
// content, so `credentials: 'include'` on every fetch would let a hostile
// page aim credentialed GETs at arbitrary hosts (CSRF-style, hitting
// cookie-guarded intranet GET endpoints). Cookies are therefore only sent
// to links on the same site the user is actually browsing. Same-site is
// approximated by the hostname's last two labels (three for the common
// multi-label public suffixes below — a tiny hand list instead of a
// bundled public-suffix list); intranet estates on one domain root
// (*.alibaba-inc.com-style) still compare equal, and browser domain-match
// rules keep scoping the actual cookies regardless.
const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.jp',
  'or.jp',
  'ne.jp',
  'co.kr',
  'co.in',
  'co.za',
  'com.cn',
  'net.cn',
  'org.cn',
  'com.tw',
  'com.hk',
  'com.sg',
  'com.br',
  'com.mx',
  'com.ar',
]);

/** Approximate registrable domain (eTLD+1) of a URL; '' for unparseable input. */
function registrableRoot(url: string): string {
  try {
    const labels = new URL(url).hostname.toLowerCase().split('.');
    const last2 = labels.slice(-2).join('.');
    return MULTI_LABEL_PUBLIC_SUFFIXES.has(last2) && labels.length >= 3
      ? labels.slice(-3).join('.')
      : last2;
  } catch {
    return '';
  }
}

/** True when both URLs sit on the same approximate registrable domain. */
function sharesRegistrableDomain(linkUrl: string, sourceUrl: string): boolean {
  const root = registrableRoot(linkUrl);
  return root !== '' && root === registrableRoot(sourceUrl);
}

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

/** Pull the first usable image URL out of a schema.org value (string / object / array shapes). */
function jsonLdImageToString(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = jsonLdImageToString(entry);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // "url" (ImageObject) / "contentUrl" (older schema.org) — both are the
    // actual image location; "image" on a nested node is not our business.
    for (const key of ['url', 'contentUrl']) {
      if (typeof record[key] === 'string' && record[key]) return record[key] as string;
    }
  }
  return null;
}

/**
 * Extract an image URL from embedded `application/ld+json` blocks. Handles the
 * top-level `image` field and the common `@graph` wrapper. Malformed JSON in
 * any block is skipped (sites ship broken JSON-LD surprisingly often).
 */
function extractJsonLdImage(html: string): string | null {
  JSON_LD_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JSON_LD_PATTERN.exec(html)) !== null) {
    try {
      const data: unknown = JSON.parse(match[1]);
      const nodes = Array.isArray(data)
        ? data
        : data &&
            typeof data === 'object' &&
            Array.isArray((data as Record<string, unknown>)['@graph'])
          ? ((data as Record<string, unknown>)['@graph'] as unknown[])
          : [data];
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const image = (node as Record<string, unknown>)['image'];
        const found = jsonLdImageToString(image);
        if (found) return found;
      }
    } catch {
      /* malformed JSON-LD block — try the next one */
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
  /**
   * Per-link outcome (v1.1.0 smoke feedback: "resolve failed" with no hint
   * WHICH link failed or WHY). Order matches the input urls (capped slice).
   * The sidepanel renders this as per-link status in the expandable list.
   */
  results: LinkResolveOutcome[];
}

export type LinkResolveFailureReason =
  | 'blocked' // URL rejected by the SSRF/security guard (private host, non-http)
  | 'http-error' // non-2xx response (anti-bot 4xx, auth wall, 5xx)
  | 'non-html' // body isn't a page (direct image / JSON / binary)
  | 'no-meta-image' // fetched fine, but advertises no image anywhere
  | 'network-error'; // fetch threw (timeout, DNS, connection reset)

export interface LinkResolveOutcome {
  /** The detail-page link this outcome describes. */
  url: string;
  status: 'resolved' | 'failed';
  /** Present when status === 'failed'. */
  reason?: LinkResolveFailureReason;
}

/**
 * Resolve detail-page links to their original images. Individual failures are
 * silently skipped and counted — one broken page must not sink the batch.
 *
 * `sourceUrl` is the page the user is browsing when they hit "resolve"; only
 * links on its site get the session cookie (see sharesRegistrableDomain).
 * Missing/unknown source → no cookies (conservative cross-site fallback).
 */
export async function resolveLinkImages(
  urls: string[],
  sourceUrl?: string
): Promise<LinkResolveResult> {
  const targets = urls.filter((u) => typeof u === 'string' && u).slice(0, MAX_LINKS_PER_REQUEST);

  const images = new Map<string, ImageItem>();
  // Pre-sized and written BY INDEX so results always match the input order —
  // the workers finish out of order and the UI maps outcomes back to the
  // rendered link list positionally.
  const results: LinkResolveOutcome[] = new Array(targets.length);
  let resolved = 0;
  let failed = 0;

  // Simple worker pool: N workers pull from a shared index.
  let next = 0;
  async function worker(): Promise<void> {
    while (next < targets.length) {
      const index = next++;
      const url = targets[index];
      try {
        const outcome = await resolveSingleLink(url, sourceUrl);
        results[index] = outcome;
        if (outcome.status === 'resolved' && outcome.imageUrl && outcome.image) {
          resolved++;
          // Several detail pages can share the same og:image — dedup.
          if (!images.has(outcome.imageUrl)) images.set(outcome.imageUrl, outcome.image);
        } else {
          failed++;
        }
      } catch {
        failed++;
        results[index] = { url, status: 'failed', reason: 'network-error' };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  return { images: [...images.values()], resolved, failed, results };
}

interface SingleLinkOutcome extends LinkResolveOutcome {
  imageUrl?: string;
  image?: ImageItem;
}

/** Fetch one page and build an ImageItem from its advertised meta image. */
async function resolveSingleLink(linkUrl: string, sourceUrl?: string): Promise<SingleLinkOutcome> {
  if (!isAllowedFetchUrl(linkUrl)) return { url: linkUrl, status: 'failed', reason: 'blocked' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(linkUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      signal: controller.signal,
      // Intramedia sites (the reported case: Alibaba Aone) require the
      // session cookie — the default 'same-origin' never sends it because
      // the service worker origin is chrome-extension://, so every
      // cross-site page fetch landed on an auth redirect and "failed".
      // Scoped to same-site links only (host_permissions: <all_urls> makes
      // this legal; see sharesRegistrableDomain for the threat model).
      credentials:
        sourceUrl && sharesRegistrableDomain(linkUrl, sourceUrl) ? 'include' : 'same-origin',
    });
    if (!response.ok) return { url: linkUrl, status: 'failed', reason: 'http-error' };
    // Re-validate the final URL after redirects (same hardening as
    // fetchImageMetaProxy) to prevent DNS-rebinding bypasses.
    if (!isAllowedFetchUrl(response.url))
      return { url: linkUrl, status: 'failed', reason: 'blocked' };

    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
      return { url: linkUrl, status: 'failed', reason: 'non-html' };
    }

    const html = (await response.text()).slice(0, HTML_SCAN_LIMIT);
    // trim() guards the whitespace-only case: `new URL(' ', response.url)`
    // parses to the PAGE itself (WHATWG strips the space), which would
    // yield a fake "original" pointing at the HTML document.
    const rawImage = (extractMetaImage(html) ?? extractJsonLdImage(html))?.trim() || null;
    if (!rawImage) return { url: linkUrl, status: 'failed', reason: 'no-meta-image' };

    // Resolve relative URLs against the final (post-redirect) page URL.
    let imageUrl: string;
    try {
      imageUrl = new URL(decodeAttrEntities(rawImage), response.url).href;
    } catch {
      return { url: linkUrl, status: 'failed', reason: 'no-meta-image' };
    }
    if (!/^https?:/i.test(imageUrl))
      return { url: linkUrl, status: 'failed', reason: 'no-meta-image' };

    // visible: true — the user explicitly asked for these originals, so they
    // must survive the default visible-only filter chain in the grid.
    // userInjected: true — they must also survive rescans / panel reloads:
    // no page scan will ever rediscover them.
    return {
      url: linkUrl,
      status: 'resolved',
      imageUrl,
      image: {
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
      } as ImageItem,
    };
  } finally {
    clearTimeout(timeout);
  }
}
