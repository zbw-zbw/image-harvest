// Settings: Hotkey display, Settings modal, Filter dropdowns, Pro feature visibility, License UI

import { MESSAGE_TYPES, PRICING_PAGE_URL } from '../shared/constants';
import { applyFilters, renderColorSwatches, syncCustomSizeInputsFromSettings } from './filter';
import { detectSimilarImages } from './pro-features';
import { fetchImages, processImageExtras } from './scan';
import { elements, state } from './state';
import {
  checkNarrowMode,
  showConfirmDialog,
  showToast,
  updateFilterButtonLabels
} from './ui';

// ============================================
// Hotkey Display
// ============================================
const MODIFIER_SYMBOLS: Record<string, string> = {
  Ctrl: '⌃',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Command: '⌘',
  MacCtrl: '⌃'
};

function formatShortcutKey(key: string): string {
  return MODIFIER_SYMBOLS[key] || key.toUpperCase();
}

export async function renderHotkeyDisplay(): Promise<void> {
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
  parts.forEach((part) => {
    const kbd = document.createElement('kbd');
    kbd.textContent = formatShortcutKey(part.trim());
    container.appendChild(kbd);
  });
}

export function openShortcutSettings(): void {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

// ============================================
// Settings
// ============================================
export function showSettings(): void {
  if (!elements.settingsModal) return;
  elements.settingsModal.classList.remove('hidden');
  // Reset scroll position to top
  const modalBody = elements.settingsModal.querySelector('.modal-body');
  if (modalBody) modalBody.scrollTop = 0;

  // Render hotkey display
  renderHotkeyDisplay();

  // Fill current values
  setToggle('setting-side-panel', state.appSettings.useSidePanel !== false);
  setRadio('layout-density', (state.appSettings.density as string) || 'standard');
  setRadio('theme', (state.appSettings.theme as string) || 'system');
  setSelect('setting-default-group', (state.appSettings.defaultGroup as string) || 'none');
  setToggle('setting-download-options', state.appSettings.specifyDownload !== false);
  setInput('setting-subfolder', (state.appSettings.subfolder as string) || '{domain}');
  setInput('setting-filename', (state.appSettings.filenameTemplate as string) || 'img_{index}_{original}.{format}');
  setSelect('setting-convert-format', (state.appSettings.convertFormat as string) || 'none');
  setToggle('setting-all-frames', !!state.appSettings.searchAllFrames);
  setToggle('setting-live-monitor', state.isProUser ? (state.appSettings.liveMonitoring !== false) : false);
  setToggle('setting-min-size', !!state.appSettings.enableMinSize);
  setInput('setting-min-width', String((state.appSettings.minWidth as number | undefined) || 50));
  setInput('setting-min-height', String((state.appSettings.minHeight as number | undefined) || 50));
  setToggle('setting-max-size', !!state.appSettings.enableMaxSize);
  setInput('setting-max-width', String((state.appSettings.maxWidth as number | undefined) || 8000));
  setInput('setting-max-height', String((state.appSettings.maxHeight as number | undefined) || 8000));
  setToggle('setting-similar-detection', state.isProUser ? (state.appSettings.enableSimilarDetection !== false) : false);
  setToggle('setting-color-extract', state.isProUser ? (state.appSettings.enableColorExtraction !== false) : false);
  setToggle('setting-no-warning', !!state.appSettings.noManyFilesWarning);

  // Sync setting-inputs sub-panel visibility
  const togglePanelPairs: Array<[string, string]> = [
    ['setting-download-options', 'download-options-inputs'],
    ['setting-min-size', 'min-size-inputs'],
    ['setting-max-size', 'max-size-inputs']
  ];
  togglePanelPairs.forEach(([checkboxId, panelId]) => {
    const checkbox = document.getElementById(checkboxId) as HTMLInputElement | null;
    const panel = document.getElementById(panelId);
    if (checkbox && panel) {
      panel.classList.toggle('hidden', !checkbox.checked);
    }
  });
}

export function closeSettings(): void {
  if (elements.settingsModal) elements.settingsModal.classList.add('hidden');
}

export async function saveSettings(): Promise<void> {
  const prevSimilar = state.appSettings.enableSimilarDetection;
  const prevColor = state.appSettings.enableColorExtraction;
  const prevSearchAllFrames = state.appSettings.searchAllFrames;

  state.appSettings.useSidePanel = getToggle('setting-side-panel');
  state.appSettings.density = (getRadio('layout-density') || 'standard') as 'compact' | 'standard' | 'comfortable';
  state.appSettings.theme = (getRadio('theme') || 'system') as 'system' | 'light' | 'dark';
  state.appSettings.defaultGroup = (getSelect('setting-default-group') || 'none') as 'none' | 'domain' | 'format' | 'size' | 'tab';
  state.appSettings.specifyDownload = getToggle('setting-download-options');
  state.appSettings.subfolder = getInput('setting-subfolder') || '{domain}';
  state.appSettings.filenameTemplate = getInput('setting-filename') || 'img_{index}_{original}.{format}';
  state.appSettings.convertFormat = (getSelect('setting-convert-format') || 'none') as 'none' | 'png' | 'jpg' | 'jpeg' | 'webp';
  state.appSettings.searchAllFrames = getToggle('setting-all-frames');
  // Free tier: Live Monitoring requires Pro
  state.appSettings.liveMonitoring = state.isProUser ? getToggle('setting-live-monitor') : false;
  state.appSettings.enableMinSize = getToggle('setting-min-size');
  state.appSettings.minWidth = parseInt(getInput('setting-min-width')) || 50;
  state.appSettings.minHeight = parseInt(getInput('setting-min-height')) || 50;
  state.appSettings.enableMaxSize = getToggle('setting-max-size');
  state.appSettings.maxWidth = parseInt(getInput('setting-max-width')) || 8000;
  state.appSettings.maxHeight = parseInt(getInput('setting-max-height')) || 8000;
  state.appSettings.enableSimilarDetection = getToggle('setting-similar-detection');
  state.appSettings.enableColorExtraction = getToggle('setting-color-extract');
  state.appSettings.noManyFilesWarning = getToggle('setting-no-warning');

  try {
    const stored = await chrome.storage.local.get('appSettings');
    const previousUseSidePanel = (stored.appSettings as { useSidePanel?: boolean } | undefined)?.useSidePanel;
    await chrome.storage.local.set({ appSettings: state.appSettings });
    applyTheme(state.appSettings.theme as string);
    applyDensity(state.appSettings.density as string);
    updateLiveIndicator();

    // Only switch display mode and show mode toast if it actually changed
    const displayModeChanged = previousUseSidePanel !== undefined
      && previousUseSidePanel !== state.appSettings.useSidePanel;
    if (displayModeChanged) {
      await switchDisplayMode(!!state.appSettings.useSidePanel);
    }

    // Re-apply filters with new settings and update filter bar UI.
    // Skip applyFilters while a scan is in progress — allImages is still empty
    // and rendering would flash "No images found". The ongoing fetchImages()
    // will call applyFilters() automatically when it completes.
    syncCustomSizeInputsFromSettings();
    await applyProFeatureVisibility();
    if (!state.isFetching) {
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
    const searchAllFramesChanged = !!state.appSettings.searchAllFrames !== !!prevSearchAllFrames;
    if (searchAllFramesChanged) {
      fetchImages();
    }

    // If pro features were newly enabled, auto-process existing images.
    // Use !! to normalize undefined/false so first-save doesn't trigger reprocessing.
    const similarNewlyEnabled = !!state.appSettings.enableSimilarDetection && !prevSimilar;
    const colorNewlyEnabled = !!state.appSettings.enableColorExtraction && !prevColor;
    if ((similarNewlyEnabled || colorNewlyEnabled) && state.allImages.length > 0) {
      processImageExtras(state.allImages);
    }
  } catch {
    showToast('Failed to save settings', 'error');
  }
}

export function resetSettings(): void {
  state.appSettings = {
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

export function updateLiveIndicator(): void {
  if (elements.liveIndicator) {
    const isActive = state.isProUser && state.appSettings.liveMonitoring !== false;
    elements.liveIndicator.classList.toggle('hidden', !isActive);
  }
}

export function applyTheme(theme: string): void {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export function applyDensity(density: string): void {
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

export async function switchDisplayMode(useSidePanel: boolean): Promise<void> {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.runtime.sendMessage({
      type: 'SET_DISPLAY_MODE',
      useSidePanel,
      openSidePanel: useSidePanel && state.isPopupMode,
      tabId: activeTab?.id
    });

    // popup → side panel: window.close() reliably closes the popup window.
    //   The background already opened the side panel for the active tab.
    // side panel → popup: window.close() does NOT close a side panel
    //   (Chrome ignores it). Instead, the background just disabled
    //   chrome.sidePanel for every relevant tab, which dismisses the panel
    //   UI on its own. We still call window.close() defensively as a no-op.
    window.close();
  } catch {
    /* ignore */
  }
}

// Settings helpers
export function setToggle(id: string, value: boolean): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el) el.checked = !!value;
}
export function getToggle(id: string): boolean {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el ? el.checked : false;
}
export function setSelect(id: string, value: string): void {
  const el = document.getElementById(id) as HTMLElement | null;
  if (!el) return;
  el.dataset.value = value;
  const textEl = el.querySelector('.setting-select-text');
  const options = el.querySelectorAll<HTMLElement>('.setting-select-option');
  options.forEach(opt => {
    const isActive = opt.dataset.value === value;
    opt.classList.toggle('active', isActive);
    if (isActive && textEl) textEl.textContent = opt.textContent;
  });
}
export function getSelect(id: string): string {
  const el = document.getElementById(id) as HTMLElement | null;
  return el ? (el.dataset.value || '') : '';
}
export function setRadio(name: string, value: string): void {
  const radio = document.querySelector<HTMLInputElement>(`input[type="radio"][name="${name}"][value="${value}"]`);
  if (radio) radio.checked = true;
}
export function getRadio(name: string): string {
  const checked = document.querySelector<HTMLInputElement>(`input[type="radio"][name="${name}"]:checked`);
  return checked ? checked.value : '';
}
export function setInput(id: string, value: string | number): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el) el.value = String(value);
}
export function getInput(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el ? el.value : '';
}

// ============================================
// Filter Dropdowns
// ============================================
export function toggleFilterDropdown(filterType: string): void {
  const dropdown = document.getElementById(`filter-${filterType}`) as HTMLElement | null;
  const btn = document.querySelector<HTMLElement>(`.filter-btn[data-filter="${filterType}"]`);
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

export function closeAllFilterDropdowns(): void {
  document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.add('hidden'));
}

// ============================================
// Pro Feature Visibility
// ============================================

export async function applyProFeatureVisibility(): Promise<void> {
  const wasPro = state.isProUser;

  // Check license status via background
  try {
    const proStatus = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.VALIDATE_LICENSE });
    state.isProUser = proStatus?.isPro === true;
  } catch {
    state.isProUser = false;
  }

  // When user just became Pro, auto-enable Pro default features and persist
  if (state.isProUser && !wasPro) {
    state.appSettings.enableSimilarDetection = true;
    state.appSettings.enableColorExtraction = true;
    state.appSettings.liveMonitoring = true;
    await chrome.storage.local.set({ appSettings: state.appSettings });

    // Process existing images with newly enabled Pro features
    if (state.allImages.length > 0) {
      processImageExtras(state.allImages);
    }
  }

  const similarEnabled = state.isProUser && state.appSettings.enableSimilarDetection !== false;

  // Similar Detection: dedup button & info in status bar
  const dedupInfo = document.getElementById('dedup-info');
  if (dedupInfo) dedupInfo.classList.toggle('hidden', !similarEnabled || state.similarGroups.length === 0);

  // Color Extraction: color bars always visible for all users (visual appeal)
  // But copy HEX and color filter require Pro (handled in click events)
  const colorExtractionEnabled = state.appSettings.enableColorExtraction !== false;
  const colorFilterBtn = document.querySelector<HTMLElement>('.filter-btn[data-filter="color"]');
  const colorFilterDropdown = document.getElementById('filter-color');
  if (colorFilterBtn) colorFilterBtn.style.display = colorExtractionEnabled ? '' : 'none';
  if (colorFilterDropdown) colorFilterDropdown.style.display = colorExtractionEnabled ? '' : 'none';

  // When color extraction is disabled in settings, clear any active color filter
  if (!colorExtractionEnabled && state.activeFilters.color) {
    state.activeFilters.color = null;
    applyFilters();
  }

  // Pro toggles: Similar Detection, Color Extract, Live Monitoring
  // Not greyed out, not disabled visually. Click interception handles Pro check.
  const proToggles: Array<HTMLInputElement | null> = [
    document.getElementById('setting-similar-detection') as HTMLInputElement | null,
    document.getElementById('setting-color-extract') as HTMLInputElement | null,
    document.getElementById('setting-live-monitor') as HTMLInputElement | null
  ];
  proToggles.forEach(toggle => {
    if (!toggle) return;
    if (!state.isProUser) {
      toggle.checked = false;
    }
  });

  // Format Conversion: free users can open dropdown to see options, but selecting triggers Pro upgrade
  // Pro check is handled in the setting-select click event
  if (!state.isProUser) {
    setSelect('setting-convert-format', 'none');
  }

  // Download format dropdown: Pro items are not disabled, just show PRO badge
  // Pro check is handled in the click event

  // Custom Naming: disable filename template input for free users
  const filenameInput = document.getElementById('setting-filename') as HTMLInputElement | null;
  if (filenameInput) {
    if (state.isProUser) {
      filenameInput.disabled = false;
      filenameInput.closest('.setting-item')?.classList.remove('pro-locked');
    } else {
      filenameInput.disabled = true;
      filenameInput.closest('.setting-item')?.classList.add('pro-locked');
    }
  }

  // Subfolder naming: disable for free users
  const subfolderInput = document.getElementById('setting-subfolder') as HTMLInputElement | null;
  if (subfolderInput) {
    if (state.isProUser) {
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
export function formatDateYMD(dateStr: string | number): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

export function maskLicenseKey(key: string): string {
  if (!key || key.length <= 8) return key || '';
  return key.substring(0, 4) + '-****-****-' + key.substring(key.length - 4);
}

// Internal: extends HTMLElement with a one-time-bound flag
type BoundButton = HTMLElement & { _bound?: boolean };

export async function updateTopProStatus(): Promise<void> {
  const freeSection = document.getElementById('pro-status-free');
  const activeSection = document.getElementById('pro-status-active');
  if (!freeSection || !activeSection) return;

  if (state.isProUser) {
    freeSection.classList.add('hidden');
    activeSection.classList.remove('hidden');

    try {
      const info = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_LICENSE_STATUS });

      const planLabel = document.getElementById('pro-plan-label');
      if (planLabel && info?.plan) {
        const planLabels: Record<string, string> = { monthly: 'Monthly', yearly: 'Yearly', lifetime: 'Lifetime' };
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
    const deactivateBtn = document.getElementById('btn-top-deactivate') as BoundButton | null;
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
export function showProUpgradeModal(): void {
  const modal = document.getElementById('pro-upgrade-modal');
  if (modal) {
    modal.classList.remove('hidden');
    // Reset scroll position to top
    const modalBody = modal.querySelector('.modal-body');
    if (modalBody) modalBody.scrollTop = 0;
    const input = document.getElementById('pro-modal-key-input') as HTMLInputElement | null;
    if (input) input.focus();
  }
}

export function closeProUpgradeModal(): void {
  const modal = document.getElementById('pro-upgrade-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Update the License section UI in settings modal
 */
export async function updateLicenseUI(): Promise<void> {
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
        const key: string = info.licenseKey;
        keyMasked.textContent = key.length > 8
          ? key.substring(0, 4) + '-****-****-' + key.substring(key.length - 4)
          : key;
      }

      // Plan badge
      const planBadge = document.getElementById('license-plan-badge');
      if (planBadge && info.plan) {
        const planLabels: Record<string, string> = { monthly: 'Monthly', yearly: 'Yearly', lifetime: 'Lifetime' };
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
export function bindLicenseEvents(): void {
  // ---- Settings modal: License activation ----
  const activateBtn = document.getElementById('btn-activate-license') as HTMLButtonElement | null;
  const deactivateBtn = document.getElementById('btn-deactivate-license') as HTMLButtonElement | null;
  const licenseInput = document.getElementById('license-key-input') as HTMLInputElement | null;
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

  const proModalActivateBtn = document.getElementById('btn-pro-modal-activate') as HTMLButtonElement | null;
  const proModalInput = document.getElementById('pro-modal-key-input') as HTMLInputElement | null;
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
  const proLockedButtons: Array<{ id: string; label: string }> = [
    { id: 'btn-collection', label: 'Collection' },
    { id: 'btn-multitab', label: 'Multi-Tab Extract' }
  ];
  proLockedButtons.forEach(({ id, label }) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      if (!state.isProUser) {
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
  const proSettingToggles: Array<HTMLElement | null> = [
    document.getElementById('setting-similar-detection'),
    document.getElementById('setting-color-extract'),
    document.getElementById('setting-live-monitor')
  ];
  proSettingToggles.forEach(toggle => {
    if (!toggle) return;
    toggle.addEventListener('click', (e) => {
      if (!state.isProUser) {
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
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) return;
    input.addEventListener('focus', (e) => {
      if (!state.isProUser) {
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
export async function activateLicenseFromInput(
  inputEl: HTMLInputElement,
  errorEl: HTMLElement | null,
  buttonEl: HTMLButtonElement,
  closeModalOnSuccess = false
): Promise<void> {
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
export function bindLicenseKeyFormatter(inputEl: HTMLInputElement): void {
  inputEl.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    const val = target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const parts: string[] = [];
    for (let i = 0; i < val.length && i < 16; i += 4) {
      parts.push(val.substring(i, i + 4));
    }
    target.value = parts.join('-');
  });
}
