// Settings: Hotkey display, Settings modal, Filter dropdowns, Pro feature visibility.
// (License UI is lazy-loaded from ./license-ui on first Settings open.)

import { DEFAULT_APP_SETTINGS, MESSAGE_TYPES } from '../shared/constants';
import { applyFilters, renderColorSwatches, syncCustomSizeInputsFromSettings } from './filter';
import { detectSimilarImages } from './pro-features';
import { fetchImages, processImageExtras } from './scan';
import { state } from './state';
import { track, isOptedIn, setOptIn } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';
import { getLocale, t } from '../shared/i18n';
import { checkNarrowMode, showConfirmDialog, showToast, updateFilterButtonLabels } from './ui';

// ============================================
// Hotkey Display
// ============================================
const MODIFIER_SYMBOLS: Record<string, string> = {
  Ctrl: '⌃',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Command: '⌘',
  MacCtrl: '⌃',
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
    const actionCommand = commands.find((cmd) => cmd.name === '_execute_action');
    if (actionCommand && actionCommand.shortcut) {
      shortcut = actionCommand.shortcut;
    }
  } catch {
    // Fallback: read from manifest
  }

  container.innerHTML = '';

  if (!shortcut) {
    const setBtn = document.createElement('button');
    setBtn.className = 'hotkey-set-btn';
    setBtn.textContent = t('hotkey_click_to_set');
    setBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openShortcutSettings();
    });
    container.appendChild(setBtn);
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

// Refresh hotkey display when the user returns from chrome://extensions/shortcuts.
// Chrome doesn't provide a commands.onChanged event, so we listen for the
// page becoming visible again while Settings is open.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.settingsModalState.open) {
      void renderHotkeyDisplay();
    }
  });
}

// ============================================
// Settings
// ============================================
export function showSettings(): void {
  // Visibility is now driven by the Preact <SettingsModal> shell. The modal
  // body subtree was moved into the Preact-rendered slot at mount time, so
  // all the getElementById('setting-xxx') calls below continue to work.
  state.settingsModalState = { open: true };
  // Scroll modal body to top for a fresh entry experience.
  // Set synchronously first (works when DOM is already visible), then
  // again in rAF as a fallback for when Preact hasn't removed the
  // `hidden` class yet (scrollTop on hidden elements is a no-op).
  const modalEl = document.getElementById('settings-modal');
  const modalBody = modalEl?.querySelector('.modal-body');
  if (modalBody) {
    modalBody.scrollTop = 0;
    requestAnimationFrame(() => {
      modalBody.scrollTop = 0;
    });
  }

  // Render hotkey display
  renderHotkeyDisplay();

  // Fill current values
  setToggle('setting-side-panel', state.appSettings.useSidePanel !== false);
  setRadio('layout-density', (state.appSettings.density as string) || 'standard');
  setRadio('theme', (state.appSettings.theme as string) || 'system');
  setSelect('setting-default-group', (state.appSettings.defaultGroup as string) || 'none');
  setToggle('setting-download-options', state.appSettings.specifyDownload !== false);
  setInput('setting-subfolder', (state.appSettings.subfolder as string) || '{domain}');
  setInput(
    'setting-filename',
    (state.appSettings.filenameTemplate as string) || 'img_{index}_{original}.{format}'
  );
  setSelect('setting-convert-format', (state.appSettings.convertFormat as string) || 'none');
  setToggle('setting-all-frames', !!state.appSettings.searchAllFrames);
  setToggle('setting-live-monitor', state.appSettings.liveMonitoring !== false);
  // If the free user's live-monitor quota is exhausted, force the toggle off
  // so the UI reflects reality instead of showing a stale "checked" state.
  if (!state.isProUser && state.appSettings.liveMonitoring !== false) {
    void import('../shared/feature-quota').then(({ checkFeatureQuota }) =>
      checkFeatureQuota('liveMonitor').then(({ allowed }) => {
        if (!allowed) {
          setToggle('setting-live-monitor', false);
        }
      })
    );
  }
  setToggle('setting-min-size', !!state.appSettings.enableMinSize);
  setInput(
    'setting-min-width',
    String((state.appSettings.minWidth as number | undefined) ?? DEFAULT_APP_SETTINGS.minWidth)
  );
  setInput(
    'setting-min-height',
    String((state.appSettings.minHeight as number | undefined) ?? DEFAULT_APP_SETTINGS.minHeight)
  );
  setToggle('setting-max-size', !!state.appSettings.enableMaxSize);
  setInput(
    'setting-max-width',
    String((state.appSettings.maxWidth as number | undefined) ?? DEFAULT_APP_SETTINGS.maxWidth)
  );
  setInput(
    'setting-max-height',
    String((state.appSettings.maxHeight as number | undefined) ?? DEFAULT_APP_SETTINGS.maxHeight)
  );
  setToggle('setting-no-warning', !!state.appSettings.noManyFilesWarning);
  // Language: source of truth is `getLocale()` (resolved by detectLocale()
  // at init time), not appSettings — i18n state lives in its own
  // chrome.storage key managed by shared/i18n.ts. This mirrors the
  // setting-telemetry pattern below: a single SDK owns the value, the
  // toggle is just a one-way mirror of current state at modal-open time.
  setSelect('setting-language', getLocale());
  // Telemetry opt-in lives in its OWN chrome.storage key (managed by the
  // SDK), not in appSettings. This avoids two sources of truth and lets
  // the SDK be reused outside the sidepanel context (background SW).
  // The toggle reflects current SDK state at modal-open time; it is not
  // re-synced on background changes (none expected in normal use).
  void isOptedIn().then((enabled) => setToggle('setting-telemetry', enabled));

  // Sync setting-inputs sub-panel visibility
  const togglePanelPairs: Array<[string, string]> = [
    ['setting-download-options', 'download-options-inputs'],
    ['setting-min-size', 'min-size-inputs'],
    ['setting-max-size', 'max-size-inputs'],
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
  // Reset scroll position on close so re-opening always starts at the top
  const modalEl = document.getElementById('settings-modal');
  const modalBody = modalEl?.querySelector('.modal-body');
  if (modalBody) modalBody.scrollTop = 0;
  state.settingsModalState = { open: false };
}

export async function saveSettings(): Promise<void> {
  const prevSearchAllFrames = state.appSettings.searchAllFrames;

  state.appSettings.useSidePanel = getToggle('setting-side-panel');
  state.appSettings.density = (getRadio('layout-density') || 'standard') as
    | 'compact'
    | 'standard'
    | 'comfortable';
  state.appSettings.theme = (getRadio('theme') || 'system') as 'system' | 'light' | 'dark';
  state.appSettings.defaultGroup = (getSelect('setting-default-group') || 'none') as
    | 'none'
    | 'domain'
    | 'format'
    | 'size'
    | 'tab';
  state.appSettings.specifyDownload = getToggle('setting-download-options');
  state.appSettings.subfolder = getInput('setting-subfolder') || '{domain}';
  state.appSettings.filenameTemplate =
    getInput('setting-filename') || 'img_{index}_{original}.{format}';
  state.appSettings.convertFormat = (getSelect('setting-convert-format') || 'none') as
    | 'none'
    | 'png'
    | 'jpg'
    | 'jpeg'
    | 'webp';
  state.appSettings.searchAllFrames = getToggle('setting-all-frames');
  state.appSettings.liveMonitoring = getToggle('setting-live-monitor');
  state.appSettings.enableMinSize = getToggle('setting-min-size');
  const parsedMinWidth = parseInt(getInput('setting-min-width'));
  state.appSettings.minWidth = isNaN(parsedMinWidth)
    ? DEFAULT_APP_SETTINGS.minWidth
    : parsedMinWidth;
  const parsedMinHeight = parseInt(getInput('setting-min-height'));
  state.appSettings.minHeight = isNaN(parsedMinHeight)
    ? DEFAULT_APP_SETTINGS.minHeight
    : parsedMinHeight;
  state.appSettings.enableMaxSize = getToggle('setting-max-size');
  const parsedMaxWidth = parseInt(getInput('setting-max-width'));
  state.appSettings.maxWidth = isNaN(parsedMaxWidth)
    ? DEFAULT_APP_SETTINGS.maxWidth
    : parsedMaxWidth;
  const parsedMaxHeight = parseInt(getInput('setting-max-height'));
  state.appSettings.maxHeight = isNaN(parsedMaxHeight)
    ? DEFAULT_APP_SETTINGS.maxHeight
    : parsedMaxHeight;
  state.appSettings.noManyFilesWarning = getToggle('setting-no-warning');
  // Telemetry opt-in is intentionally NOT a member of appSettings (see
  // loadSettings comment). Forward the toggle's current value to the SDK,
  // which persists it under its own storage key. Failure here must not
  // prevent the rest of the settings from being saved.
  void setOptIn(getToggle('setting-telemetry')).catch(() => {
    /* best-effort */
  });
  // Language: now applied immediately on dropdown selection (in init.ts).
  // No need to re-apply here — setLocale() was already called when the
  // user picked a language from the dropdown.

  try {
    const stored = await chrome.storage.local.get('appSettings');
    const previousUseSidePanel = (stored.appSettings as { useSidePanel?: boolean } | undefined)
      ?.useSidePanel;
    await chrome.storage.local.set({ appSettings: state.appSettings });
    applyTheme(state.appSettings.theme as string);
    applyDensity(state.appSettings.density as string);
    updateLiveIndicator();

    // Only switch display mode and show mode toast if it actually changed
    const displayModeChanged =
      previousUseSidePanel !== undefined && previousUseSidePanel !== state.appSettings.useSidePanel;
    if (displayModeChanged) {
      await switchDisplayMode(!!state.appSettings.useSidePanel);
    }

    // Re-apply filters with new settings and update filter bar UI.
    // Skip applyFilters while a scan is in progress — allImages is still empty
    // and rendering would flash "No images found". The ongoing fetchImages()
    // will call applyFilters() automatically when it completes.
    syncCustomSizeInputsFromSettings();
    if (!state.isFetching) {
      applyFilters();
    }
    updateFilterButtonLabels();
    closeSettings();
    if (!displayModeChanged) {
      showToast(t('settings_saved'), 'success');
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

    // Pro visibility check involves message-passing to the background SW
    // (which may need to wake up) and potentially a remote license verify
    // round-trip. Run it non-blocking so the save toast appears instantly.
    void applyProFeatureVisibility();
  } catch {
    showToast(t('settings_save_failed'), 'error');
  }
}

export function resetSettings(): void {
  state.appSettings = { ...DEFAULT_APP_SETTINGS };
  showSettings();
  updateLiveIndicator();
  showToast(t('toast_settings_reset'), 'success');
}

/**
 * Legacy entry point retained for back-compat with existing call sites.
 *
 * The visible badge is now a Preact component (`LiveIndicator`) mounted by
 * `mountLiveIndicator()` during init. The component subscribes directly to
 * `store` via `useStoreSelector`, so any mutation that affects its inputs
 * (`state.isProUser`, `state.appSettings.liveMonitoring`) re-renders
 * automatically — this function is a no-op kept to avoid ripping out the
 * dozens of `updateLiveIndicator()` call sites in one go.
 */
export function updateLiveIndicator(): void {
  // Intentionally empty — Preact handles re-rendering reactively.
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
  document.documentElement.classList.remove(
    'density-compact',
    'density-standard',
    'density-comfortable'
  );
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
      tabId: activeTab?.id,
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
  options.forEach((opt) => {
    const isActive = opt.dataset.value === value;
    opt.classList.toggle('active', isActive);
    if (isActive && textEl) textEl.textContent = opt.textContent;
  });
}
export function getSelect(id: string): string {
  const el = document.getElementById(id) as HTMLElement | null;
  return el ? el.dataset.value || '' : '';
}
export function setRadio(name: string, value: string): void {
  const radio = document.querySelector<HTMLInputElement>(
    `input[type="radio"][name="${name}"][value="${value}"]`
  );
  if (radio) radio.checked = true;
}
export function getRadio(name: string): string {
  const checked = document.querySelector<HTMLInputElement>(
    `input[type="radio"][name="${name}"]:checked`
  );
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

      const wouldOverflowRight = btnRect.left + dropdownWidth > viewportWidth;
      const wouldOverflowLeft = btnRect.left + dropdownLeft < 0;

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
          dropdown.style.left = 4 - containerRect.left + 'px';
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
  document.querySelectorAll('.filter-dropdown').forEach((d) => d.classList.add('hidden'));
}

// ============================================
// Pro Feature Visibility
// ============================================

export async function applyProFeatureVisibility(): Promise<void> {
  const wasPro = state.isProUser;

  // Check license status via background
  try {
    const proStatus = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.VALIDATE_LICENSE });
    state.inTrialGracePeriod = proStatus?.inGracePeriod === true;
    // During trial grace period, treat user as free so quota checks apply.
    // The grace banner still shows (driven by inTrialGracePeriod), but all
    // feature gates use the free-tier limits instead of bypassing them.
    state.isProUser = proStatus?.isPro === true && !state.inTrialGracePeriod;
    state.trialGraceDaysRemaining = 0;
    if (state.inTrialGracePeriod && proStatus?.expiresAt) {
      const elapsed = Date.now() - proStatus.expiresAt;
      const graceMs = 3 * 24 * 60 * 60 * 1000;
      state.trialGraceDaysRemaining = Math.ceil((graceMs - elapsed) / (24 * 60 * 60 * 1000));
    }
  } catch {
    state.isProUser = false;
    state.inTrialGracePeriod = false;
    state.trialGraceDaysRemaining = 0;
  }

  // When user just became Pro, auto-enable Pro default features and persist
  if (state.isProUser && !wasPro) {
    state.appSettings.liveMonitoring = true;
    await chrome.storage.local.set({ appSettings: state.appSettings });

    // Process existing images with newly enabled Pro features
    if (state.allImages.length > 0) {
      processImageExtras(state.allImages);
    }
  }

  // Pro toggle: Live Monitoring
  // Not greyed out, not disabled visually. Click interception handles Pro check.
  const liveMonitorToggle = document.getElementById(
    'setting-live-monitor'
  ) as HTMLInputElement | null;
  if (liveMonitorToggle && !state.isProUser) {
    liveMonitorToggle.checked = false;
  }

  // Format Conversion: free users can open dropdown to see options, but selecting triggers Pro upgrade
  // Pro check is handled in the setting-select click event
  if (!state.isProUser) {
    setSelect('setting-convert-format', 'none');
  }

  // Download format dropdown: Pro items are not disabled, just show PRO badge
  // Pro check is handled in the click event

  // Custom Naming: now free for all users (CUSTOM_NAMING: true in FREE_LIMITS).
  // Ensure inputs are always enabled and never show pro-locked styling.
  const filenameInput = document.getElementById('setting-filename') as HTMLInputElement | null;
  if (filenameInput) {
    filenameInput.disabled = false;
    filenameInput.closest('.setting-item')?.classList.remove('pro-locked');
  }

  const subfolderInput = document.getElementById('setting-subfolder') as HTMLInputElement | null;
  if (subfolderInput) {
    subfolderInput.disabled = false;
    subfolderInput.closest('.setting-item')?.classList.remove('pro-locked');
  }

  // Group mode, reverse search, delete buttons: no visual disable
  // Pro check is handled in click events; PRO badges are in HTML

  // Update top Pro status area
  updateTopProStatus();

  // Update License UI in settings — lazy-loaded since the License section
  // markup only matters when the Settings modal is actually open. The
  // import resolves off the module cache after the first call.
  // bindLicenseModalEvents is idempotent (guarded by a module-level flag),
  // so calling it on every Settings open is safe; it only attaches click
  // listeners on the very first open. Without this call, the activate /
  // deactivate buttons inside the License section have no click handler
  // and the user is silently stuck on the inactive screen.
  void import('./license-ui').then((mod) => {
    mod.bindLicenseModalEvents();
    return mod.updateLicenseUI();
  });

  // Update Live indicator and similar detection state in real-time
  updateLiveIndicator();
  detectSimilarImages();
}

/**
 * Update the top Pro status area in the toolbar.
 * Free users see "Pro" upgrade button + expandable key input.
 * Pro users see Pro badge + plan + expiry + deactivate button.
 */

// Internal: extends HTMLElement with a one-time-bound flag
type BoundButton = HTMLElement & { _bound?: boolean };

export async function updateTopProStatus(): Promise<void> {
  // The free/active toggle and the plan/expiry strings are now driven by
  // <ProStatusBadge> via two store fields: state.isProUser (already present)
  // and state.proLicenseInfo (pushed below). This function only needs to
  // refresh the license payload + bind the deactivate handler exactly once.
  if (state.isProUser) {
    try {
      const info = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_LICENSE_STATUS });
      state.proLicenseInfo = info?.plan
        ? { plan: info.plan, expiresAt: info.expiresAt }
        : state.proLicenseInfo;
    } catch {
      // Ignore errors — keep whatever info we already have so the badge
      // doesn't flicker between states on transient network failures.
    }

    // Bind deactivate button. The button is rendered by Preact, so we look
    // it up after each call (it may have been re-mounted) but flip a flag on
    // the DOM node to prevent duplicate listeners.
    const deactivateBtn = document.getElementById('btn-top-deactivate') as BoundButton | null;
    if (deactivateBtn && !deactivateBtn._bound) {
      deactivateBtn._bound = true;
      deactivateBtn.addEventListener('click', async () => {
        const confirmed = await showConfirmDialog({
          title: t('dialog_deactivate_title'),
          message: t('dialog_deactivate_message'),
          confirmText: t('btn_deactivate'),
          cancelText: t('common_cancel'),
          type: 'danger',
        });
        if (!confirmed) return;
        const originalText = deactivateBtn.textContent;
        deactivateBtn.setAttribute('disabled', 'true');
        deactivateBtn.textContent = t('license_deactivating');
        try {
          await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.DEACTIVATE_LICENSE });
          await applyProFeatureVisibility();
          showToast(t('toast_license_deactivated'), 'info');
        } catch {
          showToast(t('toast_deactivate_failed'), 'error');
        } finally {
          deactivateBtn.removeAttribute('disabled');
          deactivateBtn.textContent = originalText ?? t('btn_deactivate');
        }
      });
    }
  } else {
    // Pro user → free transition: clear stale plan/expiry so the badge
    // doesn't keep them around on the next reactivation.
    state.proLicenseInfo = null;
  }
}

/**
 * Open the Pro upgrade modal. Visibility is now driven by store state; the
 * input focus + scroll-reset still happen here because they're imperative
 * UX touches that don't fit the declarative store pattern.
 */
export function showProUpgradeModal(): void {
  state.proUpgradeModalState = { open: true, errorText: '' };
  const modal = document.getElementById('pro-upgrade-modal');
  const modalBody = modal?.querySelector('.modal-body');
  if (modalBody) {
    modalBody.scrollTop = 0;
    requestAnimationFrame(() => {
      modalBody.scrollTop = 0;
    });
  }
  const input = document.getElementById('pro-modal-key-input') as HTMLInputElement | null;
  if (input) input.focus();
  // Telemetry: this is THE conversion-funnel waypoint — every modal open
  // counts. Trigger source defaults to 'modal_open' here because the modal
  // can be reached from many paths; the bindProGuards listeners below
  // call track(PRO_FEATURE_BLOCKED, ...) BEFORE this fn so we always
  // know which feature drove the upsell. abBucket auto-injects from the
  // telemetry envelope (Sprint 2.4) — no need to pass it manually.
  void track(EVENTS.PRO_UPSELL_SHOWN, { trigger: 'modal_open' });
}

export function closeProUpgradeModal(): void {
  state.proUpgradeModalState = { open: false, errorText: '' };

  // Reset the license activation form inside the Pro modal
  const proModalInput = document.getElementById('pro-modal-key-input') as HTMLInputElement | null;
  const proModalError = document.getElementById('pro-modal-error') as HTMLElement | null;
  if (proModalInput) proModalInput.value = '';
  if (proModalError) {
    proModalError.textContent = '';
    proModalError.classList.add('hidden');
  }
}

/**
 * Bind synchronous Pro guards + the toolbar Upgrade button + ProUpgradeModal
 * close interactions. Called once from init.ts > bindEvents.
 *
 * License-section events (activate / deactivate / formatter) and the
 * activation form INSIDE the Pro Upgrade modal live in license-ui.ts and
 * are bound lazily on the first Settings modal open. Splitting them out
 * keeps the heavy license-management code path off the cold-start path.
 */
export function bindProGuards(): void {
  // ---- Top toolbar: Upgrade Pro button → open modal ----
  const btnUpgradePro = document.getElementById('btn-upgrade-pro');
  if (btnUpgradePro) {
    btnUpgradePro.addEventListener('click', showProUpgradeModal);
  }

  // ---- Pro Upgrade Modal: chrome (close button + overlay) ----
  // The activation form INSIDE the modal is bound by
  // license-ui.ts > bindLicenseModalEvents on first Settings open.
  const proModalClose = document.getElementById('btn-pro-upgrade-close');
  if (proModalClose) {
    proModalClose.addEventListener('click', closeProUpgradeModal);
  }
  const proModal = document.getElementById('pro-upgrade-modal');
  if (proModal) {
    const overlay = proModal.querySelector('.modal-overlay');
    if (overlay) overlay.addEventListener('click', closeProUpgradeModal);
  }

  // ---- Pro feature click interception → open upgrade modal ----
  // Pro feature buttons: open upgrade modal + toast
  // Only fully-locked features (no free tier at all) are intercepted here.
  // Collection and Multi-Tab are now partially open to free users:
  //   - Collection: free users can open the modal (limited to 5 saved items)
  //   - Multi-Tab: free users can open the dialog; extraction is blocked below
  const proLockedButtons: Array<{ id: string; i18nKey: string }> = [];
  proLockedButtons.forEach(({ id, i18nKey }) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener(
      'click',
      (e) => {
        if (!state.isProUser) {
          e.stopImmediatePropagation();
          e.preventDefault();
          showToast(t(i18nKey), 'warning');
          void track(EVENTS.PRO_FEATURE_BLOCKED, {
            feature: id,
          });
          showProUpgradeModal();
        }
      },
      true
    );
  });

  // Multi-tab extraction — free users get a monthly quota.
  // The primary quota gate lives in pro-features.ts > showMultiTabModal(),
  // but we keep a secondary guard on the "Start Extraction" button as well
  // so the user gets immediate feedback if their quota ran out mid-session.
  const btnStartExtraction = document.getElementById('btn-start-extraction');
  if (btnStartExtraction) {
    btnStartExtraction.addEventListener(
      'click',
      async (e) => {
        if (!state.isProUser) {
          e.preventDefault();
          const { checkFeatureQuota, quotaBlockedMessage } =
            await import('../shared/feature-quota');
          const { allowed, limit } = await checkFeatureQuota('multiTab');
          if (!allowed) {
            state.multitabModalState = { open: false };
            showToast(quotaBlockedMessage(t, 'feature_multitab', limit), 'warning');
            void track(EVENTS.PRO_FEATURE_BLOCKED, { feature: 'multitab_extract' });
            showProUpgradeModal();
          }
        }
      },
      true
    );
  }

  // Color filter: free users can open dropdown to see colors, but clicking a swatch triggers Pro upgrade
  // (Pro check is handled in the color swatch click event, not here)

  // Settings: Live Monitor — free users get a monthly quota.
  // When quota is exhausted, block toggle and show Pro upgrade.
  // When quota is available, let the toggle work and increment usage.
  const liveMonitorSetting = document.getElementById('setting-live-monitor');
  if (liveMonitorSetting) {
    liveMonitorSetting.addEventListener(
      'click',
      async (e) => {
        if (!state.isProUser) {
          const checkbox = liveMonitorSetting as HTMLInputElement;
          // If the user is turning the feature OFF, always allow it — no
          // quota check needed. Chrome toggles the checkbox *before*
          // firing the click event, so `checked === false` at this point
          // means the user just unchecked it (turning OFF).
          if (!checkbox.checked) {
            // Let the browser keep the unchecked state (turning OFF)
            return;
          }

          e.preventDefault();
          e.stopImmediatePropagation();
          const { checkFeatureQuota, incrementFeatureUsage, quotaBlockedMessage } =
            await import('../shared/feature-quota');
          const { allowed, limit } = await checkFeatureQuota('liveMonitor');
          if (!allowed) {
            closeSettings();
            showToast(quotaBlockedMessage(t, 'feature_live_monitor', limit), 'warning');
            void track(EVENTS.PRO_FEATURE_BLOCKED, { feature: 'live_monitor' });
            showProUpgradeModal();
          } else {
            // Quota available — manually toggle and count usage
            checkbox.checked = !checkbox.checked;
            if (checkbox.checked) {
              await incrementFeatureUsage('liveMonitor');
            }
            // Trigger change so saveSettings picks it up
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      },
      true
    );
  }

  // Custom naming (subfolder / filename template) is now free for all users.
  // Pro guard removed — CUSTOM_NAMING: true in FREE_LIMITS.
}

// activateLicenseFromInput / bindLicenseKeyFormatter / formatDateYMD /
// maskLicenseKey have moved to ./license-ui — they're only needed when
// the user opens Settings or the Pro Upgrade modal's activation form,
// both of which lazy-import license-ui on demand.
