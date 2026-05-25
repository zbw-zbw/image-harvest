// Tab lifecycle management: loadCurrentTab, handleTabChange, handleTabUpdated
// Extracted from init.ts to reduce complexity in the most bug-prone file.

import { MESSAGE_TYPES, TIMING } from '../shared/constants';
import { isRestrictedUrl } from '../shared/utils';
import { clearTabImageCache, getTabImageCache, saveTabImageCache } from '../shared/storage';
import { elements, state, store } from './state';
import { fetchImages, processImageExtras } from './scan';
import { applyFilters } from './filter';
import { updateSelectionUI } from './actions';
import { renderImages } from './render';
import { checkNarrowMode, hideLoading, hideRestricted, showLoading, showRestricted } from './ui';
import { cancelDiscoveredToast } from './message';
import { generateId } from './utils';

// Module-level rescan debounce timer
let tabUpdatedTimer: ReturnType<typeof setTimeout> | null = null;

// Timestamp of the last tab switch — used by handleTabUpdated and
// handleMessage to suppress Chrome's spurious events that arrive shortly
// after a tab switch.
let lastTabSwitchTime = 0;

/** Check if we are still within the grace period after a tab switch. */
export function isWithinTabSwitchGrace(): boolean {
  return Date.now() - lastTabSwitchTime < TIMING.TAB_SWITCH_GRACE_MS;
}

export async function loadCurrentTab(forceRescan = false, targetTabId?: number): Promise<void> {
  let activeTab: chrome.tabs.Tab | undefined;
  try {
    if (targetTabId != null) {
      activeTab = await chrome.tabs.get(targetTabId);
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tab;
    }
    if (!activeTab || isRestrictedUrl(activeTab.url)) {
      state.currentTabId = null;
      hideLoading();
      showRestricted();
      return;
    }
  } catch (error) {
    console.warn('Failed to query active tab:', error);
    state.currentTabId = null;
    hideLoading();
    showRestricted();
    return;
  }

  const tabId = activeTab.id!;
  const tabUrl = activeTab.url || '';

  // Guard: if another tab switch happened while we were awaiting
  // chrome.tabs.get / query, abort so we don't overwrite the new tab's
  // state (e.g. calling hideRestricted() would undo showRestricted()).
  if (targetTabId != null && state.currentTabId !== targetTabId) return;

  state.currentTabId = tabId;

  // Notify background that the side panel is open on this tab
  if (!state.isPopupMode) {
    chrome.runtime
      .sendMessage({
        type: MESSAGE_TYPES.SIDE_PANEL_OPENED,
        tabId,
      })
      .catch(() => {
        /* ignore */
      });
  }

  // Normal page — make sure the main UI is visible
  hideRestricted();

  // Check in-memory per-tab cache first (fastest — same sidepanel session)
  if (!forceRescan && state.tabCache.has(tabId)) {
    const cached = state.tabCache.get(tabId)!;
    if (cached.url === tabUrl) {
      if (cached.filteredImages && cached.filteredImages.length > 0) {
        state.filteredImages = [...cached.filteredImages];
        state.lastRenderedFilteredIds = cached.lastRenderedFilteredIds ?? null;
      }
      state.allImages = [...cached.images];
      state.selectedImages = new Set(cached.selectedImages);
      hideLoading();
      if (!cached.filteredImages || cached.filteredImages.length === 0) {
        applyFilters();
      } else if (!state.isInitialized) {
        state.lastRenderedFilteredIds = null;
        renderImages({ skipScrollReset: true });
      } else {
      }
      updateSelectionUI();
      return;
    } else {
    }
  }

  // Check session storage cache (survives popup/sidepanel close-reopen)
  if (!forceRescan) {
    const sessionCached = await getTabImageCache(tabId, tabUrl);
    // Guard: abort if a tab switch happened during the async storage read.
    if (targetTabId != null && state.currentTabId !== targetTabId) return;
    if (sessionCached && sessionCached.images && sessionCached.images.length > 0) {
      state.allImages = sessionCached.images.map((img) => ({
        ...img,
        id: img.id || generateId(img.url),
        colors: undefined,
        phash: null,
      }));
      state.selectedImages = new Set();

      // Apply filters to compute filteredImages for this restored data
      hideLoading();
      applyFilters();
      updateSelectionUI();

      // Write into the in-memory tabCache (including filteredImages) so
      // subsequent tab switches hit the fast path and skip applyFilters().
      state.tabCache.set(tabId, {
        url: tabUrl,
        images: [...state.allImages],
        selectedImages: new Set(),
        filteredImages: [...state.filteredImages],
        lastRenderedFilteredIds: state.lastRenderedFilteredIds,
      });

      // Re-derive extras (file size, dimensions, colors, pHash) that are
      // not persisted in the session-storage cache.
      processImageExtras(state.allImages);
      return;
    } else {
    }
  }

  // No cache available — full scan with loading UI.
  if (targetTabId != null && state.currentTabId !== targetTabId) return;
  await fetchImages(tabId);

  // Establish a named port connection to the content script
  try {
    const port = chrome.tabs.connect(tabId, { name: 'image-harvest-ui' });
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        // Content script not ready or tab was closed — silently ignore
      }
    });
  } catch {
    // Ignore connection errors for restricted pages
  }
}

export async function handleTabChange(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
  if (!chrome.runtime?.id) return;
  const newTabId = activeInfo.tabId;
  // Save current tab state to cache before switching
  if (state.currentTabId != null && state.currentTabId !== newTabId) {
    const cachedUrl = state.tabCache.get(state.currentTabId)?.url || '';

    const MAX_TAB_CACHE = 10;
    if (state.tabCache.size >= MAX_TAB_CACHE && !state.tabCache.has(state.currentTabId)) {
      const oldest = state.tabCache.keys().next().value;
      if (oldest !== undefined) state.tabCache.delete(oldest);
    }

    state.tabCache.set(state.currentTabId, {
      url: cachedUrl,
      images: [...state.allImages],
      selectedImages: new Set(state.selectedImages),
      filteredImages: [...state.filteredImages],
      lastRenderedFilteredIds: state.lastRenderedFilteredIds,
      similarGroups: [...state.similarGroups],
    });
    if (cachedUrl) {
      saveTabImageCache(state.currentTabId, cachedUrl, state.allImages);
    }
  }

  // Cancel any in-progress silent rescan or fetch so it won't update UI
  state.isFetching = false;
  state.isSilentScanning = false;
  state.isScanning = false;

  // Cancel any pending handleTabUpdated rescan timer
  if (tabUpdatedTimer) {
    clearTimeout(tabUpdatedTimer);
    tabUpdatedTimer = null;
  }

  // Clear stale toasts from the previous tab
  state.toasts = [];

  // Cancel any pending "new images discovered" debounce timer
  cancelDiscoveredToast();

  // Mark that this visibility change is caused by a tab switch
  state.isTabSwitching = true;
  lastTabSwitchTime = Date.now();

  state.currentTabId = newTabId;

  // Check in-memory cache synchronously BEFORE any await
  const cached = state.tabCache.get(newTabId);

  // If the cache looks like a restricted tab, show restricted state synchronously.
  if (cached && !cached.url && cached.images.length === 0) {
    state.tabCache.delete(newTabId);
    showRestricted();
    state.isTabSwitching = false;
    return;
  }

  // Fast path: cache exists — restore state synchronously BEFORE any await
  // so Preact re-renders with the new tab's data in the same paint frame.
  // URL verification happens after; if it fails we roll back.
  if (cached) {
    try {
      // Restore cached state immediately (no await yet) to eliminate flash
      const cachedFilteredIds = cached.lastRenderedFilteredIds ?? null;
      const isSameFilteredSet =
        cachedFilteredIds != null && cachedFilteredIds === state.lastRenderedFilteredIds;

      const patch: Record<string, unknown> = {
        allImages: [...cached.images],
        selectedImages: new Set(cached.selectedImages),
        similarGroups: (cached.similarGroups || []).map((g) => [...g]),
      };
      if (!isSameFilteredSet && cached.filteredImages && cached.filteredImages.length > 0) {
        patch.filteredImages = [...cached.filteredImages];
        patch.lastRenderedFilteredIds = cachedFilteredIds;
      }
      store.setMany(patch as Partial<typeof state>);

      // Ensure the normal-page UI is visible
      hideLoading();
      const stateScreensMount = document.querySelector<HTMLElement>(
        '[data-preact-mount="state-screens"]'
      );
      if (stateScreensMount) stateScreensMount.style.display = 'none';
      state.uiScreen = 'images';
      document.querySelectorAll('.toolbar, .status-bar').forEach((el) => {
        el.classList.remove('hidden');
      });

      const gridWrapper = document.querySelector<HTMLElement>('.image-grid-wrapper');
      if (gridWrapper) {
        gridWrapper.classList.remove('hidden');
        gridWrapper.style.removeProperty('display');
        gridWrapper.style.visibility = '';
      }
      if (elements.imageGrid) elements.imageGrid.classList.remove('hidden');

      if (!isSameFilteredSet && (!cached.filteredImages || cached.filteredImages.length === 0)) {
        applyFilters();
      }

      if (elements.foundCount) {
        elements.foundCount.textContent = String(state.filteredImages.length);
      }
      updateSelectionUI();
      checkNarrowMode();

      // Now verify the tab URL asynchronously — roll back if stale
      let newTab: chrome.tabs.Tab | undefined;
      try {
        newTab = await chrome.tabs.get(newTabId);
      } catch {
        // Tab may have been closed
      }
      if (state.currentTabId !== newTabId) return;

      if (!newTab || isRestrictedUrl(newTab.url)) {
        // Roll back: tab is restricted
        state.tabCache.delete(newTabId);
        state.currentTabId = null;
        state.allImages = [];
        state.selectedImages.clear();
        state.filteredImages = [];
        if (elements.imageGrid) elements.imageGrid.innerHTML = '';
        showRestricted();
        return;
      }
      if (cached.url && cached.url !== newTab.url) {
        // Roll back: URL changed — need a full rescan
        state.tabCache.delete(newTabId);
        state.allImages = [];
        state.selectedImages.clear();
        state.filteredImages = [];
        if (elements.imageGrid) elements.imageGrid.innerHTML = '';
        const gw = document.querySelector<HTMLElement>('.image-grid-wrapper');
        if (gw) {
          gw.classList.add('hidden');
          gw.style.display = 'none';
        }
        showLoading();
        await loadCurrentTab(true, newTabId);
        return;
      }
      if (!cached.url && newTab.url) {
        cached.url = newTab.url;
      }

      if (!state.isPopupMode) {
        chrome.runtime
          .sendMessage({
            type: MESSAGE_TYPES.SIDE_PANEL_OPENED,
            tabId: newTabId,
          })
          .catch(() => {
            /* ignore */
          });
      }
    } finally {
      state.isTabSwitching = false;
    }
    return;
  }

  // No cache — hide the grid and check if the target tab is restricted
  const gridWrapper = document.querySelector('.image-grid-wrapper') as HTMLElement | null;
  if (gridWrapper) {
    gridWrapper.classList.add('hidden');
    gridWrapper.style.display = 'none';
  }
  document.querySelectorAll('.toolbar, .status-bar').forEach((el) => {
    el.classList.add('hidden');
  });
  try {
    let newTab: chrome.tabs.Tab | undefined;
    try {
      newTab = await chrome.tabs.get(newTabId);
    } catch {
      // Tab may have been closed already
    }

    if (state.currentTabId !== newTabId) return;

    if (!newTab || isRestrictedUrl(newTab.url)) {
      state.currentTabId = null;
      showRestricted();
      return;
    }

    // Normal page — show loading skeleton and do a full scan.
    state.similarGroups = [];
    document.querySelectorAll('.toolbar, .status-bar').forEach((el) => {
      el.classList.remove('hidden');
    });
    showLoading();

    if (!state.isPopupMode) {
      chrome.runtime
        .sendMessage({
          type: MESSAGE_TYPES.SIDE_PANEL_OPENED,
          tabId: newTabId,
        })
        .catch(() => {
          /* ignore */
        });
    }

    await loadCurrentTab(false, newTabId);
  } finally {
    state.isTabSwitching = false;
  }
}

export function handleTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
): void {
  if (!chrome.runtime?.id) return;
  if (!changeInfo.url && changeInfo.status !== 'complete') return;

  if (state.isTabSwitching) return;

  if (Date.now() - lastTabSwitchTime < TIMING.TAB_SWITCH_GRACE_MS) return;

  if (tabId !== state.currentTabId) {
    if (state.currentTabId !== null || !tab?.active) return;
  }

  const newUrl = tab?.url || changeInfo.url || '';

  if (isRestrictedUrl(newUrl)) {
    if (state.currentTabId !== null) {
      if (tabUpdatedTimer) clearTimeout(tabUpdatedTimer);
      state.tabCache.delete(tabId);
      clearTabImageCache(tabId);
      state.allImages = [];
      state.selectedImages.clear();
      state.filteredImages = [];
      if (elements.imageGrid) elements.imageGrid.innerHTML = '';
      state.currentTabId = null;
      showRestricted();
    }
    return;
  }

  const cachedEntry = state.tabCache.get(tabId);
  if (cachedEntry && cachedEntry.url === newUrl) {
    return;
  }

  if (state.currentTabId === null) {
    state.currentTabId = tabId;
    hideRestricted();
    showLoading();
  }

  if (!state.isInitialized) return;

  if (tabUpdatedTimer) clearTimeout(tabUpdatedTimer);
  if (!state.isFetching) showLoading();
  tabUpdatedTimer = setTimeout(() => {
    if (state.isFetching) return;
    state.tabCache.delete(tabId);
    clearTabImageCache(tabId);
    state.allImages = [];
    state.selectedImages.clear();
    state.filteredImages = [];
    if (elements.imageGrid) elements.imageGrid.innerHTML = '';
    loadCurrentTab(true, tabId).catch(() => {});
  }, TIMING.TAB_UPDATED_DEBOUNCE_MS);
}
