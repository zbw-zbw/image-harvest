// Scan overlay control + image fetching/processing

import { MESSAGE_TYPES } from '../shared/constants';
import { extractColorsFromUrl } from '../shared/color-extract';
import { t } from '../shared/i18n';
import { calculatePHash } from '../shared/phash';
import type { ImageItem } from '../shared/types';
import { getFileFormat } from '../shared/utils';
import { track } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';
import { updateSelectionUI } from './actions';
import { applyFilters, renderColorSwatches } from './filter';
import { isWithinTabSwitchGrace } from './init';
import { detectSimilarImages } from './pro-features';
import { saveTabImageCache } from '../shared/storage';
import { elements, state } from './state';
import { hideLoading, showEmpty, showError, showLoading, showToast } from './ui';
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
    // Use filteredImages count so the toast matches the bottom status bar.
    showToast(
      `${t('toast_scan_cancelled')} · ${t('status_found_images', { count: state.filteredImages.length })}`,
      'info'
    );
  } else {
    showEmpty();
    showToast(t('toast_scan_cancelled'), 'info');
  }
}

export function showScanOverlay(current: number, total: number): void {
  // <ScanProgressOverlay> reads the entire scanProgress object — flipping
  // visible: true is enough to show the overlay. Title / indeterminate are
  // set by the caller (showLoading / rescanWithProgress) before this call.
  state.scanProgress = {
    ...state.scanProgress,
    visible: true,
    current,
    total,
  };
  // Disable toolbar and status bar during scan (still purely DOM CSS state).
  document
    .querySelectorAll('.toolbar, .status-bar')
    .forEach((el) => el.classList.add('scanning-disabled'));
}

export function hideScanOverlay(): void {
  // Reset to non-visible + clear indeterminate flag so the next scan starts
  // from a known state (next showLoading will set indeterminate again).
  state.scanProgress = {
    ...state.scanProgress,
    visible: false,
    indeterminate: false,
    currentUrl: '',
  };
  document
    .querySelectorAll('.toolbar, .status-bar')
    .forEach((el) => el.classList.remove('scanning-disabled'));
}

export function updateScanProgress(current: number, total: number, currentUrl = ''): void {
  // Receiving a real total flips us out of indeterminate mode (the percent
  // bar should appear). The component re-derives the percent string itself.
  state.scanProgress = {
    ...state.scanProgress,
    current,
    total,
    currentUrl,
    indeterminate: total === 0 ? state.scanProgress.indeterminate : false,
  };
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
    // Use chrome.tabs.get with the explicit tabId — never query the active
    // tab, which may differ during rapid tab switches in the shared sidepanel.
    let targetTab: chrome.tabs.Tab | undefined;
    try {
      targetTab = await chrome.tabs.get(tabId);
    } catch {
      // Tab may have been closed
    }
    if (!targetTab || state.currentTabId !== tabId) {
      state.isSilentScanning = false;
      state.isFetching = false;
      return;
    }

    const currentTabTitle = targetTab.title || 'Current Tab';
    const currentTabIndex = targetTab.index ?? 0;

    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_IMAGES,
      tabId,
      searchAllFrames: state.appSettings.searchAllFrames || false,
      liveMonitoring: state.appSettings.liveMonitoring !== false,
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
        phash: null,
      }));

      // Compare against the pre-rescan snapshot
      const preRescanUrls = new Set(preRescanImages.map((img) => img.url));
      const freshUrls = new Set(freshImages.map((img) => img.url));
      const hasChanges =
        freshImages.length !== preRescanImages.length ||
        freshImages.some((img) => !preRescanUrls.has(img.url)) ||
        preRescanImages.some((img) => !freshUrls.has(img.url));

      // Double-check tab hasn't changed before updating UI
      if (state.currentTabId !== tabId) {
        state.isSilentScanning = false;
        state.isFetching = false;
        return;
      }

      // Always replace allImages with the authoritative fresh result
      const previousSelection = new Set(state.selectedImages);
      state.allImages = freshImages;
      state.selectedImages = new Set(
        [...previousSelection].filter((id) => freshImages.some((img) => img.id === id))
      );
      applyFilters();
      updateSelectionUI();

      if (hasChanges) {
        const added = freshImages.filter((img) => !preRescanUrls.has(img.url)).length;
        const removed = [...preRescanUrls].filter((url) => !freshUrls.has(url)).length;
        const parts: string[] = [];
        if (added > 0) parts.push(t('toast_n_new', { count: added }));
        if (removed > 0) parts.push(t('toast_n_removed', { count: removed }));
        showToast(
          `${t('scan_updated')}: ${parts.join(', ')} · ${t('status_total_images', { count: state.allImages.length })}`,
          'info'
        );
      }

      // Update both caches with fresh data
      state.tabCache.set(tabId, {
        url: tabUrl,
        images: state.allImages,
        selectedImages: new Set(state.selectedImages),
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

  // Show scan overlay on top of the existing image grid (don't replace with skeletons).
  // Title flips to "Updating..." (vs. the default "Scanning...") and we go
  // back into indeterminate mode because we don't know the total yet.
  state.scanProgress = {
    ...state.scanProgress,
    title: t('scan_updating'),
    indeterminate: true,
  };
  showScanOverlay(0, 0);

  try {
    // Use chrome.tabs.get with the explicit tabId — never query the active
    // tab, which may differ during rapid tab switches in the shared sidepanel.
    let targetTab: chrome.tabs.Tab | undefined;
    try {
      targetTab = await chrome.tabs.get(tabId);
    } catch {
      // Tab may have been closed
    }
    if (!targetTab || state.currentTabId !== tabId) {
      state.isScanning = false;
      state.isFetching = false;
      hideScanOverlay();
      return;
    }

    const currentTabTitle = targetTab.title || 'Current Tab';
    const currentTabIndex = targetTab.index ?? 0;

    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_IMAGES,
      tabId,
      searchAllFrames: state.appSettings.searchAllFrames || false,
      liveMonitoring: state.appSettings.liveMonitoring !== false,
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
        phash: null,
      }));

      // Merge images discovered by live monitoring during the scan that
      // were not included in the final GET_IMAGES result.
      const freshUrls = new Set(freshImages.map((img) => img.url));
      const extraDiscovered: ImageItem[] = state.scanDiscoveredImages
        .filter((img) => !freshUrls.has(img.url))
        .map((img) => ({
          ...img,
          id: img.id || generateId(img.url),
          tabTitle: img.tabTitle || currentTabTitle,
          tabIndex: img.tabIndex ?? currentTabIndex,
          isCurrentTab: !img.tabTitle,
          colors: undefined,
          phash: null,
        }));
      const mergedImages = [...freshImages, ...extraDiscovered];

      const previousSelection = new Set(state.selectedImages);
      state.allImages = mergedImages;
      state.selectedImages = new Set(
        [...previousSelection].filter((id) => mergedImages.some((img) => img.id === id))
      );

      hideScanOverlay();
      applyFilters();
      updateSelectionUI();
      // Use filteredImages count so the toast matches the bottom status bar.
      showToast(t('status_found_images', { count: state.filteredImages.length }), 'success');

      // Update both caches with fresh data
      state.tabCache.set(tabId, {
        url: tabUrl,
        images: state.allImages,
        selectedImages: new Set(state.selectedImages),
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
    if (state.scanAborted) {
      state.isFetching = false;
      return;
    }
    console.warn('Rescan with progress failed:', error);
    hideScanOverlay();
  }
  state.isFetching = false;
}

export async function fetchImages(targetTabId?: number): Promise<void> {
  // Prevent concurrent scans — if already fetching, skip this call
  if (state.isFetching) return;
  state.isFetching = true;
  state.isScanning = true;
  state.scanDiscoveredCount = 0;
  state.scanDiscoveredImages = [];

  // Lock the tab id at scan start so it stays consistent across awaits.
  // The shared sidepanel instance may receive tab-switch events mid-scan;
  // using a snapshot avoids cross-tab data contamination.
  const scanTabId = targetTabId ?? state.currentTabId;

  // Show loading overlay immediately before any async work
  // to prevent stale content from being visible
  state.selectedImages.clear();
  state.allImages = [];
  showLoading();

  // Telemetry: scan_triggered fires at intent (not completion) so the
  // funnel can distinguish "user wanted to scan" from "scan returned N".
  // The matching scan_completed / images_shown are emitted in the success
  // branch below. Mode tells us which surface user is on.
  const _scanStartedAt = Date.now();
  void track(EVENTS.SCAN_TRIGGERED, {
    mode: state.isPopupMode ? 'popup' : 'sidepanel',
  });

  try {
    // Get tab info using the locked scanTabId — never query the active tab,
    // which may differ during rapid tab switches in the shared sidepanel.
    let tabInfo: chrome.tabs.Tab | undefined;
    if (scanTabId != null) {
      try {
        tabInfo = await chrome.tabs.get(scanTabId);
      } catch {
        // Tab may have been closed — abort the scan
        state.isFetching = false;
        state.isScanning = false;
        hideLoading();
        showEmpty();
        return;
      }
    }
    if (!tabInfo) {
      // No valid tab — abort
      state.isFetching = false;
      state.isScanning = false;
      hideLoading();
      showEmpty();
      return;
    }
    const currentTabTitle = tabInfo.title || 'Current Tab';
    const currentTabIndex = tabInfo.index ?? 0;
    const resolvedTabId = tabInfo.id ?? scanTabId;

    // While waiting for GET_IMAGES, IMAGES_DISCOVERED messages from content.js
    // will progressively populate allImages and update the scan overlay
    let response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_IMAGES,
      tabId: resolvedTabId,
      searchAllFrames: state.appSettings.searchAllFrames || false,
      liveMonitoring: state.appSettings.liveMonitoring !== false,
    });

    // First-open race condition: after extension reload the content script
    // may not be injected yet, or the page DOM may not have rendered images.
    // Retry with back-off (up to 3 attempts, ~3 s total) covering both
    // "response failed" (content script not ready) and "0 images" (SPA
    // hasn't rendered yet) scenarios.
    const retryDelays = [500, 1000, 1500];
    let retryCount = 0;
    for (const delay of retryDelays) {
      // Stop retrying once we have a successful response WITH images
      const hasImages = response?.success && response.images && response.images.length > 0;
      if (hasImages || state.scanAborted) break;

      retryCount++;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      if (state.scanAborted) break;

      // Abort if the user switched to a different tab during retry
      if (state.currentTabId !== scanTabId) break;

      try {
        response = await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.GET_IMAGES,
          tabId: resolvedTabId,
          searchAllFrames: state.appSettings.searchAllFrames || false,
          liveMonitoring: state.appSettings.liveMonitoring !== false,
        });
      } catch {
        // sendMessage can throw if background SW is still restarting
        response = null;
      }
    }

    state.isScanning = false;

    // If the user cancelled the scan while we were waiting, abort silently.
    if (state.scanAborted) {
      state.isFetching = false;
      return;
    }

    // Discard results if the user switched to a different tab during scan
    if (state.currentTabId !== scanTabId) {
      state.isFetching = false;
      hideLoading();
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
        phash: null,
      }));

      // Merge images discovered by live monitoring during the scan that
      // were not included in the final GET_IMAGES result. This handles
      // pages where images are loaded dynamically after extractImages()
      // has already finished scanning the DOM.
      const responseUrls = new Set(responseImages.map((img) => img.url));
      const extraDiscovered: ImageItem[] = state.scanDiscoveredImages
        .filter((img) => !responseUrls.has(img.url))
        .map((img) => ({
          ...img,
          id: img.id || generateId(img.url),
          tabTitle: img.tabTitle || currentTabTitle,
          tabIndex: img.tabIndex ?? currentTabIndex,
          isCurrentTab: !img.tabTitle,
          colors: undefined,
          phash: null,
        }));
      state.allImages = [...responseImages, ...extraDiscovered];

      // Hide scan overlay and re-enable toolbar buttons
      hideLoading();

      // Render the final complete image list
      applyFilters();

      // Notify the user how many images were found (use filteredImages count
      // so the toast matches the bottom status bar).
      showToast(t('status_found_images', { count: state.filteredImages.length }), 'success');

      // Telemetry: pair with scan_triggered above. images_shown is the
      // immediate render signal; scan_completed carries duration so we
      // can spot regression in scan latency over time.
      void track(EVENTS.SCAN_COMPLETED, {
        count: state.allImages.length,
        durationMs: Date.now() - _scanStartedAt,
      });
      void track(EVENTS.IMAGES_SHOWN, { count: state.allImages.length });

      // Persist to session storage using the locked scanTabId to avoid
      // writing into the wrong tab's cache slot after a mid-scan switch.
      if (scanTabId != null) {
        const tabUrl = tabInfo?.url || '';
        state.tabCache.set(scanTabId, {
          url: tabUrl,
          images: state.allImages,
          selectedImages: new Set(state.selectedImages),
        });
        saveTabImageCache(scanTabId, tabUrl, state.allImages);
      }

      // Continue with analysis phase silently in the background
      if (state.currentTabId === scanTabId) {
        await processImageExtras(state.allImages);
      }
    } else {
      hideLoading();
      showEmpty();
    }
  } catch (error) {
    state.isScanning = false;
    if (state.scanAborted) {
      state.isFetching = false;
      return;
    }
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
      url: imageUrl,
    });
    if (response && response.success) return response.dataUrl;
  } catch {
    // Background fetch failed, ignore
  }
  return null;
}

export async function processImageExtras(images: ImageItem[]): Promise<void> {
  // Snapshot tabId at the start so we can bail if the user switches tabs
  // during the long-running async batch processing below.
  const extrasTabId = state.currentTabId;

  const metaPromises: Array<Promise<unknown>> = [];
  images.forEach((img) => {
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
        fetchImageMeta(img.url)
          .then((meta) => {
            if (meta.size && !img.estimatedSize) img.estimatedSize = meta.size;
            if (img.format === 'unknown' && meta.contentType) {
              const detected = getFileFormat(img.url, meta.contentType);
              if (detected !== 'unknown') img.format = detected;
            }
          })
          .catch(() => {
            /* ignore */
          })
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

  // Process images in batches with scan overlay progress
  const batchSize = 5;
  const imagesToProcess = images.filter((img) => !img.phash || !img.colors);

  for (let i = 0; i < imagesToProcess.length; i += batchSize) {
    // Abort if user switched tabs during processing — continuing would
    // mutate stale image objects and trigger detectSimilarImages /
    // patchCardExtras for the wrong tab, causing count leaks and flicker.
    if (state.currentTabId !== extrasTabId) return;

    const batch = imagesToProcess.slice(i, i + batchSize);
    const batchPromises = batch.map(async (img) => {
      const dataUrl = await fetchImageDataUrl(img.url);
      if (!dataUrl) return;

      const extraPromises: Array<Promise<unknown>> = [];
      if (!img.phash) {
        extraPromises.push(
          calculatePHash(dataUrl)
            .then((hash) => {
              img.phash = hash;
            })
            .catch(() => {
              /* ignore */
            })
        );
      }
      if (!img.colors) {
        extraPromises.push(
          extractColorsFromUrl(dataUrl, 10)
            .then((colors) => {
              img.colors = colors;
            })
            .catch(() => {
              /* ignore */
            })
        );
      }
      await Promise.allSettled(extraPromises);
    });

    await Promise.allSettled([...batchPromises, ...metaPromises.splice(0, batchSize)]);

    // Re-check after await — tab may have changed during batch processing
    if (state.currentTabId !== extrasTabId) return;

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
 *
 * For tags managed by Preact (filesize, dims), we no longer create DOM nodes
 * here — that caused duplicate tags when Preact re-rendered later. Instead we
 * trigger a filteredImages reference update so Preact's ImageCard picks up the
 * already-mutated img properties naturally. Only format text-updates and color
 * bars (which are not yet fully Preact-managed) are patched imperatively.
 */
export function patchCardExtras(images: ImageItem[]): void {
  if (!elements.imageGrid) return;
  let needsRerender = false;

  images.forEach((img) => {
    const card = elements.imageGrid!.querySelector(`.image-card[data-id="${img.id}"]`);
    if (!card) return;

    // Check if Preact-managed data changed (filesize or dims now available)
    const w = img.naturalWidth || img.displayWidth || 0;
    const h = img.naturalHeight || img.displayHeight || 0;
    const tagsContainer = card.querySelector('.card-tags');

    if (tagsContainer) {
      // If dims data is now available but no dims tag rendered yet → needs re-render
      if (w && h && !tagsContainer.querySelector('.card-tag.dims')) {
        needsRerender = true;
      }
      // If filesize data is now available but no filesize tag rendered yet → needs re-render
      if (img.estimatedSize && !tagsContainer.querySelector('.card-tag.filesize')) {
        needsRerender = true;
      }

      // Patch format tag text if it was unknown and now resolved (safe: only
      // updates textContent of an existing Preact-managed node, no new nodes)
      const formatTag = tagsContainer.querySelector('.card-tag.format');
      if (formatTag && img.format && img.format !== 'unknown') {
        formatTag.textContent = img.format.toUpperCase();
      }
    }

    // Color bar is now Preact-managed (ColorBar component in ImageCard).
    // If colors arrived but the card still shows the empty/transparent bar,
    // flag for a Preact re-render instead of imperatively replacing the DOM.
    if (img.colors && img.colors.length > 0) {
      const colorsContainer = card.querySelector('.card-colors');
      if (colorsContainer && colorsContainer.querySelector('.card-color-bar-transparent')) {
        needsRerender = true;
      }
    }
  });

  // Trigger Preact re-render by bumping filteredImages reference so ImageCard
  // components pick up the newly-available estimatedSize / dimensions data.
  // Skip if a tab switch is in progress or recent — the new tab's fast path
  // will set filteredImages correctly; bumping the reference here would flash
  // stale data from the previous tab's processImageExtras.
  if (needsRerender && !state.isTabSwitching && !isWithinTabSwitchGrace()) {
    state.filteredImages = [...state.filteredImages];
  }
}
