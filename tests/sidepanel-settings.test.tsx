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
        .map(
          (o) => `<div class="setting-select-option" data-value="${o.value}">${o.label}</div>`
        )
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

    const checked = document.querySelector<HTMLInputElement>(
      'input[name="density"]:checked'
    );
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
      <input type="checkbox" id="setting-similar-detection" />
      <input type="checkbox" id="setting-color-extract" />
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
    'free user clicking #%s → upgrade modal opens + warning toast (NOT propagated to feature handler)',
    async (id) => {
      state.isProUser = false;
      state.proUpgradeModalState = { open: false, errorText: '' };

      // Add a downstream handler — it should NOT fire because the
      // capture-phase guard calls stopImmediatePropagation.
      const downstream = vi.fn();
      document.getElementById(id)!.addEventListener('click', downstream);

      document.getElementById(id)!.click();

      expect(state.proUpgradeModalState.open).toBe(true);
      const ui = await import('../sidepanel/ui');
      expect(ui.showToast).toHaveBeenCalledWith(
        expect.stringMatching(/Pro feature/),
        'warning'
      );
      expect(downstream).not.toHaveBeenCalled();
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

  it.each(['setting-similar-detection', 'setting-color-extract', 'setting-live-monitor'])(
    'free user clicking Pro toggle #%s → close settings + warning toast + open upgrade modal',
    async (id) => {
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
    }
  );

  it('Pro user toggling a Pro setting → no interception (settings stays open, no toast)', async () => {
    state.isProUser = true;
    state.settingsModalState = { ...state.settingsModalState, open: true };

    document.getElementById('setting-similar-detection')!.click();

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
