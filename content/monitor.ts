// Content Script Live Monitoring Module
// Handles real-time image discovery via MutationObserver

import { MESSAGE_TYPES } from '../shared/constants';
import {
  generateId,
  resolveUrl,
  getDomain,
  getFileFormat,
  isDataUri,
  isImageDataUri,
  generateDataUriKey,
  extractBackgroundUrls,
  isGradient,
} from '../shared/utils';
import type { ImageItem } from '../shared/types';
import { state, isExtensionContextValid } from './state';
import { parseSrcset, sendDiscoveredImages } from './utils';
import { extractInlineSvg, extractCanvasImage } from './extract-advanced';

interface LiveMonitorConfig {
  debounceMs?: number;
}

// Live monitoring with MutationObserver
export function startLiveMonitoring(config: LiveMonitorConfig = {}): void {
  stopLiveMonitoring();

  const debounceMs = config.debounceMs || 500;

  // Accumulating buffer: collect all mutations during the debounce window
  // so none are lost (unlike a plain debounce which discards earlier calls).
  let pendingMutations: MutationRecord[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushMutations(): void {
    flushTimer = null;
    if (!isExtensionContextValid()) {
      stopLiveMonitoring();
      return;
    }

    const mutations = pendingMutations;
    pendingMutations = [];

    const newImages: ImageItem[] = [];

    for (const mutation of mutations) {
      // Check added nodes
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as Element;
        const images = extractFromNode(el);
        newImages.push(...images);

        // Also check for background images on the added node and its children
        const bgImages = extractBackgroundFromNode(el);
        newImages.push(...bgImages);
        const bgChildren = el.querySelectorAll?.('*') || [];
        for (const child of bgChildren) {
          const childBg = extractBackgroundFromNode(child);
          newImages.push(...childBg);
        }

        // Watch for lazy-loaded <img> elements that haven't loaded yet
        const lazyImgs =
          el.tagName === 'IMG'
            ? [el as HTMLImageElement]
            : Array.from(el.querySelectorAll?.<HTMLImageElement>('img') || []);
        for (const img of lazyImgs) {
          if (!img.complete || img.naturalWidth === 0) {
            img.addEventListener('load', handleLazyImageLoad, { once: true });
          }
        }
      }

      // Check attribute changes
      if (mutation.type === 'attributes') {
        const target = mutation.target as Element;
        if (
          (mutation.attributeName === 'src' || mutation.attributeName === 'srcset') &&
          target.tagName === 'IMG'
        ) {
          const images = extractFromNode(target);
          newImages.push(...images);
        }
        if (mutation.attributeName === 'style') {
          const images = extractBackgroundFromNode(target);
          newImages.push(...images);
        }
      }
    }

    if (newImages.length > 0) {
      sendDiscoveredImages(newImages);
    }
  }

  function handleMutations(mutations: MutationRecord[]): void {
    pendingMutations.push(...mutations);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushMutations, debounceMs);
  }

  state.liveObserver = new MutationObserver(handleMutations);

  const targetNode = document.body || document.documentElement;
  if (!targetNode) {
    console.warn('[Image Harvest] No DOM node available for MutationObserver');
    return;
  }
  state.liveObserver.observe(targetNode, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'style', 'srcset'],
  });
}

/**
 * Handle lazy-loaded images that fire 'load' after being added to the DOM.
 */
function handleLazyImageLoad(event: Event): void {
  const img = event.target as HTMLImageElement | null;
  if (!img || img.tagName !== 'IMG') return;
  const images = extractFromNode(img);
  if (images.length > 0) {
    sendDiscoveredImages(images);
  }
}

export function stopLiveMonitoring(): void {
  if (state.liveObserver) {
    state.liveObserver.disconnect();
    state.liveObserver = null;
  }
}

// Extract images from a node (used by live monitoring)
export function extractFromNode(node: Element): ImageItem[] {
  const images: ImageItem[] = [];

  // Check <img> elements
  if (node.tagName === 'IMG') {
    const img = node as HTMLImageElement;
    const candidateUrls = new Set<string>();
    if (img.src) candidateUrls.add(img.src);
    if (img.currentSrc) candidateUrls.add(img.currentSrc);
    if (img.srcset) {
      const parsed = parseSrcset(img.srcset);
      for (const { url } of parsed) {
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
        images.push({
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
          timestamp: Date.now(),
        } as ImageItem);
        continue;
      }
      const resolvedUrl = resolveUrl(url);
      if (state.seenUrls.has(resolvedUrl)) continue;
      state.seenUrls.add(resolvedUrl);
      images.push({
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
        timestamp: Date.now(),
      } as ImageItem);
    }
  }

  // Check <video> poster
  if (node.tagName === 'VIDEO') {
    const video = node as HTMLVideoElement;
    if (video.poster) {
      const posterUrl = video.poster;
      if (isDataUri(posterUrl)) {
        if (isImageDataUri(posterUrl)) {
          const dataKey = generateDataUriKey(posterUrl);
          if (!state.seenUrls.has(dataKey)) {
            state.seenUrls.add(dataKey);
            images.push({
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
          }
        }
      } else {
        const resolvedUrl = resolveUrl(posterUrl);
        if (!state.seenUrls.has(resolvedUrl)) {
          state.seenUrls.add(resolvedUrl);
          images.push({
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
    }
  }

  // Check <input type="image">
  if (node.tagName === 'INPUT') {
    const input = node as HTMLInputElement;
    if (input.type === 'image' && input.src) {
      const url = input.src;
      if (isDataUri(url)) {
        if (isImageDataUri(url)) {
          const dataKey = generateDataUriKey(url);
          if (!state.seenUrls.has(dataKey)) {
            state.seenUrls.add(dataKey);
            images.push({
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
          }
        }
      } else {
        const resolvedUrl = resolveUrl(url);
        if (!state.seenUrls.has(resolvedUrl)) {
          state.seenUrls.add(resolvedUrl);
          images.push({
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
    }
  }

  // Check <object> and <embed>
  if (node.tagName === 'OBJECT') {
    const obj = node as HTMLObjectElement;
    if (obj.data) {
      const dataUrl = obj.data;
      const objType = obj.type || '';
      const imageTypePattern = /image\//i;
      if (imageTypePattern.test(objType) || getFileFormat(dataUrl) !== 'unknown') {
        const resolvedUrl = isDataUri(dataUrl) ? null : resolveUrl(dataUrl);
        const key = (isDataUri(dataUrl) ? generateDataUriKey(dataUrl) : resolvedUrl) as string;
        if (!state.seenUrls.has(key)) {
          state.seenUrls.add(key);
          const rect = obj.getBoundingClientRect();
          images.push({
            id: generateId(key),
            url: isDataUri(dataUrl) ? dataUrl : (resolvedUrl as string),
            displayWidth: Math.round(rect.width),
            displayHeight: Math.round(rect.height),
            type: 'object',
            format: isDataUri(dataUrl)
              ? getFileFormat(dataUrl)
              : getFileFormat(resolvedUrl as string),
            sourceDomain: isDataUri(dataUrl)
              ? window.location.hostname
              : getDomain(resolvedUrl as string),
            checked: false,
            timestamp: Date.now(),
          } as ImageItem);
        }
      }
    }
  }

  if (node.tagName === 'EMBED') {
    const embed = node as HTMLEmbedElement;
    if (embed.src) {
      const srcUrl = embed.src;
      const embedType = embed.type || '';
      const imageTypePattern = /image\//i;
      if (imageTypePattern.test(embedType) || getFileFormat(srcUrl) !== 'unknown') {
        const resolvedUrl = isDataUri(srcUrl) ? null : resolveUrl(srcUrl);
        const key = (isDataUri(srcUrl) ? generateDataUriKey(srcUrl) : resolvedUrl) as string;
        if (!state.seenUrls.has(key)) {
          state.seenUrls.add(key);
          const rect = embed.getBoundingClientRect();
          images.push({
            id: generateId(key),
            url: isDataUri(srcUrl) ? srcUrl : (resolvedUrl as string),
            displayWidth: Math.round(rect.width),
            displayHeight: Math.round(rect.height),
            type: 'embed',
            format: isDataUri(srcUrl)
              ? getFileFormat(srcUrl)
              : getFileFormat(resolvedUrl as string),
            sourceDomain: isDataUri(srcUrl)
              ? window.location.hostname
              : getDomain(resolvedUrl as string),
            checked: false,
            timestamp: Date.now(),
          } as ImageItem);
        }
      }
    }
  }

  // Check <svg>
  if (node.tagName === 'SVG' || node instanceof SVGElement) {
    const svgItem = extractInlineSvg(node as SVGElement);
    if (svgItem) images.push(svgItem);
  }

  // Check <canvas>
  if (node.tagName === 'CANVAS') {
    const canvasItem = extractCanvasImage(node as HTMLCanvasElement);
    if (canvasItem) images.push(canvasItem);
  }

  // Check children
  const imgs = node.querySelectorAll?.<HTMLImageElement>('img') || [];
  for (const img of imgs) {
    const extracted = extractFromNode(img);
    images.push(...extracted);
  }

  // Also check child video, svg, canvas elements
  const videos = node.querySelectorAll?.<HTMLVideoElement>('video[poster]') || [];
  for (const video of videos) {
    const extracted = extractFromNode(video);
    images.push(...extracted);
  }
  const svgs = node.querySelectorAll?.<SVGElement>('svg') || [];
  for (const svg of svgs) {
    const svgItem = extractInlineSvg(svg);
    if (svgItem) images.push(svgItem);
  }
  const canvases = node.querySelectorAll?.<HTMLCanvasElement>('canvas') || [];
  for (const canvas of canvases) {
    const canvasItem = extractCanvasImage(canvas);
    if (canvasItem) images.push(canvasItem);
  }

  return images;
}

// Extract background images from node
export function extractBackgroundFromNode(node: Element): ImageItem[] {
  const images: ImageItem[] = [];

  try {
    const style = window.getComputedStyle(node);
    const bgImage = style.backgroundImage;

    if (bgImage && bgImage !== 'none') {
      const urls = extractBackgroundUrls(bgImage);
      for (const url of urls) {
        if (!url || isGradient(url)) continue;

        if (isDataUri(url)) {
          if (!isImageDataUri(url)) continue;
          const dataKey = generateDataUriKey(url);
          if (state.seenUrls.has(dataKey)) continue;
          state.seenUrls.add(dataKey);
          const rect = node.getBoundingClientRect();
          images.push({
            id: generateId(dataKey),
            url: url,
            displayWidth: Math.round(rect.width),
            displayHeight: Math.round(rect.height),
            type: 'bg',
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

        const rect = node.getBoundingClientRect();
        images.push({
          id: generateId(resolvedUrl),
          url: resolvedUrl,
          displayWidth: Math.round(rect.width),
          displayHeight: Math.round(rect.height),
          type: 'bg',
          format: getFileFormat(resolvedUrl),
          sourceDomain: getDomain(resolvedUrl),
          checked: false,
          timestamp: Date.now(),
        } as ImageItem);
      }
    }
  } catch {
    // Ignore
  }

  return images;
}
