// ============================================
// Scan Overlay Control
// ============================================
// 扫描覆盖层和图片获取处理模块

/**
 * Handle the scan cancel button click. Sets the scanAborted flag so
 * fetchImages / rescanWithProgress can detect it after their awaited
 * sendMessage resolves, then immediately hide the overlay and render
 * whatever images have been discovered so far.
 */
function handleScanCancel() {
  scanAborted = true;
  isScanning = false;
  isFetching = false;
  hideScanOverlay();
  hideLoading();

  if (allImages.length > 0) {
    applyFilters();
    showToast(`Scan cancelled · ${allImages.length} images found`, 'info');
  } else {
    showEmpty();
    showToast('Scan cancelled', 'info');
  }
}

function showScanOverlay(current, total) {
  if (elements.scanOverlay) elements.scanOverlay.classList.remove('hidden');
  // Disable toolbar and status bar during scan
  document.querySelectorAll('.toolbar, .status-bar').forEach(el => el.classList.add('scanning-disabled'));
  updateScanProgress(current, total);
}

function hideScanOverlay() {
  if (elements.scanOverlay) {
    elements.scanOverlay.classList.add('hidden');
  }
  // Re-enable toolbar and status bar
  document.querySelectorAll('.toolbar, .status-bar').forEach(el => el.classList.remove('scanning-disabled'));
  // Restore progress bar visibility for next scan
  const scanProgressBar = elements.scanOverlay?.querySelector('.progress-bar');
  if (scanProgressBar) scanProgressBar.classList.remove('hidden');
}

function updateScanProgress(current, total, currentUrl = '') {
  if (elements.scanProgressFill) {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    elements.scanProgressFill.style.width = percent + '%';
  }
  if (elements.scanProgressText) {
    if (total === 0) {
      elements.scanProgressText.textContent = 'scanning for images...';
    } else {
      elements.scanProgressText.textContent = `${current} / ${total} images`;
    }
  }
  if (elements.scanProgressCurrent) {
    elements.scanProgressCurrent.textContent = currentUrl || '\u00A0';
    elements.scanProgressCurrent.title = currentUrl;
  }
}

// ============================================
// Image Fetching & Processing
// ============================================

/**
 * Silently rescan the current tab in the background without showing
 * loading UI. Used after restoring from session cache so the user sees
 * cached images instantly while we check for updates.
 */
async function silentRescan(tabId, tabUrl) {
  if (isFetching) return;
  isFetching = true;
  isSilentScanning = true;

  // Snapshot the current images before the scan so we can diff later.
  const preRescanImages = [...allImages];

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // Abort if the user has already switched to a different tab
    if (!activeTab || activeTab.id !== tabId || currentTabId !== tabId) {
      isSilentScanning = false;
      isFetching = false;
      return;
    }

    const currentTabTitle = activeTab.title || 'Current Tab';
    const currentTabIndex = activeTab.index ?? 0;

    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_IMAGES,
      searchAllFrames: appSettings.searchAllFrames || false,
      liveMonitoring: appSettings.liveMonitoring !== false
    });

    // Abort if the user switched tabs while we were scanning
    if (currentTabId !== tabId) {
      isSilentScanning = false;
      isFetching = false;
      return;
    }

    if (response && response.success && response.images) {
      const freshImages = response.images.map(img => ({
        ...img,
        id: img.id || generateId(img.url),
        tabTitle: img.tabTitle || currentTabTitle,
        tabIndex: img.tabIndex ?? currentTabIndex,
        isCurrentTab: !img.tabTitle,
        colors: null,
        phash: null
      }));

      // Compare against the pre-rescan snapshot
      const preRescanUrls = new Set(preRescanImages.map(img => img.url));
      const freshUrls = new Set(freshImages.map(img => img.url));
      const hasChanges = freshImages.length !== preRescanImages.length
        || freshImages.some(img => !preRescanUrls.has(img.url))
        || preRescanImages.some(img => !freshUrls.has(img.url));

      // Double-check tab hasn't changed before updating UI
      if (currentTabId !== tabId) {
        isSilentScanning = false;
        isFetching = false;
        return;
      }

      // Always replace allImages with the authoritative fresh result
      const previousSelection = new Set(selectedImages);
      allImages = freshImages;
      selectedImages = new Set([...previousSelection].filter(id =>
        freshImages.some(img => img.id === id)
      ));
      applyFilters();
      updateSelectionUI();

      if (hasChanges) {
        const added = freshImages.filter(img => !preRescanUrls.has(img.url)).length;
        const removed = [...preRescanUrls].filter(url => !freshUrls.has(url)).length;
        const parts = [];
        if (added > 0) parts.push(`${added} new`);
        if (removed > 0) parts.push(`${removed} removed`);
        showToast(`Updated: ${parts.join(', ')} · ${allImages.length} total`, 'info');
      }

      // Update both caches with fresh data
      tabCache.set(tabId, {
        url: tabUrl,
        images: allImages,
        selectedImages: new Set(selectedImages)
      });
      saveTabImageCache(tabId, tabUrl, allImages);

      // Run analysis phase silently (check tab again before heavy work)
      if (currentTabId === tabId) {
        await processImageExtras(allImages);
      }
    }
  } catch (error) {
    console.warn('Silent rescan failed:', error);
  }
  isSilentScanning = false;
  isFetching = false;
}

/**
 * Rescan with a visible progress overlay on top of already-rendered cached images.
 * Used when opening/reopening the panel so the user sees cached images immediately
 * while a progress indicator shows the rescan is in progress.
 */
async function rescanWithProgress(tabId, tabUrl) {
  if (isFetching) return;
  isFetching = true;
  isScanning = true;
  scanDiscoveredCount = 0;
  scanDiscoveredImages = [];
  scanAborted = false;

  // Show scan overlay on top of the existing image grid (don't replace with skeletons)
  if (elements.scanProgressTitle) {
    elements.scanProgressTitle.textContent = 'Updating...';
  }
  const scanProgressBar = elements.scanOverlay?.querySelector('.progress-bar');
  if (scanProgressBar) scanProgressBar.classList.add('hidden');
  showScanOverlay(0, 0);

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || activeTab.id !== tabId || currentTabId !== tabId) {
      isScanning = false;
      isFetching = false;
      hideScanOverlay();
      return;
    }

    const currentTabTitle = activeTab.title || 'Current Tab';
    const currentTabIndex = activeTab.index ?? 0;

    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_IMAGES,
      searchAllFrames: appSettings.searchAllFrames || false,
      liveMonitoring: appSettings.liveMonitoring !== false
    });

    isScanning = false;

    // If the user cancelled the scan, abort silently
    if (scanAborted) {
      isFetching = false;
      return;
    }

    // Abort if the user switched tabs while we were scanning
    if (currentTabId !== tabId) {
      isFetching = false;
      hideScanOverlay();
      return;
    }

    if (response && response.success && response.images) {
      const freshImages = response.images.map(img => ({
        ...img,
        id: img.id || generateId(img.url),
        tabTitle: img.tabTitle || currentTabTitle,
        tabIndex: img.tabIndex ?? currentTabIndex,
        isCurrentTab: !img.tabTitle,
        colors: null,
        phash: null
      }));

      // Merge images discovered by live monitoring during the scan that
      // were not included in the final GET_IMAGES result.
      const freshUrls = new Set(freshImages.map(img => img.url));
      const extraDiscovered = scanDiscoveredImages
        .filter(img => !freshUrls.has(img.url))
        .map(img => ({
          ...img,
          id: img.id || generateId(img.url),
          tabTitle: img.tabTitle || currentTabTitle,
          tabIndex: img.tabIndex ?? currentTabIndex,
          isCurrentTab: !img.tabTitle,
          colors: null,
          phash: null
        }));
      const mergedImages = [...freshImages, ...extraDiscovered];

      const previousSelection = new Set(selectedImages);
      allImages = mergedImages;
      selectedImages = new Set([...previousSelection].filter(id =>
        mergedImages.some(img => img.id === id)
      ));

      hideScanOverlay();
      applyFilters();
      updateSelectionUI();
      showToast(`Found ${allImages.length} images`, 'success');

      // Update both caches with fresh data
      tabCache.set(tabId, {
        url: tabUrl,
        images: allImages,
        selectedImages: new Set(selectedImages)
      });
      saveTabImageCache(tabId, tabUrl, allImages);

      // Run analysis phase silently
      if (currentTabId === tabId) {
        await processImageExtras(allImages);
      }
    } else {
      hideScanOverlay();
      if (allImages.length === 0) {
        showEmpty();
      }
    }
  } catch (error) {
    isScanning = false;
    if (scanAborted) { isFetching = false; return; }
    console.warn('Rescan with progress failed:', error);
    hideScanOverlay();
  }
  isFetching = false;
}

async function fetchImages() {
  // Prevent concurrent scans — if already fetching, skip this call
  if (isFetching) return;
  isFetching = true;
  isScanning = true;
  scanDiscoveredCount = 0;
  scanDiscoveredImages = [];

  // Show loading overlay immediately before any async work
  // to prevent stale content from being visible
  selectedImages.clear();
  allImages = [];
  showLoading();

  try {
    // Get current tab info to assign tabTitle and tabIndex to images
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTabTitle = activeTab?.title || 'Current Tab';
    const currentTabIndex = activeTab?.index ?? 0;

    // While waiting for GET_IMAGES, IMAGES_DISCOVERED messages from content.js
    // will progressively populate allImages and update the scan overlay
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_IMAGES,
      searchAllFrames: appSettings.searchAllFrames || false,
      liveMonitoring: appSettings.liveMonitoring !== false
    });

    isScanning = false;

    // If the user cancelled the scan while we were waiting, abort silently.
    // handleScanCancel already rendered whatever was discovered so far.
    if (scanAborted) {
      isFetching = false;
      return;
    }

    if (response && response.success && response.images) {
      // Use the final complete result from GET_IMAGES as the authoritative list
      const responseImages = response.images.map(img => ({
        ...img,
        id: img.id || generateId(img.url),
        tabTitle: img.tabTitle || currentTabTitle,
        tabIndex: img.tabIndex ?? currentTabIndex,
        isCurrentTab: !img.tabTitle,
        colors: null,
        phash: null
      }));

      // Merge images discovered by live monitoring during the scan that
      // were not included in the final GET_IMAGES result. This handles
      // pages where images are loaded dynamically after extractImages()
      // has already finished scanning the DOM.
      const responseUrls = new Set(responseImages.map(img => img.url));
      const extraDiscovered = scanDiscoveredImages
        .filter(img => !responseUrls.has(img.url))
        .map(img => ({
          ...img,
          id: img.id || generateId(img.url),
          tabTitle: img.tabTitle || currentTabTitle,
          tabIndex: img.tabIndex ?? currentTabIndex,
          isCurrentTab: !img.tabTitle,
          colors: null,
          phash: null
        }));
      allImages = [...responseImages, ...extraDiscovered];

      // Hide scan overlay and re-enable toolbar buttons
      hideLoading();

      // Render the final complete image list
      applyFilters();

      // Notify the user how many images were found
      showToast(`Found ${allImages.length} images`, 'success');

      // Persist to session storage so reopening the panel restores instantly
      if (currentTabId != null) {
        const currentTab = await chrome.tabs.query({ active: true, currentWindow: true }).then(t => t[0]).catch(() => null);
        const currentUrl = currentTab?.url || '';
        tabCache.set(currentTabId, {
          url: currentUrl,
          images: allImages,
          selectedImages: new Set(selectedImages)
        });
        saveTabImageCache(currentTabId, currentUrl, allImages);
      }

      // Continue with analysis phase silently in the background
      await processImageExtras(allImages);
    } else {
      hideLoading();
      showEmpty();
    }
  } catch (error) {
    isScanning = false;
    if (scanAborted) { isFetching = false; return; }
    console.error('Fetch images error:', error);
    hideLoading();
    showError('FETCH_ERROR', error.message, 'Refresh the page and try again');
  }
  isFetching = false;
}

async function fetchImageDataUrl(imageUrl) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.FETCH_IMAGE_DATA,
      url: imageUrl
    });
    if (response && response.success) return response.dataUrl;
  } catch (error) {
    // Background fetch failed, ignore
  }
  return null;
}

async function processImageExtras(images) {
  const metaPromises = [];
  images.forEach(img => {
    // For data: URLs, calculate size directly from the base64 string
    // instead of making an HTTP HEAD request (which would fail).
    if (img.url && img.url.startsWith('data:')) {
      if (!img.estimatedSize) {
        const commaIndex = img.url.indexOf(',');
        if (commaIndex !== -1) {
          const base64Part = img.url.substring(commaIndex + 1);
          const padding = (base64Part.match(/=+$/) || [''])[0].length;
          img.estimatedSize = Math.floor((base64Part.length * 3) / 4) - padding;
        }
      }
      if (img.format === 'unknown') {
        const mimeMatch = img.url.match(/^data:([^;,]+)/);
        if (mimeMatch) {
          const detected = getFileFormat(img.url, mimeMatch[1]);
          if (detected !== 'unknown') img.format = detected;
        }
      }
    } else if (!img.estimatedSize || img.format === 'unknown') {
      metaPromises.push(
        fetchImageMeta(img.url).then(meta => {
          if (meta.size && !img.estimatedSize) img.estimatedSize = meta.size;
          if (img.format === 'unknown' && meta.contentType) {
            const detected = getFileFormat(img.url, meta.contentType);
            if (detected !== 'unknown') img.format = detected;
          }
        }).catch(() => {})
      );
    }

    // For images missing dimensions, load them in the background to get
    // naturalWidth/naturalHeight. This handles cases where the content
    // script captured the image before it finished loading.
    const hasWidth = img.naturalWidth || img.displayWidth;
    const hasHeight = img.naturalHeight || img.displayHeight;
    if (!hasWidth || !hasHeight) {
      metaPromises.push(
        new Promise((resolve) => {
          const probe = new Image();
          probe.onload = () => {
            if (probe.naturalWidth > 0) {
              img.naturalWidth = probe.naturalWidth;
              img.naturalHeight = probe.naturalHeight;
              if (!img.displayWidth) img.displayWidth = probe.naturalWidth;
              if (!img.displayHeight) img.displayHeight = probe.naturalHeight;
            }
            resolve();
          };
          probe.onerror = resolve;
          // Timeout after 8 seconds to avoid blocking
          setTimeout(resolve, 8000);
          probe.src = img.url;
        })
      );
    }
  });

  const needsPHash = appSettings.enableSimilarDetection !== false && typeof calculatePHash === 'function';
  const needsColors = appSettings.enableColorExtraction !== false && typeof extractColorsFromUrl === 'function';

  if (!needsPHash && !needsColors) {
    if (metaPromises.length > 0) {
      await Promise.allSettled(metaPromises);
      patchCardExtras(images);
    }
    return;
  }

  // Process images in batches with scan overlay progress
  const batchSize = 5;
  const imagesToProcess = images.filter(img =>
    (needsPHash && !img.phash) || (needsColors && !img.colors)
  );

  const totalToProcess = imagesToProcess.length;
  let processedCount = 0;

  for (let i = 0; i < imagesToProcess.length; i += batchSize) {
    const batch = imagesToProcess.slice(i, i + batchSize);
    const batchPromises = batch.map(async (img) => {
      const dataUrl = await fetchImageDataUrl(img.url);
      if (!dataUrl) {
        processedCount++;
        return;
      }

      const extraPromises = [];
      if (needsPHash && !img.phash) {
        extraPromises.push(
          calculatePHash(dataUrl).then(hash => { img.phash = hash; }).catch(() => {})
        );
      }
      if (needsColors && !img.colors) {
        extraPromises.push(
          extractColorsFromUrl(dataUrl, 10).then(colors => { img.colors = colors; }).catch(() => {})
        );
      }
      await Promise.allSettled(extraPromises);
      processedCount++;
    });

    await Promise.allSettled([...batchPromises, ...metaPromises.splice(0, batchSize)]);

    // Incrementally patch card DOM for updated properties (filesize, format,
    // color bar) instead of rebuilding the entire grid, avoiding flicker.
    patchCardExtras(images);
    detectSimilarImages();
    renderColorSwatches();
  }

  // Process any remaining meta promises
  if (metaPromises.length > 0) {
    await Promise.allSettled(metaPromises);
    patchCardExtras(images);
  }
}

/**
 * Incrementally update rendered cards with newly-available metadata
 * (estimatedSize, format, colors) without rebuilding the entire grid DOM.
 */
function patchCardExtras(images) {
  if (!elements.imageGrid) return;
  const colorExtractionEnabled = appSettings.enableColorExtraction !== false;

  images.forEach(img => {
    const card = elements.imageGrid.querySelector(`.image-card[data-id="${img.id}"]`);
    if (!card) return;

    // Patch tags (filesize, dims, format)
    const tagsContainer = card.querySelector('.card-tags');
    if (tagsContainer) {
      // Patch dimensions tag if missing and now available
      const w = img.naturalWidth || img.displayWidth || 0;
      const h = img.naturalHeight || img.displayHeight || 0;
      const existingDims = tagsContainer.querySelector('.card-tag.dims');
      if (!existingDims && w && h) {
        const dimsTag = document.createElement('span');
        dimsTag.className = 'card-tag dims';
        dimsTag.textContent = `${w}×${h}`;
        // Insert after format tag to maintain order: format → dims → filesize
        const formatTag = tagsContainer.querySelector('.card-tag.format');
        if (formatTag && formatTag.nextSibling) {
          tagsContainer.insertBefore(dimsTag, formatTag.nextSibling);
        } else {
          tagsContainer.appendChild(dimsTag);
        }
      }

      // Patch filesize tag
      const existingFilesize = tagsContainer.querySelector('.card-tag.filesize');
      if (!existingFilesize && img.estimatedSize) {
        const filesizeTag = document.createElement('span');
        filesizeTag.className = 'card-tag filesize';
        filesizeTag.textContent = formatBytes(img.estimatedSize);
        tagsContainer.appendChild(filesizeTag);
      }

      // Patch format tag if it was unknown and now resolved
      const formatTag = tagsContainer.querySelector('.card-tag.format');
      if (formatTag && img.format && img.format !== 'unknown') {
        formatTag.textContent = img.format.toUpperCase();
      }
    }

    // Patch color bar
    if (colorExtractionEnabled && img.colors && img.colors.length > 0) {
      const existingColors = card.querySelector('.card-colors');
      if (existingColors) {
        // Replace the entire color container (transparent placeholder or old colors)
        existingColors.outerHTML = renderColorBar(img.colors);
      }
    }
  });
}