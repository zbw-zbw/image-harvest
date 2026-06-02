// Initialization: init function, tab management, DOM caching, event binding
// This is the single entry point loaded by sidepanel.html / popup.html.
// Importing the other modules below ensures they are bundled together.

import { FREE_LIMITS, MESSAGE_TYPES, TIMING } from '../shared/constants';
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
  applyFileSizeInputs,
  applyFileSizePreset,
  applyFilters,
  clearCustomSizeInputs,
  resetAllFilters,
  syncCustomSizeInputsFromSettings,
} from './filter';
import { mountPreactComponents } from './components/mount';
import { handleKeyDown, handleMessage } from './message';
import {
  exportCollection,
  removeDuplicates,
  showCollectionModal,
  showMultiTabModal,
  startMultiTabExtract,
  toggleMultitabSelectAll,
} from './pro-features';
import { renderImages } from './render';
import { handleScanCancel } from './scan';
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
import { clearTabImageCache } from '../shared/storage';
import { elements, state } from './state';
import {
  applyTranslations,
  handleProgressClose,
  initResizeObserver,
  showLoading,
  showToast,
  toggleViewMode,
  updateFilterButtonLabels,
} from './ui';
import { debounce, loadSettings } from './utils';
import {
  handleTabChange,
  handleTabUpdated,
  isWithinTabSwitchGrace,
  loadCurrentTab,
} from './tab-lifecycle';

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

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

function connectToBackground(): void {
  try {
    const port = chrome.runtime.connect({ name: 'image-harvest-ui' });
    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(() => {
      if (!chrome.runtime?.id) {
        extensionContextInvalidated = true;
        return;
      }
      // SW went idle — schedule reconnect
      if (reconnectAttempts >= TIMING.MAX_RECONNECT_ATTEMPTS) return;
      reconnectAttempts++;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectToBackground, TIMING.RECONNECT_DELAY_MS);
    });
    // Successful connect means runtime is alive — reset counter
    reconnectAttempts = 0;
    extensionContextInvalidated = false;
  } catch {
    // SW not ready yet — retry after a delay
    if (chrome.runtime?.id && reconnectAttempts < TIMING.MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectToBackground, TIMING.RECONNECT_DELAY_MS);
    }
  }
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
      // E2E tests set this synchronous flag via addInitScript to bypass
      // the privacy modal without a chrome.storage race condition.
      if (
        (window as unknown as { __IH_SKIP_PRIVACY_MODAL__?: boolean }).__IH_SKIP_PRIVACY_MODAL__
      ) {
        return;
      }
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

  // Start AI quota load early (in parallel with scan) so the badge is ready
  // by the time image cards render and the user can click AI Tag.
  const quotaPromise = proVisibilityPromise.then(async () => {
    if (state.isProUser) {
      const { getRemainingQuota } = await import('../shared/ai-quota');
      state.aiQuotaRemaining = await getRemainingQuota();
    }
  });
  updateFilterButtonLabels();
  applyTranslations();
  initResizeObserver();

  // Register locale-change listener so a runtime language switch in Settings
  // immediately updates all DOM text without requiring a panel reload.
  onLocaleChange(() => {
    applyTranslations();
    updateFilterButtonLabels();
    updateSelectionUI();

    // Refresh license section labels (plan badge, expiry text) that are set
    // via t() in updateLicenseUI rather than data-i18n attributes, and the
    // hotkey "Click to set" button label — but only when Settings is open.
    if (state.settingsModalState.open) {
      void import('./license-ui').then((mod) => mod.updateLicenseUI());
      void import('./settings').then((mod) => mod.renderHotkeyDisplay());
    }

    // Bump the localeTick counter so Preact components that call t() re-render
    // with the new translations without requiring a panel reload.
    state.localeTick = (state.localeTick ?? 0) + 1;
  });

  // Establish a long-lived connection to background for broadcast messages.
  // MV3 service workers can go idle after 30s of inactivity, which tears
  // down the port. We must distinguish that (recoverable) from extension
  // reload (unrecoverable, chrome.runtime.id disappears). On recoverable
  // disconnects, reconnect automatically so tab-switch and live-monitoring
  // keep working.
  connectToBackground();

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
        // Close all hover-triggered dropdowns that may have stayed open
        // while the panel was hidden (browser freezes :hover state).
        // 1. JS-controlled download dropdown
        document.getElementById('download-group')?.classList.remove('dl-dropdown-open');
        // 2. CSS :hover card dropdowns — force browser to recalculate hover
        document
          .querySelectorAll<HTMLElement>('.card-search-group, .card-dl-group')
          .forEach((el) => {
            el.style.pointerEvents = 'none';
          });
        requestAnimationFrame(() => {
          document
            .querySelectorAll<HTMLElement>('.card-search-group, .card-dl-group')
            .forEach((el) => {
              el.style.pointerEvents = '';
            });
        });
        if (state.isTabSwitching || isWithinTabSwitchGrace()) {
          lastHiddenTime = 0;
          return;
        }
        // Only trigger rescan if the panel was hidden for more than 1 second
        const wasHiddenLong = Date.now() - lastHiddenTime > TIMING.VISIBILITY_HIDDEN_THRESHOLD_MS;
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

        loadCurrentTab(false, state.currentTabId).catch(() => {});
      }
    });
  }

  // Initial load for the current tab — always force a fresh scan on panel open.
  // The session cache (chrome.storage.session) may hold stale data from a
  // previous panel session where the page content has since changed (lazy-load,
  // SPA navigation, dynamic content). A full rescan ensures the user always
  // sees up-to-date images.
  await loadCurrentTab(true);

  // Ensure the Pro visibility promise settles before marking init done,
  // so state.isProUser is resolved and UI badges are correct.
  await proVisibilityPromise;

  await quotaPromise;

  state.isInitialized = true;
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
      resetAllFilters();
      // Show loading overlay immediately to prevent stale content flash
      showLoading();
      loadCurrentTab(true, state.currentTabId ?? undefined).catch(() => {});
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
      // Close the dropdown immediately on click — the download starts,
      // user doesn't need the format menu visible anymore.
      const dlGroup = document.getElementById('download-group');
      if (dlGroup) dlGroup.classList.remove('dl-dropdown-open');
      const hasSelection = state.selectedImages.size > 0;
      const imagesToDownload = hasSelection
        ? state.filteredImages.filter((img) => state.selectedImages.has(img.id))
        : state.filteredImages;
      if (imagesToDownload.length === 0) return;
      if (imagesToDownload.length === 1) {
        downloadSingle(imagesToDownload[0], null);
      } else {
        if (!hasSelection) {
          // Temporarily select all for zip download, then clear
          state.filteredImages.forEach((img) => state.selectedImages.add(img.id));
          downloadSelectedAsZip(null).finally(() => {
            state.selectedImages.clear();
          });
        } else {
          downloadSelectedAsZip(null);
        }
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
            downloadSelectedAsZip(convertFormat).finally(() => {
              state.selectedImages.clear();
            });
          } else {
            downloadSelectedAsZip(convertFormat);
          }
        } else {
          const hasSelection = state.selectedImages.size > 0;
          const imagesToDownload = hasSelection
            ? state.filteredImages.filter((img) => state.selectedImages.has(img.id))
            : state.filteredImages;
          if (imagesToDownload.length === 0) return;
          if (imagesToDownload.length === 1) {
            downloadSingle(imagesToDownload[0], convertFormat);
          } else {
            if (!hasSelection) {
              state.filteredImages.forEach((img) => state.selectedImages.add(img.id));
              downloadSelectedAsZip(convertFormat).finally(() => {
                state.selectedImages.clear();
              });
            } else {
              downloadSelectedAsZip(convertFormat);
            }
          }
        }
      }
    });
  }

  // Download group: JS-controlled hover (replaces CSS :hover which flashed
  // when Preact re-renders broke the hover chain during click).
  const dlGroup = document.getElementById('download-group');
  if (dlGroup) {
    let dlHideTimer: ReturnType<typeof setTimeout> | null = null;
    let dlLocked = false; // Lock prevents mouseenter from re-opening after click
    dlGroup.addEventListener('mouseenter', () => {
      if (dlLocked) return;
      if (dlHideTimer) {
        clearTimeout(dlHideTimer);
        dlHideTimer = null;
      }
      dlGroup.classList.add('dl-dropdown-open');
    });
    dlGroup.addEventListener('mouseleave', () => {
      dlLocked = false; // Unlock when mouse fully leaves the group
      if (dlHideTimer) {
        clearTimeout(dlHideTimer);
        dlHideTimer = null;
      }
      dlHideTimer = setTimeout(() => {
        dlGroup.classList.remove('dl-dropdown-open');
      }, 100);
    });
    // When the download button is clicked, lock the dropdown closed until
    // the user moves the mouse away and back.
    dlGroup.addEventListener('click', () => {
      dlLocked = true;
      dlGroup.classList.remove('dl-dropdown-open');
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

  // File size preset options in File Size dropdown
  document.querySelectorAll<HTMLElement>('[data-filesize-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.filesizeFilter!;
      document
        .querySelectorAll('[data-filesize-filter]')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      applyFileSizePreset(preset);
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

  // File size (KB) filter — apply on input change with debounce
  const fileSizeMinInput = document.getElementById(
    'filter-filesize-min'
  ) as HTMLInputElement | null;
  const fileSizeMaxInput = document.getElementById(
    'filter-filesize-max'
  ) as HTMLInputElement | null;
  if (fileSizeMinInput || fileSizeMaxInput) {
    const debouncedFileSize = debounce(() => applyFileSizeInputs(), 400);
    fileSizeMinInput?.addEventListener('input', debouncedFileSize);
    fileSizeMaxInput?.addEventListener('input', debouncedFileSize);
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
        showToast(t('toast_select_at_least_one_tab'), 'error');
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
      const modal = overlay.closest('.modal');
      if (modal) modal.classList.add('hidden');
    });
  });

  // Keyboard
  document.addEventListener('keydown', handleKeyDown);

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    // download dropdown is now CSS hover — no JS toggle needed
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
      if (resetBtnLabel && resetBtnLabel.textContent?.trim() === t('empty_rescan_images')) {
        // Force reset isFetching so a new scan can start
        state.isFetching = false;
        loadCurrentTab(true, state.currentTabId ?? undefined).catch(() => {});
        return;
      }
      resetAllFilters();
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
      /**
       * Lazy-load the dedup-ui module and call showDedupModal(). Used by
       * e2e tests that need to open the dedup modal when the SimilarInline
       * link is disabled (similarGroups=[]).
       */
      showDedupModal: () => Promise<void>;
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
      showDedupModal: async () => {
        const { showDedupModal } = await import('./dedup-ui');
        showDedupModal();
      },
    };
  });
}
