// Content Script Shadow DOM & Iframe Module
// Handles extraction from Shadow DOM trees and iframes

import {
  generateId,
  resolveUrl,
  getDomain,
  getFileFormat,
  isDataUri,
  isImageDataUri,
  generateDataUriKey,
  extractBackgroundUrls,
  isGradient
} from '../shared/utils';
import type { ImageItem } from '../shared/types';
import { state } from './state';
import { ensureImageLoaded, parseSrcset } from './utils';
import { extractInlineSvg, extractCanvasImage } from './extract-advanced';

// ============================================
// Shadow DOM support
// ============================================

/**
 * Recursively collect all shadow roots in the document.
 */
export function collectShadowRoots(root: Document | ShadowRoot = document): ShadowRoot[] {
  const shadowRoots: ShadowRoot[] = [];
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.currentNode;
  while (node) {
    const el = node as Element;
    if (el.shadowRoot) {
      shadowRoots.push(el.shadowRoot);
      // Recurse into the shadow root to find nested shadow DOMs
      shadowRoots.push(...collectShadowRoots(el.shadowRoot));
    }
    node = walker.nextNode();
  }
  return shadowRoots;
}

/**
 * querySelectorAll that also searches inside Shadow DOM trees.
 */
export function querySelectorAllDeep(selector: string, root: Document | ShadowRoot = document): Element[] {
  const results: Element[] = Array.from(root.querySelectorAll(selector));
  const shadowRoots = collectShadowRoots(root);
  for (const shadowRoot of shadowRoots) {
    results.push(...shadowRoot.querySelectorAll(selector));
  }
  return results;
}

/**
 * Extract images from all Shadow DOM trees on the page.
 */
export async function extractFromShadowDom(images: Map<string, ImageItem>): Promise<void> {
  const shadowRoots = collectShadowRoots(document);
  if (shadowRoots.length === 0) return;

  for (const shadowRoot of shadowRoots) {
    // Extract <img> from shadow DOM
    const imgs = shadowRoot.querySelectorAll('img');
    for (const img of imgs) {
      try {
        await ensureImageLoaded(img);
        const candidateUrls = new Set<string>();
        if (img.src) candidateUrls.add(img.src);
        if (img.currentSrc) candidateUrls.add(img.currentSrc);
        if (img.srcset) {
          for (const { url } of parseSrcset(img.srcset)) {
            if (url) candidateUrls.add(url);
          }
        }
        for (const attr of ['data-src', 'data-original', 'data-lazy', 'data-lazy-src']) {
          const val = img.getAttribute(attr);
          if (val) candidateUrls.add(val);
        }

        for (const url of candidateUrls) {
          if (!url) continue;
          if (isDataUri(url)) {
            if (!isImageDataUri(url)) continue;
            const dataKey = generateDataUriKey(url);
            if (state.seenUrls.has(dataKey)) continue;
            state.seenUrls.add(dataKey);
            images.set(dataKey, {
              id: generateId(dataKey), url,
              displayWidth: img.naturalWidth || img.width || 0,
              displayHeight: img.naturalHeight || img.height || 0,
              naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
              type: 'img', format: getFileFormat(url),
              sourceDomain: window.location.hostname,
              checked: false, timestamp: Date.now()
            } as ImageItem);
            continue;
          }
          const resolvedUrl = resolveUrl(url);
          if (state.seenUrls.has(resolvedUrl)) continue;
          state.seenUrls.add(resolvedUrl);
          images.set(resolvedUrl, {
            id: generateId(resolvedUrl), url: resolvedUrl,
            displayWidth: img.naturalWidth || img.width || 0,
            displayHeight: img.naturalHeight || img.height || 0,
            naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
            type: 'img', format: getFileFormat(resolvedUrl),
            sourceDomain: getDomain(resolvedUrl),
            checked: false, timestamp: Date.now()
          } as ImageItem);
        }
      } catch { /* skip */ }
    }

    // Extract background images from shadow DOM
    const els = shadowRoot.querySelectorAll('*');
    const maxEls = Math.min(els.length, 1000);
    for (let i = 0; i < maxEls; i++) {
      try {
        const style = window.getComputedStyle(els[i]);
        const bg = style.backgroundImage;
        if (!bg || bg === 'none') continue;
        const urls = extractBackgroundUrls(bg);
        for (const url of urls) {
          if (!url || isGradient(url)) continue;
          if (isDataUri(url)) {
            if (!isImageDataUri(url)) continue;
            const dataKey = generateDataUriKey(url);
            if (state.seenUrls.has(dataKey)) continue;
            state.seenUrls.add(dataKey);
            const rect = els[i].getBoundingClientRect();
            images.set(dataKey, {
              id: generateId(dataKey), url,
              displayWidth: Math.round(rect.width), displayHeight: Math.round(rect.height),
              type: 'bg', format: getFileFormat(url),
              sourceDomain: window.location.hostname,
              checked: false, timestamp: Date.now()
            } as ImageItem);
            continue;
          }
          const resolvedUrl = resolveUrl(url);
          if (state.seenUrls.has(resolvedUrl)) continue;
          state.seenUrls.add(resolvedUrl);
          const rect = els[i].getBoundingClientRect();
          images.set(resolvedUrl, {
            id: generateId(resolvedUrl), url: resolvedUrl,
            displayWidth: Math.round(rect.width), displayHeight: Math.round(rect.height),
            type: 'bg', format: getFileFormat(resolvedUrl),
            sourceDomain: getDomain(resolvedUrl),
            checked: false, timestamp: Date.now()
          } as ImageItem);
        }
      } catch { /* skip */ }
    }

    // Extract <picture> sources from shadow DOM
    const pictures = shadowRoot.querySelectorAll('picture');
    for (const picture of pictures) {
      const sources = picture.querySelectorAll('source');
      const fallbackImg = picture.querySelector('img');
      for (const source of sources) {
        const candidateUrls: string[] = [];
        const srcset = source.srcset || source.getAttribute('data-srcset');
        if (srcset) {
          for (const { url } of parseSrcset(srcset)) {
            if (url) candidateUrls.push(url);
          }
        }
        const src = source.src || source.getAttribute('data-src');
        if (src) candidateUrls.push(src);

        for (const url of candidateUrls) {
          if (!url) continue;
          if (isDataUri(url)) {
            if (!isImageDataUri(url)) continue;
            const dataKey = generateDataUriKey(url);
            if (state.seenUrls.has(dataKey)) continue;
            state.seenUrls.add(dataKey);
            images.set(dataKey, {
              id: generateId(dataKey), url,
              displayWidth: fallbackImg?.naturalWidth || 0,
              displayHeight: fallbackImg?.naturalHeight || 0,
              type: 'img', format: getFileFormat(url),
              sourceDomain: window.location.hostname,
              checked: false, timestamp: Date.now()
            } as ImageItem);
            continue;
          }
          const resolvedUrl = resolveUrl(url);
          if (state.seenUrls.has(resolvedUrl)) continue;
          state.seenUrls.add(resolvedUrl);
          images.set(resolvedUrl, {
            id: generateId(resolvedUrl), url: resolvedUrl,
            displayWidth: fallbackImg?.naturalWidth || 0,
            displayHeight: fallbackImg?.naturalHeight || 0,
            type: 'img', format: getFileFormat(resolvedUrl),
            sourceDomain: getDomain(resolvedUrl),
            checked: false, timestamp: Date.now()
          } as ImageItem);
        }
      }
    }

    // Extract <video poster>, <canvas>, <svg> from shadow DOM
    const videos = shadowRoot.querySelectorAll<HTMLVideoElement>('video[poster]');
    for (const video of videos) {
      const posterUrl = video.poster;
      if (!posterUrl) continue;
      const resolvedUrl = resolveUrl(posterUrl);
      if (state.seenUrls.has(resolvedUrl)) continue;
      state.seenUrls.add(resolvedUrl);
      images.set(resolvedUrl, {
        id: generateId(resolvedUrl), url: resolvedUrl,
        displayWidth: video.videoWidth || video.width || 0,
        displayHeight: video.videoHeight || video.height || 0,
        type: 'video-poster', format: getFileFormat(resolvedUrl),
        sourceDomain: getDomain(resolvedUrl),
        checked: false, timestamp: Date.now()
      } as ImageItem);
    }

    const svgs = shadowRoot.querySelectorAll<SVGElement>('svg');
    for (const svg of svgs) {
      const item = extractInlineSvg(svg);
      if (item) images.set(item.id, item);
    }

    const canvases = shadowRoot.querySelectorAll<HTMLCanvasElement>('canvas');
    for (const canvas of canvases) {
      const item = extractCanvasImage(canvas);
      if (item) images.set(item.id, item);
    }
  }
}

// V2.0: Extract images from accessible iframes
export async function extractFromIframes(images: Map<string, ImageItem>): Promise<void> {
  const iframes = document.querySelectorAll('iframe');

  for (const iframe of iframes) {
    try {
      const doc = iframe.contentDocument;
      if (!doc) continue;

      const iframeBase = iframe.src || window.location.href;

      // Extract <img> from iframe
      const imgs = doc.querySelectorAll('img');
      for (const img of imgs) {
        const url = img.currentSrc || img.src;
        if (!url) continue;

        if (isDataUri(url)) {
          if (!isImageDataUri(url)) continue;
          const dataKey = generateDataUriKey(url);
          if (state.seenUrls.has(dataKey)) continue;
          state.seenUrls.add(dataKey);
          images.set(dataKey, {
            id: generateId(dataKey),
            url: url,
            displayWidth: img.naturalWidth || img.width || 0,
            displayHeight: img.naturalHeight || img.height || 0,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            type: 'img',
            format: getFileFormat(url),
            sourceDomain: window.location.hostname,
            checked: false,
            timestamp: Date.now()
          } as ImageItem);
          continue;
        }

        const resolvedUrl = resolveUrl(url, iframeBase);
        if (state.seenUrls.has(resolvedUrl)) continue;
        state.seenUrls.add(resolvedUrl);

        images.set(resolvedUrl, {
          id: generateId(resolvedUrl),
          url: resolvedUrl,
          displayWidth: img.naturalWidth || img.width || 0,
          displayHeight: img.naturalHeight || img.height || 0,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          type: 'img',
          format: getFileFormat(resolvedUrl),
          sourceDomain: getDomain(resolvedUrl),
          checked: false,
          timestamp: Date.now()
        } as ImageItem);
      }

      // Extract background images from iframe
      const els = doc.querySelectorAll('body, body *');
      const maxEls = Math.min(els.length, 500);
      for (let i = 0; i < maxEls; i++) {
        try {
          const win = iframe.contentWindow;
          if (!win) continue;
          const style = win.getComputedStyle(els[i]);
          const bg = style.backgroundImage;
          if (!bg || bg === 'none') continue;
          const urls = extractBackgroundUrls(bg);
          for (const u of urls) {
            if (!u || isGradient(u)) continue;

            if (isDataUri(u)) {
              if (!isImageDataUri(u)) continue;
              const dataKey = generateDataUriKey(u);
              if (state.seenUrls.has(dataKey)) continue;
              state.seenUrls.add(dataKey);
              const rect = els[i].getBoundingClientRect();
              images.set(dataKey, {
                id: generateId(dataKey),
                url: u,
                displayWidth: Math.round(rect.width),
                displayHeight: Math.round(rect.height),
                type: 'bg',
                format: getFileFormat(u),
                sourceDomain: window.location.hostname,
                checked: false,
                timestamp: Date.now()
              } as ImageItem);
              continue;
            }

            const resolvedUrl = resolveUrl(u, iframeBase);
            if (state.seenUrls.has(resolvedUrl)) continue;
            state.seenUrls.add(resolvedUrl);
            const rect = els[i].getBoundingClientRect();
            images.set(resolvedUrl, {
              id: generateId(resolvedUrl),
              url: resolvedUrl,
              displayWidth: Math.round(rect.width),
              displayHeight: Math.round(rect.height),
              type: 'bg',
              format: getFileFormat(resolvedUrl),
              sourceDomain: getDomain(resolvedUrl),
              checked: false,
              timestamp: Date.now()
            } as ImageItem);
          }
        } catch { /* skip */ }
      }
    } catch {
      // Cross-origin iframe, skip
    }
  }
}

