// Unit tests for sidepanel/settings.ts — focused on:
//   - 8 form helpers (setToggle/getToggle, setSelect/getSelect,
//     setRadio/getRadio, setInput/getInput): the DOM read/write
//     surface every settings-form binding goes through
//   - applyTheme: documentElement.dataset.theme contract (system →
//     delete; explicit value → set)
//   - applyDensity: classList swap on #app + documentElement +
//     downstream checkNarrowMode call
//   - closeSettings / showProUpgradeModal / closeProUpgradeModal:
//     state-driven modal toggles
//   - closeAllFilterDropdowns: bulk DOM hidden toggle
//   - bindProGuards: the Pro paywall interceptor — Pro user passes
//     through, free user gets stopImmediatePropagation + toast +
//     upgrade modal. This is the actual paywall and is critical to
//     pin against regression.
//
// Out of scope (heavy orchestration / chrome.* IPC):
//   - showSettings / saveSettings / resetSettings (lazy-import +
//     multi-DOM)
//   - applyProFeatureVisibility / updateTopProStatus (orchestration)
//   - switchDisplayMode (chrome.runtime IPC)
//   - renderHotkeyDisplay / openShortcutSettings (chrome.commands)
//   - toggleFilterDropdown (getBoundingClientRect-heavy positioning;
//     jsdom doesn't compute layout)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sidepanel/filter', () => ({
  applyFilters: vi.fn(),
  renderColorSwatches: vi.fn(),
  syncCustomSizeInputsFromSettings: vi.fn(),
}));
vi.mock('../sidepanel/pro-features', () => ({
  detectSimilarImages: vi.fn(),
}));
vi.mock('../sidepanel/scan', () => ({
  fetchImages: vi.fn(),
  processImageExtras: vi.fn(),
}));
vi.mock('../sidepanel/ui', () => ({
  checkNarrowMode: vi.fn(),
  showConfirmDialog: vi.fn(),
  showToast: vi.fn(),
  updateFilterButtonLabels: vi.fn(),
}));

import {
  setToggle,
  getToggle,
  setSelect,
  getSelect,
  setRadio,
  getRadio,
  setInput,
  getInput,
  applyTheme,
  applyDensity,
  closeSettings,
  showProUpgradeModal,
  closeProUpgradeModal,
  closeAllFilterDropdowns,
  bindProGuards,
} from '../sidepanel/settings';
import { state, store } from '../sidepanel/state';

beforeEach(() => {
  store.reset();
  document.body.innerHTML = '';
  // applyTheme uses documentElement.dataset; reset between tests.
  delete document.documentElement.dataset.theme;
  document.documentElement.className = '';
  vi.clearAllMocks();
});

afterEach(() => {
  store.reset();
  document.body.innerHTML = '';
  delete document.documentElement.dataset.theme;
  document.documentElement.className = '';
});

// ─────────────────────────────────────────────────────────────────────
// Form helpers — Toggle
// ─────────────────────────────────────────────────────────────────────

describe('setToggle / getToggle', () => {
  it('setToggle sets .checked on a checkbox input', () => {
    document.body.innerHTML = '<input type="checkbox" id="t1" />';
    setToggle('t1', true);
    expect((document.getElementById('t1') as HTMLInputElement).checked).toBe(true);
    setToggle('t1', false);
    expect((document.getElementById('t1') as HTMLInputElement).checked).toBe(false);
  });

  it('setToggle coerces truthy/falsy values to boolean (!!value)', () => {
    document.body.innerHTML = '<input type="checkbox" id="t1" />';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setToggle('t1', 1 as any);
    expect((document.getElementById('t1') as HTMLInputElement).checked).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setToggle('t1', 0 as any);
    expect((document.getElementById('t1') as HTMLInputElement).checked).toBe(false);
  });

  it('setToggle is a no-op when the element is missing (no crash)', () => {
    expect(() => setToggle('nonexistent', true)).not.toThrow();
  });

  it('getToggle reads .checked from a checkbox input', () => {
    document.body.innerHTML = '<input type="checkbox" id="t1" checked />';
    expect(getToggle('t1')).toBe(true);
    (document.getElementById('t1') as HTMLInputElement).checked = false;
    expect(getToggle('t1')).toBe(false);
  });

  it('getToggle returns false when the element is missing (defensive default)', () => {
    expect(getToggle('nonexistent')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Form helpers — Select (custom dropdown)
// ─────────────────────────────────────────────────────────────────────

describe('setSelect / getSelect', () => {
  function buildSelect(id: string, options: Array<{ value: string; label: string }>): void {
    const html =
      `<div id="${id}" data-value="">` +
      `<span class="setting-select-text"></span>` +
      options
        .map((o) => `<div class="setting-select-option" data-value="${o.value}">${o.label}</div>`)
        .join('') +
      `</div>`;
    document.body.innerHTML = html;
  }

  it('setSelect sets data-value, marks the matching option .active, and updates the label', () => {
    buildSelect('s1', [
      { value: 'a', label: 'Option A' },
      { value: 'b', label: 'Option B' },
    ]);

    setSelect('s1', 'b');

    const root = document.getElementById('s1')!;
    expect(root.dataset.value).toBe('b');

    const text = root.querySelector('.setting-select-text');
    expect(text?.textContent).toBe('Option B');

    const opts = root.querySelectorAll<HTMLElement>('.setting-select-option');
    expect(opts[0].classList.contains('active')).toBe(false);
    expect(opts[1].classList.contains('active')).toBe(true);
  });

  it('setSelect with a value that no option matches → data-value updated, NO option marked active, label unchanged', () => {
    buildSelect('s1', [{ value: 'a', label: 'Option A' }]);
    document.querySelector<HTMLElement>('.setting-select-text')!.textContent = 'untouched';

    setSelect('s1', 'unknown');

    expect(document.getElementById('s1')!.dataset.value).toBe('unknown');
    expect(
      document.querySelector<HTMLElement>('.setting-select-option')!.classList.contains('active')
    ).toBe(false);
    expect(document.querySelector('.setting-select-text')!.textContent).toBe('untouched');
  });

  it('setSelect is a no-op when the element is missing', () => {
    expect(() => setSelect('nonexistent', 'x')).not.toThrow();
  });

  it('getSelect reads data-value from the element', () => {
    buildSelect('s1', [{ value: 'a', label: 'A' }]);
    document.getElementById('s1')!.dataset.value = 'preset';
    expect(getSelect('s1')).toBe('preset');
  });

  it('getSelect returns "" when data-value is unset OR element is missing', () => {
    buildSelect('s1', [{ value: 'a', label: 'A' }]);
    expect(getSelect('s1')).toBe(''); // data-value="" initial
    expect(getSelect('nonexistent')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Form helpers — Radio
// ─────────────────────────────────────────────────────────────────────

describe('setRadio / getRadio', () => {
  function buildRadios(name: string, values: string[]): void {
    document.body.innerHTML = values
      .map((v) => `<input type="radio" name="${name}" value="${v}" />`)
      .join('');
  }

  it('setRadio checks the matching radio in the named group', () => {
    buildRadios('density', ['compact', 'standard', 'comfortable']);
    setRadio('density', 'standard');

    const checked = document.querySelector<HTMLInputElement>('input[name="density"]:checked');
    expect(checked?.value).toBe('standard');
  });

  it('setRadio is a no-op when no radio in the group has the given value', () => {
    buildRadios('density', ['compact']);
    setRadio('density', 'unknown');
    expect(document.querySelector('input[name="density"]:checked')).toBeNull();
  });

  it('getRadio returns the value of the currently-checked radio', () => {
    buildRadios('density', ['compact', 'standard']);
    document.querySelector<HTMLInputElement>('input[value="compact"]')!.checked = true;
    expect(getRadio('density')).toBe('compact');
  });

  it('getRadio returns "" when no radio in the group is checked', () => {
    buildRadios('density', ['compact', 'standard']);
    expect(getRadio('density')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Form helpers — Input
// ─────────────────────────────────────────────────────────────────────

describe('setInput / getInput', () => {
  it('setInput sets .value on an input (string passthrough)', () => {
    document.body.innerHTML = '<input id="i1" />';
    setInput('i1', 'hello');
    expect((document.getElementById('i1') as HTMLInputElement).value).toBe('hello');
  });

  it('setInput coerces numbers to string', () => {
    document.body.innerHTML = '<input id="i1" />';
    setInput('i1', 42);
    expect((document.getElementById('i1') as HTMLInputElement).value).toBe('42');
    setInput('i1', 0);
    expect((document.getElementById('i1') as HTMLInputElement).value).toBe('0');
  });

  it('setInput is a no-op when the element is missing', () => {
    expect(() => setInput('nonexistent', 'x')).not.toThrow();
  });

  it('getInput returns .value, "" when element missing', () => {
    document.body.innerHTML = '<input id="i1" value="preset" />';
    expect(getInput('i1')).toBe('preset');
    expect(getInput('nonexistent')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────
// applyTheme / applyDensity
// ─────────────────────────────────────────────────────────────────────

describe('applyTheme', () => {
  it("'system' DELETES documentElement.dataset.theme (CSS falls back to prefers-color-scheme)", () => {
    document.documentElement.dataset.theme = 'dark';
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('explicit theme value is set as data-theme attribute', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('switching from explicit → system → explicit cleanly toggles', () => {
    applyTheme('dark');
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('applyDensity', () => {
  it('removes ALL three density-* classes from #app + html before adding the new one (clean swap)', () => {
    document.body.innerHTML = '<div id="app" class="density-compact density-standard"></div>';
    document.documentElement.classList.add('density-comfortable');

    applyDensity('standard');

    const app = document.getElementById('app')!;
    expect(app.classList.contains('density-compact')).toBe(false);
    expect(app.classList.contains('density-comfortable')).toBe(false);
    expect(app.classList.contains('density-standard')).toBe(true);

    expect(document.documentElement.classList.contains('density-comfortable')).toBe(false);
    expect(document.documentElement.classList.contains('density-standard')).toBe(true);
  });

  it('applies the density class to documentElement even when #app is missing (popup-mode safety)', () => {
    // No #app in DOM (e.g. before init)
    applyDensity('compact');
    expect(document.documentElement.classList.contains('density-compact')).toBe(true);
  });

  it('triggers checkNarrowMode after applying density (so card widths re-derive)', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    applyDensity('comfortable');
    const ui = await import('../sidepanel/ui');
    expect(ui.checkNarrowMode).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// State-driven modal toggles
// ─────────────────────────────────────────────────────────────────────

describe('closeSettings', () => {
  it('flips state.settingsModalState.open to false', () => {
    state.settingsModalState = { ...state.settingsModalState, open: true };
    closeSettings();
    expect(state.settingsModalState.open).toBe(false);
  });

  it('is idempotent — calling twice when already closed stays closed', () => {
    state.settingsModalState = { ...state.settingsModalState, open: false };
    closeSettings();
    closeSettings();
    expect(state.settingsModalState.open).toBe(false);
  });
});

describe('showProUpgradeModal / closeProUpgradeModal', () => {
  it('showProUpgradeModal sets open:true + clears errorText + scrolls modal-body to top', () => {
    document.body.innerHTML = `
      <div id="pro-upgrade-modal">
        <div class="modal-body" style="overflow:auto"></div>
      </div>
      <input id="pro-modal-key-input" />
    `;
    const body = document.querySelector('.modal-body')!;
    Object.defineProperty(body, 'scrollTop', { value: 500, writable: true });

    state.proUpgradeModalState = { open: false, errorText: 'old error' };
    showProUpgradeModal();

    expect(state.proUpgradeModalState.open).toBe(true);
    expect(state.proUpgradeModalState.errorText).toBe('');
    expect((body as HTMLElement & { scrollTop: number }).scrollTop).toBe(0);
  });

  it('showProUpgradeModal is a no-op on missing DOM nodes (no crash before/during init)', () => {
    expect(() => showProUpgradeModal()).not.toThrow();
    expect(state.proUpgradeModalState.open).toBe(true);
  });

  it('closeProUpgradeModal sets open:false + clears errorText (resets for next open)', () => {
    state.proUpgradeModalState = { open: true, errorText: 'Activation failed' };
    closeProUpgradeModal();
    expect(state.proUpgradeModalState.open).toBe(false);
    expect(state.proUpgradeModalState.errorText).toBe('');
  });
});

describe('closeAllFilterDropdowns', () => {
  it('adds .hidden to every .filter-dropdown element', () => {
    document.body.innerHTML = `
      <div class="filter-dropdown" id="fd1"></div>
      <div class="filter-dropdown" id="fd2"></div>
      <div class="filter-dropdown hidden" id="fd3"></div>
    `;
    closeAllFilterDropdowns();
    expect(document.getElementById('fd1')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('fd2')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('fd3')!.classList.contains('hidden')).toBe(true);
  });

  it('is a no-op when no .filter-dropdown elements exist', () => {
    document.body.innerHTML = '<div class="some-other-class"></div>';
    expect(() => closeAllFilterDropdowns()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────
// bindProGuards — the Pro paywall interceptor
// ─────────────────────────────────────────────────────────────────────

describe('bindProGuards — Pro paywall interceptor', () => {
  // bindProGuards wires capture-phase listeners on:
  //   - #btn-upgrade-pro    → opens upgrade modal
  //   - #btn-pro-upgrade-close + .modal-overlay → closes upgrade modal
  //   - #btn-collection / #btn-multitab (Pro feature buttons)
  //   - #setting-similar-detection / #setting-color-extract /
  //     #setting-live-monitor (Pro toggles)
  //   - #setting-subfolder / #setting-filename (Pro inputs, focus event)
  //
  // For Pro features: free user → preventDefault + stopImmediate +
  //   toast + open upgrade modal. Pro user → no interception.

  function buildProGuardsDom(): void {
    document.body.innerHTML = `
      <button id="btn-upgrade-pro">Upgrade Pro</button>
      <div id="pro-upgrade-modal">
        <button id="btn-pro-upgrade-close">×</button>
        <div class="modal-overlay"></div>
        <div class="modal-body"></div>
      </div>
      <input id="pro-modal-key-input" />
      <button id="btn-collection">Collection</button>
      <button id="btn-multitab">Multi-Tab</button>
      <input type="checkbox" id="setting-live-monitor" />
      <input id="setting-subfolder" />
      <input id="setting-filename" />
    `;
  }

  beforeEach(() => {
    buildProGuardsDom();
    bindProGuards();
  });

  it('clicking #btn-upgrade-pro opens the Pro upgrade modal', () => {
    state.proUpgradeModalState = { open: false, errorText: '' };
    document.getElementById('btn-upgrade-pro')!.click();
    expect(state.proUpgradeModalState.open).toBe(true);
  });

  it('clicking #btn-pro-upgrade-close closes the Pro upgrade modal', () => {
    state.proUpgradeModalState = { open: true, errorText: '' };
    document.getElementById('btn-pro-upgrade-close')!.click();
    expect(state.proUpgradeModalState.open).toBe(false);
  });

  it('clicking the modal overlay also closes the modal', () => {
    state.proUpgradeModalState = { open: true, errorText: '' };
    document.querySelector<HTMLElement>('.modal-overlay')!.click();
    expect(state.proUpgradeModalState.open).toBe(false);
  });

  it.each(['btn-collection', 'btn-multitab'])(
    'free user clicking #%s → modal opens freely (no Pro gate on toolbar button)',
    async (id) => {
      // v1.0.5 Round 2: collection and multi-tab modals are now open to free
      // users. The Pro gate was moved off the toolbar button — free users can
      // open the dialog to browse. The upgrade prompt fires only when they try
      // to take a restricted action inside (e.g. Start Extraction).
      state.isProUser = false;
      state.proUpgradeModalState = { open: false, errorText: '' };

      const downstream = vi.fn();
      document.getElementById(id)!.addEventListener('click', downstream);

      document.getElementById(id)!.click();

      // No upgrade modal — click is not intercepted at toolbar button level.
      expect(state.proUpgradeModalState.open).toBe(false);
      const ui = await import('../sidepanel/ui');
      expect(ui.showToast).not.toHaveBeenCalled();
      // Downstream handler fires because stopImmediatePropagation is NOT called.
      expect(downstream).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['btn-collection', 'btn-multitab'])(
    'Pro user clicking #%s → no toast, no modal, downstream handler fires',
    async (id) => {
      state.isProUser = true;
      state.proUpgradeModalState = { open: false, errorText: '' };

      const downstream = vi.fn();
      document.getElementById(id)!.addEventListener('click', downstream);

      document.getElementById(id)!.click();

      expect(state.proUpgradeModalState.open).toBe(false);
      const ui = await import('../sidepanel/ui');
      expect(ui.showToast).not.toHaveBeenCalled();
      expect(downstream).toHaveBeenCalledTimes(1);
    }
  );

  it('free user clicking Pro toggle #setting-live-monitor → close settings + warning toast + open upgrade modal', async () => {
    const id = 'setting-live-monitor';
    state.isProUser = false;
    state.settingsModalState = { ...state.settingsModalState, open: true };
    state.proUpgradeModalState = { open: false, errorText: '' };

    document.getElementById(id)!.click();

    expect(state.settingsModalState.open).toBe(false);
    expect(state.proUpgradeModalState.open).toBe(true);
    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).toHaveBeenCalledWith(
      'This setting requires Pro. Upgrade to unlock!',
      'warning'
    );
  });

  it('Pro user toggling a Pro setting → no interception (settings stays open, no toast)', async () => {
    state.isProUser = true;
    state.settingsModalState = { ...state.settingsModalState, open: true };

    document.getElementById('setting-live-monitor')!.click();

    expect(state.settingsModalState.open).toBe(true);
    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).not.toHaveBeenCalled();
  });

  it.each(['setting-subfolder', 'setting-filename'])(
    'free user focusing Pro input #%s → blur + close settings + warning toast + open modal',
    async (id) => {
      state.isProUser = false;
      state.settingsModalState = { ...state.settingsModalState, open: true };
      state.proUpgradeModalState = { open: false, errorText: '' };

      const input = document.getElementById(id) as HTMLInputElement;
      const blurSpy = vi.spyOn(input, 'blur');

      input.dispatchEvent(new FocusEvent('focus'));

      expect(blurSpy).toHaveBeenCalledTimes(1);
      expect(state.settingsModalState.open).toBe(false);
      expect(state.proUpgradeModalState.open).toBe(true);
      const ui = await import('../sidepanel/ui');
      expect(ui.showToast).toHaveBeenCalledWith(
        'Custom naming is a Pro feature. Upgrade to unlock!',
        'warning'
      );
    }
  );

  it('Pro user focusing a Pro input → no blur, no modal, settings stays open', async () => {
    state.isProUser = true;
    state.settingsModalState = { ...state.settingsModalState, open: true };

    const input = document.getElementById('setting-subfolder') as HTMLInputElement;
    const blurSpy = vi.spyOn(input, 'blur');
    input.dispatchEvent(new FocusEvent('focus'));

    expect(blurSpy).not.toHaveBeenCalled();
    expect(state.settingsModalState.open).toBe(true);
    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Chrome API surface for the remaining export tests (j1/j2/j3).
// Installed once at first import-time of this section. Earlier
// describe blocks don't need chrome — they pass-through when chrome
// is undefined because their target functions don't touch it.
// ─────────────────────────────────────────────────────────────────────

import {
  renderHotkeyDisplay,
  openShortcutSettings,
  switchDisplayMode,
  updateLiveIndicator,
  resetSettings,
  showSettings,
  saveSettings,
  applyProFeatureVisibility,
  updateTopProStatus,
} from '../sidepanel/settings';

// Chrome API mock — delegated to the shared tests/_helpers/chromeApiMock
// helper. Every call to installChromeMock() returns a fresh mock so per-case
// mockResolvedValue overrides never leak across cases.
import { installChromeMock, type ChromeMock } from './_helpers/chromeApiMock';

// Mock license-ui as a virtual module — applyProFeatureVisibility
// dynamically imports it. Without this, the real module is loaded and
// its top-level chrome.* calls would explode.
vi.mock('../sidepanel/license-ui', () => ({
  bindLicenseModalEvents: vi.fn(),
  updateLicenseUI: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────
// updateLiveIndicator — intentionally a no-op (legacy entry point)
// ─────────────────────────────────────────────────────────────────────

describe('updateLiveIndicator', () => {
  it('is a no-op (does not throw, returns undefined)', () => {
    // Pin: the visible badge is now driven by Preact <LiveIndicator>.
    // This export is kept ONLY for backward compat with dozens of
    // call sites; it must stay a no-op. If a future refactor puts
    // imperative DOM mutation back in here, those call sites would
    // re-render twice (once via Preact, once via this fn).
    expect(updateLiveIndicator()).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// renderHotkeyDisplay
// ─────────────────────────────────────────────────────────────────────

describe('renderHotkeyDisplay', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  it('returns silently when #hotkey-keys container is missing', async () => {
    await expect(renderHotkeyDisplay()).resolves.toBeUndefined();
    expect(chromeMock.commands.getAll).not.toHaveBeenCalled();
  });

  it('renders "Click to set" button when no _execute_action shortcut configured', async () => {
    document.body.innerHTML = '<div id="hotkey-keys"></div>';
    chromeMock.commands.getAll.mockResolvedValue([{ name: 'other-cmd', shortcut: 'Ctrl+X' }]);

    await renderHotkeyDisplay();
    const container = document.getElementById('hotkey-keys')!;
    expect(container.querySelector('.hotkey-set-btn')).toBeTruthy();
  });

  it('parses "Ctrl+Shift+S" into 3 <kbd> with modifier symbols (⌃ ⇧ S)', async () => {
    document.body.innerHTML = '<div id="hotkey-keys"></div>';
    chromeMock.commands.getAll.mockResolvedValue([
      { name: '_execute_action', shortcut: 'Ctrl+Shift+S' },
    ]);

    await renderHotkeyDisplay();
    const container = document.getElementById('hotkey-keys')!;
    const kbds = container.querySelectorAll('kbd');
    expect(kbds).toHaveLength(3);
    // Pin the modifier-symbol mapping: Ctrl → ⌃, Shift → ⇧, plain key
    // uppercased. Affects on-screen hint visibility and aesthetic
    // consistency with macOS conventions.
    expect(kbds[0].textContent).toBe('⌃');
    expect(kbds[1].textContent).toBe('⇧');
    expect(kbds[2].textContent).toBe('S');
  });

  it('handles ⌘+Shift+S (already-symbol form, e.g. macOS Chrome)', async () => {
    document.body.innerHTML = '<div id="hotkey-keys"></div>';
    chromeMock.commands.getAll.mockResolvedValue([
      { name: '_execute_action', shortcut: 'Command+Shift+I' },
    ]);

    await renderHotkeyDisplay();
    const kbds = document.querySelectorAll('#hotkey-keys kbd');
    expect(kbds[0].textContent).toBe('⌘');
    expect(kbds[1].textContent).toBe('⇧');
    expect(kbds[2].textContent).toBe('I');
  });

  it('survives chrome.commands.getAll throwing (renders "Click to set" fallback)', async () => {
    document.body.innerHTML = '<div id="hotkey-keys"></div>';
    chromeMock.commands.getAll.mockRejectedValue(new Error('API unavailable'));

    await renderHotkeyDisplay();
    expect(document.querySelector('.hotkey-set-btn')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────
// openShortcutSettings
// ─────────────────────────────────────────────────────────────────────

describe('openShortcutSettings', () => {
  it('opens chrome://extensions/shortcuts in a new tab', () => {
    const chromeMock = installChromeMock();
    openShortcutSettings();
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({
      url: 'chrome://extensions/shortcuts',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// switchDisplayMode
// ─────────────────────────────────────────────────────────────────────

describe('switchDisplayMode', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  it('queries active tab + sends SET_DISPLAY_MODE with tabId + closes window', async () => {
    chromeMock.tabs.query.mockResolvedValue([{ id: 42 }]);
    state.isPopupMode = true;
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});

    await switchDisplayMode(true);

    expect(chromeMock.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'SET_DISPLAY_MODE',
      useSidePanel: true,
      // popup → sidepanel: openSidePanel=true ONLY when switching FROM popup TO side panel
      openSidePanel: true,
      tabId: 42,
    });
    expect(closeSpy).toHaveBeenCalled();
  });

  it('side-panel → popup: openSidePanel=false because state.isPopupMode is false', async () => {
    state.isPopupMode = false;
    vi.spyOn(window, 'close').mockImplementation(() => {});

    await switchDisplayMode(false);
    // Pin: openSidePanel = useSidePanel && state.isPopupMode → both
    // sides false here. Background uses this flag to decide whether to
    // proactively open the side panel after the switch — wrong value
    // would leave the user staring at a blank tab.
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ openSidePanel: false })
    );
  });

  it('survives chrome.tabs.query throwing — outer try/catch swallows', async () => {
    chromeMock.tabs.query.mockRejectedValue(new Error('no tabs API'));
    vi.spyOn(window, 'close').mockImplementation(() => {});

    await expect(switchDisplayMode(true)).resolves.toBeUndefined();
    // sendMessage never reached because query threw first.
    expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// resetSettings
// ─────────────────────────────────────────────────────────────────────

describe('resetSettings', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('resets state.appSettings to documented defaults (all 17 fields)', () => {
    // Pre-pollute with non-default values
    state.appSettings = {
      useSidePanel: false,
      density: 'compact',
      theme: 'dark',
      defaultGroup: 'domain',
      specifyDownload: false,
      subfolder: 'custom',
      filenameTemplate: 'custom-template',
      convertFormat: 'webp',
      searchAllFrames: true,
      liveMonitoring: true,
      enableMinSize: true,
      minWidth: 999,
      minHeight: 999,
      enableMaxSize: true,
      maxWidth: 100,
      maxHeight: 100,
      noManyFilesWarning: true,
    } as typeof state.appSettings;

    resetSettings();

    // Pin defaults — these are user-facing and must NOT regress silently
    expect(state.appSettings.useSidePanel).toBe(true);
    expect(state.appSettings.density).toBe('standard');
    expect(state.appSettings.theme).toBe('system');
    expect(state.appSettings.defaultGroup).toBe('none');
    expect(state.appSettings.subfolder).toBe('{domain}');
    expect(state.appSettings.filenameTemplate).toBe('img_{index}_{original}.{format}');
    expect(state.appSettings.convertFormat).toBe('none');
    expect(state.appSettings.searchAllFrames).toBe(true);
    expect(state.appSettings.liveMonitoring).toBe(true);
    expect(state.appSettings.minWidth).toBe(0);
    expect(state.appSettings.maxWidth).toBe(99999);
  });

  it('shows success toast + opens settings modal (via showSettings)', async () => {
    resetSettings();

    expect(state.settingsModalState.open).toBe(true);
    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).toHaveBeenCalledWith('Settings reset to defaults', 'success');
  });
});

// ─────────────────────────────────────────────────────────────────────
// showSettings
// ─────────────────────────────────────────────────────────────────────

describe('showSettings', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
    chromeMock.commands.getAll.mockResolvedValue([]);
  });

  it('flips state.settingsModalState.open to true', () => {
    showSettings();
    expect(state.settingsModalState.open).toBe(true);
  });

  it('scrolls .modal-body inside #settings-modal to top (fresh entry UX)', () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <div class="modal-body" style="overflow:auto"></div>
      </div>
    `;
    const body = document.querySelector('#settings-modal .modal-body') as HTMLElement;
    body.scrollTop = 500;

    showSettings();
    expect(body.scrollTop).toBe(0);
  });

  it('fills setting-side-panel toggle with state.appSettings.useSidePanel', () => {
    document.body.innerHTML = '<input type="checkbox" id="setting-side-panel" />';
    state.appSettings.useSidePanel = true;
    showSettings();
    expect((document.getElementById('setting-side-panel') as HTMLInputElement).checked).toBe(true);
  });

  it('forces Pro-only toggles to false for free users (live-monitor)', () => {
    document.body.innerHTML = `
      <input type="checkbox" id="setting-live-monitor" />
    `;
    state.isProUser = false;
    state.appSettings.liveMonitoring = true;

    showSettings();

    // Pin: free users see Pro toggles as OFF in the form, regardless of
    // the underlying state value. Otherwise free users could see "ON"
    // in the UI but the feature wouldn't actually work — confusing UX.
    expect((document.getElementById('setting-live-monitor') as HTMLInputElement).checked).toBe(
      false
    );
  });

  it('toggles sub-panel visibility based on parent checkbox state', () => {
    document.body.innerHTML = `
      <input type="checkbox" id="setting-download-options" checked />
      <div id="download-options-inputs"></div>
      <input type="checkbox" id="setting-min-size" />
      <div id="min-size-inputs"></div>
      <input type="checkbox" id="setting-max-size" checked />
      <div id="max-size-inputs"></div>
    `;
    state.appSettings.specifyDownload = true;
    state.appSettings.enableMinSize = false;
    state.appSettings.enableMaxSize = true;

    showSettings();

    // Pin: sub-panel visibility tracks the parent checkbox AT FILL-IN
    // time. After init, runtime toggle handlers update the .hidden class
    // separately, but on Settings open the form must reflect persisted
    // state.
    expect(document.getElementById('download-options-inputs')!.classList.contains('hidden')).toBe(
      false
    );
    expect(document.getElementById('min-size-inputs')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('max-size-inputs')!.classList.contains('hidden')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// applyProFeatureVisibility — Pro gate orchestrator
// ─────────────────────────────────────────────────────────────────────

describe('applyProFeatureVisibility', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
    // Default: free user (VALIDATE_LICENSE returns isPro:false)
    chromeMock.runtime.sendMessage.mockResolvedValue({ isPro: false });
  });

  it('sets state.isProUser=true when VALIDATE_LICENSE returns isPro:true', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ isPro: true });
    state.isProUser = false;

    await applyProFeatureVisibility();
    expect(state.isProUser).toBe(true);
  });

  it('sets state.isProUser=false when VALIDATE_LICENSE throws (defensive default)', async () => {
    chromeMock.runtime.sendMessage.mockRejectedValue(new Error('bg unavailable'));
    state.isProUser = true;

    await applyProFeatureVisibility();
    // Pin: a transient bg error must NOT keep the user on Pro UI; the
    // safer default is to fall back to free, otherwise a user whose
    // license expired would keep seeing Pro features they can't use.
    expect(state.isProUser).toBe(false);
  });

  it('newly-Pro transition (free → Pro) auto-enables liveMonitoring + persists', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ isPro: true });
    state.isProUser = false;
    state.appSettings.liveMonitoring = false;

    await applyProFeatureVisibility();

    // Pin: first-time activation should turn ON liveMonitoring
    // so the user sees value immediately, and persist so they survive reload.
    expect(state.appSettings.liveMonitoring).toBe(true);
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ appSettings: state.appSettings })
    );
  });

  it('newly-Pro + allImages.length > 0 → triggers processImageExtras for retroactive Pro processing', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ isPro: true });
    state.isProUser = false;
    state.allImages = [{ id: 'a', url: 'a.jpg' } as never, { id: 'b', url: 'b.jpg' } as never];

    await applyProFeatureVisibility();
    const scan = await import('../sidepanel/scan');
    // Pin: existing scanned images should retroactively get pHash + color
    // extraction so the user doesn't have to re-scan after activating Pro.
    expect(scan.processImageExtras).toHaveBeenCalledWith(state.allImages);
  });

  it('already-Pro (no transition) does NOT re-enable defaults or persist', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ isPro: true });
    state.isProUser = true; // wasPro=true, isProUser stays true → no transition

    await applyProFeatureVisibility();

    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
  });

  it('does not crash when #dedup-info element is absent (removed from DOM)', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ isPro: false });
    document.body.innerHTML = '';

    // applyProFeatureVisibility no longer manipulates #dedup-info directly;
    // similar-detection visibility is driven by Preact components. Verify
    // it completes without throwing when the element is missing.
    await expect(applyProFeatureVisibility()).resolves.toBeUndefined();
  });

  it('forces Pro toggle (live-monitor) to unchecked for free users', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ isPro: false });
    document.body.innerHTML = `
      <input type="checkbox" id="setting-live-monitor" checked />
    `;

    await applyProFeatureVisibility();
    // Pin: the Pro toggle in the Settings form MUST visually reflect
    // the actual capability. Showing "ON" while the underlying state is
    // disabled would mislead users (the click handler intercepts and
    // shows the upgrade modal, but the visual mismatch is still bad UX).
    expect((document.getElementById('setting-live-monitor') as HTMLInputElement).checked).toBe(
      false
    );
  });

  it('forces convertFormat → "none" for free users', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ isPro: false });
    document.body.innerHTML = `
      <div id="setting-convert-format" data-value="webp">
        <span class="setting-select-text">WebP</span>
        <div class="setting-select-option" data-value="none">None</div>
        <div class="setting-select-option" data-value="webp">WebP</div>
      </div>
    `;

    await applyProFeatureVisibility();
    // Pin: force-reset to 'none' for free users. Without this, a user
    // who used Pro features then let their license expire would still
    // have convertFormat='webp' silently bricking their downloads.
    expect((document.getElementById('setting-convert-format') as HTMLElement).dataset.value).toBe(
      'none'
    );
  });

  it('disables filename + subfolder inputs + adds .pro-locked for free users', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ isPro: false });
    document.body.innerHTML = `
      <div class="setting-item">
        <input id="setting-filename" type="text" />
      </div>
      <div class="setting-item">
        <input id="setting-subfolder" type="text" />
      </div>
    `;

    await applyProFeatureVisibility();
    const filename = document.getElementById('setting-filename') as HTMLInputElement;
    const subfolder = document.getElementById('setting-subfolder') as HTMLInputElement;
    expect(filename.disabled).toBe(true);
    expect(subfolder.disabled).toBe(true);
    expect(filename.closest('.setting-item')!.classList.contains('pro-locked')).toBe(true);
    expect(subfolder.closest('.setting-item')!.classList.contains('pro-locked')).toBe(true);
  });

  it('enables filename + subfolder inputs + removes .pro-locked for Pro users', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ isPro: true });
    document.body.innerHTML = `
      <div class="setting-item pro-locked">
        <input id="setting-filename" type="text" disabled />
      </div>
      <div class="setting-item pro-locked">
        <input id="setting-subfolder" type="text" disabled />
      </div>
    `;
    state.isProUser = true; // already-Pro path (skip newly-Pro persist)

    await applyProFeatureVisibility();
    const filename = document.getElementById('setting-filename') as HTMLInputElement;
    const subfolder = document.getElementById('setting-subfolder') as HTMLInputElement;
    expect(filename.disabled).toBe(false);
    expect(subfolder.disabled).toBe(false);
    expect(filename.closest('.setting-item')!.classList.contains('pro-locked')).toBe(false);
    expect(subfolder.closest('.setting-item')!.classList.contains('pro-locked')).toBe(false);
  });

  it('always calls detectSimilarImages at the end (post-state-change refresh)', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ isPro: false });

    await applyProFeatureVisibility();
    const proFeatures = await import('../sidepanel/pro-features');
    // Pin: detectSimilarImages must run after every Pro state change so
    // that UI reflects the new similar-groups status (e.g. when a user
    // disables similar detection, the dedup info should disappear).
    expect(proFeatures.detectSimilarImages).toHaveBeenCalled();
  });

  it('lazy-imports license-ui and calls bindLicenseModalEvents + updateLicenseUI', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ isPro: false });

    await applyProFeatureVisibility();
    // Wait one microtask for the void-imported promise chain to settle.
    await new Promise((r) => setTimeout(r, 0));

    const licenseUi = await import('../sidepanel/license-ui');
    // Pin: license-ui is lazy-loaded but MUST eventually fire on every
    // Settings open. bindLicenseModalEvents is idempotent (module-level
    // flag), so calling it repeatedly is safe.
    expect(licenseUi.bindLicenseModalEvents).toHaveBeenCalled();
    expect(licenseUi.updateLicenseUI).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// updateTopProStatus
// ─────────────────────────────────────────────────────────────────────

describe('updateTopProStatus', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  it('Pro user: pulls GET_LICENSE_STATUS + writes to state.proLicenseInfo', async () => {
    state.isProUser = true;
    chromeMock.runtime.sendMessage.mockResolvedValue({
      plan: 'lifetime',
      expiresAt: 9999999999,
    });

    await updateTopProStatus();
    expect(state.proLicenseInfo).toEqual({ plan: 'lifetime', expiresAt: 9999999999 });
  });

  it('Pro user: keeps previous proLicenseInfo when GET_LICENSE_STATUS has no plan (no flicker)', async () => {
    state.isProUser = true;
    state.proLicenseInfo = { plan: 'monthly', expiresAt: 1234567890 };
    chromeMock.runtime.sendMessage.mockResolvedValue({}); // no plan field

    await updateTopProStatus();
    // Pin: don't overwrite proLicenseInfo with empty payload — protects
    // against transient backend hiccups that would otherwise blank the
    // badge and look like a license loss to the user.
    expect(state.proLicenseInfo).toEqual({ plan: 'monthly', expiresAt: 1234567890 });
  });

  it('Pro user: GET_LICENSE_STATUS throw is swallowed (defensive — no badge flicker)', async () => {
    state.isProUser = true;
    state.proLicenseInfo = { plan: 'monthly', expiresAt: 1234567890 };
    chromeMock.runtime.sendMessage.mockRejectedValue(new Error('bg down'));

    await expect(updateTopProStatus()).resolves.toBeUndefined();
    // Same protection as above.
    expect(state.proLicenseInfo).toEqual({ plan: 'monthly', expiresAt: 1234567890 });
  });

  it('Free user (transition Pro → free): clears state.proLicenseInfo', async () => {
    state.isProUser = false;
    state.proLicenseInfo = { plan: 'monthly', expiresAt: 1234567890 };

    await updateTopProStatus();
    // Pin: clearing on free transition prevents stale plan/expiry
    // from sticking to the badge if the user reactivates later with
    // a different license.
    expect(state.proLicenseInfo).toBeNull();
    // Also: free path does NOT call sendMessage (no GET_LICENSE_STATUS).
    expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('Pro user: binds #btn-top-deactivate click handler exactly once (_bound flag)', async () => {
    state.isProUser = true;
    chromeMock.runtime.sendMessage.mockResolvedValue({ plan: 'lifetime' });

    document.body.innerHTML = '<button id="btn-top-deactivate"></button>';
    const btn = document.getElementById('btn-top-deactivate') as HTMLElement & {
      _bound?: boolean;
    };
    const addSpy = vi.spyOn(btn, 'addEventListener');

    await updateTopProStatus();
    expect(btn._bound).toBe(true);
    expect(addSpy).toHaveBeenCalledTimes(1);

    // Second call: the flag prevents a second addEventListener — pinned
    // because every Settings open triggers updateTopProStatus, and
    // duplicate listeners would fire the deactivate flow N times per click.
    await updateTopProStatus();
    expect(addSpy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// saveSettings — full persistence path
// ─────────────────────────────────────────────────────────────────────

describe('saveSettings', () => {
  let chromeMock: ChromeMock;

  // Build the minimal DOM fixture required for saveSettings's getXxx
  // reads. Without these, every getter returns the documented default
  // (covered by other cases) but here we want CONTROL over the values
  // saveSettings reads back, so we render checked checkboxes / filled
  // inputs / data-value selects with our chosen state.
  function buildSettingsFormDOM(opts: {
    useSidePanel?: boolean;
    density?: string;
    theme?: string;
    defaultGroup?: string;
    searchAllFrames?: boolean;
  }): void {
    const checked = (b: boolean | undefined): string => (b ? 'checked' : '');
    document.body.innerHTML = `
      <input type="checkbox" id="setting-side-panel" ${checked(opts.useSidePanel)} />
      <input type="radio" name="layout-density" value="compact" ${
        opts.density === 'compact' ? 'checked' : ''
      } />
      <input type="radio" name="layout-density" value="standard" ${
        opts.density === 'standard' || !opts.density ? 'checked' : ''
      } />
      <input type="radio" name="layout-density" value="comfortable" ${
        opts.density === 'comfortable' ? 'checked' : ''
      } />
      <input type="radio" name="theme" value="system" ${
        opts.theme === 'system' || !opts.theme ? 'checked' : ''
      } />
      <input type="radio" name="theme" value="light" ${opts.theme === 'light' ? 'checked' : ''} />
      <input type="radio" name="theme" value="dark" ${opts.theme === 'dark' ? 'checked' : ''} />
      <div id="setting-default-group" data-value="${opts.defaultGroup ?? 'none'}"></div>
      <input type="checkbox" id="setting-download-options" />
      <input id="setting-subfolder" value="{domain}" />
      <input id="setting-filename" value="img_{index}_{original}.{format}" />
      <div id="setting-convert-format" data-value="none"></div>
      <input type="checkbox" id="setting-all-frames" ${checked(opts.searchAllFrames)} />
      <input type="checkbox" id="setting-live-monitor" />
      <input type="checkbox" id="setting-min-size" />
      <input id="setting-min-width" value="50" />
      <input id="setting-min-height" value="50" />
      <input type="checkbox" id="setting-max-size" />
      <input id="setting-max-width" value="8000" />
      <input id="setting-max-height" value="8000" />
      <input type="checkbox" id="setting-no-warning" />
    `;
  }

  beforeEach(() => {
    chromeMock = installChromeMock();
    chromeMock.runtime.sendMessage.mockResolvedValue({ isPro: false });
    state.settingsModalState = { open: true };
  });

  it('writes ALL form values into state.appSettings + persists via storage.local.set', async () => {
    buildSettingsFormDOM({
      useSidePanel: true,
      density: 'compact',
      theme: 'dark',
      defaultGroup: 'domain',
    });
    chromeMock.storage.local.get.mockResolvedValue({}); // no previous → no display-mode change

    await saveSettings();

    expect(state.appSettings.useSidePanel).toBe(true);
    expect(state.appSettings.density).toBe('compact');
    expect(state.appSettings.theme).toBe('dark');
    expect(state.appSettings.defaultGroup).toBe('domain');
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ appSettings: state.appSettings })
    );
  });

  it('Free tier: liveMonitoring is FORCED to false regardless of toggle state', async () => {
    buildSettingsFormDOM({});
    state.isProUser = false;
    // Even if the live-monitor toggle was rendered checked, free path
    // ignores it — pinned because the user can't actually use Live
    // Monitoring without Pro and persisting `true` would mislead UI.
    document.querySelector<HTMLInputElement>('#setting-live-monitor')!.checked = true;

    await saveSettings();
    expect(state.appSettings.liveMonitoring).toBe(false);
  });

  it('Pro tier: liveMonitoring respects the toggle', async () => {
    buildSettingsFormDOM({});
    state.isProUser = true;
    chromeMock.runtime.sendMessage.mockResolvedValue({ isPro: true });
    document.querySelector<HTMLInputElement>('#setting-live-monitor')!.checked = true;

    await saveSettings();
    expect(state.appSettings.liveMonitoring).toBe(true);
  });

  it('parseInt fallback: empty min-width input → defaults to 50 (NOT NaN)', async () => {
    buildSettingsFormDOM({});
    document.querySelector<HTMLInputElement>('#setting-min-width')!.value = '';
    document.querySelector<HTMLInputElement>('#setting-max-width')!.value = '';

    await saveSettings();
    // Pin: parseInt('') is NaN; the fallback uses DEFAULT_APP_SETTINGS
    // values to protect against silent NaN propagation.
    expect(state.appSettings.minWidth).toBe(0);
    expect(state.appSettings.maxWidth).toBe(99999);
  });

  it('display mode change: previous=true, new=false → calls switchDisplayMode + NO success toast', async () => {
    buildSettingsFormDOM({ useSidePanel: false });
    chromeMock.storage.local.get.mockResolvedValue({
      appSettings: { useSidePanel: true },
    });
    vi.spyOn(window, 'close').mockImplementation(() => {});

    await saveSettings();
    // switchDisplayMode → chrome.tabs.query + sendMessage SET_DISPLAY_MODE
    expect(chromeMock.tabs.query).toHaveBeenCalled();
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_DISPLAY_MODE', useSidePanel: false })
    );
    // Pin: NO toast because window.close() makes it invisible anyway —
    // a "Settings saved" toast that flashes for a frame would just be UI noise.
    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).not.toHaveBeenCalledWith('Settings saved', 'success');
  });

  it('NO display mode change (previous undefined / first save): NO switchDisplayMode + show success toast', async () => {
    buildSettingsFormDOM({ useSidePanel: true });
    chromeMock.storage.local.get.mockResolvedValue({}); // no previous appSettings

    await saveSettings();
    // Pin: previousUseSidePanel === undefined → displayModeChanged=false
    // (the explicit `previousUseSidePanel !== undefined` guard). Without
    // it, first-ever save would always trigger an unnecessary mode switch.
    expect(chromeMock.tabs.query).not.toHaveBeenCalled();
    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).toHaveBeenCalledWith('Settings saved', 'success');
  });

  it('NO display mode change (previous matches new): NO switchDisplayMode', async () => {
    buildSettingsFormDOM({ useSidePanel: true });
    chromeMock.storage.local.get.mockResolvedValue({
      appSettings: { useSidePanel: true },
    });

    await saveSettings();
    expect(chromeMock.tabs.query).not.toHaveBeenCalled();
  });

  it('searchAllFrames CHANGED: triggers fetchImages re-scan', async () => {
    buildSettingsFormDOM({ searchAllFrames: true });
    state.appSettings.searchAllFrames = false; // prev=false, new=true

    await saveSettings();
    const scan = await import('../sidepanel/scan');
    // Pin: changing searchAllFrames must force a re-scan because the
    // current allImages was collected with the OLD flag — without
    // re-scan, the user wouldn't see iframe images they just enabled.
    expect(scan.fetchImages).toHaveBeenCalled();
  });

  it('searchAllFrames UNCHANGED: does NOT call fetchImages', async () => {
    buildSettingsFormDOM({ searchAllFrames: false });
    state.appSettings.searchAllFrames = false;

    await saveSettings();
    const scan = await import('../sidepanel/scan');
    expect(scan.fetchImages).not.toHaveBeenCalled();
  });

  it('isFetching=true: SKIPS applyFilters (avoid flashing "No images found")', async () => {
    buildSettingsFormDOM({});
    state.isFetching = true;

    await saveSettings();
    const filter = await import('../sidepanel/filter');
    // Pin: while a scan is in progress, allImages is empty/intermediate
    // and applyFilters would render "No images found" briefly. The
    // ongoing fetchImages will trigger applyFilters when done.
    expect(filter.applyFilters).not.toHaveBeenCalled();
  });

  it('isFetching=false: calls applyFilters as part of post-save refresh', async () => {
    buildSettingsFormDOM({});
    state.isFetching = false;

    await saveSettings();
    const filter = await import('../sidepanel/filter');
    expect(filter.applyFilters).toHaveBeenCalled();
  });

  it('storage.set throws → error toast + NO partial UI updates', async () => {
    buildSettingsFormDOM({});
    chromeMock.storage.local.set.mockRejectedValue(new Error('quota'));

    await saveSettings();
    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).toHaveBeenCalledWith('Failed to save settings', 'error');
    // Pin: closeSettings is INSIDE the try block, so an early throw
    // leaves the modal open so the user can retry without losing input.
    expect(state.settingsModalState.open).toBe(true);
  });

  it('closes settings modal on successful save', async () => {
    buildSettingsFormDOM({});
    state.settingsModalState = { open: true };

    await saveSettings();
    expect(state.settingsModalState.open).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// toggleFilterDropdown — simplified-path coverage (jsdom doesn't compute
// layout, so wouldOverflowRight / wouldOverflowLeft positioning is left
// as e2e territory; here we pin the open/close state machine + special
// color-filter renderColorSwatches call + missing-element guards)
// ─────────────────────────────────────────────────────────────────────

import { toggleFilterDropdown } from '../sidepanel/settings';

describe('toggleFilterDropdown', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('non-existent dropdown id → no-op (no crash, no DOM mutation)', () => {
    document.body.innerHTML = '<div class="filter-dropdown" id="filter-other"></div>';
    expect(() => toggleFilterDropdown('does-not-exist')).not.toThrow();
    // closeAllFilterDropdowns still ran — pinned because the close path
    // is unconditional, ensuring stale dropdowns from a previous toggle
    // don't linger when the user clicks an unrelated trigger.
    expect(document.getElementById('filter-other')!.classList.contains('hidden')).toBe(true);
  });

  it('hidden dropdown becomes visible (open path)', () => {
    document.body.innerHTML = `
      <div class="filter-container">
        <button class="filter-btn" data-filter="size"></button>
        <div class="filter-dropdown hidden" id="filter-size"></div>
      </div>
    `;
    toggleFilterDropdown('size');
    // Pin: wasHidden=true → unconditional .remove('hidden') at end of fn,
    // independent of the layout-positioning branches that jsdom can't
    // exercise (offsetWidth/getBoundingClientRect are 0 in jsdom).
    expect(document.getElementById('filter-size')!.classList.contains('hidden')).toBe(false);
  });

  it('visible dropdown stays closed after toggle (close path via wasHidden=false)', () => {
    document.body.innerHTML = `
      <div class="filter-container">
        <button class="filter-btn" data-filter="size"></button>
        <div class="filter-dropdown" id="filter-size"></div>
      </div>
    `;
    toggleFilterDropdown('size');
    // Pin: wasHidden=false → closeAllFilterDropdowns hides it + the
    // post-condition 'if (dropdown && wasHidden)' branch is skipped, so
    // the dropdown ends hidden. This is the toggle-to-close behavior.
    expect(document.getElementById('filter-size')!.classList.contains('hidden')).toBe(true);
  });

  it('opening another dropdown closes the previously open one', () => {
    document.body.innerHTML = `
      <div class="filter-container">
        <button class="filter-btn" data-filter="size"></button>
        <div class="filter-dropdown" id="filter-size"></div>
        <button class="filter-btn" data-filter="format"></button>
        <div class="filter-dropdown hidden" id="filter-format"></div>
      </div>
    `;
    // Pin: opening 'format' must close 'size' — only ONE dropdown
    // visible at a time (UX contract: floating menus are mutex).
    toggleFilterDropdown('format');
    expect(document.getElementById('filter-size')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('filter-format')!.classList.contains('hidden')).toBe(false);
  });

  it('color filter type → calls renderColorSwatches before measuring (dynamic content prep)', async () => {
    document.body.innerHTML = `
      <div class="filter-container">
        <button class="filter-btn" data-filter="color"></button>
        <div class="filter-dropdown hidden" id="filter-color"></div>
      </div>
    `;
    toggleFilterDropdown('color');
    const filter = await import('../sidepanel/filter');
    // Pin: 'color' is special — swatches are rendered lazily so the
    // dropdown can be sized correctly. Removing this call would leave
    // the dropdown empty on first open until something else triggers
    // a re-render (effectively broken UX).
    expect(filter.renderColorSwatches).toHaveBeenCalled();
  });
});
