// Content Script Live Monitoring Module
// Handles real-time image discovery via MutationObserver

// Live monitoring with MutationObserver
function startLiveMonitoring(config = {}) {
  stopLiveMonitoring();
  
  const debounceMs = config.debounceMs || 500;

  // Accumulating buffer: collect all mutations during the debounce window
  // so none are lost (unlike a plain debounce which discards earlier calls).
  let pendingMutations = [];
  let flushTimer = null;

  function flushMutations() {
    flushTimer = null;
    if (!isExtensionContextValid()) {
      stopLiveMonitoring();
      return;
    }

    const mutations = pendingMutations;
    pendingMutations = [];

    const newImages = [];

    for (const mutation of mutations) {
      // Check added nodes
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const images = extractFromNode(node);
        newImages.push(...images);

        // Also check for background images on the added node and its children
        const bgImages = extractBackgroundFromNode(node);
        newImages.push(...bgImages);
        const bgChildren = node.querySelectorAll?.('*') || [];
        for (const child of bgChildren) {
          const childBg = extractBackgroundFromNode(child);
          newImages.push(...childBg);
        }

        // Watch for lazy-loaded <img> elements that haven't loaded yet:
        // their naturalWidth is 0, so we listen for the 'load' event to
        // capture the real dimensions and discover them if missed.
        const lazyImgs = node.tagName === 'IMG' ? [node] : Array.from(node.querySelectorAll?.('img') || []);
        for (const img of lazyImgs) {
          if (!img.complete || img.naturalWidth === 0) {
            img.addEventListener('load', handleLazyImageLoad, { once: true });
          }
        }
      }

      // Check attribute changes
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if ((mutation.attributeName === 'src' || mutation.attributeName === 'srcset') && target.tagName === 'IMG') {
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

  function handleMutations(mutations) {
    pendingMutations.push(...mutations);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushMutations, debounceMs);
  }

  var liveObserver = new MutationObserver(handleMutations);
  
  const targetNode = document.body || document.documentElement;
  if (!targetNode) {
    console.warn('[Image Harvest] No DOM node available for MutationObserver');
    return;
  }
  liveObserver.observe(targetNode, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'style', 'srcset']
  });
}

/**
 * Handle lazy-loaded images that fire 'load' after being added to the DOM.
 * At this point the image has its real src/naturalWidth, so we can extract it.
 */
function handleLazyImageLoad(event) {
  const img = event.target;
  if (!img || img.tagName !== 'IMG') return;
  const images = extractFromNode(img);
  if (images.length > 0) {
    sendDiscoveredImages(images);
  }
}

/**
 * Send newly discovered images to the background / UI.
 */
function sendDiscoveredImages(images) {
  try {
    if (!chrome.runtime?.id) return;
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      images
    }).catch(() => {});
  } catch {
    stopLiveMonitoring();
  }
}

function stopLiveMonitoring() {
  if (liveObserver) {
    liveObserver.disconnect();
    liveObserver = null;
  }
}

// Extract images from a node (used by live monitoring)
function extractFromNode(node) {
  const images = [];
  
  // Check <img> elements
  if (node.tagName === 'IMG') {
    const candidateUrls = new Set();
    if (node.src) candidateUrls.add(node.src);
    if (node.currentSrc) candidateUrls.add(node.currentSrc);
    if (node.srcset) {
      const parsed = parseSrcset(node.srcset);
      for (const { url } of parsed) {
        if (url) candidateUrls.add(url);
      }
    }
    for (const attr of ['data-src', 'data-original', 'data-lazy', 'data-lazy-src']) {
      const val = node.getAttribute(attr);
      if (val) candidateUrls.add(val);
    }

    for (const url of candidateUrls) {
      if (!url) continue;
      if (isDataUri(url)) {
        if (!isImageDataUri(url)) continue;
        const dataKey = generateDataUriKey(url);
        if (seenUrls.has(dataKey)) continue;
        seenUrls.add(dataKey);
        images.push({
          id: generateId(dataKey),
          url: url,
          displayWidth: node.naturalWidth || node.width || 0,
          displayHeight: node.naturalHeight || node.height || 0,
          naturalWidth: node.naturalWidth,
          naturalHeight: node.naturalHeight,
          type: 'img',
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
      images.push({
        id: generateId(resolvedUrl),
        url: resolvedUrl,
        displayWidth: node.naturalWidth || node.width || 0,
        displayHeight: node.naturalHeight || node.height || 0,
        naturalWidth: node.naturalWidth,
        naturalHeight: node.naturalHeight,
        type: 'img',
        format: getFileFormat(resolvedUrl),
        sourceDomain: getDomain(resolvedUrl),
        checked: false,
        timestamp: Date.now()
      });
    }
  }
  
  // Check <video> poster
  if (node.tagName === 'VIDEO' && node.poster) {
    const posterUrl = node.poster;
    if (isDataUri(posterUrl)) {
      if (!isImageDataUri(posterUrl)) {
        // skip
      } else {
        const dataKey = generateDataUriKey(posterUrl);
        if (!seenUrls.has(dataKey)) {
          seenUrls.add(dataKey);
          images.push({
            id: generateId(dataKey),
            url: posterUrl,
            displayWidth: node.videoWidth || node.width || 0,
            displayHeight: node.videoHeight || node.height || 0,
            type: 'video-poster',
            format: getFileFormat(posterUrl),
            sourceDomain: window.location.hostname,
            checked: false,
            timestamp: Date.now()
          });
        }
      }
    } else {
      const resolvedUrl = resolveUrl(posterUrl);
      if (!seenUrls.has(resolvedUrl)) {
        seenUrls.add(resolvedUrl);
        images.push({
          id: generateId(resolvedUrl),
          url: resolvedUrl,
          displayWidth: node.videoWidth || node.width || 0,
          displayHeight: node.videoHeight || node.height || 0,
          type: 'video-poster',
          format: getFileFormat(resolvedUrl),
          sourceDomain: getDomain(resolvedUrl),
          checked: false,
          timestamp: Date.now()
        });
      }
    }
  }
  
  // Check <input type="image">
  if (node.tagName === 'INPUT' && node.type === 'image' && node.src) {
    const url = node.src;
    if (isDataUri(url)) {
      if (!isImageDataUri(url)) {
        // skip
      } else {
        const dataKey = generateDataUriKey(url);
        if (!seenUrls.has(dataKey)) {
          seenUrls.add(dataKey);
          images.push({
            id: generateId(dataKey),
            url: url,
            displayWidth: node.width || 0,
            displayHeight: node.height || 0,
            type: 'input-image',
            format: getFileFormat(url),
            sourceDomain: window.location.hostname,
            checked: false,
            timestamp: Date.now()
          });
        }
      }
    } else {
      const resolvedUrl = resolveUrl(url);
      if (!seenUrls.has(resolvedUrl)) {
        seenUrls.add(resolvedUrl);
        images.push({
          id: generateId(resolvedUrl),
          url: resolvedUrl,
          displayWidth: node.width || 0,
          displayHeight: node.height || 0,
          type: 'input-image',
          format: getFileFormat(resolvedUrl),
          sourceDomain: getDomain(resolvedUrl),
          checked: false,
          timestamp: Date.now()
        });
      }
    }
  }
  
  // Check <object> and <embed>
  if (node.tagName === 'OBJECT' && node.data) {
    const dataUrl = node.data;
    const objType = node.type || '';
    const imageTypePattern = /image\//i;
    if (imageTypePattern.test(objType) || getFileFormat(dataUrl) !== 'unknown') {
      const resolvedUrl = isDataUri(dataUrl) ? null : resolveUrl(dataUrl);
      const key = isDataUri(dataUrl) ? generateDataUriKey(dataUrl) : resolvedUrl;
      if (!seenUrls.has(key)) {
        seenUrls.add(key);
        const rect = node.getBoundingClientRect();
        images.push({
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
    }
  }
  
  if (node.tagName === 'EMBED' && node.src) {
    const srcUrl = node.src;
    const embedType = node.type || '';
    const imageTypePattern = /image\//i;
    if (imageTypePattern.test(embedType) || getFileFormat(srcUrl) !== 'unknown') {
      const resolvedUrl = isDataUri(srcUrl) ? null : resolveUrl(srcUrl);
      const key = isDataUri(srcUrl) ? generateDataUriKey(srcUrl) : resolvedUrl;
      if (!seenUrls.has(key)) {
        seenUrls.add(key);
        const rect = node.getBoundingClientRect();
        images.push({
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
  }
  
  // Check <svg>
  if (node.tagName === 'SVG') {
    const svgItem = extractInlineSvg(node);
    if (svgItem) images.push(svgItem);
  }
  
  // Check <canvas>
  if (node.tagName === 'CANVAS') {
    const canvasItem = extractCanvasImage(node);
    if (canvasItem) images.push(canvasItem);
  }
  
  // Check children
  const imgs = node.querySelectorAll?.('img') || [];
  for (const img of imgs) {
    const extracted = extractFromNode(img);
    images.push(...extracted);
  }

  // Also check child video, svg, canvas elements
  const videos = node.querySelectorAll?.('video[poster]') || [];
  for (const video of videos) {
    const extracted = extractFromNode(video);
    images.push(...extracted);
  }
  const svgs = node.querySelectorAll?.('svg') || [];
  for (const svg of svgs) {
    const svgItem = extractInlineSvg(svg);
    if (svgItem) images.push(svgItem);
  }
  const canvases = node.querySelectorAll?.('canvas') || [];
  for (const canvas of canvases) {
    const canvasItem = extractCanvasImage(canvas);
    if (canvasItem) images.push(canvasItem);
  }
  
  return images;
}

// Extract background images from node
function extractBackgroundFromNode(node) {
  const images = [];
  
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
          if (seenUrls.has(dataKey)) continue;
          seenUrls.add(dataKey);
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
            timestamp: Date.now()
          });
          continue;
        }
        
        const resolvedUrl = resolveUrl(url);
        if (seenUrls.has(resolvedUrl)) continue;
        seenUrls.add(resolvedUrl);
        
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
          timestamp: Date.now()
        });
      }
    }
  } catch (error) {
    // Ignore
  }
  
  return images;
}
