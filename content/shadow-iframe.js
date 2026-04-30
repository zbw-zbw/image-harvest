// Content Script Shadow DOM & Iframe Module
// Handles extraction from Shadow DOM trees and iframes

// ============================================
// Shadow DOM support
// ============================================

/**
 * Recursively collect all shadow roots in the document.
 * Returns an array of ShadowRoot objects.
 */
function collectShadowRoots(root = document) {
  const shadowRoots = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode;
  while (node) {
    if (node.shadowRoot) {
      shadowRoots.push(node.shadowRoot);
      // Recurse into the shadow root to find nested shadow DOMs
      shadowRoots.push(...collectShadowRoots(node.shadowRoot));
    }
    node = walker.nextNode();
  }
  return shadowRoots;
}

/**
 * querySelectorAll that also searches inside Shadow DOM trees.
 */
function querySelectorAllDeep(selector, root = document) {
  const results = Array.from(root.querySelectorAll(selector));
  const shadowRoots = collectShadowRoots(root);
  for (const shadowRoot of shadowRoots) {
    results.push(...shadowRoot.querySelectorAll(selector));
  }
  return results;
}

/**
 * Extract images from all Shadow DOM trees on the page.
 * Re-uses the same extraction helpers but scoped to each shadow root.
 */
async function extractFromShadowDom(images) {
  const shadowRoots = collectShadowRoots(document);
  if (shadowRoots.length === 0) return;

  for (const shadowRoot of shadowRoots) {
    // Extract <img> from shadow DOM
    const imgs = shadowRoot.querySelectorAll('img');
    for (const img of imgs) {
      try {
        await ensureImageLoaded(img);
        const candidateUrls = new Set();
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
            if (seenUrls.has(dataKey)) continue;
            seenUrls.add(dataKey);
            images.set(dataKey, {
              id: generateId(dataKey), url,
              displayWidth: img.naturalWidth || img.width || 0,
              displayHeight: img.naturalHeight || img.height || 0,
              naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
              type: 'img', format: getFileFormat(url),
              sourceDomain: window.location.hostname,
              checked: false, timestamp: Date.now()
            });
            continue;
          }
          const resolvedUrl = resolveUrl(url);
          if (seenUrls.has(resolvedUrl)) continue;
          seenUrls.add(resolvedUrl);
          images.set(resolvedUrl, {
            id: generateId(resolvedUrl), url: resolvedUrl,
            displayWidth: img.naturalWidth || img.width || 0,
            displayHeight: img.naturalHeight || img.height || 0,
            naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
            type: 'img', format: getFileFormat(resolvedUrl),
            sourceDomain: getDomain(resolvedUrl),
            checked: false, timestamp: Date.now()
          });
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
            if (seenUrls.has(dataKey)) continue;
            seenUrls.add(dataKey);
            const rect = els[i].getBoundingClientRect();
            images.set(dataKey, {
              id: generateId(dataKey), url,
              displayWidth: Math.round(rect.width), displayHeight: Math.round(rect.height),
              type: 'bg', format: getFileFormat(url),
              sourceDomain: window.location.hostname,
              checked: false, timestamp: Date.now()
            });
            continue;
          }
          const resolvedUrl = resolveUrl(url);
          if (seenUrls.has(resolvedUrl)) continue;
          seenUrls.add(resolvedUrl);
          const rect = els[i].getBoundingClientRect();
          images.set(resolvedUrl, {
            id: generateId(resolvedUrl), url: resolvedUrl,
            displayWidth: Math.round(rect.width), displayHeight: Math.round(rect.height),
            type: 'bg', format: getFileFormat(resolvedUrl),
            sourceDomain: getDomain(resolvedUrl),
            checked: false, timestamp: Date.now()
          });
        }
      } catch { /* skip */ }
    }

    // Extract <picture> sources from shadow DOM
    const pictures = shadowRoot.querySelectorAll('picture');
    for (const picture of pictures) {
      const sources = picture.querySelectorAll('source');
      const fallbackImg = picture.querySelector('img');
      for (const source of sources) {
        const candidateUrls = [];
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
            if (seenUrls.has(dataKey)) continue;
            seenUrls.add(dataKey);
            images.set(dataKey, {
              id: generateId(dataKey), url,
              displayWidth: fallbackImg?.naturalWidth || 0,
              displayHeight: fallbackImg?.naturalHeight || 0,
              type: 'img', format: getFileFormat(url),
              sourceDomain: window.location.hostname,
              checked: false, timestamp: Date.now()
            });
            continue;
          }
          const resolvedUrl = resolveUrl(url);
          if (seenUrls.has(resolvedUrl)) continue;
          seenUrls.add(resolvedUrl);
          images.set(resolvedUrl, {
            id: generateId(resolvedUrl), url: resolvedUrl,
            displayWidth: fallbackImg?.naturalWidth || 0,
            displayHeight: fallbackImg?.naturalHeight || 0,
            type: 'img', format: getFileFormat(resolvedUrl),
            sourceDomain: getDomain(resolvedUrl),
            checked: false, timestamp: Date.now()
          });
        }
      }
    }

    // Extract <video poster>, <canvas>, <svg> from shadow DOM
    const videos = shadowRoot.querySelectorAll('video[poster]');
    for (const video of videos) {
      const posterUrl = video.poster;
      if (!posterUrl) continue;
      const resolvedUrl = resolveUrl(posterUrl);
      if (seenUrls.has(resolvedUrl)) continue;
      seenUrls.add(resolvedUrl);
      images.set(resolvedUrl, {
        id: generateId(resolvedUrl), url: resolvedUrl,
        displayWidth: video.videoWidth || video.width || 0,
        displayHeight: video.videoHeight || video.height || 0,
        type: 'video-poster', format: getFileFormat(resolvedUrl),
        sourceDomain: getDomain(resolvedUrl),
        checked: false, timestamp: Date.now()
      });
    }

    const svgs = shadowRoot.querySelectorAll('svg');
    for (const svg of svgs) {
      const item = extractInlineSvg(svg);
      if (item) images.set(item.id, item);
    }

    const canvases = shadowRoot.querySelectorAll('canvas');
    for (const canvas of canvases) {
      const item = extractCanvasImage(canvas);
      if (item) images.set(item.id, item);
    }
  }
}

// V2.0: Extract images from accessible iframes
async function extractFromIframes(images) {
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
          if (seenUrls.has(dataKey)) continue;
          seenUrls.add(dataKey);
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
          });
          continue;
        }

        const resolvedUrl = resolveUrl(url, iframeBase);
        if (seenUrls.has(resolvedUrl)) continue;
        seenUrls.add(resolvedUrl);

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
        });
      }

      // Extract background images from iframe
      const els = doc.querySelectorAll('body, body *');
      const maxEls = Math.min(els.length, 500);
      for (let i = 0; i < maxEls; i++) {
        try {
          const style = iframe.contentWindow.getComputedStyle(els[i]);
          const bg = style.backgroundImage;
          if (!bg || bg === 'none') continue;
          const urls = extractBackgroundUrls(bg);
          for (const u of urls) {
            if (!u || isGradient(u)) continue;

            if (isDataUri(u)) {
              if (!isImageDataUri(u)) continue;
              const dataKey = generateDataUriKey(u);
              if (seenUrls.has(dataKey)) continue;
              seenUrls.add(dataKey);
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
              });
              continue;
            }

            const resolvedUrl = resolveUrl(u, iframeBase);
            if (seenUrls.has(resolvedUrl)) continue;
            seenUrls.add(resolvedUrl);
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
            });
          }
        } catch (e) { /* skip */ }
      }
    } catch (e) {
      // Cross-origin iframe, skip
    }
  }
}

// Auto-start when script loads
function initContentScript() {
  // Skip extension's own pages to avoid injection errors
  if (window.location.protocol === 'chrome-extension:' || window.location.protocol === 'chrome:') {
    return;
  }
  // Clean up any stale FAB elements from previous versions
  removeFAB();

  // Listen for extension UI disconnect to auto-clean highlights.
  // This serves as a fallback in case the beforeunload message
  // from the side panel / popup fails to arrive.
  try {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name === 'image-snatcher-ui') {
        port.onDisconnect.addListener(() => {
          removeAllHighlights();
        });
      }
    });
  } catch {
    // Extension context invalidated — stale content script after reload/update
  }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initContentScript();
} else {
  document.addEventListener('DOMContentLoaded', initContentScript);
}
