// Content Script Advanced Extraction Module
// Handles extraction of SVG, canvas, video, and other advanced image sources

/**
 * Convert an inline <svg> element to a data URI and create an image item.
 * Returns null if the SVG is too small or already seen.
 */
function extractInlineSvg(svgElement) {
  try {
    const rect = svgElement.getBoundingClientRect();
    // Skip tiny SVGs (likely icons/decorations handled elsewhere)
    if (rect.width < 2 || rect.height < 2) return null;

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);
    const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
    const dataKey = generateDataUriKey(dataUri);
    if (seenUrls.has(dataKey)) return null;
    seenUrls.add(dataKey);

    return {
      id: generateId(dataKey),
      url: dataUri,
      displayWidth: Math.round(rect.width),
      displayHeight: Math.round(rect.height),
      type: 'svg',
      format: 'svg',
      sourceDomain: window.location.hostname,
      checked: false,
      timestamp: Date.now()
    };
  } catch {
    return null;
  }
}

/**
 * Extract image data from a <canvas> element by converting to data URI.
 * Returns null if the canvas is tainted (cross-origin), empty, or already seen.
 */
function extractCanvasImage(canvasElement) {
  try {
    if (canvasElement.width < 2 || canvasElement.height < 2) return null;

    const dataUri = canvasElement.toDataURL('image/png');
    // toDataURL returns a very short string for blank canvases
    if (!dataUri || dataUri.length < 100) return null;

    const dataKey = generateDataUriKey(dataUri);
    if (seenUrls.has(dataKey)) return null;
    seenUrls.add(dataKey);

    return {
      id: generateId(dataKey),
      url: dataUri,
      displayWidth: canvasElement.width,
      displayHeight: canvasElement.height,
      type: 'canvas',
      format: 'png',
      sourceDomain: window.location.hostname,
      checked: false,
      timestamp: Date.now()
    };
  } catch {
    // Canvas is tainted (cross-origin content drawn on it)
    return null;
  }
}

// Extract all inline <svg> elements on the page
async function extractInlineSvgs(images) {
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
      const key = item.id;
      images.set(key, item);
    }
  }
}

// Extract all <canvas> elements on the page
async function extractCanvasElements(images) {
  const canvases = document.querySelectorAll('canvas');
  for (const canvas of canvases) {
    const item = extractCanvasImage(canvas);
    if (item) {
      const key = item.id;
      images.set(key, item);
    }
  }
}

// Extract <video> poster images
async function extractVideoPosterImages(images) {
  const videos = document.querySelectorAll('video[poster]');
  for (const video of videos) {
    const posterUrl = video.poster;
    if (!posterUrl) continue;

    if (isDataUri(posterUrl)) {
      if (!isImageDataUri(posterUrl)) continue;
      const dataKey = generateDataUriKey(posterUrl);
      if (seenUrls.has(dataKey)) continue;
      seenUrls.add(dataKey);
      images.set(dataKey, {
        id: generateId(dataKey),
        url: posterUrl,
        displayWidth: video.videoWidth || video.width || 0,
        displayHeight: video.videoHeight || video.height || 0,
        type: 'video-poster',
        format: getFileFormat(posterUrl),
        sourceDomain: window.location.hostname,
        checked: false,
        timestamp: Date.now()
      });
      continue;
    }

    const resolvedUrl = resolveUrl(posterUrl);
    if (seenUrls.has(resolvedUrl)) continue;
    seenUrls.add(resolvedUrl);

    images.set(resolvedUrl, {
      id: generateId(resolvedUrl),
      url: resolvedUrl,
      displayWidth: video.videoWidth || video.width || 0,
      displayHeight: video.videoHeight || video.height || 0,
      type: 'video-poster',
      format: getFileFormat(resolvedUrl),
      sourceDomain: getDomain(resolvedUrl),
      checked: false,
      timestamp: Date.now()
    });
  }
}

// Extract <input type="image"> elements
async function extractInputImages(images) {
  const inputs = document.querySelectorAll('input[type="image"]');
  for (const input of inputs) {
    const url = input.src;
    if (!url) continue;

    if (isDataUri(url)) {
      if (!isImageDataUri(url)) continue;
      const dataKey = generateDataUriKey(url);
      if (seenUrls.has(dataKey)) continue;
      seenUrls.add(dataKey);
      images.set(dataKey, {
        id: generateId(dataKey),
        url: url,
        displayWidth: input.width || 0,
        displayHeight: input.height || 0,
        type: 'input-image',
        format: getFileFormat(url),
        sourceDomain: window.location.hostname,
        checked: false,
        timestamp: Date.now()
      });
      continue;
    }

    const resolvedUrl = resolveUrl(url);
    if (seenUrls.has(resolvedUrl)) continue;
    seenUrls.add(resolvedUrl);

    images.set(resolvedUrl, {
      id: generateId(resolvedUrl),
      url: resolvedUrl,
      displayWidth: input.width || 0,
      displayHeight: input.height || 0,
      type: 'input-image',
      format: getFileFormat(resolvedUrl),
      sourceDomain: getDomain(resolvedUrl),
      checked: false,
      timestamp: Date.now()
    });
  }
}

// Extract images from <object> and <embed> elements
async function extractObjectEmbedImages(images) {
  const imageTypePattern = /image\//i;

  // <object> elements with image type or image data URL
  const objects = document.querySelectorAll('object');
  for (const obj of objects) {
    const dataUrl = obj.data;
    const objType = obj.type || '';
    if (!dataUrl) continue;
    // Only process if type indicates image, or URL looks like an image
    if (!imageTypePattern.test(objType) && getFileFormat(dataUrl) === 'unknown') continue;

    const resolvedUrl = isDataUri(dataUrl) ? null : resolveUrl(dataUrl);
    const key = isDataUri(dataUrl) ? generateDataUriKey(dataUrl) : resolvedUrl;
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);

    const rect = obj.getBoundingClientRect();
    images.set(key, {
      id: generateId(key),
      url: isDataUri(dataUrl) ? dataUrl : resolvedUrl,
      displayWidth: Math.round(rect.width),
      displayHeight: Math.round(rect.height),
      type: 'object',
      format: isDataUri(dataUrl) ? getFileFormat(dataUrl) : getFileFormat(resolvedUrl),
      sourceDomain: isDataUri(dataUrl) ? window.location.hostname : getDomain(resolvedUrl),
      checked: false,
      timestamp: Date.now()
    });
  }

  // <embed> elements with image type
  const embeds = document.querySelectorAll('embed');
  for (const embed of embeds) {
    const srcUrl = embed.src;
    const embedType = embed.type || '';
    if (!srcUrl) continue;
    if (!imageTypePattern.test(embedType) && getFileFormat(srcUrl) === 'unknown') continue;

    const resolvedUrl = isDataUri(srcUrl) ? null : resolveUrl(srcUrl);
    const key = isDataUri(srcUrl) ? generateDataUriKey(srcUrl) : resolvedUrl;
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);

    const rect = embed.getBoundingClientRect();
    images.set(key, {
      id: generateId(key),
      url: isDataUri(srcUrl) ? srcUrl : resolvedUrl,
      displayWidth: Math.round(rect.width),
      displayHeight: Math.round(rect.height),
      type: 'embed',
      format: isDataUri(srcUrl) ? getFileFormat(srcUrl) : getFileFormat(resolvedUrl),
      sourceDomain: isDataUri(srcUrl) ? window.location.hostname : getDomain(resolvedUrl),
      checked: false,
      timestamp: Date.now()
    });
  }
}

// Extract images from <link rel="icon"> and <meta property="og:image"> etc.
async function extractMetaAndLinkImages(images) {
  // Favicon and apple-touch-icon
  const linkSelectors = [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
    'link[rel="apple-touch-icon-precomposed"]',
    'link[rel="mask-icon"]',
  ];
  const links = document.querySelectorAll(linkSelectors.join(','));
  for (const link of links) {
    const href = link.href;
    if (!href || isDataUri(href)) continue;

    const resolvedUrl = resolveUrl(href);
    if (seenUrls.has(resolvedUrl)) continue;
    seenUrls.add(resolvedUrl);

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
      timestamp: Date.now()
    });
  }

  // Open Graph and Twitter Card images
  const metaSelectors = [
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'meta[itemprop="image"]',
  ];
  const metas = document.querySelectorAll(metaSelectors.join(','));
  for (const meta of metas) {
    const content = meta.content;
    if (!content || isDataUri(content)) continue;

    const resolvedUrl = resolveUrl(content);
    if (seenUrls.has(resolvedUrl)) continue;
    seenUrls.add(resolvedUrl);

    images.set(resolvedUrl, {
      id: generateId(resolvedUrl),
      url: resolvedUrl,
      displayWidth: 0,
      displayHeight: 0,
      type: 'meta',
      format: getFileFormat(resolvedUrl),
      sourceDomain: getDomain(resolvedUrl),
      checked: false,
      timestamp: Date.now()
    });
  }
}

// Extract lazy-loaded images via common data-* attributes
async function extractLazyLoadImages(images) {
  // Common lazy-load attribute names used by popular libraries
  const lazyAttributes = [
    'data-src', 'data-original', 'data-lazy', 'data-lazy-src',
    'data-hi-res-src', 'data-image', 'data-full-src',
    'data-bg', 'data-bg-src', 'data-background',
    'data-poster',
  ];
  const lazySrcsetAttributes = [
    'data-srcset', 'data-lazy-srcset',
  ];

  // Build a selector that matches any element with at least one of these attributes
  const selectorParts = [
    ...lazyAttributes.map(attr => `[${attr}]`),
    ...lazySrcsetAttributes.map(attr => `[${attr}]`),
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
        if (seenUrls.has(dataKey)) continue;
        seenUrls.add(dataKey);
        const rect = el.getBoundingClientRect();
        images.set(dataKey, {
          id: generateId(dataKey),
          url: rawUrl,
          displayWidth: el.naturalWidth || Math.round(rect.width) || 0,
          displayHeight: el.naturalHeight || Math.round(rect.height) || 0,
          type: 'lazy',
          format: getFileFormat(rawUrl),
          sourceDomain: window.location.hostname,
          checked: false,
          timestamp: Date.now()
        });
        continue;
      }

      const resolvedUrl = resolveUrl(rawUrl);
      if (seenUrls.has(resolvedUrl)) continue;
      seenUrls.add(resolvedUrl);

      // Verify it looks like an image URL
      const format = getFileFormat(resolvedUrl);
      if (format === 'unknown' && !attr.includes('bg') && !attr.includes('background')) {
        // For non-bg attributes, skip if it doesn't look like an image
        // unless the element is an <img> or has image-related context
        if (el.tagName !== 'IMG' && el.tagName !== 'VIDEO' && el.tagName !== 'SOURCE') continue;
      }

      const rect = el.getBoundingClientRect();
      images.set(resolvedUrl, {
        id: generateId(resolvedUrl),
        url: resolvedUrl,
        displayWidth: el.naturalWidth || Math.round(rect.width) || 0,
        displayHeight: el.naturalHeight || Math.round(rect.height) || 0,
        type: 'lazy',
        format: format,
        sourceDomain: getDomain(resolvedUrl),
        checked: false,
        timestamp: Date.now()
      });
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
          if (seenUrls.has(dataKey)) continue;
          seenUrls.add(dataKey);
          const rect = el.getBoundingClientRect();
          images.set(dataKey, {
            id: generateId(dataKey),
            url: url,
            displayWidth: el.naturalWidth || Math.round(rect.width) || 0,
            displayHeight: el.naturalHeight || Math.round(rect.height) || 0,
            type: 'lazy',
            format: getFileFormat(url),
            sourceDomain: window.location.hostname,
            checked: false,
            timestamp: Date.now()
          });
          continue;
        }

        const resolvedUrl = resolveUrl(url);
        if (seenUrls.has(resolvedUrl)) continue;
        seenUrls.add(resolvedUrl);

        const rect = el.getBoundingClientRect();
        images.set(resolvedUrl, {
          id: generateId(resolvedUrl),
          url: resolvedUrl,
          displayWidth: el.naturalWidth || Math.round(rect.width) || 0,
          displayHeight: el.naturalHeight || Math.round(rect.height) || 0,
          type: 'lazy',
          format: getFileFormat(resolvedUrl),
          sourceDomain: getDomain(resolvedUrl),
          checked: false,
          timestamp: Date.now()
        });
      }
    }
  }
}

// Extract images from CSS content property (e.g. ::before / ::after pseudo-elements)
async function extractCssContentImages(images) {
  const elements = document.querySelectorAll('body, body *');
  const maxElements = Math.min(elements.length, 2000);

  for (let i = 0; i < maxElements; i++) {
    const el = elements[i];
    if (skipElement(el)) continue;

    for (const pseudo of ['::before', '::after']) {
      try {
        const style = window.getComputedStyle(el, pseudo);
        const contentValue = style.content;
        if (!contentValue || contentValue === 'none' || contentValue === 'normal' || contentValue === '""') continue;

        const urls = extractBackgroundUrls(contentValue);
        for (const url of urls) {
          if (!url || isGradient(url)) continue;

          if (isDataUri(url)) {
            if (!isImageDataUri(url)) continue;
            const dataKey = generateDataUriKey(url);
            if (seenUrls.has(dataKey)) continue;
            seenUrls.add(dataKey);
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
              timestamp: Date.now()
            });
            continue;
          }

          const resolvedUrl = resolveUrl(url);
          if (seenUrls.has(resolvedUrl)) continue;
          seenUrls.add(resolvedUrl);

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
            timestamp: Date.now()
          });
        }
      } catch {
        // Skip inaccessible pseudo-elements
      }
    }
  }
}
