// Content Script Advanced Extraction Module
// Handles extraction of SVG, canvas, video, and other advanced image sources

import {
  generateId,
  resolveUrl,
  getDomain,
  getFileFormat,
  isDataUri,
  isImageDataUri,
  generateDataUriKey,
} from '../shared/utils';
import type { ImageItem } from '../shared/types';
import { state } from './state';
import { skipElement, parseSrcset } from './utils';

/**
 * Convert an inline <svg> element to a data URI and create an image item.
 * Returns null if the SVG is too small or already seen.
 */
export function extractInlineSvg(svgElement: SVGElement): ImageItem | null {
  try {
    const rect = svgElement.getBoundingClientRect();
    // Skip tiny SVGs (likely icons/decorations handled elsewhere)
    if (rect.width < 2 || rect.height < 2) return null;

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);
    const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
    const dataKey = generateDataUriKey(dataUri);
    if (state.seenUrls.has(dataKey)) return null;
    state.seenUrls.add(dataKey);

    return {
      id: generateId(dataKey),
      url: dataUri,
      displayWidth: Math.round(rect.width),
      displayHeight: Math.round(rect.height),
      type: 'svg',
      format: 'svg',
      sourceDomain: window.location.hostname,
      checked: false,
      timestamp: Date.now(),
    } as ImageItem;
  } catch {
    return null;
  }
}

/**
 * Extract image data from a <canvas> element by converting to data URI.
 * Returns null if the canvas is tainted (cross-origin), empty, or already seen.
 */
export function extractCanvasImage(canvasElement: HTMLCanvasElement): ImageItem | null {
  try {
    if (canvasElement.width < 2 || canvasElement.height < 2) return null;

    const dataUri = canvasElement.toDataURL('image/png');
    // toDataURL returns a very short string for blank canvases
    if (!dataUri || dataUri.length < 100) return null;

    const dataKey = generateDataUriKey(dataUri);
    if (state.seenUrls.has(dataKey)) return null;
    state.seenUrls.add(dataKey);

    return {
      id: generateId(dataKey),
      url: dataUri,
      displayWidth: canvasElement.width,
      displayHeight: canvasElement.height,
      type: 'canvas',
      format: 'png',
      sourceDomain: window.location.hostname,
      checked: false,
      timestamp: Date.now(),
    } as ImageItem;
  } catch {
    // Canvas is tainted (cross-origin content drawn on it)
    return null;
  }
}

// Extract all inline <svg> elements on the page
export async function extractInlineSvgs(images: Map<string, ImageItem>): Promise<void> {
  const svgElements = document.querySelectorAll('svg');
  for (const svg of svgElements) {
    // Skip SVGs that are inside an <img> (already handled) or hidden
    if (svg.closest('img') || svg.closest('[style*="display: none"]')) continue;
    try {
      const rect = svg.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const style = window.getComputedStyle(svg);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
    } catch {
      continue;
    }

    const item = extractInlineSvg(svg);
    if (item) {
      images.set(item.id, item);
    }
  }
}

// Extract all <canvas> elements on the page
export async function extractCanvasElements(images: Map<string, ImageItem>): Promise<void> {
  const canvases = document.querySelectorAll('canvas');
  for (const canvas of canvases) {
    const item = extractCanvasImage(canvas);
    if (item) {
      images.set(item.id, item);
    }
  }
}

// Extract <video> poster images
export async function extractVideoPosterImages(images: Map<string, ImageItem>): Promise<void> {
  const videos = document.querySelectorAll<HTMLVideoElement>('video[poster]');
  for (const video of videos) {
    const posterUrl = video.poster;
    if (!posterUrl) continue;

    if (isDataUri(posterUrl)) {
      if (!isImageDataUri(posterUrl)) continue;
      const dataKey = generateDataUriKey(posterUrl);
      if (state.seenUrls.has(dataKey)) continue;
      state.seenUrls.add(dataKey);
      images.set(dataKey, {
        id: generateId(dataKey),
        url: posterUrl,
        displayWidth: video.videoWidth || video.width || 0,
        displayHeight: video.videoHeight || video.height || 0,
        type: 'video-poster',
        format: getFileFormat(posterUrl),
        sourceDomain: window.location.hostname,
        checked: false,
        timestamp: Date.now(),
      } as ImageItem);
      continue;
    }

    const resolvedUrl = resolveUrl(posterUrl);
    if (state.seenUrls.has(resolvedUrl)) continue;
    state.seenUrls.add(resolvedUrl);

    images.set(resolvedUrl, {
      id: generateId(resolvedUrl),
      url: resolvedUrl,
      displayWidth: video.videoWidth || video.width || 0,
      displayHeight: video.videoHeight || video.height || 0,
      type: 'video-poster',
      format: getFileFormat(resolvedUrl),
      sourceDomain: getDomain(resolvedUrl),
      checked: false,
      timestamp: Date.now(),
    } as ImageItem);
  }
}

// Extract <input type="image"> elements
export async function extractInputImages(images: Map<string, ImageItem>): Promise<void> {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="image"]');
  for (const input of inputs) {
    const url = input.src;
    if (!url) continue;

    if (isDataUri(url)) {
      if (!isImageDataUri(url)) continue;
      const dataKey = generateDataUriKey(url);
      if (state.seenUrls.has(dataKey)) continue;
      state.seenUrls.add(dataKey);
      images.set(dataKey, {
        id: generateId(dataKey),
        url: url,
        displayWidth: input.width || 0,
        displayHeight: input.height || 0,
        type: 'input-image',
        format: getFileFormat(url),
        sourceDomain: window.location.hostname,
        checked: false,
        timestamp: Date.now(),
      } as ImageItem);
      continue;
    }

    const resolvedUrl = resolveUrl(url);
    if (state.seenUrls.has(resolvedUrl)) continue;
    state.seenUrls.add(resolvedUrl);

    images.set(resolvedUrl, {
      id: generateId(resolvedUrl),
      url: resolvedUrl,
      displayWidth: input.width || 0,
      displayHeight: input.height || 0,
      type: 'input-image',
      format: getFileFormat(resolvedUrl),
      sourceDomain: getDomain(resolvedUrl),
      checked: false,
      timestamp: Date.now(),
    } as ImageItem);
  }
}

// Extract images from <object> and <embed> elements
export async function extractObjectEmbedImages(images: Map<string, ImageItem>): Promise<void> {
  const imageTypePattern = /image\//i;

  // <object> elements with image type or image data URL
  const objects = document.querySelectorAll<HTMLObjectElement>('object');
  for (const obj of objects) {
    const dataUrl = obj.data;
    const objType = obj.type || '';
    if (!dataUrl) continue;
    // Only process if type indicates image, or URL looks like an image
    if (!imageTypePattern.test(objType) && getFileFormat(dataUrl) === 'unknown') continue;

    const resolvedUrl = isDataUri(dataUrl) ? null : resolveUrl(dataUrl);
    const key = (isDataUri(dataUrl) ? generateDataUriKey(dataUrl) : resolvedUrl) as string;
    if (state.seenUrls.has(key)) continue;
    state.seenUrls.add(key);

    const rect = obj.getBoundingClientRect();
    images.set(key, {
      id: generateId(key),
      url: isDataUri(dataUrl) ? dataUrl : (resolvedUrl as string),
      displayWidth: Math.round(rect.width),
      displayHeight: Math.round(rect.height),
      type: 'object',
      format: isDataUri(dataUrl) ? getFileFormat(dataUrl) : getFileFormat(resolvedUrl as string),
      sourceDomain: isDataUri(dataUrl)
        ? window.location.hostname
        : getDomain(resolvedUrl as string),
      checked: false,
      timestamp: Date.now(),
    } as ImageItem);
  }

  // <embed> elements with image type
  const embeds = document.querySelectorAll<HTMLEmbedElement>('embed');
  for (const embed of embeds) {
    const srcUrl = embed.src;
    const embedType = embed.type || '';
    if (!srcUrl) continue;
    if (!imageTypePattern.test(embedType) && getFileFormat(srcUrl) === 'unknown') continue;

    const resolvedUrl = isDataUri(srcUrl) ? null : resolveUrl(srcUrl);
    const key = (isDataUri(srcUrl) ? generateDataUriKey(srcUrl) : resolvedUrl) as string;
    if (state.seenUrls.has(key)) continue;
    state.seenUrls.add(key);

    const rect = embed.getBoundingClientRect();
    images.set(key, {
      id: generateId(key),
      url: isDataUri(srcUrl) ? srcUrl : (resolvedUrl as string),
      displayWidth: Math.round(rect.width),
      displayHeight: Math.round(rect.height),
      type: 'embed',
      format: isDataUri(srcUrl) ? getFileFormat(srcUrl) : getFileFormat(resolvedUrl as string),
      sourceDomain: isDataUri(srcUrl) ? window.location.hostname : getDomain(resolvedUrl as string),
      checked: false,
      timestamp: Date.now(),
    } as ImageItem);
  }
}

// Extract images from <link rel="icon"> and <meta property="og:image"> etc.
export async function extractMetaAndLinkImages(images: Map<string, ImageItem>): Promise<void> {
  // Favicon and apple-touch-icon
  const linkSelectors = [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
    'link[rel="apple-touch-icon-precomposed"]',
    'link[rel="mask-icon"]',
  ];
  const links = document.querySelectorAll<HTMLLinkElement>(linkSelectors.join(','));
  for (const link of links) {
    const href = link.href;
    if (!href || isDataUri(href)) continue;

    const resolvedUrl = resolveUrl(href);
    if (state.seenUrls.has(resolvedUrl)) continue;
    state.seenUrls.add(resolvedUrl);

    const sizes = link.getAttribute('sizes');
    let width = 0;
    let height = 0;
    if (sizes && sizes !== 'any') {
      const parts = sizes.split('x');
      if (parts.length === 2) {
        width = parseInt(parts[0], 10) || 0;
        height = parseInt(parts[1], 10) || 0;
      }
    }

    images.set(resolvedUrl, {
      id: generateId(resolvedUrl),
      url: resolvedUrl,
      displayWidth: width,
      displayHeight: height,
      type: 'link-icon',
      format: getFileFormat(resolvedUrl),
      sourceDomain: getDomain(resolvedUrl),
      checked: false,
      timestamp: Date.now(),
    } as ImageItem);
  }

  // Open Graph and Twitter Card images
  const metaSelectors = [
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'meta[itemprop="image"]',
  ];
  const metas = document.querySelectorAll<HTMLMetaElement>(metaSelectors.join(','));
  for (const meta of metas) {
    const content = meta.content;
    if (!content || isDataUri(content)) continue;

    const resolvedUrl = resolveUrl(content);
    if (state.seenUrls.has(resolvedUrl)) continue;
    state.seenUrls.add(resolvedUrl);

    images.set(resolvedUrl, {
      id: generateId(resolvedUrl),
      url: resolvedUrl,
      displayWidth: 0,
      displayHeight: 0,
      type: 'meta',
      format: getFileFormat(resolvedUrl),
      sourceDomain: getDomain(resolvedUrl),
      checked: false,
      timestamp: Date.now(),
    } as ImageItem);
  }
}

// Extract lazy-loaded images via common data-* attributes
export async function extractLazyLoadImages(images: Map<string, ImageItem>): Promise<void> {
  // Common lazy-load attribute names used by popular libraries
  const lazyAttributes = [
    'data-src',
    'data-original',
    'data-lazy',
    'data-lazy-src',
    'data-hi-res-src',
    'data-image',
    'data-full-src',
    'data-bg',
    'data-bg-src',
    'data-background',
    'data-poster',
  ];
  const lazySrcsetAttributes = ['data-srcset', 'data-lazy-srcset'];

  // Build a selector that matches any element with at least one of these attributes
  const selectorParts = [
    ...lazyAttributes.map((attr) => `[${attr}]`),
    ...lazySrcsetAttributes.map((attr) => `[${attr}]`),
  ];
  const elements = document.querySelectorAll(selectorParts.join(','));

  for (const el of elements) {
    // Process single-URL attributes
    for (const attr of lazyAttributes) {
      const value = el.getAttribute(attr);
      if (!value) continue;

      // Some data-bg attributes use url() syntax
      const urlMatch = value.match(/url\(['"]?([^'")]+)['"]?\)/);
      const rawUrl = urlMatch ? urlMatch[1] : value;

      if (isDataUri(rawUrl)) {
        if (!isImageDataUri(rawUrl)) continue;
        const dataKey = generateDataUriKey(rawUrl);
        if (state.seenUrls.has(dataKey)) continue;
        state.seenUrls.add(dataKey);
        const rect = el.getBoundingClientRect();
        const naturalW = (el as HTMLImageElement).naturalWidth || 0;
        const naturalH = (el as HTMLImageElement).naturalHeight || 0;
        images.set(dataKey, {
          id: generateId(dataKey),
          url: rawUrl,
          displayWidth: naturalW || Math.round(rect.width) || 0,
          displayHeight: naturalH || Math.round(rect.height) || 0,
          type: 'lazy',
          format: getFileFormat(rawUrl),
          sourceDomain: window.location.hostname,
          checked: false,
          timestamp: Date.now(),
        } as ImageItem);
        continue;
      }

      const resolvedUrl = resolveUrl(rawUrl);
      if (state.seenUrls.has(resolvedUrl)) continue;
      state.seenUrls.add(resolvedUrl);

      // Verify it looks like an image URL
      const format = getFileFormat(resolvedUrl);
      if (format === 'unknown' && !attr.includes('bg') && !attr.includes('background')) {
        // For non-bg attributes, skip if it doesn't look like an image
        // unless the element is an <img> or has image-related context
        if (el.tagName !== 'IMG' && el.tagName !== 'VIDEO' && el.tagName !== 'SOURCE') continue;
      }

      const rect = el.getBoundingClientRect();
      const naturalW = (el as HTMLImageElement).naturalWidth || 0;
      const naturalH = (el as HTMLImageElement).naturalHeight || 0;
      images.set(resolvedUrl, {
        id: generateId(resolvedUrl),
        url: resolvedUrl,
        displayWidth: naturalW || Math.round(rect.width) || 0,
        displayHeight: naturalH || Math.round(rect.height) || 0,
        type: 'lazy',
        format: format,
        sourceDomain: getDomain(resolvedUrl),
        checked: false,
        timestamp: Date.now(),
      } as ImageItem);
    }

    // Process srcset-style attributes
    for (const attr of lazySrcsetAttributes) {
      const value = el.getAttribute(attr);
      if (!value) continue;

      const parsed = parseSrcset(value);
      for (const { url } of parsed) {
        if (!url) continue;

        if (isDataUri(url)) {
          if (!isImageDataUri(url)) continue;
          const dataKey = generateDataUriKey(url);
          if (state.seenUrls.has(dataKey)) continue;
          state.seenUrls.add(dataKey);
          const rect = el.getBoundingClientRect();
          const naturalW = (el as HTMLImageElement).naturalWidth || 0;
          const naturalH = (el as HTMLImageElement).naturalHeight || 0;
          images.set(dataKey, {
            id: generateId(dataKey),
            url: url,
            displayWidth: naturalW || Math.round(rect.width) || 0,
            displayHeight: naturalH || Math.round(rect.height) || 0,
            type: 'lazy',
            format: getFileFormat(url),
            sourceDomain: window.location.hostname,
            checked: false,
            timestamp: Date.now(),
          } as ImageItem);
          continue;
        }

        const resolvedUrl = resolveUrl(url);
        if (state.seenUrls.has(resolvedUrl)) continue;
        state.seenUrls.add(resolvedUrl);

        const rect = el.getBoundingClientRect();
        const naturalW = (el as HTMLImageElement).naturalWidth || 0;
        const naturalH = (el as HTMLImageElement).naturalHeight || 0;
        images.set(resolvedUrl, {
          id: generateId(resolvedUrl),
          url: resolvedUrl,
          displayWidth: naturalW || Math.round(rect.width) || 0,
          displayHeight: naturalH || Math.round(rect.height) || 0,
          type: 'lazy',
          format: getFileFormat(resolvedUrl),
          sourceDomain: getDomain(resolvedUrl),
          checked: false,
          timestamp: Date.now(),
        } as ImageItem);
      }
    }
  }
}

// Extract images from CSS content property (e.g. ::before / ::after pseudo-elements)
export async function extractCssContentImages(images: Map<string, ImageItem>): Promise<void> {
  const elements = document.querySelectorAll('*');
  for (const el of elements) {
    if (skipElement(el)) continue;
    for (const pseudo of ['::before', '::after'] as const) {
      try {
        const style = window.getComputedStyle(el, pseudo);
        const content = style.content;
        if (!content || content === 'none' || content === 'normal') continue;
        const urlMatch = content.match(/url\(['"]?([^'")]+)['"]?\)/);
        if (!urlMatch) continue;
        const rawUrl = urlMatch[1];

        if (isDataUri(rawUrl)) {
          if (!isImageDataUri(rawUrl)) continue;
          const dataKey = generateDataUriKey(rawUrl);
          if (state.seenUrls.has(dataKey)) continue;
          state.seenUrls.add(dataKey);
          const rect = el.getBoundingClientRect();
          images.set(dataKey, {
            id: generateId(dataKey),
            url: rawUrl,
            displayWidth: Math.round(rect.width) || 0,
            displayHeight: Math.round(rect.height) || 0,
            type: 'css-content',
            format: getFileFormat(rawUrl),
            sourceDomain: window.location.hostname,
            checked: false,
            timestamp: Date.now(),
          } as ImageItem);
        } else {
          const resolvedUrl = resolveUrl(rawUrl);
          if (!resolvedUrl || state.seenUrls.has(resolvedUrl)) continue;
          state.seenUrls.add(resolvedUrl);
          const rect = el.getBoundingClientRect();
          images.set(resolvedUrl, {
            id: generateId(resolvedUrl),
            url: resolvedUrl,
            displayWidth: Math.round(rect.width) || 0,
            displayHeight: Math.round(rect.height) || 0,
            type: 'css-content',
            format: getFileFormat(resolvedUrl),
            sourceDomain: getDomain(resolvedUrl),
            checked: false,
            timestamp: Date.now(),
          } as ImageItem);
        }
      } catch {
        // Swallow getComputedStyle exceptions for inaccessible pseudo-elements
      }
    }
  }
}
