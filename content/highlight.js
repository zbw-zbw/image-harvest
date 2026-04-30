// Content Script Highlight Module
// Handles image highlighting and locating functionality

// V2.0: FAB removed due to Chrome API limitation
// (sidePanel.open() requires direct user gesture)
// Users should use toolbar icon or Cmd+Shift+S shortcut

// Stub functions to maintain message handler compatibility
function toggleFAB() {}
function removeFAB() {
  // Clean up any stale FAB elements from previous versions
  const staleFabs = document.querySelectorAll('#image-snatcher-fab-host');
  staleFabs.forEach(el => el.remove());
}

// V2.0: Image Highlight & Locate
// Multi-highlight state: Map<imageUrl, { element, border, cleanup }>
var highlightEntries = new Map();
var overlayElement = null;
var highlightStyleElement = null;

function ensureHighlightStyles() {
  if (highlightStyleElement) return;
  highlightStyleElement = document.createElement('style');
  highlightStyleElement.textContent = `
    @keyframes image-snatcher-pulse {
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
    .image-snatcher-highlight-border {
      animation: image-snatcher-pulse 1.2s ease-in-out 3;
    }
  `;
  document.head.appendChild(highlightStyleElement);
}

function removeHighlightStyles() {
  if (highlightStyleElement) {
    highlightStyleElement.remove();
    highlightStyleElement = null;
  }
}

var escKeyHandler = null;

function ensureOverlay() {
  if (overlayElement) return;
  ensureHighlightStyles();
  overlayElement = document.createElement('div');
  overlayElement.className = 'image-snatcher-overlay';
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
    escKeyHandler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        dismissAllHighlights();
      }
    };
    document.addEventListener('keydown', escKeyHandler, true);
  }
}

function dismissAllHighlights() {
  removeAllHighlights();
  // Notify sidepanel/popup to clear selection
  try {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CLEAR_SELECTION });
  } catch (e) { /* extension context may be invalid */ }
}

function removeOverlay() {
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

function findImageElement(url) {
  const isTargetDataUri = isDataUri(url);
  // For data URIs, generate a key for comparison since the full string is huge
  const targetDataKey = isTargetDataUri ? generateDataUriKey(url) : null;

  // Helper: check if a candidate URL matches the target
  function urlMatches(candidateUrl) {
    if (!candidateUrl) return false;
    if (isTargetDataUri) {
      if (!isDataUri(candidateUrl)) return false;
      return generateDataUriKey(candidateUrl) === targetDataKey;
    }
    return candidateUrl === url || resolveUrl(candidateUrl) === url;
  }

  // 1. Check <img> elements (including srcset and lazy-load attributes)
  const imgs = document.querySelectorAll('img');
  for (const img of imgs) {
    const src = img.currentSrc || img.src;
    if (urlMatches(src)) return img;

    // Check srcset
    if (img.srcset) {
      const srcsetUrls = parseSrcset(img.srcset);
      for (const { url: candidateUrl } of srcsetUrls) {
        if (urlMatches(candidateUrl)) return img;
      }
    }

    // Check lazy-load attributes
    for (const attr of ['data-src', 'data-original', 'data-lazy', 'data-lazy-src', 'data-srcset', 'data-lazy-srcset']) {
      const val = img.getAttribute(attr);
      if (!val) continue;
      if (attr.includes('srcset')) {
        const parsed = parseSrcset(val);
        for (const { url: candidateUrl } of parsed) {
          if (urlMatches(candidateUrl)) return img;
        }
      } else if (urlMatches(val)) {
        return img;
      }
    }
  }

  // 2. Check <picture> > <source> (src, srcset, and lazy variants)
  const pictures = document.querySelectorAll('picture');
  for (const picture of pictures) {
    const sources = picture.querySelectorAll('source');
    for (const source of sources) {
      for (const attr of ['srcset', 'data-srcset', 'data-lazy-srcset']) {
        const val = source.getAttribute(attr);
        if (!val) continue;
        const srcsetUrls = parseSrcset(val);
        for (const { url: candidateUrl } of srcsetUrls) {
          if (urlMatches(candidateUrl)) return picture.querySelector('img') || picture;
        }
      }
      for (const attr of ['src', 'data-src']) {
        const val = source.getAttribute(attr);
        if (urlMatches(val)) return picture.querySelector('img') || picture;
      }
    }
  }

  // 3. Check <video> poster attribute
  const videos = document.querySelectorAll('video[poster]');
  for (const video of videos) {
    if (urlMatches(video.poster)) return video;
  }

  // 4. Check <input type="image">
  const inputImages = document.querySelectorAll('input[type="image"]');
  for (const input of inputImages) {
    if (urlMatches(input.src)) return input;
  }

  // 5. Check <object> and <embed>
  const objects = document.querySelectorAll('object[data]');
  for (const obj of objects) {
    if (urlMatches(obj.data)) return obj;
  }
  const embeds = document.querySelectorAll('embed[src]');
  for (const embed of embeds) {
    if (urlMatches(embed.src)) return embed;
  }

  // 6. Check inline <svg> elements (compare by data URI key)
  if (isTargetDataUri && url.startsWith('data:image/svg')) {
    const svgs = document.querySelectorAll('svg');
    for (const svg of svgs) {
      try {
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svg);
        const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
        if (generateDataUriKey(dataUri) === targetDataKey) return svg;
      } catch { /* skip */ }
    }
  }

  // 7. Check <canvas> elements (compare by data URI key)
  if (isTargetDataUri && url.startsWith('data:image/png')) {
    const canvases = document.querySelectorAll('canvas');
    for (const canvas of canvases) {
      try {
        const canvasDataUri = canvas.toDataURL('image/png');
        if (generateDataUriKey(canvasDataUri) === targetDataKey) return canvas;
      } catch { /* tainted canvas */ }
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
          if (urlMatches(u)) return el;
        }
      }

      // Also check CSS content property on pseudo-elements
      for (const pseudo of ['::before', '::after']) {
        const pseudoStyle = window.getComputedStyle(el, pseudo);
        const content = pseudoStyle.content;
        if (content && content !== 'none' && content !== 'normal' && content !== '""') {
          const contentUrls = extractBackgroundUrls(content);
          for (const u of contentUrls) {
            if (urlMatches(u)) return el;
          }
        }
      }
    } catch { /* skip */ }
  }

  // 9. Check lazy-load data-* attributes on non-img elements (divs, spans, etc.)
  const lazyAttrs = ['data-src', 'data-original', 'data-bg', 'data-bg-src', 'data-background', 'data-image'];
  for (const el of allElements) {
    for (const attr of lazyAttrs) {
      const val = el.getAttribute(attr);
      if (!val) continue;
      const urlMatch = val.match(/url\(['"]?([^'")]+)['"]?\)/);
      const rawUrl = urlMatch ? urlMatch[1] : val;
      if (urlMatches(rawUrl)) return el;
    }
  }

  // 10. Search inside Shadow DOM trees
  const shadowRoots = collectShadowRoots(document);
  for (const shadowRoot of shadowRoots) {
    // Check <img> in shadow DOM
    const shadowImgs = shadowRoot.querySelectorAll('img');
    for (const img of shadowImgs) {
      if (urlMatches(img.currentSrc) || urlMatches(img.src)) return img;
      if (img.srcset) {
        for (const { url: candidateUrl } of parseSrcset(img.srcset)) {
          if (urlMatches(candidateUrl)) return img;
        }
      }
      for (const attr of ['data-src', 'data-original', 'data-lazy', 'data-lazy-src']) {
        if (urlMatches(img.getAttribute(attr))) return img;
      }
    }

    // Check <picture> > <source> in shadow DOM
    const shadowPictures = shadowRoot.querySelectorAll('picture');
    for (const picture of shadowPictures) {
      for (const source of picture.querySelectorAll('source')) {
        for (const attr of ['srcset', 'data-srcset', 'src', 'data-src']) {
          const val = source.getAttribute(attr);
          if (!val) continue;
          if (attr.includes('srcset')) {
            for (const { url: candidateUrl } of parseSrcset(val)) {
              if (urlMatches(candidateUrl)) return picture.querySelector('img') || picture;
            }
          } else if (urlMatches(val)) {
            return picture.querySelector('img') || picture;
          }
        }
      }
    }

    // Check <video poster>, <input type=image>, <object>, <embed> in shadow DOM
    for (const video of shadowRoot.querySelectorAll('video[poster]')) {
      if (urlMatches(video.poster)) return video;
    }
    for (const input of shadowRoot.querySelectorAll('input[type="image"]')) {
      if (urlMatches(input.src)) return input;
    }
    for (const obj of shadowRoot.querySelectorAll('object[data]')) {
      if (urlMatches(obj.data)) return obj;
    }
    for (const embed of shadowRoot.querySelectorAll('embed[src]')) {
      if (urlMatches(embed.src)) return embed;
    }

    // Check background images in shadow DOM
    const shadowEls = shadowRoot.querySelectorAll('*');
    for (const el of shadowEls) {
      try {
        const bg = window.getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none') {
          for (const u of extractBackgroundUrls(bg)) {
            if (urlMatches(u)) return el;
          }
        }
      } catch { /* skip */ }
    }

    // Check inline SVGs in shadow DOM
    if (isTargetDataUri && url.startsWith('data:image/svg')) {
      for (const svg of shadowRoot.querySelectorAll('svg')) {
        try {
          const serializer = new XMLSerializer();
          const svgString = serializer.serializeToString(svg);
          const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
          if (generateDataUriKey(dataUri) === targetDataKey) return svg;
        } catch { /* skip */ }
      }
    }
  }

  // 10. Check <link> elements (favicon, apple-touch-icon, etc.)
  if (!isTargetDataUri) {
    const linkSelectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
      'link[rel="apple-touch-icon-precomposed"]',
      'link[rel="mask-icon"]',
    ];
    const linkElements = document.querySelectorAll(linkSelectors.join(','));
    for (const link of linkElements) {
      if (urlMatches(link.href)) return link;
    }

    // 11. Check <meta> elements (og:image, twitter:image, etc.)
    const metaSelectors = [
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
      'meta[itemprop="image"]',
    ];
    const metaElements = document.querySelectorAll(metaSelectors.join(','));
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
function isMetadataElement(element) {
  const tag = element.tagName?.toLowerCase();
  return tag === 'link' || tag === 'meta';
}

function addHighlight(imageUrl, shouldScroll = true) {
  if (highlightEntries.has(imageUrl)) return { found: true };

  const target = findImageElement(imageUrl);
  if (!target) return { found: false };

  // Metadata elements (<link>, <meta>) exist in <head> and cannot be
  // visually highlighted or scrolled to — just acknowledge they exist.
  if (isMetadataElement(target)) return { found: true };

  // Create highlight immediately — rAF loop will track position during scroll
  createSingleHighlight(imageUrl, target);

  if (shouldScroll) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return { found: true };
}

function createSingleHighlight(imageUrl, target) {
  if (highlightEntries.has(imageUrl)) return;

  ensureOverlay();

  const borderWidth = 3;
  const gap = 3;

  // Create a fixed-position overlay div that tracks the target element
  const border = document.createElement('div');
  border.className = 'image-snatcher-highlight-border';
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
  var rafId = null;
  var isTracking = true;

  const trackPosition = () => {
    if (!isTracking) return;
    const r = target.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Hide highlight when element is completely outside the viewport
    const isOutOfView = r.bottom < 0 || r.top > viewportHeight ||
                        r.right < 0 || r.left > viewportWidth;
    border.style.display = isOutOfView ? 'none' : '';

    if (!isOutOfView) {
      border.style.top = (r.top - gap) + 'px';
      border.style.left = (r.left - gap) + 'px';
      border.style.width = (r.width + gap * 2) + 'px';
      border.style.height = (r.height + gap * 2) + 'px';
    }

    rafId = requestAnimationFrame(trackPosition);
  };
  rafId = requestAnimationFrame(trackPosition);

  const cleanup = () => {
    isTracking = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    border.remove();
  };

  highlightEntries.set(imageUrl, { element: target, border, cleanup });
}

function removeSingleHighlight(imageUrl) {
  const entry = highlightEntries.get(imageUrl);
  if (!entry) return;

  entry.cleanup();
  highlightEntries.delete(imageUrl);

  // Remove overlay when no highlights remain
  if (highlightEntries.size === 0) {
    removeOverlay();
  }
}

function syncHighlights(imageUrls) {
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

function removeAllHighlights() {
  for (const [, entry] of highlightEntries) {
    if (entry) {
      entry.cleanup();
    }
  }
  highlightEntries.clear();
  removeOverlay();
}
