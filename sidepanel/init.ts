// Initialization: init function, tab management, DOM caching, event binding
// This is the single entry point loaded by sidepanel.html / popup.html.
// Importing the other modules below ensures they are bundled together.

import { FREE_LIMITS, MESSAGE_TYPES } from '../shared/constants';
import { isRestrictedUrl } from '../shared/utils';
import { setEnvelopeMeta, track, flushNow } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';
import { isProUser } from '../shared/license';
import { getProUpsellBucket } from '../shared/ab-experiment';
import { detectLocale, onLocaleChange, setLocale, t, type Locale } from '../shared/i18n';
import {
  clearSelection,
  downloadSelectedAsZip,
  downloadSingle,
  hideDownloadDropdown,
  removeAllHighlightsOnPage,
  reverseSearch,
  selectAll,
  toggleDownloadDropdown,
  updateSelectionUI,
} from './actions';
import {
  applyCustomSizeInputs,
  applyFilters,
  clearCustomSizeInputs,
  syncCustomSizeInputsFromSettings,
} from './filter';
import { mountPreactComponents } from './components/mount';
import { cancelDiscoveredToast, handleKeyDown, handleMessage } from './message';
import {
  exportCollection,
  removeDuplicates,
  showCollectionModal,
  showMultiTabModal,
  startMultiTabExtract,
  toggleMultitabSelectAll,
} from './pro-features';
import { renderImages } from './render';
import { fetchImages, handleScanCancel, processImageExtras } from './scan';
import {
  applyDensity,
  applyProFeatureVisibility,
  applyTheme,
  bindProGuards,
  closeAllFilterDropdowns,
  closeSettings,
  openShortcutSettings,
  resetSettings,
  saveSettings,
  setSelect,
  showProUpgradeModal,
  showSettings,
  toggleFilterDropdown,
  updateLiveIndicator,
} from './settings';
import { clearTabImageCache, getTabImageCache, saveTabImageCache } from '../shared/storage';
import { elements, state, store } from './state';
import {
  applyTranslations,
  handleProgressClose,
  hideLoading,
  hideRestricted,
  initResizeObserver,
  showLoading,
  showRestricted,
  showToast,
  toggleViewMode,
  updateFilterButtonLabels,
} from './ui';
import { debounce, generateId, loadSettings } from './utils';

// Module-level rescan debounce timer
let tabUpdatedTimer: ReturnType<typeof setTimeout> | null = null;

// Timestamp of the last tab switch — used by handleTabUpdated and
// handleMessage to suppress Chrome's spurious events that arrive shortly
// after a tab switch (race condition where isTabSwitching has already been
// reset in the finally block).
let lastTabSwitchTime = 0;
const TAB_SWITCH_GRACE_MS = 2000;

/** Check if we are still within the grace period after a tab switch. */
export function isWithinTabSwitchGrace(): boolean {
  return Date.now() - lastTabSwitchTime < TAB_SWITCH_GRACE_MS;
}

// Flag set by uiPort.onDisconnect — signals that the extension has been
// reloaded and chrome.* APIs are no longer valid. All event listeners
// (onActivated, onUpdated, visibilitychange) check this before calling
// any chrome.* API to prevent crashing Chrome.
let extensionContextInvalidated = false;

/**
 * Returns true if the extension context is still valid. When the extension
 * is reloaded from chrome://extensions, the background SW disconnects and
 * chrome.runtime.id becomes undefined. Continuing to call chrome.tabs.*
 * or chrome.runtime.* in this state can crash the entire browser.
 */
function isExtensionContextValid(): boolean {
  if (extensionContextInvalidated) return false;
  if (!chrome.runtime?.id) {
    extensionContextInvalidated = true;
    return false;
  }
  return true;
}

// ============================================
// Initialization
// ============================================
async function init(): Promise<void> {
  state.isPopupMode = window.location.pathname.endsWith('popup.html');

  // ── Instant visual feedback ─────────────────────────────────────────────
  // Mount Preact components, cache DOM refs, and show loading skeletons
  // BEFORE any async work (locale detection, telemetry, settings load).
  // This ensures the user sees skeleton placeholders the moment the panel
  // opens, eliminating the blank-screen flash. Locale detection and
  // translations are applied later via applyTranslations().
  mountPreactComponents();
  cacheElements();
  showLoading();

  // ── i18n: resolve user / browser locale ─────────────────────────────────
  // Catalogue lookup is sync once detectLocale() resolves, so subsequent
  // t() calls inside loadSettings / applyTranslations see the right
  // language. Failure here must not block init — t() falls back to English
  // when activeLocale stays at its module default.
  try {
    await detectLocale();
  } catch {
    /* keep fallback locale */
  }
  // Preact components were mounted above (before detectLocale) so their
  // initial render used the default English locale. Bump localeTick now
  // so every component that calls t() re-renders with the resolved language.
  state.localeTick = (state.localeTick ?? 0) + 1;

  // ── Telemetry envelope sync ─────────────────────────────────────────────
  // Background SW seeds {version, plan} but lives in a different runtime,
  // so the sidepanel must re-seed for its own SDK instance. lang is
  // sidepanel-only because chrome.i18n returns the UI locale here.
  try {
    const lang = chrome.i18n?.getUILanguage?.() || 'unknown';
    setEnvelopeMeta({ lang });
    isProUser()
      .then((info) => setEnvelopeMeta({ plan: info.isPro ? info.plan || 'pro' : 'free' }))
      .catch(() => {
        /* keep default */
      });
    // Resolve the install's A/B bucket once and stamp it onto the envelope
    // so every conversion event whose schema declares `abBucket` ships
    // with the right variant. Sync after this initial await — the SDK
    // reads it from envelopeMeta on every track() call.
    getProUpsellBucket()
      .then((bucket) => setEnvelopeMeta({ abBucket: bucket }))
      .catch(() => {
        /* fall back to no bucket — the funnel collapses A+B for that user */
      });

    // Fire EXTENSION_FIRST_OPEN exactly once per install, gated by a
    // storage flag so subsequent opens stay silent. We deliberately do
    // NOT await this — the funnel doesn't care about ordering vs init.
    void (async () => {
      const { _telemetry_first_open_at } = await chrome.storage.local.get(
        '_telemetry_first_open_at'
      );
      if (!_telemetry_first_open_at) {
        await chrome.storage.local.set({ _telemetry_first_open_at: Date.now() });
        await track(EVENTS.EXTENSION_FIRST_OPEN);
        await flushNow();
      }
    })();

    // First-run privacy opt-in. Show the modal only when the user has
    // never made a choice before; otherwise honor their stored decision.
    // We deliberately delay by one tick so mountPreactComponents() can
    // attach the modal mount point before we flip the visibility flag.
    void (async () => {
      const { _telemetry_opt_in_decided } = await chrome.storage.local.get(
        '_telemetry_opt_in_decided'
      );
      if (!_telemetry_opt_in_decided) {
        // setTimeout puts the state mutation after the current task so
        // Preact has finished its initial mount pass.
        setTimeout(() => {
          state.privacyOptInModalState = { open: true };
        }, 50);
      }
    })();
  } catch {
    /* telemetry must never break init */
  }

  await loadSettings();

  applyTheme((state.appSettings.theme as string) || 'system');
  applyDensity((state.appSettings.density as string) || 'standard');
  // Apply default group mode from saved settings so the panel opens with
  // the user's preferred grouping without requiring a manual selection.
  if (state.appSettings.defaultGroup && state.appSettings.defaultGroup !== 'none') {
    state.currentGroupMode = state.appSettings.defaultGroup;
    // Sync the group-filter dropdown UI so the active item matches.
    document.querySelectorAll('[data-group-filter]').forEach((opt) => {
      opt.classList.toggle(
        'active',
        (opt as HTMLElement).dataset.groupFilter === state.appSettings.defaultGroup
      );
    });
  }
  updateLiveIndicator();

  bindEvents();
  syncCustomSizeInputsFromSettings();
  // Fire-and-forget: Pro visibility check involves a VALIDATE_LICENSE
  // round-trip to the background SW (~1-1.5s). It only sets state.isProUser
  // and toggles UI badges — none of which blocks image scanning. Running it
  // non-blocking lets loadCurrentTab start immediately, saving ~1.2s.
  const proVisibilityPromise = applyProFeatureVisibility();
  updateFilterButtonLabels();
  applyTranslations();
  initResizeObserver();

  // Register locale-change listener so a runtime language switch in Settings
  // immediately updates all DOM text without requiring a panel reload.
  onLocaleChange(() => {
    applyTranslations();
    updateFilterButtonLabels();
    updateSelectionUI();
    // Bump the localeTick counter so Preact components that call t() re-render
    // with the new translations without requiring a panel reload.
    state.localeTick = (state.localeTick ?? 0) + 1;
  });

  // Establish a long-lived connection to background for broadcast messages.
  // Wrap in try-catch: after extension reload the background service worker
  // may not be ready yet, which causes chrome.runtime.connect() to throw
  // synchronously. Without this guard the entire init() would abort and
  // loadCurrentTab() would never execute — the panel would stay blank.
  try {
    const uiPort = chrome.runtime.connect({ name: 'image-harvest-ui' });
    uiPort.onMessage.addListener(handleMessage);
    // When the extension is reloaded (e.g. developer clicks the refresh
    // button on chrome://extensions), the background SW is torn down and
    // the port disconnects. Without this handler, sidepanel listeners
    // (onActivated, onUpdated, visibilitychange) keep firing and call
    // chrome.tabs/runtime APIs on the now-invalid extension context,
    // which can crash the entire Chrome process.
    uiPort.onDisconnect.addListener(() => {
      extensionContextInvalidated = true;
    });
  } catch (error) {
    console.warn('Failed to connect to background — will retry via sendMessage:', error);
  }

  // Listen for tab switches / navigations so we can auto-refresh
  if (!state.isPopupMode) {
    chrome.tabs.onActivated.addListener(handleTabChange);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);
    // Clean up cache when a tab is closed
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (!isExtensionContextValid()) return;
      state.tabCache.delete(tabId);
      clearTabImageCache(tabId);
    });
  }

  // Clean up page highlights when side panel / popup is closed
  window.addEventListener('beforeunload', () => {
    if (!isExtensionContextValid()) return;
    removeAllHighlightsOnPage();
    // Notify background to stop tracking this tab's side panel
    if (!state.isPopupMode && state.currentTabId != null) {
      chrome.runtime
        .sendMessage({
          type: MESSAGE_TYPES.SIDE_PANEL_CLOSED,
          tabId: state.currentTabId,
        })
        .catch(() => {
          /* ignore */
        });
    }
  });

  // Handle sidepanel becoming visible again after being hidden.
  if (!state.isPopupMode) {
    let lastHiddenTime = 0;

    document.addEventListener('visibilitychange', () => {
      if (!isExtensionContextValid()) return;
      if (document.visibilityState === 'hidden') {
        lastHiddenTime = Date.now();
      } else if (document.visibilityState === 'visible' && state.isInitialized) {
        if (state.isTabSwitching || isWithinTabSwitchGrace()) {
          lastHiddenTime = 0;
          return;
        }
        // Only trigger rescan if the panel was hidden for more than 1 second
        const wasHiddenLong = Date.now() - lastHiddenTime > 1000;
        if (!wasHiddenLong) {
          return;
        }

        lastHiddenTime = 0;

        // When currentTabId is null the user is on a restricted page (e.g.
        // chrome://) — don't trigger loadCurrentTab here; handleTabChange
        // will handle it when the user switches to a real tab.
        if (state.currentTabId == null) {
          return;
        }

        // If we already have images for the current tab (either in memory
        // cache or currently displayed), skip the rescan.
        if (state.tabCache.has(state.currentTabId) || state.allImages.length > 0) {
          return;
        }

        loadCurrentTab(false, state.currentTabId);
      }
    });
  }

  // Initial load for the current tab (trigger rescan with progress overlay).
  // Runs in parallel with proVisibilityPromise — image scanning does not
  // depend on the Pro status, so there is no reason to wait for the
  // ~1.2s VALIDATE_LICENSE round-trip before starting the scan.
  await loadCurrentTab(false);

  // Ensure the Pro visibility promise settles before marking init done,
  // so state.isProUser is resolved and UI badges are correct.
  await proVisibilityPromise;

  state.isInitialized = true;
}

/**
 * Determine the target tab and either show the restricted
 * placeholder or scan for images.
 *
 * @param forceRescan  - skip cache and do a full scan
 * @param targetTabId  - explicit tab to load; falls back to querying the active tab
 */
async function loadCurrentTab(forceRescan = false, targetTabId?: number): Promise<void> {
  let activeTab: chrome.tabs.Tab | undefined;
  try {
    if (targetTabId != null) {
      // Use the explicitly provided tab — avoids querying the wrong active tab
      // during rapid tab switches in the shared sidepanel instance.
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
      // Assign filteredImages BEFORE allImages so that any store-proxy
      // subscriber triggered by the allImages write already sees the
      // correct filtered data (prevents a single-frame flash).
      if (cached.filteredImages && cached.filteredImages.length > 0) {
        state.filteredImages = cached.filteredImages;
        state.lastRenderedFilteredIds = cached.lastRenderedFilteredIds ?? null;
      }
      state.allImages = cached.images;
      state.selectedImages = cached.selectedImages;
      hideLoading();
      if (!cached.filteredImages || cached.filteredImages.length === 0) {
        applyFilters();
      } else if (state.isPopupMode) {
        // Popup opens a fresh DOM each time — always force a render even
        // when filteredImages was restored from cache. Without this the
        // lastRenderedFilteredIds optimization in applyFilters() would
        // skip renderImages(), leaving the grid empty.
        state.lastRenderedFilteredIds = null;
        renderImages({ skipScrollReset: true });
      }
      updateSelectionUI();
      return;
    }
  }

  // Check session storage cache (survives popup/sidepanel close-reopen)
  if (!forceRescan) {
    const sessionCached = await getTabImageCache(tabId, tabUrl);
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
      // not persisted in the session-storage cache.  Fire-and-forget so
      // the UI is responsive immediately while extras load in the background.
      processImageExtras(state.allImages);
      return;
    }
  }

  // No cache available — full scan with loading UI.
  // Pass the resolved tabId explicitly so fetchImages never falls back to
  // querying the active tab (which may differ during rapid tab switches).
  await fetchImages(tabId);

  // fetchImages already persists to tabCache + sessionStorage using the
  // locked scanTabId, so no duplicate cache write is needed here.

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

async function handleTabChange(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
  if (!isExtensionContextValid()) return;
  const newTabId = activeInfo.tabId;

  // Save current tab state to cache before switching
  if (state.currentTabId != null && state.currentTabId !== newTabId) {
    const cachedUrl = state.tabCache.get(state.currentTabId)?.url || '';
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

  // Cancel any pending handleTabUpdated rescan timer — the tab switch
  // supersedes any queued URL-change rescan from the previous tab.
  if (tabUpdatedTimer) {
    clearTimeout(tabUpdatedTimer);
    tabUpdatedTimer = null;
  }

  // Clear stale toasts from the previous tab (e.g. "Found N images" toast
  // from a scan that completed on the old tab just before the switch).
  state.toasts = [];

  // Cancel any pending "new images discovered" debounce timer from the
  // previous tab's live monitoring — prevents a stale toast from firing
  // after the switch.
  cancelDiscoveredToast();

  // Mark that this visibility change is caused by a tab switch
  state.isTabSwitching = true;
  lastTabSwitchTime = Date.now();

  state.currentTabId = newTabId;

  // Check in-memory cache synchronously BEFORE any await
  const cached = state.tabCache.get(newTabId);

  // Fast path (synchronous)
  if (cached) {
    try {
      // ── Hide the grid while we swap data so the user never sees the
      // intermediate state (old images → new images). We use
      // visibility:hidden (not display:none) to keep layout stable.
      const gridWrapper = document.querySelector('.image-grid-wrapper') as HTMLElement | null;
      if (gridWrapper) gridWrapper.style.visibility = 'hidden';

      // ── Determine up-front whether the filtered image set changed ──
      const cachedFilteredIds = cached.lastRenderedFilteredIds ?? null;
      const isSameFilteredSet =
        cachedFilteredIds != null && cachedFilteredIds === state.lastRenderedFilteredIds;

      // Batch all state assignments to avoid intermediate Preact renders.
      const patch: Record<string, unknown> = {
        allImages: cached.images,
        selectedImages: cached.selectedImages,
        similarGroups: cached.similarGroups || [],
      };
      // Only assign filteredImages when the content actually changed.
      // Cached arrays are spread-copies ([...arr]) so their reference
      // always differs — assigning them unconditionally would trigger
      // ImageGrid's useStoreSelector to re-render all cards.
      if (!isSameFilteredSet && cached.filteredImages && cached.filteredImages.length > 0) {
        patch.filteredImages = cached.filteredImages;
        patch.lastRenderedFilteredIds = cachedFilteredIds;
      }
      store.setMany(patch as Partial<typeof state>);

      hideLoading();
      hideRestricted();

      // If no cached filteredImages were available, derive them now.
      if (!isSameFilteredSet && (!cached.filteredImages || cached.filteredImages.length === 0)) {
        applyFilters();
      }

      // Update the found count immediately so the status bar doesn't flash
      // the previous tab's count.
      if (elements.foundCount) {
        elements.foundCount.textContent = String(state.filteredImages.length);
      }

      updateSelectionUI();

      if (!isSameFilteredSet) {
        renderImages({ skipScrollReset: true });
      } else {
        // Ensure the grid element is visible after showRestricted hid it.
        if (elements.imageGrid) elements.imageGrid.classList.remove('hidden');
        state.uiScreen = 'images';
      }

      // Reveal the grid after Preact has finished rendering the new cards.
      // Double-rAF ensures we're past the paint that contains the new DOM.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (gridWrapper) {
            gridWrapper.style.visibility = '';
            gridWrapper.classList.remove('hidden');
            gridWrapper.style.display = '';
          }
        });
      });

      // Verify the URL still matches asynchronously
      try {
        const newTab = await chrome.tabs.get(newTabId);
        if (state.currentTabId !== newTabId) return;
        if (!newTab || isRestrictedUrl(newTab.url)) {
          state.currentTabId = null;
          // clearCurrentImages is exported from ui.ts; tolerate absence here
          state.allImages = [];
          state.selectedImages.clear();
          state.filteredImages = [];
          if (elements.imageGrid) elements.imageGrid.innerHTML = '';
          showRestricted();
          return;
        }
        if (cached.url && cached.url !== newTab.url) {
          await loadCurrentTab(true, newTabId);
          return;
        }
        // If cached.url was empty (saved before URL was known), update it now
        if (!cached.url && newTab.url) {
          cached.url = newTab.url;
        }
      } catch {
        // Tab may have been closed — ignore
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

  // No cache — check if the target tab is restricted BEFORE showing loading
  try {
    let newTab: chrome.tabs.Tab | undefined;
    try {
      newTab = await chrome.tabs.get(newTabId);
    } catch {
      // Tab may have been closed already
    }

    // Abort if the user has already switched to another tab during await
    if (state.currentTabId !== newTabId) return;

    if (!newTab || isRestrictedUrl(newTab.url)) {
      state.currentTabId = null;
      showRestricted();
      return;
    }

    // Normal page — show loading skeleton and do a full scan.
    // Reset similar groups from previous tab so the status bar doesn't
    // flash a stale count while the new tab is being scanned.
    state.similarGroups = [];
    showLoading();

    // Notify background that the side panel is open on this tab
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

function handleTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
): void {
  if (!isExtensionContextValid()) return;
  // Only react to URL changes / completed loads
  if (!changeInfo.url && changeInfo.status !== 'complete') return;

  // Ignore during tab switching — handleTabChange handles the new tab's
  // lifecycle. Without this guard, Chrome's "complete" event for the newly
  // activated tab can race with handleTabChange and trigger a redundant
  // rescan that shows a stale toast ("Found N images" from wrong tab).
  if (state.isTabSwitching) return;

  // Grace period after a tab switch: Chrome may fire a status=complete event
  // for the newly activated tab shortly after handleTabChange finishes (and
  // isTabSwitching has already been reset to false). Ignore events within
  // the grace window to prevent spurious rescans.
  if (Date.now() - lastTabSwitchTime < TAB_SWITCH_GRACE_MS) return;

  // Only handle the current tab — or, when there is no current tab, the
  // updated tab is the active tab in this window
  if (tabId !== state.currentTabId) {
    if (state.currentTabId !== null || !tab?.active) return;
  }

  const newUrl = tab?.url || changeInfo.url || '';

  // If the new URL is a restricted page, show the restricted state immediately
  if (isRestrictedUrl(newUrl)) {
    if (state.currentTabId !== null) {
      if (tabUpdatedTimer) clearTimeout(tabUpdatedTimer);
      state.tabCache.delete(tabId);
      clearTabImageCache(tabId);
      // Inline clearCurrentImages
      state.allImages = [];
      state.selectedImages.clear();
      state.filteredImages = [];
      if (elements.imageGrid) elements.imageGrid.innerHTML = '';
      state.currentTabId = null;
      showRestricted();
    }
    return;
  }

  // Check if the URL actually changed
  const cachedEntry = state.tabCache.get(tabId);
  if (cachedEntry && cachedEntry.url === newUrl) {
    return;
  }

  // When navigating away from a restricted page, show loading immediately
  if (state.currentTabId === null) {
    state.currentTabId = tabId;
    hideRestricted();
    showLoading();
  }

  // URL changed — do a full rescan after a short delay
  if (!state.isInitialized) return;

  if (tabUpdatedTimer) clearTimeout(tabUpdatedTimer);
  if (!state.isFetching) showLoading();
  tabUpdatedTimer = setTimeout(() => {
    if (state.isFetching) return;
    state.tabCache.delete(tabId);
    clearTabImageCache(tabId);
    // Inline clearCurrentImages
    state.allImages = [];
    state.selectedImages.clear();
    state.filteredImages = [];
    if (elements.imageGrid) elements.imageGrid.innerHTML = '';
    loadCurrentTab(true, tabId);
  }, 800);
}

function cacheElements(): void {
  const ids = [
    'image-grid',
    'loading-state',
    'empty-state',
    'error-state',
    'restricted-state',
    'settings-modal',
    'progress-modal',
    'progress-fill',
    'progress-text',
    'progress-current',
    'toast-container',
    'selected-count',
    'total-count',
    'btn-download',
    'btn-download-toggle',
    'btn-select-all',
    'download-dropdown',
    'download-group',
    'group-mode',
    'btn-view-toggle',
    'found-info',
    'found-action-count',
    'btn-refresh',
    'filter-url-input',
    'reverse-search-menu',
    'dedup-modal',
    'dedup-body',
    'collection-modal',
    'collection-body',
    'multitab-modal',
    'multitab-list',
    'btn-multitab',
    'btn-settings',
    'btn-collection',
    'btn-dedup',
    'similar-count',
    'btn-save-settings',
    'btn-reset-defaults',
    'btn-settings-close',
    'btn-start-extraction',
    'btn-remove-duplicates',
    'btn-collection-export',
    'collection-search',
    'btn-dedup-close',
    'btn-cancel-dedup',
    'btn-multitab-close',
    'btn-cancel-multitab',
    'btn-collection-back',
    'btn-progress-close',
    'found-count',
    'setting-side-panel',
    'setting-density',
    'setting-theme',
    'setting-default-group',
    'setting-download-options',
    'setting-subfolder',
    'setting-filename',
    'setting-convert',
    'live-indicator',
    'setting-all-frames',
    'setting-live-monitor',
    'setting-min-size',
    'setting-min-width',
    'setting-min-height',
    'setting-max-size',
    'setting-max-width',
    'setting-max-height',
    'setting-no-warning',
    'download-count',
    'download-label',
    'scan-overlay',
    'scan-progress-fill',
    'scan-progress-text',
    'scan-progress-title',
    'scan-progress-current',
    'btn-scan-cancel',
  ];

  ids.forEach((id) => {
    const camelCase = id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    elements[camelCase] = document.getElementById(id);
  });
}

function bindEvents(): void {
  // Refresh / rescan images
  if (elements.btnRefresh) {
    elements.btnRefresh.addEventListener('click', () => {
      // Force rescan: invalidate cache for current tab and reload
      if (state.currentTabId != null) {
        state.tabCache.delete(state.currentTabId);
        clearTabImageCache(state.currentTabId);
      }
      state.isFetching = false;
      // Show loading overlay immediately to prevent stale content flash
      showLoading();
      loadCurrentTab(true, state.currentTabId ?? undefined);
    });
  }

  // Select all / clear
  if (elements.btnSelectAll) {
    elements.btnSelectAll.addEventListener('click', () => {
      const allFilteredSelected =
        state.filteredImages.length > 0 &&
        state.filteredImages.every((img) => state.selectedImages.has(img.id));
      if (allFilteredSelected) {
        clearSelection();
      } else {
        selectAll();
      }
    });
  }

  // Download button
  if (elements.btnDownload) {
    elements.btnDownload.addEventListener('click', (e) => {
      e.stopPropagation();
      hideDownloadDropdown();
      const hasSelection = state.selectedImages.size > 0;
      const imagesToDownload = hasSelection
        ? state.filteredImages.filter((img) => state.selectedImages.has(img.id))
        : state.filteredImages;
      if (imagesToDownload.length === 0) return;
      if (imagesToDownload.length === 1) {
        downloadSingle(imagesToDownload[0], null);
      } else {
        if (!hasSelection) {
          state.filteredImages.forEach((img) => state.selectedImages.add(img.id));
          updateSelectionUI();
        }
        downloadSelectedAsZip(null);
      }
    });
  }

  // Download dropdown toggle
  if (elements.btnDownloadToggle) {
    elements.btnDownloadToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDownloadDropdown();
    });
  }

  // Download dropdown items
  if (elements.downloadDropdown) {
    elements.downloadDropdown.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-format]');
      if (item) {
        const format = item.dataset.format;
        // Pro check: non-original formats require Pro
        if (!state.isProUser && format !== 'original') {
          showToast(t('pro_feature_blocked_format_conversion'), 'warning');
          showProUpgradeModal();
          hideDownloadDropdown();
          return;
        }
        elements
          .downloadDropdown!.querySelectorAll('.dropdown-item')
          .forEach((el) => el.classList.remove('active'));
        item.classList.add('active');
        const convertFormat = format === 'original' ? null : (format ?? null);
        const isZip = item.dataset.zip === 'true';
        if (isZip) {
          if (state.selectedImages.size === 0) {
            state.filteredImages.forEach((img) => state.selectedImages.add(img.id));
            updateSelectionUI();
          }
          downloadSelectedAsZip(convertFormat);
        } else {
          const hasSelection = state.selectedImages.size > 0;
          const imagesToDownload = hasSelection
            ? state.filteredImages.filter((img) => state.selectedImages.has(img.id))
            : state.filteredImages;
          if (imagesToDownload.length === 0) return;
          if (!hasSelection) {
            state.filteredImages.forEach((img) => state.selectedImages.add(img.id));
            updateSelectionUI();
          }
          if (imagesToDownload.length === 1) {
            downloadSingle(imagesToDownload[0], convertFormat);
          } else {
            downloadSelectedAsZip(convertFormat);
          }
        }
        hideDownloadDropdown();
      }
    });
  }

  // View toggle
  if (elements.btnViewToggle) {
    elements.btnViewToggle.addEventListener('click', toggleViewMode);
  }

  // Group mode
  if (elements.groupMode) {
    elements.groupMode.addEventListener('change', (e) => {
      state.currentGroupMode = (e.target as HTMLSelectElement)
        .value as typeof state.currentGroupMode;
      renderImages();
    });
  }

  // Filter buttons
  document.querySelectorAll<HTMLElement>('.filter-btn[data-filter]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = btn.dataset.filter;
      if (type) toggleFilterDropdown(type);
    });
  });

  // Size filter options
  document.querySelectorAll<HTMLElement>('[data-size-filter]').forEach((opt) => {
    opt.addEventListener('click', () => {
      const val = opt.dataset.sizeFilter || 'all';
      state.activeFilters.size = val;
      switch (val) {
        case 'all':
          state.activeFilters.sizeMin = 0;
          state.activeFilters.sizeMax = Infinity;
          break;
        case 'small':
          state.activeFilters.sizeMin = 0;
          state.activeFilters.sizeMax = 100;
          break;
        case 'medium':
          state.activeFilters.sizeMin = 100;
          state.activeFilters.sizeMax = 500;
          break;
        case 'large':
          state.activeFilters.sizeMin = 500;
          state.activeFilters.sizeMax = 1000;
          break;
        case 'xl':
          state.activeFilters.sizeMin = 1000;
          state.activeFilters.sizeMax = Infinity;
          break;
      }
      // Clear custom size inputs when selecting a preset
      clearCustomSizeInputs();
      state.appSettings.enableMinSize = false;
      state.appSettings.enableMaxSize = false;

      document.querySelectorAll('[data-size-filter]').forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      updateFilterButtonLabels();
      applyFilters();
      closeAllFilterDropdowns();
    });
  });

  // Custom size inputs in Size dropdown
  ['filter-min-width', 'filter-min-height', 'filter-max-width', 'filter-max-height'].forEach(
    (inputId) => {
      const input = document.getElementById(inputId);
      if (input) {
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('input', () => applyCustomSizeInputs());
      }
    }
  );

  // Type filter checkboxes
  document.querySelectorAll<HTMLInputElement>('.type-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      const allCheckbox = document.querySelector<HTMLInputElement>('.type-checkbox[value="all"]');
      const typeCheckboxes = document.querySelectorAll<HTMLInputElement>(
        '.type-checkbox:not([value="all"])'
      );

      if (cb.value === 'all') {
        typeCheckboxes.forEach((tc) => {
          tc.checked = cb.checked;
        });
      } else {
        const allTypesChecked = Array.from(typeCheckboxes).every((tc) => tc.checked);
        if (allCheckbox) allCheckbox.checked = allTypesChecked;
      }

      const checkedTypes = Array.from(
        document.querySelectorAll<HTMLInputElement>('.type-checkbox:not([value="all"]):checked')
      ).map((c) => c.value);
      const allChecked = !!(allCheckbox && allCheckbox.checked);
      state.activeFilters.types = allChecked ? [] : checkedTypes;
      updateFilterButtonLabels();
      applyFilters();
    });
  });

  // Layout filter options
  document.querySelectorAll<HTMLElement>('[data-layout-filter]').forEach((opt) => {
    opt.addEventListener('click', () => {
      state.activeFilters.layout = opt.dataset.layoutFilter || 'all';
      document
        .querySelectorAll('[data-layout-filter]')
        .forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      updateFilterButtonLabels();
      applyFilters();
      closeAllFilterDropdowns();
    });
  });

  // Group filter options
  document.querySelectorAll<HTMLElement>('[data-group-filter]').forEach((opt) => {
    opt.addEventListener('click', () => {
      const val = opt.dataset.groupFilter || 'none';
      // Free tier: only 'none' and 'format' grouping allowed
      if (!state.isProUser && !FREE_LIMITS.ALLOWED_GROUP_MODES.includes(val as 'none' | 'format')) {
        showToast(t('pro_feature_blocked_advanced_grouping'), 'warning');
        showProUpgradeModal();
        closeAllFilterDropdowns();
        return;
      }
      state.currentGroupMode = val as typeof state.currentGroupMode;
      if (elements.groupMode) (elements.groupMode as HTMLSelectElement).value = val;
      document.querySelectorAll('[data-group-filter]').forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      updateFilterButtonLabels();
      renderImages();
      closeAllFilterDropdowns();
    });
  });

  // Sort filter options
  document.querySelectorAll<HTMLElement>('[data-sort-filter]').forEach((opt) => {
    opt.addEventListener('click', () => {
      state.currentSortMode = (opt.dataset.sortFilter || 'natural') as typeof state.currentSortMode;
      document.querySelectorAll('[data-sort-filter]').forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      updateFilterButtonLabels();
      applyFilters();
      closeAllFilterDropdowns();
    });
  });

  // URL filter (with IME composition awareness and debounce)
  if (elements.filterUrlInput) {
    let isComposing = false;
    const debouncedUrlFilter = debounce((value: string) => {
      state.activeFilters.urlKeyword = value.toLowerCase();
      updateFilterButtonLabels();
      applyFilters();
    }, 300);

    elements.filterUrlInput.addEventListener('compositionstart', () => {
      isComposing = true;
    });
    elements.filterUrlInput.addEventListener('compositionend', (e) => {
      isComposing = false;
      debouncedUrlFilter((e.target as HTMLInputElement).value);
    });
    elements.filterUrlInput.addEventListener('input', (e) => {
      if (isComposing) return;
      debouncedUrlFilter((e.target as HTMLInputElement).value);
    });
  }

  // Color filter - "All Colors" option
  document.querySelectorAll<HTMLElement>('[data-color-filter]').forEach((opt) => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      if (opt.dataset.colorFilter === 'all') {
        state.activeFilters.color = null;
        document
          .querySelectorAll('#color-swatches .color-swatch')
          .forEach((s) => s.classList.remove('active'));
        opt.classList.add('active');
        updateFilterButtonLabels();
        applyFilters();
        closeAllFilterDropdowns();
      }
    });
  });

  // Settings
  if (elements.btnSettings) elements.btnSettings.addEventListener('click', showSettings);
  // btn-settings-close is now owned by the <SettingsModal> Preact shell —
  // its onClick directly mutates the store, so no addEventListener needed.
  if (elements.btnSaveSettings) elements.btnSaveSettings.addEventListener('click', saveSettings);
  if (elements.btnResetDefaults) elements.btnResetDefaults.addEventListener('click', resetSettings);

  // Theme radio: apply immediately on selection and persist (no explicit save required).
  document
    .querySelectorAll<HTMLInputElement>('input[type="radio"][name="theme"]')
    .forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          applyTheme(radio.value);
          state.appSettings.theme = radio.value as 'system' | 'light' | 'dark';
          void chrome.storage.local.set({ appSettings: state.appSettings });
        }
      });
    });

  // Toggle setting-inputs sub-panels based on checkbox state
  const settingTogglePairs: Array<[string, string]> = [
    ['setting-download-options', 'download-options-inputs'],
    ['setting-min-size', 'min-size-inputs'],
    ['setting-max-size', 'max-size-inputs'],
  ];
  settingTogglePairs.forEach(([checkboxId, panelId]) => {
    const checkbox = document.getElementById(checkboxId) as HTMLInputElement | null;
    const panel = document.getElementById(panelId);
    if (checkbox && panel) {
      checkbox.addEventListener('change', () => {
        panel.classList.toggle('hidden', !checkbox.checked);
      });
    }
  });

  // Custom setting-select dropdowns
  document.querySelectorAll<HTMLElement>('.setting-select').forEach((selectEl) => {
    const btn = selectEl.querySelector('.setting-select-btn');
    const dropdown = selectEl.querySelector('.setting-select-dropdown');
    if (btn && dropdown) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.setting-select-dropdown').forEach((d) => {
          if (d !== dropdown) d.classList.add('hidden');
        });
        dropdown.classList.toggle('hidden');
      });
      dropdown.querySelectorAll<HTMLElement>('.setting-select-option').forEach((opt) => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const value = opt.dataset.value || '';
          // Pro check for setting-default-group: Domain/Size/Tab require Pro
          if (
            selectEl.id === 'setting-default-group' &&
            !state.isProUser &&
            ['domain', 'size', 'tab'].includes(value)
          ) {
            dropdown.classList.add('hidden');
            closeSettings();
            showToast(t('pro_feature_blocked_advanced_grouping'), 'warning');
            showProUpgradeModal();
            return;
          }
          // Pro check for setting-convert-format: PNG/JPG/WebP require Pro
          if (
            selectEl.id === 'setting-convert-format' &&
            !state.isProUser &&
            ['png', 'jpg', 'webp'].includes(value)
          ) {
            dropdown.classList.add('hidden');
            closeSettings();
            showToast(t('pro_feature_blocked_format_conversion'), 'warning');
            showProUpgradeModal();
            return;
          }
          setSelect(selectEl.id, value);
          dropdown.classList.add('hidden');
          // Language switch takes effect immediately (no save required).
          if (selectEl.id === 'setting-language' && value) {
            void setLocale(value as Locale);
          }
        });
      });
    }
  });

  // Close setting-select dropdowns on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.setting-select-dropdown').forEach((d) => d.classList.add('hidden'));
  });

  // Hotkey link - open browser shortcut settings
  const hotkeyLink = document.getElementById('hotkey-link');
  if (hotkeyLink) hotkeyLink.addEventListener('click', openShortcutSettings);

  // Pro features
  if (elements.btnCollection) elements.btnCollection.addEventListener('click', showCollectionModal);
  // btn-dedup removed from HTML — Similar entry is now the SimilarInline
  // Preact component in toolbar row 2, which handles clicks internally.
  if (elements.btnMultitab) elements.btnMultitab.addEventListener('click', showMultiTabModal);
  // The DedupModal / CollectionModal / MultitabModal Preact shells own their
  // close/cancel/back buttons (each calls the corresponding store-mutation
  // directly via onClick), so no addEventListener needed for those any more.
  // Cached refs (elements.btnDedupClose / btnCancelDedup / btnCollectionBack /
  // btnMultitabClose / btnCancelMultitab) are intentionally left dangling —
  // they would point to detached nodes anyway after Preact mount, and no
  // remaining code dereferences them.
  if (elements.btnProgressClose)
    elements.btnProgressClose.addEventListener('click', handleProgressClose);
  if (elements.btnScanCancel) elements.btnScanCancel.addEventListener('click', handleScanCancel);
  if (elements.btnStartExtraction) {
    elements.btnStartExtraction.addEventListener('click', () => {
      const checked = Array.from(
        document.querySelectorAll<HTMLInputElement>('.tab-checkbox input:checked')
      ).map((c) => parseInt(c.value));
      if (checked.length > 0) {
        startMultiTabExtract(checked);
      } else {
        showToast('Select at least one tab', 'error');
      }
    });
  }

  // Multi-tab select all
  const multitabSelectAll = document.getElementById('multitab-select-all');
  if (multitabSelectAll) multitabSelectAll.addEventListener('click', toggleMultitabSelectAll);

  if (elements.btnRemoveDuplicates)
    elements.btnRemoveDuplicates.addEventListener('click', removeDuplicates);
  if (elements.btnCollectionExport)
    elements.btnCollectionExport.addEventListener('click', exportCollection);

  // Reverse search menu items
  document.querySelectorAll<HTMLElement>('[data-engine]').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const engine = item.dataset.engine || '';
      // Free tier: only engines in FREE_LIMITS.REVERSE_SEARCH_ENGINES are allowed
      if (
        !state.isProUser &&
        !FREE_LIMITS.REVERSE_SEARCH_ENGINES.includes(
          engine as (typeof FREE_LIMITS.REVERSE_SEARCH_ENGINES)[number]
        )
      ) {
        const engineLabel = engine.charAt(0).toUpperCase() + engine.slice(1);
        showToast(t('pro_feature_blocked_reverse_search', { engine: engineLabel }), 'warning');
        showProUpgradeModal();
        if (elements.reverseSearchMenu) elements.reverseSearchMenu.classList.add('hidden');
        return;
      }
      const url = elements.reverseSearchMenu?.dataset.imageUrl || '';
      reverseSearch(url, engine);
      if (elements.reverseSearchMenu) elements.reverseSearchMenu.classList.add('hidden');
    });
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', () => {
      const modal = overlay.closest('_modal');
      if (modal) modal.classList.add('hidden');
    });
  });

  // Keyboard
  document.addEventListener('keydown', handleKeyDown);

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (
      !target.closest('.download-group') &&
      !target.closest('#download-dropdown') &&
      !target.closest('#btn-download-toggle')
    ) {
      hideDownloadDropdown();
    }
    if (!target.closest('.filter-btn') && !target.closest('.filter-dropdown')) {
      closeAllFilterDropdowns();
    }
    if (!target.closest('.context-menu') && !target.closest('.btn-search')) {
      if (elements.reverseSearchMenu) {
        elements.reverseSearchMenu.classList.add('hidden');
      }
    }
  });

  // Empty state reset/rescan button
  const resetBtn = document.getElementById('btn-reset-filters');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const resetBtnLabel = resetBtn.querySelector('span');
      if (resetBtnLabel && resetBtnLabel.textContent?.trim() === 'Rescan Images') {
        // Force reset isFetching so a new scan can start
        state.isFetching = false;
        loadCurrentTab(true, state.currentTabId ?? undefined);
        return;
      }
      // Reset all filters to defaults, restoring custom size from global
      // settings (not zero) so the global > local contract is preserved.
      state.activeFilters = {
        size: 'all',
        sizeMin: 0,
        sizeMax: Infinity,
        types: [],
        layout: 'all',
        urlKeyword: '',
        color: null,
        customMinEnabled: state.appSettings.enableMinSize,
        customMinWidth: state.appSettings.minWidth ?? 0,
        customMinHeight: state.appSettings.minHeight ?? 0,
        customMaxEnabled: state.appSettings.enableMaxSize,
        customMaxWidth: state.appSettings.maxWidth ?? 8000,
        customMaxHeight: state.appSettings.maxHeight ?? 8000,
      };
      if (elements.filterUrlInput) (elements.filterUrlInput as HTMLInputElement).value = '';
      // Restore custom size input fields from global settings
      syncCustomSizeInputsFromSettings();
      document.querySelectorAll<HTMLInputElement>('.type-checkbox').forEach((cb) => {
        cb.checked = true;
      });
      document.querySelectorAll('[data-size-filter]').forEach((o) => o.classList.remove('active'));
      document
        .querySelectorAll('[data-layout-filter]')
        .forEach((o) => o.classList.remove('active'));
      const defaultSizeOption = document.querySelector('[data-size-filter="all"]');
      if (defaultSizeOption) defaultSizeOption.classList.add('active');
      const defaultLayoutOption = document.querySelector('[data-layout-filter="all"]');
      if (defaultLayoutOption) defaultLayoutOption.classList.add('active');
      document
        .querySelectorAll('#color-swatches .color-swatch')
        .forEach((s) => s.classList.remove('active'));
      const allColorOption = document.querySelector('[data-color-filter="all"]');
      if (allColorOption) allColorOption.classList.add('active');
      updateFilterButtonLabels();
      applyFilters();
    });
  }

  // Pro feature click guards + Upgrade button + ProUpgradeModal close.
  // License-section events live in ./license-ui and are bound lazily on
  // the first Settings modal open.
  bindProGuards();
}

// ============================================
// Initialize
// ============================================
document.addEventListener('DOMContentLoaded', init);

// ── E2E test hooks ──────────────────────────────────────────────────────────
// Playwright's addInitScript runs before any module on the page evaluates,
// so it can set this flag synchronously. We expose the store + filter API
// on a clearly-namespaced global so e2e tests can drive deterministic state
// transitions without clicking through 4-deep dropdown menus. No-op in
// production (the flag is never set by any real user code).
declare global {
  interface Window {
    __IH_E2E__?: boolean;
    __IH__?: {
      store: typeof import('./state').store;
      applyFilters: typeof import('./filter').applyFilters;
      /**
       * Lazy-load and return the multitab module (sidepanel/multitab.ts).
       * Used by e2e tests to drive showMultiTabModal / loadTabList without
       * relying on the toolbar button's click wiring (which has init-time
       * timing quirks under Playwright). The module is the same one the
       * production lazy wrapper in pro-features.ts loads, so the rendered
       * DOM matches real-user paths.
       */
      loadMultitab: () => Promise<typeof import('./multitab')>;
      /**
       * Synchronous applyTheme accessor for e2e — saves us from driving
       * the full Settings modal → radio flip → click Save → chrome.
       * storage.local round-trip just to verify applyTheme's contract
       * (set/clear documentElement.dataset.theme). The Settings modal
       * → save → applyTheme integration itself is exercised manually
       * during dev; what we want to pin in e2e is the leaf behavior.
       */
      applyTheme: typeof import('./settings').applyTheme;
      /**
       * Direct entry into sidepanel's port message handler. Used by the
       * live-monitor e2e to dispatch synthetic IMAGES_DISCOVERED frames
       * without going through the real chrome.runtime + background SW
       * fan-out (which Playwright cannot inject into). The function
       * itself is the same one wired into uiPort.onMessage at L103, so
       * the four guard branches (fromTabId mismatch / isTabSwitching /
       * isSilentScanning|isFetching|isMultiTabExtracting / isScanning)
       * exercise their production paths verbatim.
       */
      handleMessage: typeof import('./message').handleMessage;
    };
  }
}

if (typeof window !== 'undefined' && window.__IH_E2E__) {
  // Lazy-imported to avoid a circular boot-time import; both modules are
  // already in the bundle so this resolves synchronously off the module
  // cache once init runs.
  void Promise.all([
    import('./state'),
    import('./filter'),
    import('./settings'),
    import('./message'),
  ]).then(([stateMod, filterMod, settingsMod, messageMod]) => {
    window.__IH__ = {
      store: stateMod.store,
      applyFilters: filterMod.applyFilters,
      loadMultitab: () => import('./multitab'),
      applyTheme: settingsMod.applyTheme,
      handleMessage: messageMod.handleMessage,
    };
  });
}
