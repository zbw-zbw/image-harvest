// Initialization: init function, tab management, DOM caching, event binding

// ============================================
// Initialization
// ============================================
async function init() {
  isPopupMode = window.location.pathname.endsWith('popup.html');

  cacheElements();
  await loadSettings();

  applyTheme(appSettings.theme || 'system');
  applyDensity(appSettings.density || 'standard');
  updateLiveIndicator();

  bindEvents();
  syncCustomSizeInputsFromSettings();
  await applyProFeatureVisibility();
  updateFilterButtonLabels();
  initResizeObserver();

  // Show loading overlay immediately — before establishing any message
  // connections that could trigger early image rendering via IMAGES_DISCOVERED
  showLoading();

  // Establish a long-lived connection to background for broadcast messages
  // (avoids "Could not establish connection" errors from runtime.sendMessage)
  const uiPort = chrome.runtime.connect({ name: 'image-snatcher-ui' });
  uiPort.onMessage.addListener(handleMessage);

  // Listen for tab switches / navigations so we can auto-refresh
  if (!isPopupMode) {
    chrome.tabs.onActivated.addListener(handleTabChange);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);
    // Clean up cache when a tab is closed
    chrome.tabs.onRemoved.addListener((tabId) => {
      tabCache.delete(tabId);
      clearTabImageCache(tabId);
    });
  }

  // Clean up page highlights when side panel / popup is closed
  window.addEventListener('beforeunload', () => {
    removeAllHighlightsOnPage();
    // Notify background to stop tracking this tab's side panel
    if (!isPopupMode && currentTabId != null) {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SIDE_PANEL_CLOSED,
        tabId: currentTabId
      }).catch(() => { /* ignore */ });
    }
  });

  // Handle sidepanel becoming visible again after being hidden.
  // Chrome may keep the JS context alive when the sidepanel is closed,
  // so init() won't re-run. We use visibilitychange to detect re-open
  // and trigger a rescan with progress overlay on top of cached images.
  if (!isPopupMode) {
    let lastHiddenTime = 0;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        lastHiddenTime = Date.now();
      } else if (document.visibilityState === 'visible' && isInitialized) {
        // Skip rescan if this visibility change was caused by a tab switch.
        // Tab switches already handle loading via handleTabChange — the
        // visibilitychange handler is only meant for panel close/reopen.
        // Do NOT reset isTabSwitching here — only handleTabChange's finally
        // block should reset it, to prevent race conditions where multiple
        // visibilitychange events during a single tab switch cause the
        // second event to slip through and trigger an unwanted rescan.
        if (isTabSwitching) {
          lastHiddenTime = 0;
          return;
        }
        // Only trigger rescan if the panel was hidden for more than 1 second
        // (avoids rescan on brief focus changes like alt-tab)
        const wasHiddenLong = (Date.now() - lastHiddenTime) > 1000;
        if (!wasHiddenLong) return;

        lastHiddenTime = 0;

        // If the current tab already has a valid in-memory cache, skip the
        // rescan. This handles the common case where the user opens an image
        // in a new tab (or switches windows) and comes back — the tab hasn't
        // changed and the cached images are still valid. The visibilitychange
        // rescan is only meant for panel close/reopen scenarios where the
        // cache may be stale (session storage only) or missing entirely.
        if (currentTabId != null && tabCache.has(currentTabId)) {
          return;
        }

        loadCurrentTab(false, true);
      }
    });
  }

  // Initial load for the current tab (trigger rescan with progress overlay)
  await loadCurrentTab(false, true);
  isInitialized = true;
}

/**
 * Determine the current active tab and either show the restricted
 * placeholder or scan for images.
 */
async function loadCurrentTab(forceRescan = false, showCacheToast = false) {
  let activeTab;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;
    if (!activeTab || isRestrictedUrl(activeTab.url)) {
      currentTabId = null;
      hideLoading();
      showRestricted();
      return;
    }
  } catch (error) {
    console.warn('Failed to query active tab:', error);
    currentTabId = null;
    hideLoading();
    showRestricted();
    return;
  }

  const tabId = activeTab.id;
  const tabUrl = activeTab.url;
  currentTabId = tabId;

  // Notify background that the side panel is open on this tab so it can
  // track per-tab side panel state (only show panel on tabs user opened it on)
  if (!isPopupMode) {
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SIDE_PANEL_OPENED,
      tabId
    }).catch(() => { /* ignore */ });
  }

  // Normal page — make sure the main UI is visible
  hideRestricted();

  // Check in-memory per-tab cache first (fastest — same sidepanel session)
  if (!forceRescan && tabCache.has(tabId)) {
    const cached = tabCache.get(tabId);
    if (cached.url === tabUrl) {
      allImages = cached.images;
      selectedImages = cached.selectedImages;
      hideLoading();
      applyFilters();
      updateSelectionUI();

      // When opening/reopening the panel, trigger a full rescan in the
      // background so the user sees up-to-date images on top of the cache.
      // Skip rescan during tab switches — the user is just switching tabs,
      // not reopening the panel, so cached images are sufficient.
      if (showCacheToast && !isTabSwitching) {
        loadCurrentTab(true, false);
      }
      return;
    }
  }

  // Check session storage cache (survives popup/sidepanel close-reopen)
  if (!forceRescan) {
    const sessionCached = await getTabImageCache(tabId, tabUrl);
    if (sessionCached && sessionCached.images && sessionCached.images.length > 0) {
      // Restore cached images instantly so the user sees results immediately
      allImages = sessionCached.images.map(img => ({
        ...img,
        id: img.id || generateId(img.url),
        colors: null,
        phash: null
      }));
      selectedImages = new Set();
      hideLoading();
      applyFilters();
      updateSelectionUI();

      // Trigger a full rescan to get up-to-date images.
      // Skip rescan during tab switches — cached images are sufficient.
      if (!isTabSwitching) {
        loadCurrentTab(true, false);
      }
      return;
    }
  }

  // No cache available — full scan with loading UI
  await fetchImages();

  // Cache the results for this tab (both in-memory and session storage)
  tabCache.set(tabId, {
    url: tabUrl,
    images: allImages,
    selectedImages: new Set(selectedImages)
  });
  saveTabImageCache(tabId, tabUrl, allImages);

  // Establish a named port connection to the content script so it can
  // detect when the UI is closed (port disconnect) and auto-clean highlights.
  try {
    const port = chrome.tabs.connect(tabId, { name: 'image-snatcher-ui' });
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        // Content script not ready or tab was closed — silently ignore
      }
    });
  } catch (connectError) {
    // Ignore connection errors for restricted pages
  }
}

async function handleTabChange(activeInfo) {
  const newTabId = activeInfo.tabId;

  // Save current tab state to cache before switching
  if (currentTabId != null && currentTabId !== newTabId) {
    const cachedUrl = tabCache.get(currentTabId)?.url || '';
    tabCache.set(currentTabId, {
      url: cachedUrl,
      images: [...allImages],
      selectedImages: new Set(selectedImages)
    });
    // Persist to session storage so it survives panel close/reopen
    if (cachedUrl) {
      saveTabImageCache(currentTabId, cachedUrl, allImages);
    }
  }

  // Cancel any in-progress silent rescan or fetch so it won't update UI
  // after we switch to the new tab.
  isFetching = false;
  isSilentScanning = false;
  isScanning = false;

  // Mark that this visibility change is caused by a tab switch, so the
  // visibilitychange handler won't trigger an unnecessary rescan.
  isTabSwitching = true;

  // Update currentTabId immediately so other handlers (handleTabUpdated,
  // IMAGES_DISCOVERED) know which tab is active.
  currentTabId = newTabId;

  // Check in-memory cache synchronously BEFORE any await — this avoids
  // showing stale images from the previous tab during the async gap.
  const cached = tabCache.get(newTabId);

  // Fast path (synchronous): if the target tab has an in-memory cache,
  // restore the cached state and render immediately — no async gap means
  // the user never sees the previous tab's images flash on screen.
  if (cached) {
    try {
      allImages = cached.images;
      selectedImages = cached.selectedImages;
      // Invalidate the rendered-filter cache so applyFilters() will call
      // renderImages() even if the filtered IDs haven't changed — the grid
      // DOM may have been cleared by showRestricted() / showLoading().
      lastRenderedFilteredIds = null;
      hideLoading();
      hideRestricted();
      applyFilters();
      updateSelectionUI();

      // Verify the URL still matches asynchronously (tab may have navigated)
      try {
        const newTab = await chrome.tabs.get(newTabId);
        if (currentTabId !== newTabId) return;
        if (!newTab || isRestrictedUrl(newTab.url)) {
          currentTabId = null;
          clearCurrentImages();
          showRestricted();
          return;
        }
        if (cached.url !== newTab.url) {
          // URL changed since cache was saved — do a full rescan
          await loadCurrentTab(true);
          return;
        }
      } catch {
        // Tab may have been closed — ignore
      }

      // Notify background that the side panel is open on this tab
      if (!isPopupMode) {
        chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.SIDE_PANEL_OPENED,
          tabId: newTabId
        }).catch(() => { /* ignore */ });
      }
    } finally {
      isTabSwitching = false;
    }
    return;
  }

  // No cache — check if the target tab is restricted BEFORE showing loading
  // skeleton. This avoids unnecessarily clearing the grid and adding
  // scanning-disabled class only to immediately switch to restricted state.
  try {
    let newTab;
    try {
      newTab = await chrome.tabs.get(newTabId);
    } catch {
      // Tab may have been closed already
    }

    // Abort if the user has already switched to another tab during await
    if (currentTabId !== newTabId) return;

    // Check for restricted URLs — show restricted state directly without
    // going through showLoading() first (which would clear grid & add
    // scanning-disabled class unnecessarily).
    if (!newTab || isRestrictedUrl(newTab.url)) {
      currentTabId = null;
      showRestricted();
      return;
    }

    // Normal page — show loading skeleton and do a full scan.
    showLoading();

    // Cache miss — fall back to full loadCurrentTab (will scan with loading UI).
    await loadCurrentTab();
  } finally {
    // Always reset isTabSwitching after tab switch handling completes, even if
    // visibilitychange didn't fire (e.g. sidepanel stays visible during
    // tab switches). This prevents the flag from being stuck forever.
    isTabSwitching = false;
  }
}

let tabUpdatedTimer = null;

function handleTabUpdated(tabId, changeInfo, tab) {
  if (changeInfo.status !== 'complete') return;

  // Ignore tab updates during a tab switch — handleTabChange handles loading.
  if (isTabSwitching) return;

  // React if the updated tab is the currently active one, OR if we are
  // currently showing the restricted state (currentTabId === null) and the
  // updated tab is the active tab in this window — this handles navigation
  // from a restricted page (e.g. chrome://) to a normal page.
  if (tabId !== currentTabId) {
    if (currentTabId !== null || !tab?.active) return;
  }

  const newUrl = tab?.url || changeInfo.url || '';

  // If the new URL is a restricted page, show the restricted state immediately.
  // But skip if we are already showing the restricted state (currentTabId === null)
  // to avoid redundant state transitions that could interfere with a concurrent
  // tab switch back to a normal page.
  if (isRestrictedUrl(newUrl)) {
    if (currentTabId !== null) {
      clearTimeout(tabUpdatedTimer);
      tabCache.delete(tabId);
      clearTabImageCache(tabId);
      clearCurrentImages();
      currentTabId = null;
      showRestricted();
    }
    return;
  }

  // Check if the URL actually changed — if the tab was merely re-activated
  // (e.g. user switched away and back) the browser may fire onUpdated with
  // status 'complete' even though nothing changed. In that case skip the
  // rescan; the cached images are still valid.
  const cachedEntry = tabCache.get(tabId);
  if (cachedEntry && cachedEntry.url === newUrl) {
    return;
  }

  // When navigating away from a restricted page, show loading immediately
  // so the user sees feedback instead of the stale intro page.
  // For normal URL changes we do NOT call showLoading() here — fetchImages()
  // will handle it. Calling it prematurely hides the image grid and exposes
  // an ugly opaque background.
  if (currentTabId === null) {
    currentTabId = tabId;
    hideRestricted();
    showLoading();
  }

  // URL changed (navigation, SPA route, etc.) — do a full rescan after a
  // short delay to let the page finish rendering.
  // Skip if init() hasn't completed yet (avoids double-scan on first open)
  if (!isInitialized) return;

  clearTimeout(tabUpdatedTimer);
  // Show loading overlay immediately so stale cached images are covered
  if (!isFetching) showLoading();
  tabUpdatedTimer = setTimeout(() => {
    if (isFetching) return;
    tabCache.delete(tabId);
    clearTabImageCache(tabId);
    clearCurrentImages();
    loadCurrentTab(true);
  }, 800);
}

function cacheElements() {
  const ids = [
    'image-grid', 'loading-state', 'empty-state', 'error-state', 'restricted-state',
    'settings-modal', 'progress-modal', 'progress-fill',
    'progress-text', 'progress-current', 'toast-container',
    'selected-count', 'total-count', 'btn-download', 'btn-download-toggle', 'btn-select-all',
    'download-dropdown', 'download-group', 'group-mode', 'btn-view-toggle',
    'found-info', 'found-action-count', 'btn-refresh',
    'filter-url-input', 'reverse-search-menu',
    'dedup-modal', 'dedup-body', 'collection-modal', 'collection-body',
    'multitab-modal', 'multitab-list', 'btn-multitab', 'btn-settings',
    'btn-collection', 'btn-dedup', 'similar-count',
    'btn-save-settings', 'btn-reset-defaults',
    'btn-settings-close', 'btn-start-extraction', 'btn-remove-duplicates',
    'btn-collection-export', 'collection-search',
    'btn-dedup-close', 'btn-cancel-dedup', 'btn-multitab-close', 'btn-cancel-multitab', 'btn-collection-back', 'btn-progress-close',
    'found-count',
    'setting-side-panel', 'setting-density', 'setting-theme',
    'setting-default-group', 'setting-download-options',
    'setting-subfolder', 'setting-filename', 'setting-convert',
    'live-indicator',
    'setting-all-frames', 'setting-live-monitor',
    'setting-min-size', 'setting-min-width', 'setting-min-height',
    'setting-max-size', 'setting-max-width', 'setting-max-height',
    'setting-similar-detection', 'setting-color-extract',
    'setting-no-warning', 'download-count', 'download-label',
    'scan-overlay', 'scan-progress-fill', 'scan-progress-text', 'scan-progress-title',
    'scan-progress-current', 'btn-scan-cancel'
  ];

  ids.forEach(id => {
    const camelCase = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    elements[camelCase] = document.getElementById(id);
  });
}

function bindEvents() {
  // Refresh / rescan images
  if (elements.btnRefresh) {
    elements.btnRefresh.addEventListener('click', () => {
      // Force rescan: invalidate cache for current tab and reload
      if (currentTabId != null) {
        tabCache.delete(currentTabId);
        clearTabImageCache(currentTabId);
      }
      isFetching = false;
      // Show loading overlay immediately to prevent stale content flash
      showLoading();
      loadCurrentTab(true);
    });
  }

  // Select all / clear
  if (elements.btnSelectAll) {
    elements.btnSelectAll.addEventListener('click', () => {
      const allFilteredSelected = filteredImages.length > 0 && filteredImages.every(img => selectedImages.has(img.id));
      if (allFilteredSelected) {
        clearSelection();
      } else {
        selectAll();
      }
    });
  }

  // Download button - click to download selected images, or all if none selected
  if (elements.btnDownload) {
    elements.btnDownload.addEventListener('click', (e) => {
      e.stopPropagation();
      hideDownloadDropdown();
      const hasSelection = selectedImages.size > 0;
      const imagesToDownload = hasSelection
        ? filteredImages.filter(img => selectedImages.has(img.id))
        : filteredImages;
      if (imagesToDownload.length === 0) return;
      if (imagesToDownload.length === 1) {
        downloadSingle(imagesToDownload[0], null);
      } else {
        if (!hasSelection) {
          filteredImages.forEach(img => selectedImages.add(img.id));
          updateSelectionUI();
        }
        downloadSelectedAsZip(null);
      }
    });
  }

  // Download dropdown toggle - click to show/hide format options
  if (elements.btnDownloadToggle) {
    elements.btnDownloadToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDownloadDropdown();
    });
  }

  // Download dropdown items
  if (elements.downloadDropdown) {
    elements.downloadDropdown.addEventListener('click', (e) => {
      const item = e.target.closest('[data-format]');
      if (item) {
        const format = item.dataset.format;
        // Pro check: non-original formats require Pro
        if (!_isProUser && format !== 'original') {
          showToast('Format conversion is a Pro feature. Upgrade to unlock!', 'warning');
          showProUpgradeModal();
          hideDownloadDropdown();
          return;
        }
        // Update active state on download format items
        elements.downloadDropdown.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        const convertFormat = format === 'original' ? null : format;
        const isZip = item.dataset.zip === 'true';
        if (isZip) {
          if (selectedImages.size === 0) {
            filteredImages.forEach(img => selectedImages.add(img.id));
            updateSelectionUI();
          }
          downloadSelectedAsZip(convertFormat);
        } else {
          const hasSelection = selectedImages.size > 0;
          const imagesToDownload = hasSelection
            ? filteredImages.filter(img => selectedImages.has(img.id))
            : filteredImages;
          if (imagesToDownload.length === 0) return;
          if (!hasSelection) {
            filteredImages.forEach(img => selectedImages.add(img.id));
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
      currentGroupMode = e.target.value;
      renderImages();
    });
  }

  // Filter buttons (only those with data-filter that have dropdowns)
  document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = btn.dataset.filter;
      if (type) toggleFilterDropdown(type);
    });
  });

  // Size filter options
  document.querySelectorAll('[data-size-filter]').forEach(opt => {
    opt.addEventListener('click', () => {
      const val = opt.dataset.sizeFilter;
      activeFilters.size = val;
      switch (val) {
        case 'all': activeFilters.sizeMin = 0; activeFilters.sizeMax = Infinity; break;
        case 'small': activeFilters.sizeMin = 0; activeFilters.sizeMax = 100; break;
        case 'medium': activeFilters.sizeMin = 100; activeFilters.sizeMax = 500; break;
        case 'large': activeFilters.sizeMin = 500; activeFilters.sizeMax = 1000; break;
        case 'xl': activeFilters.sizeMin = 1000; activeFilters.sizeMax = Infinity; break;
      }
      // Clear custom size inputs when selecting a preset
      clearCustomSizeInputs();
      appSettings.enableMinSize = false;
      appSettings.enableMaxSize = false;

      document.querySelectorAll('[data-size-filter]').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      updateFilterButtonLabels();
      applyFilters();
      closeAllFilterDropdowns();
    });
  });

  // Custom size inputs in Size dropdown
  ['filter-min-width', 'filter-min-height', 'filter-max-width', 'filter-max-height'].forEach(inputId => {
    const input = document.getElementById(inputId);
    if (input) {
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('input', () => applyCustomSizeInputs());
    }
  });

  // Type filter checkboxes
  document.querySelectorAll('.type-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const allCheckbox = document.querySelector('.type-checkbox[value="all"]');
      const typeCheckboxes = document.querySelectorAll('.type-checkbox:not([value="all"])');

      if (cb.value === 'all') {
        // Clicking "All" toggles all type checkboxes
        typeCheckboxes.forEach(tc => { tc.checked = cb.checked; });
      } else {
        // Clicking a specific type: uncheck "All" if any type is unchecked
        const allTypesChecked = Array.from(typeCheckboxes).every(tc => tc.checked);
        if (allCheckbox) allCheckbox.checked = allTypesChecked;
      }

      const checkedTypes = Array.from(document.querySelectorAll('.type-checkbox:not([value="all"]):checked')).map(c => c.value);
      const allChecked = allCheckbox && allCheckbox.checked;
      activeFilters.types = allChecked ? [] : checkedTypes;
      updateFilterButtonLabels();
      applyFilters();
    });
  });

  // Layout filter options
  document.querySelectorAll('[data-layout-filter]').forEach(opt => {
    opt.addEventListener('click', () => {
      activeFilters.layout = opt.dataset.layoutFilter;
      document.querySelectorAll('[data-layout-filter]').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      updateFilterButtonLabels();
      applyFilters();
      closeAllFilterDropdowns();
    });
  });

  // Group filter options
  document.querySelectorAll('[data-group-filter]').forEach(opt => {
    opt.addEventListener('click', () => {
      const val = opt.dataset.groupFilter;
      // Free tier: only 'none' and 'format' grouping allowed
      if (!_isProUser && !FREE_LIMITS.ALLOWED_GROUP_MODES.includes(val)) {
        showToast('Advanced grouping is a Pro feature. Upgrade to unlock!', 'warning');
        showProUpgradeModal();
        closeAllFilterDropdowns();
        return;
      }
      currentGroupMode = val;
      if (elements.groupMode) elements.groupMode.value = val;
      document.querySelectorAll('[data-group-filter]').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      updateFilterButtonLabels();
      renderImages();
      closeAllFilterDropdowns();
    });
  });

  // Sort filter options
  document.querySelectorAll('[data-sort-filter]').forEach(opt => {
    opt.addEventListener('click', () => {
      currentSortMode = opt.dataset.sortFilter;
      document.querySelectorAll('[data-sort-filter]').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      updateFilterButtonLabels();
      applyFilters();
      closeAllFilterDropdowns();
    });
  });

  // URL filter (with IME composition awareness and debounce)
  if (elements.filterUrlInput) {
    let isComposing = false;
    const debouncedUrlFilter = debounce((value) => {
      activeFilters.urlKeyword = value.toLowerCase();
      updateFilterButtonLabels();
      applyFilters();
    }, 300);

    elements.filterUrlInput.addEventListener('compositionstart', () => {
      isComposing = true;
    });
    elements.filterUrlInput.addEventListener('compositionend', (e) => {
      isComposing = false;
      debouncedUrlFilter(e.target.value);
    });
    elements.filterUrlInput.addEventListener('input', (e) => {
      if (isComposing) return;
      debouncedUrlFilter(e.target.value);
    });
  }

  // Color filter - "All Colors" option
  document.querySelectorAll('[data-color-filter]').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      if (opt.dataset.colorFilter === 'all') {
        activeFilters.color = null;
        document.querySelectorAll('#color-swatches .color-swatch').forEach(s => s.classList.remove('active'));
        opt.classList.add('active');
        updateFilterButtonLabels();
        applyFilters();
        closeAllFilterDropdowns();
      }
    });
  });

  // Settings
  if (elements.btnSettings) {
    elements.btnSettings.addEventListener('click', showSettings);
  }
  if (elements.btnSettingsClose) {
    elements.btnSettingsClose.addEventListener('click', closeSettings);
  }
  if (elements.btnSaveSettings) {
    elements.btnSaveSettings.addEventListener('click', saveSettings);
  }
  if (elements.btnResetDefaults) {
    elements.btnResetDefaults.addEventListener('click', resetSettings);
  }

  // Toggle setting-inputs sub-panels based on checkbox state
  const settingTogglePairs = [
    ['setting-download-options', 'download-options-inputs'],
    ['setting-min-size', 'min-size-inputs'],
    ['setting-max-size', 'max-size-inputs']
  ];
  settingTogglePairs.forEach(([checkboxId, panelId]) => {
    const checkbox = document.getElementById(checkboxId);
    const panel = document.getElementById(panelId);
    if (checkbox && panel) {
      checkbox.addEventListener('change', () => {
        panel.classList.toggle('hidden', !checkbox.checked);
      });
    }
  });

  // Custom setting-select dropdowns
  document.querySelectorAll('.setting-select').forEach(selectEl => {
    const btn = selectEl.querySelector('.setting-select-btn');
    const dropdown = selectEl.querySelector('.setting-select-dropdown');
    if (btn && dropdown) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.setting-select-dropdown').forEach(d => {
          if (d !== dropdown) d.classList.add('hidden');
        });
        dropdown.classList.toggle('hidden');
      });
      dropdown.querySelectorAll('.setting-select-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const value = opt.dataset.value;
          // Pro check for setting-default-group: Domain/Size/Tab require Pro
          if (selectEl.id === 'setting-default-group' && !_isProUser && ['domain', 'size', 'tab'].includes(value)) {
            dropdown.classList.add('hidden');
            closeSettings();
            showToast('Advanced grouping is a Pro feature. Upgrade to unlock!', 'warning');
            showProUpgradeModal();
            return;
          }
          // Pro check for setting-convert-format: PNG/JPG/WebP require Pro
          if (selectEl.id === 'setting-convert-format' && !_isProUser && ['png', 'jpg', 'webp'].includes(value)) {
            dropdown.classList.add('hidden');
            closeSettings();
            showToast('Format conversion is a Pro feature. Upgrade to unlock!', 'warning');
            showProUpgradeModal();
            return;
          }
          setSelect(selectEl.id, value);
          dropdown.classList.add('hidden');
        });
      });
    }
  });

  // Close setting-select dropdowns on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.setting-select-dropdown').forEach(d => d.classList.add('hidden'));
  });

  // Hotkey link - open browser shortcut settings
  const hotkeyLink = document.getElementById('hotkey-link');
  if (hotkeyLink) {
    hotkeyLink.addEventListener('click', openShortcutSettings);
  }

  // Pro features
  if (elements.btnCollection) {
    elements.btnCollection.addEventListener('click', showCollectionModal);
  }
  if (elements.btnCollectionBack) {
    elements.btnCollectionBack.addEventListener('click', () => {
      if (elements.collectionModal) elements.collectionModal.classList.add('hidden');
    });
  }
  if (elements.btnDedup) {
    elements.btnDedup.addEventListener('click', showDedupModal);
  }
  if (elements.btnDedupClose) {
    elements.btnDedupClose.addEventListener('click', closeDedupModal);
  }
  if (elements.btnCancelDedup) {
    elements.btnCancelDedup.addEventListener('click', closeDedupModal);
  }
  if (elements.btnMultitab) {
    elements.btnMultitab.addEventListener('click', showMultiTabModal);
  }
  if (elements.btnMultitabClose) {
    elements.btnMultitabClose.addEventListener('click', () => {
      if (elements.multitabModal) elements.multitabModal.classList.add('hidden');
    });
  }
  if (elements.btnCancelMultitab) {
    elements.btnCancelMultitab.addEventListener('click', () => {
      if (elements.multitabModal) elements.multitabModal.classList.add('hidden');
    });
  }
  if (elements.btnProgressClose) {
    elements.btnProgressClose.addEventListener('click', handleProgressClose);
  }
  if (elements.btnScanCancel) {
    elements.btnScanCancel.addEventListener('click', handleScanCancel);
  }
  if (elements.btnStartExtraction) {
    elements.btnStartExtraction.addEventListener('click', () => {
      const checked = Array.from(document.querySelectorAll('.tab-checkbox input:checked')).map(c => parseInt(c.value));
      if (checked.length > 0) {
        startMultiTabExtract(checked);
      } else {
        showToast('Select at least one tab', 'error');
      }
    });
  }

  // Multi-tab select all
  const multitabSelectAll = document.getElementById('multitab-select-all');
  if (multitabSelectAll) {
    multitabSelectAll.addEventListener('click', toggleMultitabSelectAll);
  }
  if (elements.btnRemoveDuplicates) {
    elements.btnRemoveDuplicates.addEventListener('click', removeDuplicates);
  }
  if (elements.btnCollectionExport) {
    elements.btnCollectionExport.addEventListener('click', exportCollection);
  }

  // Reverse search menu items
  document.querySelectorAll('[data-engine]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const engine = item.dataset.engine;
      // Free tier: only engines in FREE_LIMITS.REVERSE_SEARCH_ENGINES are allowed
      if (!_isProUser && !FREE_LIMITS.REVERSE_SEARCH_ENGINES.includes(engine)) {
        showToast(`${engine.charAt(0).toUpperCase() + engine.slice(1)} search requires Pro. Upgrade to unlock!`, 'warning');
        showProUpgradeModal();
        elements.reverseSearchMenu.classList.add('hidden');
        return;
      }
      const url = elements.reverseSearchMenu.dataset.imageUrl;
      reverseSearch(url, engine);
      elements.reverseSearchMenu.classList.add('hidden');
    });
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', () => {
      const modal = overlay.closest('.modal');
      if (modal) modal.classList.add('hidden');
    });
  });

  // Keyboard
  document.addEventListener('keydown', handleKeyDown);

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.download-group') && !e.target.closest('#download-dropdown') && !e.target.closest('#btn-download-toggle')) {
      hideDownloadDropdown();
    }
    if (!e.target.closest('.filter-btn') && !e.target.closest('.filter-dropdown')) {
      closeAllFilterDropdowns();
    }
    if (!e.target.closest('.context-menu') && !e.target.closest('.btn-search')) {
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
      if (resetBtnLabel && resetBtnLabel.textContent.trim() === 'Rescan Images') {
        // Force reset isFetching so a new scan can start
        isFetching = false;
        loadCurrentTab(true);
        return;
      }
      activeFilters = { size: 'all', sizeMin: 0, sizeMax: Infinity, types: [], layout: 'all', urlKeyword: '', color: null };
      if (elements.filterUrlInput) elements.filterUrlInput.value = '';
      document.querySelectorAll('.type-checkbox').forEach(cb => { cb.checked = true; });
      document.querySelectorAll('[data-size-filter]').forEach(o => o.classList.remove('active'));
      document.querySelectorAll('[data-layout-filter]').forEach(o => o.classList.remove('active'));
      const defaultSizeOption = document.querySelector('[data-size-filter="all"]');
      if (defaultSizeOption) defaultSizeOption.classList.add('active');
      const defaultLayoutOption = document.querySelector('[data-layout-filter="all"]');
      if (defaultLayoutOption) defaultLayoutOption.classList.add('active');
      document.querySelectorAll('#color-swatches .color-swatch').forEach(s => s.classList.remove('active'));
      const allColorOption = document.querySelector('[data-color-filter="all"]');
      if (allColorOption) allColorOption.classList.add('active');
      updateFilterButtonLabels();
      applyFilters();
    });
  }

  // License events
  bindLicenseEvents();

}

// ============================================
// Initialize
// ============================================
document.addEventListener('DOMContentLoaded', init);
