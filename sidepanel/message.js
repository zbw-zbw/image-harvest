// Message handling from background script and keyboard shortcuts

// ============================================
// Debounced "new images discovered" toast
// ============================================
let discoveredToastCount = 0;
let discoveredToastTimer = null;
const DISCOVERED_TOAST_DEBOUNCE_MS = 1500;

function showDiscoveredToastDebounced(addedCount) {
  discoveredToastCount += addedCount;
  if (discoveredToastTimer) clearTimeout(discoveredToastTimer);
  discoveredToastTimer = setTimeout(() => {
    if (discoveredToastCount > 0) {
      showToast(`${discoveredToastCount} new images discovered`, 'info');
      discoveredToastCount = 0;
    }
    discoveredToastTimer = null;
  }, DISCOVERED_TOAST_DEBOUNCE_MS);
}

// ============================================
// Message Handling
// ============================================
function handleMessage(message) {
  if (!message || !message.type) return;

  switch (message.type) {
    case MESSAGE_TYPES.IMAGES_DISCOVERED:
      // Ignore messages from a different tab — when the user switches tabs,
      // the previous tab's content script live monitoring may still send
      // discoveries that should not pollute the current tab's image list.
      if (message.fromTabId != null && message.fromTabId !== currentTabId) {
        break;
      }

      // Ignore during tab switching — the new tab's loadCurrentTab will
      // handle image loading from cache or a fresh scan.
      if (isTabSwitching) {
        break;
      }

      // During silent rescan, fetch-only, or multi-tab extraction, ignore
      // discoveries entirely — the final response is the authoritative result.
      if (isSilentScanning || (isFetching && !isScanning) || isMultiTabExtracting) {
        break;
      }

      // During an active scan, buffer discovered images AND update the scan
      // overlay in real-time so the user sees incremental progress (count +
      // URL). Only render images into the grid up to the skeleton card limit
      // to avoid constant re-rendering flicker on image-heavy pages.
      if (isScanning && message.images) {
        const newImgs = message.images.map(img => ({
          ...img,
          id: img.id || generateId(img.url),
          colors: null,
          phash: null
        }));

        const prevCount = allImages.length;
        let addedCount = 0;
        newImgs.forEach(ni => {
          if (!allImages.find(img => img.url === ni.url)) {
            allImages.push(ni);
            addedCount++;
          }
        });

        scanDiscoveredCount += message.images.length;
        scanDiscoveredImages.push(...message.images);

        if (addedCount > 0) {
          // Always update scan overlay with real-time progress
          const lastUrl = newImgs[newImgs.length - 1]?.url || '';
          const truncatedUrl = lastUrl.length > 60 ? lastUrl.substring(0, 57) + '...' : lastUrl;
          updateScanProgress(allImages.length, 0, truncatedUrl);
          if (elements.scanProgressText) {
            elements.scanProgressText.textContent = `found ${allImages.length} images`;
          }

          // Always keep the bottom status bar count in sync
          if (elements.foundCount) {
            elements.foundCount.textContent = allImages.length;
          }

          // Only incrementally render while we haven't filled the skeleton
          // slots yet. After that, stop re-rendering to avoid flicker —
          // the final complete render happens when the scan finishes.
          if (prevCount < scanSkeletonLimit) {
            applyFilters();
          }
        }
        break;
      }

      if (message.images && isInitialized) {
        // Live monitoring (only after init completes and no scan in progress)
        const newImgs = message.images.map(img => ({
          ...img,
          id: img.id || generateId(img.url),
          colors: null,
          phash: null
        }));
        let addedCount = 0;
        newImgs.forEach(ni => {
          if (!allImages.find(img => img.url === ni.url)) {
            allImages.push(ni);
            addedCount++;
          }
        });
        if (addedCount > 0) {
          applyFilters();
          showDiscoveredToastDebounced(addedCount);
        }
      }
      break;

    case MESSAGE_TYPES.DOWNLOAD_PROGRESS:
      updateProgress(message.completed, message.total, message.current, message.imageCount);
      break;

    case MESSAGE_TYPES.DOWNLOAD_COMPLETE:
      hideProgress();
      showToast(`Downloaded ${message.count} images`, 'success');
      break;

    case MESSAGE_TYPES.DOWNLOAD_ERROR:
      hideProgress();
      showToast('Download failed: ' + (message.error || 'Unknown error'), 'error');
      break;

    case MESSAGE_TYPES.CLEAR_SELECTION:
      // User clicked overlay or pressed ESC on the page — clear selection in UI
      selectedImages.clear();
      renderImages();
      updateSelectionUI();
      break;

    case MESSAGE_TYPES.LICENSE_STATUS_CHANGED:
      // License status changed (activation, deactivation, periodic check)
      applyProFeatureVisibility();
      break;

    case MESSAGE_TYPES.MULTI_TAB_EXTRACT_COMPLETE:
      hideProgress();
      if (message.success && message.images) {
        const newImages = message.images.map(img => ({
          ...img,
          id: img.id || generateId(img.url),
          colors: null,
          phash: null
        }));

        newImages.forEach(newImg => {
          if (!allImages.find(img => img.url === newImg.url)) {
            allImages.push(newImg);
          }
        });

        currentGroupMode = 'tab';
        if (elements.groupMode) elements.groupMode.value = 'tab';
        document.querySelectorAll('[data-group-filter]').forEach(o => {
          o.classList.toggle('active', o.dataset.groupFilter === 'tab');
        });
        updateFilterButtonLabels();

        applyFilters();
        closeMultiTabModal();
        showToast(`Extracted ${newImages.length} images from ${message.tabCount} tabs`, 'success');

        if (appSettings.enableSimilarDetection !== false || appSettings.enableColorExtraction !== false) {
          processImageExtras(newImages);
        }
      } else {
        showToast('Extraction failed', 'error');
      }
      break;

    case MESSAGE_TYPES.MULTI_TAB_EXTRACT_ERROR:
      hideProgress();
      showToast('Multi-tab extraction failed: ' + (message.error || 'Unknown error'), 'error');
      break;
  }
}

// ============================================
// Keyboard Shortcuts
// ============================================
function handleKeyDown(e) {
  if (e.key === 'Escape') {
    if (elements.settingsModal && !elements.settingsModal.classList.contains('hidden')) { closeSettings(); return; }
    if (elements.dedupModal && !elements.dedupModal.classList.contains('hidden')) { closeDedupModal(); return; }
    if (elements.collectionModal && !elements.collectionModal.classList.contains('hidden')) { closeCollectionModal(); return; }
    if (elements.multitabModal && !elements.multitabModal.classList.contains('hidden')) { closeMultiTabModal(); return; }
    hideDownloadDropdown();
    closeAllFilterDropdowns();
    // Clear selection and remove page highlights
    if (selectedImages.size > 0) {
      clearSelection();
    }
    return;
  }

  // Don't handle shortcuts when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    e.preventDefault();
    selectAll();
  }

  if (e.key === 'Enter' && selectedImages.size > 0) {
    e.preventDefault();
    downloadSelectedAsZip(null);
  }
}
