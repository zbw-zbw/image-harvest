// Scan overlay control + image fetching/processing

import { MESSAGE_TYPES } from '../shared/constants';
import { extractColorsFromUrl } from '../shared/color-extract';
import { calculatePHash } from '../shared/phash';
import type { ImageItem } from '../shared/types';
import { getFileFormat } from '../shared/utils';
import { updateSelectionUI } from './actions';
import { applyFilters, renderColorSwatches } from './filter';
import { detectSimilarImages, renderColorBar } from './pro-features';
import { saveTabImageCache } from '../shared/storage';
import { elements, state } from './state';
import {
  hideLoading,
  showEmpty,
  showError,
  showLoading,
  showToast
} from './ui';
import { fetchImageMeta, formatBytes, generateId } from './utils';

// ============================================
// Scan Overlay Control
// ============================================
/**
 * Handle the scan cancel button click. Sets the scanAborted flag so
 * fetchImages / rescanWithProgress can detect it after their awaited
 * sendMessage resolves, then immediately hide the overlay and render
 * whatever images have been discovered so far.
 */
export function handleScanCancel(): void {
  state.scanAborted = true;
  state.isScanning = false;
  state.isFetching = false;
  hideScanOverlay();
  hideLoading();

  if (state.allImages.length > 0) {
    applyFilters();
    showToast(`Scan cancelled · ${state.allImages.length} images found`, 'info');
  } else {
    showEmpty();
    showToast('Scan cancelled', 'info');
  }
}

export function showScanOverlay(current: number, total: number): void {
  if (elements.scanOverlay) elements.scanOverlay.classList.remove('hidden');
  // Disable toolbar and status bar during scan
  document.querySelectorAll('.toolbar, .status-bar').forEach(el => el.classList.add('scanning-disabled'));
  updateScanProgress(current, total);
}

export function hideScanOverlay(): void {
  if (elements.scanOverlay) {
    elements.scanOverlay.classList.add('hidden');
  }
  // Re-enable toolbar and status bar
  document.querySelectorAll('.toolbar, .status-bar').forEach(el => el.classList.remove('scanning-disabled'));
  // Restore progress bar visibility for next scan
  const scanProgressBar = elements.scanOverlay?.querySelector('.progress-bar');
  if (scanProgressBar) scanProgressBar.classList.remove('hidden');
}

export function updateScanProgress(current: number, total: number, currentUrl = ''): void {
  if (elements.scanProgressFill) {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    (elements.scanProgressFill as HTMLElement).style.width = percent + '%';
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
export async function silentRescan(tabId: number, tabUrl: string): Promise<void> {
  if (state.isFetching) return;
  state.isFetching = true;
  state.isSilentScanning = true;

  // Snapshot the current images before the scan so we can diff later.
  const preRescanImages = [...state.allImages];

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // Abort if the user has already switched to a different tab
    if (!activeTab || activeTab.id !== tabId || state.currentTabId !== tabId) {
      state.isSilentScanning = false;
      state.isFetching = false;
      return;
    }

    const currentTabTitle = activeTab.title || 'Current Tab';
    const currentTabIndex = activeTab.index ?? 0;

    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_IMAGES,
      searchAllFrames: state.appSettings.searchAllFrames || false,
      liveMonitoring: state.appSettings.liveMonitoring !== false
    });

    // Abort if the user switched tabs while we were scanning
    if (state.currentTabId !== tabId) {
      state.isSilentScanning = false;
      state.isFetching = false;
      return;
    }

    if (response && response.success && response.images) {
      const freshImages: ImageItem[] = response.images.map((img: ImageItem) => ({
        ...img,
        id: img.id || generateId(img.url),
        tabTitle: img.tabTitle || currentTabTitle,
        tabIndex: img.tabIndex ?? currentTabIndex,
        isCurrentTab: !img.tabTitle,
        colors: undefined,
        phash: null
      }));

      // Compare against the pre-rescan snapshot
      const preRescanUrls = new Set(preRescanImages.map(img => img.url));
      const freshUrls = new Set(freshImages.map(img => img.url));
      const hasChanges = freshImages.length !== preRescanImages.length
        || freshImages.some(img => !preRescanUrls.has(img.url))
        || preRescanImages.some(img => !freshUrls.has(img.url));

      // Double-check tab hasn't changed before updating UI
      if (state.currentTabId !== tabId) {
        state.isSilentScanning = false;
        state.isFetching = false;
        return;
      }

      // Always replace allImages with the authoritative fresh result
      const previousSelection = new Set(state.selectedImages);
      state.allImages = freshImages;
      state.selectedImages = new Set([...previousSelection].filter(id =>
        freshImages.some(img => img.id === id)
      ));
      applyFilters();
      updateSelectionUI();

      if (hasChanges) {
        const added = freshImages.filter(img => !preRescanUrls.has(img.url)).length;
        const removed = [...preRescanUrls].filter(url => !freshUrls.has(url)).length;
        const parts: string[] = [];
        if (added > 0) parts.push(`${added} new`);
        if (removed > 0) parts.push(`${removed} removed`);
        showToast(`Updated: ${parts.join(', ')} · ${state.allImages.length} total`, 'info');
      }

      // Update both caches with fresh data
      state.tabCache.set(tabId, {
        url: tabUrl,
        images: state.allImages,
        selectedImages: new Set(state.selectedImages)
      });
      saveTabImageCache(tabId, tabUrl, state.allImages);

      // Run analysis phase silently (check tab again before heavy work)
      if (state.currentTabId === tabId) {
        await processImageExtras(state.allImages);
      }
    }
  } catch (error) {
    console.warn('Silent rescan failed:', error);
  }
  state.isSilentScanning = false;
  state.isFetching = false;
}

/**
 * Rescan with a visible progress overlay on top of already-rendered cached images.
 * Used when opening/reopening the panel so the user sees cached images immediately
 * while a progress indicator shows the rescan is in progress.
 */
export async function rescanWithProgress(tabId: number, tabUrl: string): Promise<void> {
  if (state.isFetching) return;
  state.isFetching = true;
  state.isScanning = true;
  state.scanDiscoveredCount = 0;
  state.scanDiscoveredImages = [];
  state.scanAborted = false;

  // Show scan overlay on top of the existing image grid (don't replace with skeletons)
  if (elements.scanProgressTitle) {
    elements.scanProgressTitle.textContent = 'Updating...';
  }
  const scanProgressBar = elements.scanOverlay?.querySelector('.progress-bar');
  if (scanProgressBar) scanProgressBar.classList.add('hidden');
  showScanOverlay(0, 0);

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || activeTab.id !== tabId || state.currentTabId !== tabId) {
      state.isScanning = false;
      state.isFetching = false;
      hideScanOverlay();
      return;
    }

    const currentTabTitle = activeTab.title || 'Current Tab';
    const currentTabIndex = activeTab.index ?? 0;

    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_IMAGES,
      searchAllFrames: state.appSettings.searchAllFrames || false,
      liveMonitoring: state.appSettings.liveMonitoring !== false
    });

    state.isScanning = false;

    // If the user cancelled the scan, abort silently
    if (state.scanAborted) {
      state.isFetching = false;
      return;
    }

    // Abort if the user switched tabs while we were scanning
    if (state.currentTabId !== tabId) {
      state.isFetching = false;
      hideScanOverlay();
      return;
    }

    if (response && response.success && response.images) {
      const freshImages: ImageItem[] = response.images.map((img: ImageItem) => ({
        ...img,
        id: img.id || generateId(img.url),
        tabTitle: img.tabTitle || currentTabTitle,
        tabIndex: img.tabIndex ?? currentTabIndex,
        isCurrentTab: !img.tabTitle,
        colors: undefined,
        phash: null
      }));

      // Merge images discovered by live monitoring during the scan that
      // were not included in the final GET_IMAGES result.
      const freshUrls = new Set(freshImages.map(img => img.url));
      const extraDiscovered: ImageItem[] = state.scanDiscoveredImages
        .filter(img => !freshUrls.has(img.url))
        .map(img => ({
          ...img,
          id: img.id || generateId(img.url),
          tabTitle: img.tabTitle || currentTabTitle,
          tabIndex: img.tabIndex ?? currentTabIndex,
          isCurrentTab: !img.tabTitle,
          colors: undefined,
          phash: null
        }));
      const mergedImages = [...freshImages, ...extraDiscovered];

      const previousSelection = new Set(state.selectedImages);
      state.allImages = mergedImages;
      state.selectedImages = new Set([...previousSelection].filter(id =>
        mergedImages.some(img => img.id === id)
      ));

      hideScanOverlay();
      applyFilters();
      updateSelectionUI();
      showToast(`Found ${state.allImages.length} images`, 'success');

      // Update both caches with fresh data
      state.tabCache.set(tabId, {
        url: tabUrl,
        images: state.allImages,
        selectedImages: new Set(state.selectedImages)
      });
      saveTabImageCache(tabId, tabUrl, state.allImages);

      // Run analysis phase silently
      if (state.currentTabId === tabId) {
        await processImageExtras(state.allImages);
      }
    } else {
      hideScanOverlay();
      if (state.allImages.length === 0) {
        showEmpty();
      }
    }
  } catch (error) {
    state.isScanning = false;
    if (state.scanAborted) { state.isFetching = false; return; }
    console.warn('Rescan with progress failed:', error);
    hideScanOverlay();
  }
  state.isFetching = false;
}

export async function fetchImages(): Promise<void> {
  // Prevent concurrent scans — if already fetching, skip this call
  if (state.isFetching) return;
  state.isFetching = true;
  state.isScanning = true;
  state.scanDiscoveredCount = 0;
  state.scanDiscoveredImages = [];

  // Show loading overlay immediately before any async work
  // to prevent stale content from being visible
  state.selectedImages.clear();
  state.allImages = [];
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
      searchAllFrames: state.appSettings.searchAllFrames || false,
      liveMonitoring: state.appSettings.liveMonitoring !== false
    });

    state.isScanning = false;

    // If the user cancelled the scan while we were waiting, abort silently.
    if (state.scanAborted) {
      state.isFetching = false;
      return;
    }

    if (response && response.success && response.images) {
      // Use the final complete result from GET_IMAGES as the authoritative list
      const responseImages: ImageItem[] = response.images.map((img: ImageItem) => ({
        ...img,
        id: img.id || generateId(img.url),
        tabTitle: img.tabTitle || currentTabTitle,
        tabIndex: img.tabIndex ?? currentTabIndex,
        isCurrentTab: !img.tabTitle,
        colors: undefined,
        phash: null
      }));

      // Merge images discovered by live monitoring during the scan that
      // were not included in the final GET_IMAGES result. This handles
      // pages where images are loaded dynamically after extractImages()
      // has already finished scanning the DOM.
      const responseUrls = new Set(responseImages.map(img => img.url));
      const extraDiscovered: ImageItem[] = state.scanDiscoveredImages
        .filter(img => !responseUrls.has(img.url))
        .map(img => ({
          ...img,
          id: img.id || generateId(img.url),
          tabTitle: img.tabTitle || currentTabTitle,
          tabIndex: img.tabIndex ?? currentTabIndex,
          isCurrentTab: !img.tabTitle,
          colors: undefined,
          phash: null
        }));
      state.allImages = [...responseImages, ...extraDiscovered];

      // Hide scan overlay and re-enable toolbar buttons
      hideLoading();

      // Render the final complete image list
      applyFilters();

      // Notify the user how many images were found
      showToast(`Found ${state.allImages.length} images`, 'success');

      // Persist to session storage so reopening the panel restores instantly
      if (state.currentTabId != null) {
        const currentTab = await chrome.tabs.query({ active: true, currentWindow: true })
          .then(t => t[0])
          .catch(() => null);
        const currentUrl = currentTab?.url || '';
        state.tabCache.set(state.currentTabId, {
          url: currentUrl,
          images: state.allImages,
          selectedImages: new Set(state.selectedImages)
        });
        saveTabImageCache(state.currentTabId, currentUrl, state.allImages);
      }

      // Continue with analysis phase silently in the background
      await processImageExtras(state.allImages);
    } else {
      hideLoading();
      showEmpty();
    }
  } catch (error) {
    state.isScanning = false;
    if (state.scanAborted) { state.isFetching = false; return; }
    console.error('Fetch images error:', error);
    hideLoading();
    const msg = error instanceof Error ? error.message : String(error);
    showError('FETCH_ERROR', msg, 'Refresh the page and try again');
  }
  state.isFetching = false;
}

export async function fetchImageDataUrl(imageUrl: string): Promise<string | null> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.FETCH_IMAGE_DATA,
      url: imageUrl
    });
    if (response && response.success) return response.dataUrl;
  } catch {
    // Background fetch failed, ignore
  }
  return null;
}

export async function processImageExtras(images: ImageItem[]): Promise<void> {
  const metaPromises: Array<Promise<unknown>> = [];
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
        }).catch(() => { /* ignore */ })
      );
    }

    // For images missing dimensions, load them in the background to get
    // naturalWidth/naturalHeight. This handles cases where the content
    // script captured the image before it finished loading.
    const hasWidth = img.naturalWidth || img.displayWidth;
    const hasHeight = img.naturalHeight || img.displayHeight;
    if (!hasWidth || !hasHeight) {
      metaPromises.push(
        new Promise<void>((resolve) => {
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
          probe.onerror = () => resolve();
          // Timeout after 8 seconds to avoid blocking
          setTimeout(resolve, 8000);
          probe.src = img.url;
        })
      );
    }
  });

  const needsPHash = state.appSettings.enableSimilarDetection !== false;
  const needsColors = state.appSettings.enableColorExtraction !== false;

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

  for (let i = 0; i < imagesToProcess.length; i += batchSize) {
    const batch = imagesToProcess.slice(i, i + batchSize);
    const batchPromises = batch.map(async (img) => {
      const dataUrl = await fetchImageDataUrl(img.url);
      if (!dataUrl) return;

      const extraPromises: Array<Promise<unknown>> = [];
      if (needsPHash && !img.phash) {
        extraPromises.push(
          calculatePHash(dataUrl).then(hash => { img.phash = hash; }).catch(() => { /* ignore */ })
        );
      }
      if (needsColors && !img.colors) {
        extraPromises.push(
          extractColorsFromUrl(dataUrl, 10).then(colors => { img.colors = colors; }).catch(() => { /* ignore */ })
        );
      }
      await Promise.allSettled(extraPromises);
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
export function patchCardExtras(images: ImageItem[]): void {
  if (!elements.imageGrid) return;
  const colorExtractionEnabled = state.appSettings.enableColorExtraction !== false;

  images.forEach(img => {
    const card = elements.imageGrid!.querySelector(`.image-card[data-id="${img.id}"]`);
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
