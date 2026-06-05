// Content Script Main Module — entry point
// Handles message processing and core image extraction functions

import { MESSAGE_TYPES, LIMITS } from '../shared/constants';
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
import {
  ensureImageLoaded,
  parseSrcset,
  skipElement,
  sendDiscoveredImages,
  isElementAccessibleWithoutInteraction,
  pickBestSrcsetUrl,
} from './utils';
import {
  extractInlineSvgs,
  extractCanvasElements,
  extractVideoPosterImages,
  extractInputImages,
  extractObjectEmbedImages,
  extractMetaAndLinkImages,
  extractCssContentImages,
  extractLazyLoadImages,
} from './extract-advanced';
import { extractFromShadowDom, extractFromIframes } from './shadow-iframe';
import {
  addHighlight,
  removeSingleHighlight,
  syncHighlights,
  removeAllHighlights,
  removeFAB,
  checkImagesVisibility,
} from './highlight';
import { startLiveMonitoring, stopLiveMonitoring } from './monitor';

interface ExtractOptions {
  skipIframes?: boolean;
}

interface MessageBase {
  type: string;
  [key: string]: unknown;
}

// Message handler — guard against stale content script after extension reload
try {
  chrome.runtime.onMessage.addListener((message: MessageBase, _sender, sendResponse) => {
    if (!isExtensionContextValid()) return;
    handleMessage(message, sendResponse);
    return true;
  });
} catch {
  // Extension context already invalidated at script load time
}

async function handleMessage(
  message: MessageBase,
  sendResponse: (response?: unknown) => void
): Promise<void> {
  switch (message.type) {
    case MESSAGE_TYPES.PING:
      sendResponse({ type: MESSAGE_TYPES.PONG });
      break;

    case MESSAGE_TYPES.EXTRACT_IMAGES: {
      const images = await extractImages({
        skipIframes: message.skipIframes as boolean | undefined,
      });
      sendResponse({ success: true, images });
      break;
    }

    case MESSAGE_TYPES.START_LIVE_MONITOR:
      startLiveMonitoring(message.config as { debounceMs?: number } | undefined);
      sendResponse({ success: true });
      break;

    case MESSAGE_TYPES.STOP_LIVE_MONITOR:
      stopLiveMonitoring();
      sendResponse({ success: true });
      break;

    case MESSAGE_TYPES.TOGGLE_FAB:
      // FAB removed - no-op for backward compatibility
      sendResponse({ success: true });
      break;

    case MESSAGE_TYPES.HIGHLIGHT_IMAGE: {
      const result = addHighlight(message.imageUrl as string);
      sendResponse({ success: true, found: result?.found ?? false });
      break;
    }

    case MESSAGE_TYPES.UNHIGHLIGHT_IMAGE:
      removeSingleHighlight(message.imageUrl as string);
      sendResponse({ success: true });
      break;

    case MESSAGE_TYPES.HIGHLIGHT_IMAGES:
      syncHighlights((message.imageUrls as string[]) || []);
      sendResponse({ success: true });
      break;

    case MESSAGE_TYPES.REMOVE_HIGHLIGHT:
      removeAllHighlights();
      sendResponse({ success: true });
      break;

    case MESSAGE_TYPES.CHECK_VISIBILITY: {
      const visibilityMap = checkImagesVisibility((message.imageUrls as string[]) || []);
      sendResponse({ success: true, visibilityMap });
      break;
    }

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
}

// Main extraction function
export async function extractImages(options: ExtractOptions = {}): Promise<ImageItem[]> {
  if (state.isExtracting) {
    return [];
  }
  state.isExtracting = true;
  state.seenUrls.clear();

  try {
    const images = new Map<string, ImageItem>();

    // 1. Extract <img> tags
    await extractImgTags(images);

    // 2. Extract background images
    await extractBackgroundImages(images);

    // 3. Extract picture sources
    await extractPictureSources(images);

    // 4. (removed: extractFromStylesheets was a no-op — per-element
    //    getComputedStyle already catches applied background images)

    // 5. Extract inline <svg> elements
    await extractInlineSvgs(images);

    // 6. Extract <canvas> elements
    await extractCanvasElements(images);

    // 7. Extract <video> poster images
    await extractVideoPosterImages(images);

    // 8. Extract <input type="image"> elements
    await extractInputImages(images);

    // 9. Extract <object>/<embed> images
    await extractObjectEmbedImages(images);

    // 10. Extract <link> icons and <meta> og:image
    await extractMetaAndLinkImages(images);

    // 11. Extract images from CSS content property
    await extractCssContentImages(images);

    // 12. Extract lazy-loaded images (data-src, data-srcset, etc.)
    await extractLazyLoadImages(images);

    // 13. Extract images from Shadow DOM trees
    await extractFromShadowDom(images);

    // 14. Extract from iframes (V2.0)
    if (!options.skipIframes) {
      await extractFromIframes(images);
    }

    const imageArray = Array.from(images.values());

    // Limit check
    if (imageArray.length > LIMITS.MAX_IMAGES_PER_SCAN) {
      console.warn(`Found ${imageArray.length} images, limited to ${LIMITS.MAX_IMAGES_PER_SCAN}`);
      imageArray.length = LIMITS.MAX_IMAGES_PER_SCAN;
    }

    return imageArray;
  } finally {
    state.isExtracting = false;
  }
}

// Extract <img> tags
async function extractImgTags(images: Map<string, ImageItem>): Promise<void> {
  const imgElements = Array.from(document.images);

  // Wait for all images to load in parallel instead of serially.
  // This reduces total wait from N×timeout to 1×timeout in the worst case.
  // Use .catch() per-image so one failure doesn't abort the batch.
  await Promise.all(imgElements.map((img) => ensureImageLoaded(img).catch(() => {})));

  for (const img of imgElements) {
    try {
      const visible = isElementAccessibleWithoutInteraction(img);

      // Smart srcset merge: pick only the best (highest resolution) URL
      // instead of expanding every candidate into a separate entry.
      let bestUrl: string | null = null;

      // 1. srcset / data-srcset — pick highest resolution only
      const srcsetAttr =
        img.srcset || img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset') || '';
      if (srcsetAttr) {
        const parsed = parseSrcset(srcsetAttr);
        bestUrl = pickBestSrcsetUrl(parsed);
      }

      // 2. Fallback to currentSrc > src > lazy-load attrs
      if (!bestUrl) bestUrl = img.currentSrc || img.src || null;
      if (!bestUrl) {
        for (const attr of ['data-src', 'data-original', 'data-lazy', 'data-lazy-src']) {
          const val = img.getAttribute(attr);
          if (val) {
            bestUrl = val;
            break;
          }
        }
      }

      if (!bestUrl) continue;

      // Handle data URI images
      if (isDataUri(bestUrl)) {
        if (!isImageDataUri(bestUrl)) continue;
        const dataKey = generateDataUriKey(bestUrl);
        if (state.seenUrls.has(dataKey)) continue;
        state.seenUrls.add(dataKey);

        const item: ImageItem = {
          id: generateId(dataKey),
          url: bestUrl,
          displayWidth: img.naturalWidth || img.width || 0,
          displayHeight: img.naturalHeight || img.height || 0,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          type: 'img',
          format: getFileFormat(bestUrl),
          sourceDomain: window.location.hostname,
          visible,
          checked: false,
          timestamp: Date.now(),
        } as ImageItem;
        images.set(dataKey, item);
        sendDiscoveredImages([item]);
        continue;
      }

      const resolvedUrl = resolveUrl(bestUrl);
      if (state.seenUrls.has(resolvedUrl)) continue;
      state.seenUrls.add(resolvedUrl);

      const item: ImageItem = {
        id: generateId(resolvedUrl),
        url: resolvedUrl,
        displayWidth: img.naturalWidth || img.width || 0,
        displayHeight: img.naturalHeight || img.height || 0,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        type: 'img',
        format: getFileFormat(resolvedUrl),
        sourceDomain: getDomain(resolvedUrl),
        visible,
        checked: false,
        timestamp: Date.now(),
      } as ImageItem;

      images.set(resolvedUrl, item);
      sendDiscoveredImages([item]);
    } catch (error) {
      console.warn('Failed to extract img:', error);
    }
  }
}

// Extract background images
async function extractBackgroundImages(images: Map<string, ImageItem>): Promise<void> {
  // Limit elements to check for performance
  const elements = document.querySelectorAll('body, body *');
  const maxElements = Math.min(elements.length, 2000);

  for (let i = 0; i < maxElements; i++) {
    const el = elements[i];

    // Skip invisible elements
    if (skipElement(el)) continue;

    try {
      const computedStyle = window.getComputedStyle(el);
      const bgImage = computedStyle.backgroundImage;

      if (!bgImage || bgImage === 'none') continue;

      const urls = extractBackgroundUrls(bgImage);

      for (const url of urls) {
        if (!url || isGradient(url)) continue;

        // Handle data URI background images
        if (isDataUri(url)) {
          if (!isImageDataUri(url)) continue;
          const dataKey = generateDataUriKey(url);
          if (state.seenUrls.has(dataKey)) continue;
          state.seenUrls.add(dataKey);
          const rect = el.getBoundingClientRect();
          images.set(dataKey, {
            id: generateId(dataKey),
            url: url,
            displayWidth: Math.round(rect.width),
            displayHeight: Math.round(rect.height),
            type: 'bg',
            format: getFileFormat(url),
            sourceDomain: window.location.hostname,
            checked: false,
            timestamp: Date.now(),
            visible: isElementAccessibleWithoutInteraction(el),
          } as ImageItem);
          continue;
        }

        const resolvedUrl = resolveUrl(url);
        if (state.seenUrls.has(resolvedUrl)) {
          // Update with larger dimensions if found
          const existing = images.get(resolvedUrl);
          if (existing) {
            const rect = el.getBoundingClientRect();
            const existingArea = (existing.displayWidth ?? 0) * (existing.displayHeight ?? 0);
            if (rect.width * rect.height > existingArea) {
              existing.displayWidth = Math.round(rect.width);
              existing.displayHeight = Math.round(rect.height);
            }
          }
          continue;
        }
        state.seenUrls.add(resolvedUrl);

        const rect = el.getBoundingClientRect();

        const item: ImageItem = {
          id: generateId(resolvedUrl),
          url: resolvedUrl,
          displayWidth: Math.round(rect.width),
          displayHeight: Math.round(rect.height),
          type: 'bg',
          format: getFileFormat(resolvedUrl),
          sourceDomain: getDomain(resolvedUrl),
          checked: false,
          timestamp: Date.now(),
          visible: isElementAccessibleWithoutInteraction(el),
        } as ImageItem;

        images.set(resolvedUrl, item);
      }
    } catch {
      // Skip elements we can't access (cross-origin iframes, etc.)
    }

    // Also extract from CSS content (::before / ::after) in the same pass
    for (const pseudo of ['::before', '::after'] as const) {
      try {
        const pseudoStyle = window.getComputedStyle(el, pseudo);
        const contentValue = pseudoStyle.content;
        if (
          !contentValue ||
          contentValue === 'none' ||
          contentValue === 'normal' ||
          contentValue === '""'
        )
          continue;

        const contentUrls = extractBackgroundUrls(contentValue);
        for (const url of contentUrls) {
          if (!url || isGradient(url)) continue;

          if (isDataUri(url)) {
            if (!isImageDataUri(url)) continue;
            const dataKey = generateDataUriKey(url);
            if (state.seenUrls.has(dataKey)) continue;
            state.seenUrls.add(dataKey);
            const rect = el.getBoundingClientRect();
            images.set(dataKey, {
              id: generateId(dataKey),
              url: url,
              displayWidth: Math.round(rect.width),
              displayHeight: Math.round(rect.height),
              type: 'css-content',
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
          images.set(resolvedUrl, {
            id: generateId(resolvedUrl),
            url: resolvedUrl,
            displayWidth: Math.round(rect.width),
            displayHeight: Math.round(rect.height),
            type: 'css-content',
            format: getFileFormat(resolvedUrl),
            sourceDomain: getDomain(resolvedUrl),
            checked: false,
            timestamp: Date.now(),
          } as ImageItem);
        }
      } catch {
        // Skip inaccessible pseudo-elements
      }
    }
  }
}

// Extract from <picture> elements — smart merge: for each <picture>, pick
// only the best format (WebP/AVIF > PNG/JPEG) at the highest resolution,
// instead of expanding every <source> into separate entries.
async function extractPictureSources(images: Map<string, ImageItem>): Promise<void> {
  const pictures = document.querySelectorAll('picture');

  // Format priority: prefer modern formats
  const formatPriority: Record<string, number> = {
    avif: 4,
    webp: 3,
    png: 2,
    jpg: 1,
    jpeg: 1,
    gif: 0,
  };

  for (const picture of pictures) {
    const sources = picture.querySelectorAll('source');
    const fallbackImg = picture.querySelector('img');
    const visible = fallbackImg ? isElementAccessibleWithoutInteraction(fallbackImg) : false;

    // Collect best URL from each source, ranked by format priority
    let bestUrl: string | null = null;
    let bestPriority = -1;

    for (const source of sources) {
      const srcset = source.srcset || source.getAttribute('data-srcset');
      const src = source.src || source.getAttribute('data-src');
      const mimeType = source.type || '';

      // Determine format priority from MIME type or URL
      let priority = 0;
      if (mimeType.includes('avif')) priority = 4;
      else if (mimeType.includes('webp')) priority = 3;
      else if (mimeType.includes('png')) priority = 2;
      else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) priority = 1;

      let candidateUrl: string | null = null;
      if (srcset) {
        const parsed = parseSrcset(srcset);
        candidateUrl = pickBestSrcsetUrl(parsed);
      }
      if (!candidateUrl && src) {
        candidateUrl = src;
      }

      if (candidateUrl) {
        // If format not determined from MIME, infer from URL
        if (priority === 0) {
          const fmt = getFileFormat(candidateUrl).toLowerCase();
          priority = formatPriority[fmt] ?? 0;
        }
        if (priority > bestPriority) {
          bestPriority = priority;
          bestUrl = candidateUrl;
        }
      }
    }

    // Fallback to <img> inside <picture> if no <source> matched
    if (!bestUrl && fallbackImg) {
      bestUrl = fallbackImg.currentSrc || fallbackImg.src || null;
    }

    if (!bestUrl) continue;

    if (isDataUri(bestUrl)) {
      if (!isImageDataUri(bestUrl)) continue;
      const dataKey = generateDataUriKey(bestUrl);
      if (state.seenUrls.has(dataKey)) continue;
      state.seenUrls.add(dataKey);
      images.set(dataKey, {
        id: generateId(dataKey),
        url: bestUrl,
        displayWidth: fallbackImg?.naturalWidth || 0,
        displayHeight: fallbackImg?.naturalHeight || 0,
        naturalWidth: fallbackImg?.naturalWidth,
        naturalHeight: fallbackImg?.naturalHeight,
        type: 'img',
        format: getFileFormat(bestUrl),
        sourceDomain: window.location.hostname,
        visible,
        checked: false,
        timestamp: Date.now(),
      } as ImageItem);
      continue;
    }

    const resolvedUrl = resolveUrl(bestUrl);
    if (state.seenUrls.has(resolvedUrl)) continue;
    state.seenUrls.add(resolvedUrl);

    const item: ImageItem = {
      id: generateId(resolvedUrl),
      url: resolvedUrl,
      displayWidth: fallbackImg?.naturalWidth || 0,
      displayHeight: fallbackImg?.naturalHeight || 0,
      naturalWidth: fallbackImg?.naturalWidth,
      naturalHeight: fallbackImg?.naturalHeight,
      type: 'img',
      format: getFileFormat(resolvedUrl),
      sourceDomain: getDomain(resolvedUrl),
      visible,
      checked: false,
      timestamp: Date.now(),
    } as ImageItem;

    images.set(resolvedUrl, item);
  }
}

// Initialize the content script.
function initContentScript(): void {
  // Skip extension's own pages to avoid injection errors
  if (window.location.protocol === 'chrome-extension:' || window.location.protocol === 'chrome:') {
    return;
  }
  // Clean up any stale FAB elements from previous versions
  removeFAB();

  // Listen for extension UI disconnect to auto-clean highlights.
  // Fallback in case the beforeunload message from the side panel / popup
  // fails to arrive.
  try {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name === 'image-harvest-ui') {
        port.onDisconnect.addListener(() => {
          removeAllHighlights();
        });
      }
    });
  } catch {
    // Extension context invalidated — stale content script after reload/update
  }
}

initContentScript();
