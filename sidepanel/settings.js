// Settings: Hotkey display, Settings modal, Filter dropdowns, Pro feature visibility, License UI

// ============================================
// Hotkey Display
// ============================================
const MODIFIER_SYMBOLS = {
  Ctrl: '⌃',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Command: '⌘',
  MacCtrl: '⌃'
};

function formatShortcutKey(key) {
  return MODIFIER_SYMBOLS[key] || key.toUpperCase();
}

async function renderHotkeyDisplay() {
  const container = document.getElementById('hotkey-keys');
  if (!container) return;

  let shortcut = '';
  try {
    const commands = await chrome.commands.getAll();
    const actionCommand = commands.find(cmd => cmd.name === '_execute_action');
    if (actionCommand && actionCommand.shortcut) {
      shortcut = actionCommand.shortcut;
    }
  } catch {
    // Fallback: read from manifest
  }

  container.innerHTML = '';

  if (!shortcut) {
    const notSet = document.createElement('span');
    notSet.className = 'hotkey-not-set';
    notSet.textContent = 'Not set';
    container.appendChild(notSet);
    return;
  }

  // Parse shortcut like "Ctrl+Shift+S" or "⌘+Shift+S"
  const parts = shortcut.split('+');
  parts.forEach((part, index) => {
    if (index > 0) {
      // No visible separator needed — kbd tags have gap via CSS
    }
    const kbd = document.createElement('kbd');
    kbd.textContent = formatShortcutKey(part.trim());
    container.appendChild(kbd);
  });
}

function openShortcutSettings() {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

// ============================================
// Settings
// ============================================
function showSettings() {
  if (!elements.settingsModal) return;
  elements.settingsModal.classList.remove('hidden');
  // Reset scroll position to top
  const modalBody = elements.settingsModal.querySelector('.modal-body');
  if (modalBody) modalBody.scrollTop = 0;

  // Render hotkey display
  renderHotkeyDisplay();

  // Fill current values
  setToggle('setting-side-panel', appSettings.useSidePanel !== false);
  setRadio('layout-density', appSettings.density || 'standard');
  setRadio('theme', appSettings.theme || 'system');
  setSelect('setting-default-group', appSettings.defaultGroup || 'none');
  setToggle('setting-download-options', appSettings.specifyDownload !== false);
  setInput('setting-subfolder', appSettings.subfolder || '{domain}');
  setInput('setting-filename', appSettings.filenameTemplate || 'img_{index}_{original}.{format}');
  setSelect('setting-convert-format', appSettings.convertFormat || 'none');
  setToggle('setting-all-frames', appSettings.searchAllFrames || false);
  setToggle('setting-live-monitor', _isProUser ? (appSettings.liveMonitoring !== false) : false);
  setToggle('setting-min-size', appSettings.enableMinSize || false);
  setInput('setting-min-width', appSettings.minWidth || 50);
  setInput('setting-min-height', appSettings.minHeight || 50);
  setToggle('setting-max-size', appSettings.enableMaxSize || false);
  setInput('setting-max-width', appSettings.maxWidth || 8000);
  setInput('setting-max-height', appSettings.maxHeight || 8000);
  setToggle('setting-similar-detection', _isProUser ? (appSettings.enableSimilarDetection !== false) : false);
  setToggle('setting-color-extract', _isProUser ? (appSettings.enableColorExtraction !== false) : false);
  setToggle('setting-no-warning', appSettings.noManyFilesWarning || false);

  // Sync setting-inputs sub-panel visibility
  const togglePanelPairs = [
    ['setting-download-options', 'download-options-inputs'],
    ['setting-min-size', 'min-size-inputs'],
    ['setting-max-size', 'max-size-inputs']
  ];
  togglePanelPairs.forEach(([checkboxId, panelId]) => {
    const checkbox = document.getElementById(checkboxId);
    const panel = document.getElementById(panelId);
    if (checkbox && panel) {
      panel.classList.toggle('hidden', !checkbox.checked);
    }
  });
}

function closeSettings() {
  if (elements.settingsModal) elements.settingsModal.classList.add('hidden');
}

async function saveSettings() {
  const prevSimilar = appSettings.enableSimilarDetection;
  const prevColor = appSettings.enableColorExtraction;
  const prevSearchAllFrames = appSettings.searchAllFrames;

  appSettings.useSidePanel = getToggle('setting-side-panel');
  appSettings.density = getRadio('layout-density') || 'standard';
  appSettings.theme = getRadio('theme') || 'system';
  appSettings.defaultGroup = getSelect('setting-default-group') || 'none';
  appSettings.specifyDownload = getToggle('setting-download-options');
  appSettings.subfolder = getInput('setting-subfolder') || '{domain}';
  appSettings.filenameTemplate = getInput('setting-filename') || 'img_{index}_{original}.{format}';
  appSettings.convertFormat = getSelect('setting-convert-format') || 'none';
  appSettings.searchAllFrames = getToggle('setting-all-frames');
  // Free tier: Live Monitoring requires Pro
  appSettings.liveMonitoring = _isProUser ? getToggle('setting-live-monitor') : false;
  appSettings.enableMinSize = getToggle('setting-min-size');
  appSettings.minWidth = parseInt(getInput('setting-min-width')) || 50;
  appSettings.minHeight = parseInt(getInput('setting-min-height')) || 50;
  appSettings.enableMaxSize = getToggle('setting-max-size');
  appSettings.maxWidth = parseInt(getInput('setting-max-width')) || 8000;
  appSettings.maxHeight = parseInt(getInput('setting-max-height')) || 8000;
  appSettings.enableSimilarDetection = getToggle('setting-similar-detection');
  appSettings.enableColorExtraction = getToggle('setting-color-extract');
  appSettings.noManyFilesWarning = getToggle('setting-no-warning');

  try {
    const previousUseSidePanel = (await chrome.storage.local.get('appSettings')).appSettings?.useSidePanel;
    await chrome.storage.local.set({ appSettings });
    applyTheme(appSettings.theme);
    applyDensity(appSettings.density);
    updateLiveIndicator();

    // Only switch display mode and show mode toast if it actually changed
    const displayModeChanged = previousUseSidePanel !== undefined && previousUseSidePanel !== appSettings.useSidePanel;
    if (displayModeChanged) {
      await switchDisplayMode(appSettings.useSidePanel);
    }

    // Re-apply filters with new settings and update filter bar UI.
    // Skip applyFilters while a scan is in progress — allImages is still empty
    // and rendering would flash "No images found". The ongoing fetchImages()
    // will call applyFilters() automatically when it completes.
    syncCustomSizeInputsFromSettings();
    await applyProFeatureVisibility();
    if (!isFetching) {
      applyFilters();
    }
    updateFilterButtonLabels();
    closeSettings();
    if (!displayModeChanged) {
      showToast('Settings saved', 'success');
    }
    // When display mode changed, switchDisplayMode() will close the current
    // window automatically. No toast needed — it would be invisible anyway.

    // If searchAllFrames changed, re-scan to include/exclude iframe images.
    // Use !! to normalize undefined/false so that undefined→false doesn't
    // trigger an unnecessary rescan.
    const searchAllFramesChanged = !!appSettings.searchAllFrames !== !!prevSearchAllFrames;
    if (searchAllFramesChanged) {
      fetchImages();
    }

    // If pro features were newly enabled, auto-process existing images.
    // Use !! to normalize undefined/false so first-save doesn't trigger reprocessing.
    const similarNewlyEnabled = !!appSettings.enableSimilarDetection && !prevSimilar;
    const colorNewlyEnabled = !!appSettings.enableColorExtraction && !prevColor;
    if ((similarNewlyEnabled || colorNewlyEnabled) && allImages.length > 0) {
      processImageExtras(allImages);
    }
  } catch (error) {
    showToast('Failed to save settings', 'error');
  }
}

function resetSettings() {
  appSettings = {
    useSidePanel: true, density: 'standard', theme: 'system',
    defaultGroup: 'none', specifyDownload: true, subfolder: '{domain}',
    filenameTemplate: 'img_{index}_{original}.{format}', convertFormat: 'none',
    searchAllFrames: false, liveMonitoring: false,
    enableMinSize: false, minWidth: 50, minHeight: 50,
    enableMaxSize: false, maxWidth: 8000, maxHeight: 8000,
    enableSimilarDetection: false, enableColorExtraction: false,
    noManyFilesWarning: false
  };
  showSettings();
  updateLiveIndicator();
  showToast('Settings reset to defaults', 'success');
}

function updateLiveIndicator() {
  if (elements.liveIndicator) {
    const isActive = _isProUser && appSettings.liveMonitoring !== false;
    elements.liveIndicator.classList.toggle('hidden', !isActive);
  }
}

function applyTheme(theme) {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

function applyDensity(density) {
  const app = document.getElementById('app');
  if (app) {
    app.classList.remove('density-compact', 'density-standard', 'density-comfortable');
    app.classList.add(`density-${density}`);
  }
  // Also apply to html/body for popup mode compatibility
  document.documentElement.classList.remove('density-compact', 'density-standard', 'density-comfortable');
  document.documentElement.classList.add(`density-${density}`);
  checkNarrowMode();
}

async function switchDisplayMode(useSidePanel) {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.runtime.sendMessage({
      type: 'SET_DISPLAY_MODE',
      useSidePanel,
      openSidePanel: useSidePanel && isPopupMode,
      tabId: activeTab?.id
    });

    // Close the current window after switching mode so the user can
    // re-open the extension in the new mode by clicking the icon.
    // popup → side panel: background also opens the side panel automatically.
    // side panel → popup: user clicks the icon to open the popup.
    window.close();
  } catch (e) { /* ignore */ }
}

// Settings helpers
function setToggle(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}
function getToggle(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}
function setSelect(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.dataset.value = value;
  const textEl = el.querySelector('.setting-select-text');
  const options = el.querySelectorAll('.setting-select-option');
  options.forEach(opt => {
    const isActive = opt.dataset.value === value;
    opt.classList.toggle('active', isActive);
    if (isActive && textEl) textEl.textContent = opt.textContent;
  });
}
function getSelect(id) {
  const el = document.getElementById(id);
  return el ? (el.dataset.value || '') : '';
}
function setRadio(name, value) {
  const radio = document.querySelector(`input[type="radio"][name="${name}"][value="${value}"]`);
  if (radio) radio.checked = true;
}
function getRadio(name) {
  const checked = document.querySelector(`input[type="radio"][name="${name}"]:checked`);
  return checked ? checked.value : '';
}
function setInput(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}
function getInput(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

// ============================================
// Filter Dropdowns
// ============================================
function toggleFilterDropdown(filterType) {
  const dropdown = document.getElementById(`filter-${filterType}`);
  const btn = document.querySelector(`.filter-btn[data-filter="${filterType}"]`);
  const wasHidden = dropdown && dropdown.classList.contains('hidden');
  closeAllFilterDropdowns();
  if (dropdown && wasHidden) {
    // Render dynamic content before measuring (e.g. color swatches)
    if (filterType === 'color') {
      renderColorSwatches();
    }

    if (btn && dropdown.parentElement) {
      const containerRect = dropdown.parentElement.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const dropdownLeft = btnRect.left - containerRect.left;
      const viewportWidth = document.documentElement.clientWidth;

      // Temporarily show to measure width, then position
      dropdown.style.visibility = 'hidden';
      dropdown.style.left = '0';
      dropdown.style.right = 'auto';
      dropdown.classList.remove('hidden');
      const dropdownWidth = dropdown.offsetWidth;
      dropdown.classList.add('hidden');
      dropdown.style.visibility = '';

      const wouldOverflowRight = (btnRect.left + dropdownWidth) > viewportWidth;
      const wouldOverflowLeft = (btnRect.left + dropdownLeft) < 0;

      if (wouldOverflowRight && !wouldOverflowLeft) {
        // Align dropdown right edge to viewport right with some padding
        const rightOffset = containerRect.right - Math.min(btnRect.right, viewportWidth - 4);
        dropdown.style.left = 'auto';
        dropdown.style.right = rightOffset + 'px';
      } else if (wouldOverflowRight) {
        // Both sides overflow: center in viewport
        const centeredLeft = (viewportWidth - dropdownWidth) / 2 - containerRect.left;
        dropdown.style.left = Math.max(0 - containerRect.left + 4, centeredLeft) + 'px';
        dropdown.style.right = 'auto';
      } else {
        // Default: align left edge to button left edge
        // But also check if it would overflow the left side of viewport
        const absoluteLeft = containerRect.left + dropdownLeft;
        if (absoluteLeft < 4) {
          dropdown.style.left = (4 - containerRect.left) + 'px';
        } else {
          dropdown.style.left = dropdownLeft + 'px';
        }
        dropdown.style.right = 'auto';
      }
    }
    dropdown.classList.remove('hidden');
  }
}

function closeAllFilterDropdowns() {
  document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.add('hidden'));
}

// ============================================
// Pro Feature Visibility
// ============================================
// Track current Pro status
let _isProUser = false;

async function applyProFeatureVisibility() {
  const wasPro = _isProUser;

  // Check license status via background
  try {
    const proStatus = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.VALIDATE_LICENSE });
    _isProUser = proStatus?.isPro === true;
  } catch {
    _isProUser = false;
  }

  // When user just became Pro, auto-enable Pro default features and persist
  if (_isProUser && !wasPro) {
    appSettings.enableSimilarDetection = true;
    appSettings.enableColorExtraction = true;
    appSettings.liveMonitoring = true;
    await chrome.storage.local.set({ appSettings });

    // Process existing images with newly enabled Pro features
    if (allImages.length > 0) {
      processImageExtras(allImages);
    }
  }

  const similarEnabled = _isProUser && appSettings.enableSimilarDetection !== false;

  // Similar Detection: dedup button & info in status bar
  const dedupInfo = document.getElementById('dedup-info');
  if (dedupInfo) dedupInfo.classList.toggle('hidden', !similarEnabled || similarGroups.length === 0);

  // Color Extraction: color bars always visible for all users (visual appeal)
  // But copy HEX and color filter require Pro (handled in click events)
  const colorExtractionEnabled = appSettings.enableColorExtraction !== false;
  const colorFilterBtn = document.querySelector('.filter-btn[data-filter="color"]');
  const colorFilterDropdown = document.getElementById('filter-color');
  if (colorFilterBtn) colorFilterBtn.style.display = colorExtractionEnabled ? '' : 'none';
  if (colorFilterDropdown) colorFilterDropdown.style.display = colorExtractionEnabled ? '' : 'none';

  // When color extraction is disabled in settings, clear any active color filter
  if (!colorExtractionEnabled && activeFilters.color) {
    activeFilters.color = null;
    applyFilters();
  }

  // Pro toggles: Similar Detection, Color Extract, Live Monitoring
  // Not greyed out, not disabled visually. Click interception handles Pro check.
  const proToggles = [
    document.getElementById('setting-similar-detection'),
    document.getElementById('setting-color-extract'),
    document.getElementById('setting-live-monitor')
  ];
  proToggles.forEach(toggle => {
    if (!toggle) return;
    if (!_isProUser) {
      toggle.checked = false;
    }
  });

  // Format Conversion: free users can open dropdown to see options, but selecting triggers Pro upgrade
  // Pro check is handled in the setting-select click event
  if (!_isProUser) {
    setSelect('setting-convert-format', 'none');
  }

  // Download format dropdown: Pro items are not disabled, just show PRO badge
  // Pro check is handled in the click event

  // Custom Naming: disable filename template input for free users
  const filenameInput = document.getElementById('setting-filename');
  if (filenameInput) {
    if (_isProUser) {
      filenameInput.disabled = false;
      filenameInput.closest('.setting-item')?.classList.remove('pro-locked');
    } else {
      filenameInput.disabled = true;
      filenameInput.closest('.setting-item')?.classList.add('pro-locked');
    }
  }

  // Subfolder naming: disable for free users
  const subfolderInput = document.getElementById('setting-subfolder');
  if (subfolderInput) {
    if (_isProUser) {
      subfolderInput.disabled = false;
      subfolderInput.closest('.setting-item')?.classList.remove('pro-locked');
    } else {
      subfolderInput.disabled = true;
      subfolderInput.closest('.setting-item')?.classList.add('pro-locked');
    }
  }

  // Group mode, reverse search, delete buttons: no visual disable
  // Pro check is handled in click events; PRO badges are in HTML

  // Update top Pro status area
  updateTopProStatus();

  // Update License UI in settings
  updateLicenseUI();

  // Update Live indicator and similar detection state in real-time
  updateLiveIndicator();
  detectSimilarImages();
}

/**
 * Update the top Pro status area in the toolbar.
 * Free users see "Pro" upgrade button + expandable key input.
 * Pro users see Pro badge + plan + expiry + deactivate button.
 */
function formatDateYMD(dateStr) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

function maskLicenseKey(key) {
  if (!key || key.length <= 8) return key || '';
  return key.substring(0, 4) + '-****-****-' + key.substring(key.length - 4);
}

async function updateTopProStatus() {
  const freeSection = document.getElementById('pro-status-free');
  const activeSection = document.getElementById('pro-status-active');
  if (!freeSection || !activeSection) return;

  if (_isProUser) {
    freeSection.classList.add('hidden');
    activeSection.classList.remove('hidden');

    try {
      const info = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_LICENSE_STATUS });

      const planLabel = document.getElementById('pro-plan-label');
      if (planLabel && info?.plan) {
        const planLabels = { monthly: 'Monthly', yearly: 'Yearly', lifetime: 'Lifetime' };
        planLabel.textContent = planLabels[info.plan] || info.plan;
      }

      const expiryLabel = document.getElementById('pro-expiry-label');
      if (expiryLabel) {
        if (info?.plan === 'lifetime') {
          expiryLabel.textContent = 'Never expires';
        } else if (info?.expiresAt) {
          expiryLabel.textContent = `Expires: ${formatDateYMD(info.expiresAt)}`;
        } else {
          expiryLabel.textContent = '';
        }
      }
    } catch {
      // Ignore errors, keep badge visible
    }

    // Bind deactivate button
    const deactivateBtn = document.getElementById('btn-top-deactivate');
    if (deactivateBtn && !deactivateBtn._bound) {
      deactivateBtn._bound = true;
      deactivateBtn.addEventListener('click', async () => {
        const confirmed = await showConfirmDialog({
          title: 'Deactivate License',
          message: 'Are you sure you want to deactivate your license on this device? You can activate it on another device after deactivation.',
          confirmText: 'Deactivate',
          cancelText: 'Cancel',
          type: 'danger'
        });
        if (!confirmed) return;
        try {
          await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.DEACTIVATE_LICENSE });
          showToast('License deactivated', 'info');
          await applyProFeatureVisibility();
        } catch {
          showToast('Failed to deactivate', 'error');
        }
      });
    }
  } else {
    freeSection.classList.remove('hidden');
    activeSection.classList.add('hidden');
  }
}

/**
 * Open the Pro upgrade modal
 */
function showProUpgradeModal() {
  const modal = document.getElementById('pro-upgrade-modal');
  if (modal) {
    modal.classList.remove('hidden');
    // Reset scroll position to top
    const modalBody = modal.querySelector('.modal-body');
    if (modalBody) modalBody.scrollTop = 0;
    const input = document.getElementById('pro-modal-key-input');
    if (input) input.focus();
  }
}

function closeProUpgradeModal() {
  const modal = document.getElementById('pro-upgrade-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Update the License section UI in settings modal
 */
async function updateLicenseUI() {
  const inactiveSection = document.getElementById('license-inactive');
  const activeSection = document.getElementById('license-active');
  if (!inactiveSection || !activeSection) return;

  try {
    const info = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_LICENSE_STATUS });

    if (info?.hasLicense && info.status === 'active') {
      inactiveSection.classList.add('hidden');
      activeSection.classList.remove('hidden');

      // Mask the license key: show first and last 4 chars
      const keyMasked = document.getElementById('license-key-masked');
      if (keyMasked && info.licenseKey) {
        const key = info.licenseKey;
        keyMasked.textContent = key.length > 8
          ? key.substring(0, 4) + '-****-****-' + key.substring(key.length - 4)
          : key;
      }

      // Plan badge
      const planBadge = document.getElementById('license-plan-badge');
      if (planBadge && info.plan) {
        const planLabels = { monthly: 'Monthly', yearly: 'Yearly', lifetime: 'Lifetime' };
        planBadge.textContent = planLabels[info.plan] || info.plan;
      }

      // Expiry info
      const expiresEl = document.getElementById('license-expires');
      if (expiresEl) {
        if (info.plan === 'lifetime') {
          expiresEl.textContent = 'Never expires';
        } else if (info.expiresAt) {
          expiresEl.textContent = 'Expires: ' + formatDateYMD(info.expiresAt);
        } else {
          expiresEl.textContent = '';
        }
      }
    } else {
      inactiveSection.classList.remove('hidden');
      activeSection.classList.add('hidden');
    }
  } catch {
    inactiveSection.classList.remove('hidden');
    activeSection.classList.add('hidden');
  }
}

/**
 * Bind License UI events (called once from bindEvents)
 */
function bindLicenseEvents() {
  // ---- Settings modal: License activation ----
  const activateBtn = document.getElementById('btn-activate-license');
  const deactivateBtn = document.getElementById('btn-deactivate-license');
  const licenseInput = document.getElementById('license-key-input');
  const licenseError = document.getElementById('license-error');
  const getProLink = document.getElementById('link-get-pro');

  if (activateBtn && licenseInput) {
    activateBtn.addEventListener('click', () => activateLicenseFromInput(licenseInput, licenseError, activateBtn));
    bindLicenseKeyFormatter(licenseInput);
    licenseInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') activateBtn.click(); });
  }

  if (deactivateBtn) {
    deactivateBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmDialog({
        title: 'Deactivate License',
        message: 'Are you sure you want to deactivate your license on this device? You can reactivate it later.',
        confirmText: 'Deactivate',
        cancelText: 'Cancel',
        type: 'danger'
      });
      if (!confirmed) return;
      deactivateBtn.disabled = true;
      deactivateBtn.textContent = 'Deactivating...';
      try {
        await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.DEACTIVATE_LICENSE });
        await applyProFeatureVisibility();
        showToast('License deactivated', 'info');
      } catch {
        showToast('Failed to deactivate', 'error');
      } finally {
        deactivateBtn.disabled = false;
        deactivateBtn.textContent = 'Deactivate';
      }
    });
  }

  if (getProLink) {
    getProLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: PRICING_PAGE_URL });
    });
  }

  // ---- Top toolbar: Upgrade Pro button → open modal ----
  const btnUpgradePro = document.getElementById('btn-upgrade-pro');
  if (btnUpgradePro) {
    btnUpgradePro.addEventListener('click', showProUpgradeModal);
  }

  // ---- Pro Upgrade Modal events ----
  const proModalClose = document.getElementById('btn-pro-upgrade-close');
  if (proModalClose) {
    proModalClose.addEventListener('click', closeProUpgradeModal);
  }

  const proModal = document.getElementById('pro-upgrade-modal');
  if (proModal) {
    const overlay = proModal.querySelector('.modal-overlay');
    if (overlay) overlay.addEventListener('click', closeProUpgradeModal);
  }

  const proModalActivateBtn = document.getElementById('btn-pro-modal-activate');
  const proModalInput = document.getElementById('pro-modal-key-input');
  const proModalError = document.getElementById('pro-modal-error');
  const proModalGetLink = document.getElementById('link-pro-modal-get');

  if (proModalActivateBtn && proModalInput) {
    proModalActivateBtn.addEventListener('click', () => activateLicenseFromInput(proModalInput, proModalError, proModalActivateBtn, true));
    bindLicenseKeyFormatter(proModalInput);
    proModalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') proModalActivateBtn.click(); });
  }

  if (proModalGetLink) {
    proModalGetLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: PRICING_PAGE_URL });
    });
  }

  // ---- Pro feature click interception → open upgrade modal ----
  // Pro feature buttons: open upgrade modal + toast
  const proLockedButtons = [
    { id: 'btn-collection', label: 'Collection' },
    { id: 'btn-multitab', label: 'Multi-Tab Extract' }
  ];
  proLockedButtons.forEach(({ id, label }) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      if (!_isProUser) {
        e.stopImmediatePropagation();
        e.preventDefault();
        showToast(`${label} is a Pro feature. Upgrade to unlock!`, 'warning');
        showProUpgradeModal();
      }
    }, true);
  });

  // Color filter: free users can open dropdown to see colors, but clicking a swatch triggers Pro upgrade
  // (Pro check is handled in the color swatch click event, not here)

  // Settings: Pro toggle interception (Similar Detection, Color Extract, Live Monitor)
  const proSettingToggles = [
    document.getElementById('setting-similar-detection'),
    document.getElementById('setting-color-extract'),
    document.getElementById('setting-live-monitor')
  ];
  proSettingToggles.forEach(toggle => {
    if (!toggle) return;
    toggle.addEventListener('click', (e) => {
      if (!_isProUser) {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeSettings();
        showToast('This setting requires Pro. Upgrade to unlock!', 'warning');
        showProUpgradeModal();
      }
    }, true);
  });

  // Settings: Pro input fields interception (Subfolder, Filename Template)
  ['setting-subfolder', 'setting-filename'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('focus', (e) => {
      if (!_isProUser) {
        e.preventDefault();
        input.blur();
        closeSettings();
        showToast('Custom naming is a Pro feature. Upgrade to unlock!', 'warning');
        showProUpgradeModal();
      }
    });
  });
}

/**
 * Shared license activation logic for both settings and modal inputs
 */
async function activateLicenseFromInput(inputEl, errorEl, buttonEl, closeModalOnSuccess = false) {
  const key = inputEl.value.trim();
  if (!key) {
    if (errorEl) {
      errorEl.textContent = 'Please enter a license key';
      errorEl.classList.remove('hidden');
    }
    return;
  }

  const originalText = buttonEl.textContent;
  buttonEl.disabled = true;
  buttonEl.textContent = 'Activating...';
  if (errorEl) errorEl.classList.add('hidden');

  try {
    const result = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.ACTIVATE_LICENSE,
      licenseKey: key
    });

    if (result?.success) {
      inputEl.value = '';
      if (closeModalOnSuccess) closeProUpgradeModal();
      await applyProFeatureVisibility();
      showToast('Pro activated successfully!', 'success');
    } else {
      if (errorEl) {
        errorEl.textContent = result?.error || 'Activation failed';
        errorEl.classList.remove('hidden');
      }
    }
  } catch {
    if (errorEl) {
      errorEl.textContent = 'Network error. Please try again.';
      errorEl.classList.remove('hidden');
    }
  } finally {
    buttonEl.disabled = false;
    buttonEl.textContent = originalText;
  }
}

/**
 * Auto-format license key input (add dashes every 4 chars)
 */
function bindLicenseKeyFormatter(inputEl) {
  inputEl.addEventListener('input', (e) => {
    let val = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const parts = [];
    for (let i = 0; i < val.length && i < 16; i += 4) {
      parts.push(val.substring(i, i + 4));
    }
    e.target.value = parts.join('-');
  });
}
