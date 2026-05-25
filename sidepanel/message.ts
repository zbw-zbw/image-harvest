// Message handling from background script and keyboard shortcuts

import { MESSAGE_TYPES } from '../shared/constants';
import { t } from '../shared/i18n';
import type { ImageItem } from '../shared/types';
import {
  downloadSelectedAsZip,
  hideDownloadDropdown,
  removeAllHighlightsOnPage,
  selectAll,
} from './actions';
import { applyFilters } from './filter';
import { isWithinTabSwitchGrace } from './tab-lifecycle';
import { processImageExtras, updateScanProgress } from './scan';
import { renderImages } from './render';
import { applyProFeatureVisibility, closeAllFilterDropdowns, closeSettings } from './settings';
import { closeCollectionModal, closeDedupModal, closeMultiTabModal } from './pro-features';
import { elements, state } from './state';
import { hideProgress, showToast, updateFilterButtonLabels, updateProgress } from './ui';
import { generateId } from './utils';

// ============================================
// Debounced "new images discovered" toast
// ============================================
let discoveredToastCount = 0;
let discoveredToastTimer: ReturnType<typeof setTimeout> | null = null;
const DISCOVERED_TOAST_DEBOUNCE_MS = 1500;

export function showDiscoveredToastDebounced(addedCount: number): void {
  discoveredToastCount += addedCount;
  if (discoveredToastTimer) clearTimeout(discoveredToastTimer);
  discoveredToastTimer = setTimeout(() => {
    if (discoveredToastCount > 0) {
      showToast(t('toast_new_images_discovered', { count: discoveredToastCount }), 'info');
      discoveredToastCount = 0;
    }
    discoveredToastTimer = null;
  }, DISCOVERED_TOAST_DEBOUNCE_MS);
}

/**
 * Cancel any pending "new images discovered" debounce timer and reset the
 * accumulated count. Called during tab switches to prevent a stale toast
 * from the previous tab appearing on the new tab.
 */
export function cancelDiscoveredToast(): void {
  if (discoveredToastTimer) {
    clearTimeout(discoveredToastTimer);
    discoveredToastTimer = null;
  }
  discoveredToastCount = 0;
}

interface IncomingMessage {
  type?: string;
  fromTabId?: number;
  images?: ImageItem[];
  completed?: number;
  total?: number;
  current?: string;
  imageCount?: number;
  count?: number;
  error?: string;
  success?: boolean;
  tabCount?: number;
}

// ============================================
// Message Handling
// ============================================
export function handleMessage(message: IncomingMessage): void {
  if (!message || !message.type) return;

  switch (message.type) {
    case MESSAGE_TYPES.IMAGES_DISCOVERED:
      // Ignore messages from a different tab — when the user switches tabs,
      // the previous tab's content script live monitoring may still send
      // discoveries that should not pollute the current tab's image list.
      if (message.fromTabId != null && message.fromTabId !== state.currentTabId) {
        break;
      }

      // Ignore during tab switching — the new tab's loadCurrentTab will
      // handle image loading from cache or a fresh scan.
      if (state.isTabSwitching) {
        break;
      }

      // Grace period after a tab switch: isTabSwitching resets in the
      // finally block, but content script live monitoring or background
      // may still broadcast IMAGES_DISCOVERED shortly after. Suppress
      // these to prevent "new images discovered" toasts on cached tabs.
      if (isWithinTabSwitchGrace()) {
        break;
      }

      // During silent rescan, fetch-only, or multi-tab extraction, ignore
      // discoveries entirely — the final response is the authoritative result.
      if (
        state.isSilentScanning ||
        (state.isFetching && !state.isScanning) ||
        state.isMultiTabExtracting
      ) {
        break;
      }

      // During an active scan, buffer discovered images AND update the scan
      // overlay in real-time so the user sees incremental progress (count +
      // URL). Only render images into the grid up to the skeleton card limit
      // to avoid constant re-rendering flicker on image-heavy pages.
      if (state.isScanning && message.images) {
        const newImgs = message.images.map(
          (img) =>
            ({
              ...img,
              id: img.id || generateId(img.url),
              colors: undefined,
              phash: null,
            }) as ImageItem
        );

        const prevCount = state.allImages.length;
        let addedCount = 0;
        newImgs.forEach((ni) => {
          if (!state.allImages.find((img) => img.url === ni.url)) {
            state.allImages.push(ni);
            addedCount++;
          }
        });

        state.scanDiscoveredCount += message.images.length;
        state.scanDiscoveredImages.push(...message.images);

        if (addedCount > 0) {
          // Always update scan overlay with real-time progress
          const lastUrl = newImgs[newImgs.length - 1]?.url || '';
          const truncatedUrl = lastUrl.length > 60 ? lastUrl.substring(0, 57) + '...' : lastUrl;
          // updateScanProgress already pushes current/total into the store;
          // the "found N images" copy lives directly on scanProgress so the
          // <ScanProgressOverlay> can derive the right string.
          updateScanProgress(state.allImages.length, 0, truncatedUrl);
          // Override the overlay's text by stuffing a non-zero "fake total"
          // would be misleading; instead encode the discovery message in the
          // title so it stays distinct from "scanning for images...".
          state.scanProgress = {
            ...state.scanProgress,
            title: t('status_found_images', { count: state.allImages.length }),
          };

          // Always keep the bottom status bar count in sync
          if (elements.foundCount) {
            elements.foundCount.textContent = String(state.allImages.length);
          }

          // Only incrementally render while we haven't filled the skeleton
          // slots yet. After that, stop re-rendering to avoid flicker —
          // the final complete render happens when the scan finishes.
          if (prevCount < state.scanSkeletonLimit) {
            applyFilters();
          }
        }
        break;
      }

      if (message.images && state.isInitialized) {
        // Live monitoring (only after init completes and no scan in progress)
        const newImgs = message.images.map(
          (img) =>
            ({
              ...img,
              id: img.id || generateId(img.url),
              colors: undefined,
              phash: null,
            }) as ImageItem
        );
        let addedCount = 0;
        newImgs.forEach((ni) => {
          if (!state.allImages.find((img) => img.url === ni.url)) {
            state.allImages.push(ni);
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
      updateProgress(
        message.completed || 0,
        message.total || 0,
        message.current,
        message.imageCount
      );
      break;

    case MESSAGE_TYPES.DOWNLOAD_COMPLETE:
      hideProgress();
      showToast(t('toast_download_completed', { count: message.count ?? 0 }), 'success');
      break;

    case MESSAGE_TYPES.DOWNLOAD_ERROR:
      hideProgress();
      showToast(t('toast_download_failed') + (message.error ? ': ' + message.error : ''), 'error');
      break;

    case MESSAGE_TYPES.CLEAR_SELECTION:
      // User clicked overlay or pressed ESC on the page — clear selection in UI
      state.selectedImages.clear();
      renderImages();
      // updateSelectionUI is called via clearSelection downstream; keep parity
      // with original code by directly invoking renderImages + selection sync
      // (see actions.clearSelection).
      break;

    case MESSAGE_TYPES.LICENSE_STATUS_CHANGED:
      // License status changed (activation, deactivation, periodic check)
      applyProFeatureVisibility();
      break;

    case MESSAGE_TYPES.MULTI_TAB_EXTRACT_COMPLETE:
      hideProgress();
      if (message.success && message.images) {
        const newImages = message.images.map(
          (img) =>
            ({
              ...img,
              id: img.id || generateId(img.url),
              colors: undefined,
              phash: null,
            }) as ImageItem
        );

        newImages.forEach((newImg) => {
          if (!state.allImages.find((img) => img.url === newImg.url)) {
            state.allImages.push(newImg);
          }
        });

        state.currentGroupMode = 'tab';
        if (elements.groupMode) (elements.groupMode as HTMLSelectElement).value = 'tab';
        document.querySelectorAll<HTMLElement>('[data-group-filter]').forEach((o) => {
          o.classList.toggle('active', o.dataset.groupFilter === 'tab');
        });
        updateFilterButtonLabels();

        applyFilters();
        closeMultiTabModal();
        showToast(
          t('toast_extraction_success', { images: newImages.length, tabs: message.tabCount ?? 0 }),
          'success'
        );

        processImageExtras(newImages);
      } else {
        showToast(t('toast_extraction_failed'), 'error');
      }
      break;

    case MESSAGE_TYPES.MULTI_TAB_EXTRACT_ERROR:
      hideProgress();
      showToast(t('toast_multitab_failed') + (message.error ? ': ' + message.error : ''), 'error');
      break;
  }
}

// ============================================
// Keyboard Shortcuts
// ============================================
export function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    // Settings modal visibility is driven by store state — read it directly
    // instead of probing classList on a (now stale) cached ref.
    if (state.settingsModalState.open) {
      closeSettings();
      return;
    }
    // Modal visibility is now driven by store state — read it directly
    // instead of probing classList on cached (potentially stale) refs.
    if (state.dedupModalState.open) {
      closeDedupModal();
      return;
    }
    if (state.collectionModalState.open) {
      closeCollectionModal();
      return;
    }
    if (state.multitabModalState.open) {
      closeMultiTabModal();
      return;
    }
    hideDownloadDropdown();
    closeAllFilterDropdowns();
    // Only remove page highlights — preserve selection state and scroll
    // position. ESC is just exiting the page highlight view, not
    // deselecting images in the list.
    removeAllHighlightsOnPage();
    return;
  }

  // Don't handle shortcuts when typing in inputs
  const target = e.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
  )
    return;

  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    e.preventDefault();
    selectAll();
  }

  if (e.key === 'Enter' && state.selectedImages.size > 0) {
    e.preventDefault();
    downloadSelectedAsZip(null);
  }
}
