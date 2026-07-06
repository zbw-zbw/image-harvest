// Tab lifecycle management: loadCurrentTab, handleTabChange, handleTabUpdated
// Extracted from init.ts to reduce complexity in the most bug-prone file.

import { MESSAGE_TYPES, TIMING } from '../shared/constants';
import { isRestrictedUrl } from '../shared/utils';
import { clearTabImageCache, getTabImageCache, saveTabImageCache } from '../shared/storage';
import { loadAiTagsMap } from '../shared/ai-tags-store';
import { elements, state, store, evictOldestTabCache } from './state';
import { fetchImages, processImageExtras } from './scan';
import { applyFilters, refreshVisibility } from './filter';
import { updateSelectionUI } from './actions';
import { renderImages } from './render';
import { checkNarrowMode, hideLoading, hideRestricted, showLoading, showRestricted } from './ui';
import { cancelDiscoveredToast } from './message';
import { generateId } from './utils';
import {
  isReverseSearchTab,
  forgetReverseSearchTab,
  isOwnExtensionUrl,
  isIgnoredExtensionTab,
  markIgnoredExtensionTab,
  isWithinReverseSearchCloseGrace,
  isOpenedTab,
  isWithinOpenedTabCloseGrace,
} from './reverse-search-tabs';
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
      state.allImages = [...cached.images];
      state.selectedImages = new Set(cached.selectedImages);
      hideLoading();

      // When "show visible only" filter is active, cached visibility flags
      // may be stale (content script context can change between tab
      // switches). Re-check visibility from the content script and
      // re-apply filters so images aren't incorrectly hidden.
      if (state.activeFilters.showVisibleOnly) {
        void refreshVisibility().then(() => {
          applyFilters();
          updateSelectionUI();
        });
        return;
      }

      if (cached.filteredImages && cached.filteredImages.length > 0) {
        state.filteredImages = [...cached.filteredImages];
        state.lastRenderedFilteredIds = cached.lastRenderedFilteredIds ?? null;
      }
      if (!cached.filteredImages || cached.filteredImages.length === 0) {
        applyFilters();
      } else if (!state.isInitialized) {
        state.lastRenderedFilteredIds = null;
        renderImages({ skipScrollReset: true });
      }
      // Already initialized with valid filtered images — no action needed.
      updateSelectionUI();
      return;
    }
    // No in-memory cache hit — fall through to session storage / full scan.
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

      // Restore persisted AI tags into cached images
      const tagMap = await loadAiTagsMap();
      if (Object.keys(tagMap).length > 0) {
        state.allImages = state.allImages.map((img) =>
          tagMap[img.url] ? { ...img, aiTags: tagMap[img.url] } : img
        );
      }

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
        lastAccessed: Date.now(),
      });

      // Re-derive extras (file size, dimensions, colors, pHash) that are
      // not persisted in the session-storage cache.
      processImageExtras(state.allImages);
      return;
    }
    // No session cache hit — fall through to full scan.
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

  // Synchronously ignore activation of any known extension-owned tab
  // (reverse-search, welcome page, etc.). This check is intentionally
  // synchronous (no await) so it does NOT delay or break the synchronous
  // cache-restore fast path below. Switching to such a tab must not
  // save/clear/rescan the current tab's images.
  // Also ignore the focus-restore event that fires immediately after
  // closing a reverse-search tab (grace period protects the original tab).
  if (
    isReverseSearchTab(newTabId) ||
    isIgnoredExtensionTab(newTabId) ||
    isWithinReverseSearchCloseGrace() ||
    isOpenedTab(newTabId) ||
    isWithinOpenedTabCloseGrace()
  )
    return;

  // Re-activating the current tab (e.g. focus returns after closing a new
  // window) — nothing to do.
  if (newTabId === state.currentTabId) return;

  // Remember the previous tabId so we can restore it if the target turns
  // out to be an extension page discovered only after the async check.
  const previousTabId = state.currentTabId;

  // Save current tab state to cache before switching
  if (state.currentTabId != null && state.currentTabId !== newTabId) {
    const cachedUrl = state.tabCache.get(state.currentTabId)?.url || '';

    // Save scroll position so we can restore it when switching back.
    // The actual scrollable container is .image-grid (overflow-y: auto),
    // NOT .image-grid-wrapper (which is a non-scrolling flex parent).
    const scrollTop = elements.imageGrid?.scrollTop ?? 0;

    state.tabCache.set(state.currentTabId, {
      url: cachedUrl,
      images: [...state.allImages],
      selectedImages: new Set(state.selectedImages),
      filteredImages: [...state.filteredImages],
      lastRenderedFilteredIds: state.lastRenderedFilteredIds,
      similarGroups: [...state.similarGroups],
      scrollTop,
      lastAccessed: Date.now(),
    });
    evictOldestTabCache(state.tabCache);
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

      // Determine if this is a no-op restore: same images already rendered.
      // Compare by cached ID string (stable per dataset) against what was
      // last rendered for THIS tab's data — NOT state.lastRenderedFilteredIds
      // which may have been overwritten by an intermediate tab's loadCurrentTab.
      const currentImagesMatch =
        cachedFilteredIds != null &&
        cached.images.length === state.allImages.length &&
        cached.images.length > 0 &&
        cached.images[0]?.id === state.allImages[0]?.id &&
        cached.images[cached.images.length - 1]?.id ===
          state.allImages[state.allImages.length - 1]?.id;

      // ── 1. Prepare DOM containers BEFORE any state mutation ──────────
      // The grid might be hidden from a previous no-cache tab switch
      // (which sets display:none on the wrapper). Making containers visible
      // FIRST ensures Preact renders into a correctly-laid-out parent so
      // the browser composites everything in a single paint frame.
      const stateScreensMount = document.querySelector<HTMLElement>(
        '[data-preact-mount="state-screens"]'
      );
      if (stateScreensMount) stateScreensMount.style.display = 'none';

      const gridWrapper = document.querySelector<HTMLElement>('.image-grid-wrapper');
      if (gridWrapper) {
        gridWrapper.classList.remove('hidden');
        gridWrapper.style.removeProperty('display');
        gridWrapper.style.visibility = '';
      }
      if (elements.imageGrid) elements.imageGrid.classList.remove('hidden');
      document.querySelectorAll('.toolbar, .status-bar').forEach((el) => {
        el.classList.remove('hidden');
        el.classList.remove('scanning-disabled');
      });

      // ── 2. Atomic state update (queueMicrotask + CSS fade-in) ────────
      // Strategy: Do NOT hide the grid (no opacity:0 — avoids white flash).
      // Instead, let Preact swap DOM in its microtask while old content is
      // still displayed. Then, in OUR queueMicrotask (guaranteed to fire
      // after Preact's Promise-based render, and BEFORE any browser paint
      // per the event-loop spec: all microtasks drain before rendering),
      // we restore scrollTop and trigger a subtle CSS fade-in animation.
      // Result: the browser's first paint already shows new content at the
      // correct scroll position, with a smooth opacity transition.
      if (!currentImagesMatch) {
        const patch: Record<string, unknown> = {
          allImages: [...cached.images],
          selectedImages: new Set(cached.selectedImages),
          similarGroups: (cached.similarGroups || []).map((g) => [...g]),
          uiScreen: 'images',
          scanSkeletonsToShow: 0,
          scanProgress: {
            ...state.scanProgress,
            visible: false,
            indeterminate: false,
            currentUrl: '',
          },
        };
        if (cached.filteredImages && cached.filteredImages.length > 0) {
          patch.filteredImages = [...cached.filteredImages];
          patch.lastRenderedFilteredIds = cachedFilteredIds;
        }
        store.setMany(patch as Partial<typeof state>);

        if (!cached.filteredImages || cached.filteredImages.length === 0) {
          applyFilters({ skipScrollReset: true });
          // Guard: applyFilters→renderImages→showEmpty may hide the grid
          // and set uiScreen='empty' if filters produce 0 results. Undo
          // those side effects to prevent "暂无数据" flash during tab switch.
          if (gridWrapper) {
            gridWrapper.classList.remove('hidden');
            gridWrapper.style.removeProperty('display');
          }
          if (elements.imageGrid) elements.imageGrid.classList.remove('hidden');
          if (stateScreensMount) stateScreensMount.style.display = 'none';
          state.uiScreen = 'images';
        }

        // Restore scroll + smooth reveal AFTER Preact commits the new DOM.
        // Preact's render is scheduled via Promise.resolve().then(process),
        // which is a microtask queued DURING store.setMany(). Our
        // queueMicrotask() is queued AFTER — FIFO guarantees it fires once
        // Preact has finished. The browser only paints after the entire
        // microtask queue drains, so the user never sees an intermediate state.
        const savedScroll = cached.scrollTop ?? 0;
        queueMicrotask(() => {
          if (!elements.imageGrid) return;
          if (savedScroll) elements.imageGrid.scrollTop = savedScroll;
          // Trigger a smooth CSS fade-in animation.
          // Start from low opacity and animate to full.
          elements.imageGrid.classList.add('tab-switch-fadein');
          // Remove the animation class after it completes to avoid
          // interfering with other opacity-related styles.
          const onEnd = () => {
            elements.imageGrid?.classList.remove('tab-switch-fadein');
            elements.imageGrid?.removeEventListener('animationend', onEnd);
          };
          elements.imageGrid.addEventListener('animationend', onEnd, { once: true });
          // Fallback cleanup in case animationend doesn't fire (e.g. tab
          // switched away mid-animation, or browser throttles animation).
          setTimeout(() => {
            if (elements.imageGrid) {
              elements.imageGrid.classList.remove('tab-switch-fadein');
            }
          }, 200);
        });
      } else {
        // Images already match — just ensure UI flags are consistent.
        state.uiScreen = 'images';
        state.scanSkeletonsToShow = 0;
        if (state.scanProgress.visible) {
          state.scanProgress = {
            ...state.scanProgress,
            visible: false,
            indeterminate: false,
            currentUrl: '',
          };
        }
        // No DOM change pending — restore scroll directly.
        if (cached.scrollTop && elements.imageGrid) {
          elements.imageGrid.scrollTop = cached.scrollTop;
        }
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

  // No cache — peek at the target tab's URL FIRST (before hiding anything)
  // so we can detect our own extension pages (welcome.html, reverse-search.html)
  // and skip them entirely. These are not scannable pages; switching focus to
  // one must not clear similarGroups, toggle isScanning, or hide the grid —
  // all of which cause the current tab's status counts to re-render with a
  // fade-in animation (and occasionally flash the previous list) on return.
  let newTab: chrome.tabs.Tab | undefined;
  try {
    newTab = await chrome.tabs.get(newTabId);
  } catch {
    // Tab may have been closed already
  }

  if (state.currentTabId !== newTabId) return;

  // Our own extension page (welcome, reverse-search, etc.) — roll back all
  // state changes made above so the original tab's image list is completely
  // undisturbed. Remember this tabId so subsequent switches are caught
  // synchronously by isIgnoredExtensionTab() (no await needed next time).
  if (newTab && isOwnExtensionUrl(newTab.url)) {
    markIgnoredExtensionTab(newTabId);
    // Restore currentTabId so switching back doesn't save a bogus cache
    // entry for this extension page tab.
    state.currentTabId = previousTabId;
    state.isTabSwitching = false;
    return;
  }

  // Hide the grid and check if the target tab is restricted
  const gridWrapper = document.querySelector('.image-grid-wrapper') as HTMLElement | null;
  if (gridWrapper) {
    gridWrapper.classList.add('hidden');
    gridWrapper.style.display = 'none';
  }
  document.querySelectorAll('.toolbar, .status-bar').forEach((el) => {
    el.classList.add('hidden');
  });
  try {
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

  // Once a tracked reverse-search tab navigates away from our extension page
  // to the real search engine, stop ignoring it — it's a normal tab now.
  if (isReverseSearchTab(tabId)) {
    const updatedUrl = tab?.url || changeInfo.url || '';
    if (updatedUrl && !updatedUrl.startsWith(chrome.runtime.getURL(''))) {
      forgetReverseSearchTab(tabId);
    }
  }

  if (!changeInfo.url && changeInfo.status !== 'complete') return;

  // Our own extension pages (welcome.html, reverse-search.html, …) are not
  // scannable. Ignore their updates so we never clear/rescan and pollute the
  // current tab's image state — which would re-render the status counts with
  // a fade-in animation when the user returns.
  const updatedUrl = tab?.url || changeInfo.url || '';
  if (isOwnExtensionUrl(updatedUrl)) return;

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
