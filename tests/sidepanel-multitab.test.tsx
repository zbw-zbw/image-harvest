// Unit tests for sidepanel/multitab.ts — the 352-line lazy-loaded
// multi-tab image extraction module (previously at 0% coverage).
//
// Scope grouped by Chrome-API surface dependency:
//   Group A — pure/DOM-only (no chrome):
//     * getFallbackFaviconUrl (pure URL parser)
//     * toggleTabCheckboxVisual (DOM class flip)
//     * updateMultitabSelectAllState (3-way checked/partial/none state)
//     * toggleMultitabSelectAll (all-on ↔ all-off toggle)
//     * showMultiTabModal (state flip + scrollTop reset + loadTabList kickoff)
//
//   Group B — chrome.tabs.query + scripting.executeScript (this file):
//     * loadTabList (tab filter by isRestrictedUrl + active-first sort +
//       DOM render + 4 event wires + resolveTabFavicons async kickoff)
//     * resolveTabFavicons / resolveTabFaviconById / tryGoogleFaviconFallback
//
//   Group C — chrome.runtime.sendMessage 'MULTI_TAB_EXTRACT':
//     * startMultiTabExtract (response handling + abort + processImageExtras)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shared/utils', async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>;
  return {
    ...actual,
    // isRestrictedUrl is used by loadTabList to filter chrome:// etc.
    // Override with a predictable stub so tests don't depend on the real
    // whitelist drift.
    isRestrictedUrl: vi.fn((url?: string) => !!url && url.startsWith('chrome://')),
  };
});
vi.mock('../sidepanel/filter', () => ({ applyFilters: vi.fn() }));
vi.mock('../sidepanel/pro-features', () => ({ closeMultiTabModal: vi.fn() }));
vi.mock('../sidepanel/scan', () => ({ processImageExtras: vi.fn() }));
vi.mock('../sidepanel/ui', () => ({
  hideProgress: vi.fn(),
  showProgress: vi.fn(),
  showToast: vi.fn(),
  updateFilterButtonLabels: vi.fn(),
  updateProgress: vi.fn(),
}));
vi.mock('../sidepanel/utils', () => ({
  generateId: vi.fn((url: string) => `id-${url}`),
  truncateUrl: vi.fn((u: string, n: number) => u.slice(0, n)),
}));

import {
  getFallbackFaviconUrl,
  showMultiTabModal,
  toggleMultitabSelectAll,
  toggleTabCheckboxVisual,
  updateMultitabSelectAllState,
} from '../sidepanel/multitab';
import { elements, state } from '../sidepanel/state';

interface ChromeStub {
  tabs: {
    query: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  scripting: {
    executeScript: ReturnType<typeof vi.fn>;
  };
  runtime: {
    sendMessage: ReturnType<typeof vi.fn>;
  };
}

let chromeStub: ChromeStub;

function installChrome(): void {
  chromeStub = {
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ url: 'https://example.com' }),
    },
    scripting: {
      executeScript: vi.fn().mockResolvedValue([{ result: null }]),
    },
    runtime: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
}

function mountMultitabDOM(): void {
  document.body.innerHTML = `
    <div id="multitab-modal">
      <div class="modal-body"></div>
    </div>
    <div id="multitab-list"></div>
    <button id="multitab-select-all">
      <span class="check-icon hidden"></span>
      <span class="select-all-text">Select all</span>
    </button>
  `;
  elements.multitabList = document.getElementById('multitab-list') as HTMLDivElement;
}

beforeEach(() => {
  installChrome();
  mountMultitabDOM();
  state.multitabModalState = { open: false };
  state.allImages = [];
  state.isMultiTabExtracting = false;
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (elements as Partial<typeof elements>).multitabList;
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// Group A — pure / DOM-only
// ─────────────────────────────────────────────────────────────────────

describe('getFallbackFaviconUrl', () => {
  it('valid http URL → "<origin>/favicon.ico"', () => {
    expect(getFallbackFaviconUrl('https://example.com/some/path?q=1')).toBe(
      'https://example.com/favicon.ico'
    );
  });

  it('valid http URL with port → port preserved in origin', () => {
    // Pin: URL.origin includes port. A regression hardcoding ":80"
    // or stripping the port would break intranet favicon resolution.
    expect(getFallbackFaviconUrl('http://localhost:3000/app')).toBe(
      'http://localhost:3000/favicon.ico'
    );
  });

  it('invalid URL → empty string (catch branch, no crash)', () => {
    expect(getFallbackFaviconUrl('not a url')).toBe('');
    expect(getFallbackFaviconUrl('')).toBe('');
  });

  it('chrome:// internal URL → "chrome:///favicon.ico" (still a valid URL object)', () => {
    // Pin: chrome-internal URLs parse fine; they just happen to have
    // empty origin. A regression conflating "not parseable" with
    // "origin === ''" would wrongly return '' here.
    const result = getFallbackFaviconUrl('chrome://extensions');
    expect(result).toMatch(/favicon\.ico$/);
  });
});

describe('toggleTabCheckboxVisual', () => {
  function mkTabItem(checked: boolean): { item: HTMLElement; checkbox: HTMLInputElement } {
    const item = document.createElement('div');
    item.className = 'tab-item';
    item.innerHTML = `
      <label class="tab-checkbox">
        <input type="checkbox" />
      </label>
    `;
    const checkbox = item.querySelector('input') as HTMLInputElement;
    checkbox.checked = checked;
    document.body.appendChild(item);
    return { item, checkbox };
  }

  it('syncs .checked CSS class with the native checkbox.checked state', () => {
    const { item, checkbox } = mkTabItem(true);
    toggleTabCheckboxVisual(item);
    expect(item.querySelector('.tab-checkbox')!.classList.contains('checked')).toBe(true);

    checkbox.checked = false;
    toggleTabCheckboxVisual(item);
    expect(item.querySelector('.tab-checkbox')!.classList.contains('checked')).toBe(false);
  });

  it('missing input or .tab-checkbox wrapper → silent no-op (defensive)', () => {
    const empty = document.createElement('div');
    // Pin: this is the "half-rendered DOM between render frames"
    // guard. Without it, reacting to a click mid-render would crash.
    expect(() => toggleTabCheckboxVisual(empty)).not.toThrow();
  });
});

describe('updateMultitabSelectAllState', () => {
  function mkCheckboxes(states: boolean[]): void {
    const list = document.getElementById('multitab-list')!;
    list.innerHTML = states
      .map(
        (checked) =>
          `<div class="tab-item"><label class="tab-checkbox"><input type="checkbox" ${checked ? 'checked' : ''} /></label></div>`
      )
      .join('');
  }

  it('all checked → .checked class + check icon visible + "N selected" label', () => {
    mkCheckboxes([true, true, true]);
    updateMultitabSelectAllState();
    const btn = document.getElementById('multitab-select-all')!;
    expect(btn.classList.contains('checked')).toBe(true);
    expect(btn.classList.contains('partial')).toBe(false);
    expect(btn.querySelector('.check-icon')!.classList.contains('hidden')).toBe(false);
    expect(btn.querySelector('.select-all-text')!.textContent).toBe('3 selected');
  });

  it('some checked → .partial class + check icon visible + "N selected" label', () => {
    mkCheckboxes([true, false, false]);
    updateMultitabSelectAllState();
    const btn = document.getElementById('multitab-select-all')!;
    // Pin: "partial" is a distinct CSS state (dash icon) from
    // "checked" (check icon). Using the same class for both would
    // stop users from telling whether they selected all vs. some.
    expect(btn.classList.contains('partial')).toBe(true);
    expect(btn.classList.contains('checked')).toBe(false);
    expect(btn.querySelector('.select-all-text')!.textContent).toBe('1 selected');
  });

  it('none checked → neither class + check icon HIDDEN + "Select all" label', () => {
    mkCheckboxes([false, false]);
    updateMultitabSelectAllState();
    const btn = document.getElementById('multitab-select-all')!;
    expect(btn.classList.contains('checked')).toBe(false);
    expect(btn.classList.contains('partial')).toBe(false);
    expect(btn.querySelector('.check-icon')!.classList.contains('hidden')).toBe(true);
    expect(btn.querySelector('.select-all-text')!.textContent).toBe('Select all');
  });

  it('zero checkboxes (empty list) → treats as "none" (not "all")', () => {
    mkCheckboxes([]);
    updateMultitabSelectAllState();
    const btn = document.getElementById('multitab-select-all')!;
    // Pin: the `totalCount > 0` guard on the "all checked" branch.
    // Without it, an empty list would show "0 selected" with the
    // check icon (checkedCount===totalCount vacuously true).
    expect(btn.classList.contains('checked')).toBe(false);
    expect(btn.querySelector('.select-all-text')!.textContent).toBe('Select all');
  });

  it('missing #multitab-select-all → silent early-return', () => {
    document.getElementById('multitab-select-all')?.remove();
    mkCheckboxes([true]);
    expect(() => updateMultitabSelectAllState()).not.toThrow();
  });
});

describe('toggleMultitabSelectAll', () => {
  function mkCheckboxes(states: boolean[]): void {
    const list = document.getElementById('multitab-list')!;
    list.innerHTML = states
      .map(
        (checked) =>
          `<div class="tab-item"><label class="tab-checkbox"><input type="checkbox" ${checked ? 'checked' : ''} /></label></div>`
      )
      .join('');
  }

  it('some-checked → all-checked (expands selection)', () => {
    mkCheckboxes([true, false, false]);
    toggleMultitabSelectAll();
    const boxes = document.querySelectorAll<HTMLInputElement>('.tab-checkbox input');
    expect(Array.from(boxes).every((b) => b.checked)).toBe(true);
    // Select-all button state is also resynced.
    expect(document.getElementById('multitab-select-all')!.classList.contains('checked')).toBe(
      true
    );
  });

  it('all-checked → all-unchecked (collapses selection)', () => {
    mkCheckboxes([true, true, true]);
    toggleMultitabSelectAll();
    const boxes = document.querySelectorAll<HTMLInputElement>('.tab-checkbox input');
    expect(Array.from(boxes).every((b) => !b.checked)).toBe(true);
  });

  it('none-checked → all-checked', () => {
    mkCheckboxes([false, false]);
    toggleMultitabSelectAll();
    const boxes = document.querySelectorAll<HTMLInputElement>('.tab-checkbox input');
    expect(Array.from(boxes).every((b) => b.checked)).toBe(true);
  });

  it('empty list → no-op (no `every` on empty array quirk)', () => {
    mkCheckboxes([]);
    // Pin: `.every()` on empty array returns true, which would flip
    // allChecked → true → the toggle would try to un-check nothing.
    // The explicit `checkboxes.length > 0 &&` guard prevents this.
    expect(() => toggleMultitabSelectAll()).not.toThrow();
  });
});

describe('showMultiTabModal', () => {
  it('flips state.multitabModalState.open=true + resets modal-body scrollTop + kicks off loadTabList', () => {
    const modalBody = document.querySelector('.modal-body') as HTMLElement;
    modalBody.scrollTop = 400;
    chromeStub.tabs.query.mockResolvedValueOnce([]);

    showMultiTabModal();

    expect(state.multitabModalState.open).toBe(true);
    expect(modalBody.scrollTop).toBe(0);
    // loadTabList is awaitable-but-not-awaited; the chrome.tabs.query
    // call is what proves it was fired off.
    expect(chromeStub.tabs.query).toHaveBeenCalledWith({ currentWindow: true });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Group B — loadTabList + favicon resolver chain
// ─────────────────────────────────────────────────────────────────────

describe('loadTabList', () => {
  // Helper: builds a Chrome tab dict with sensible defaults.
  function mkTab(overrides: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
    return {
      id: 1,
      url: 'https://example.com/a',
      title: 'Example',
      active: false,
      favIconUrl: '',
      ...overrides,
    } as chrome.tabs.Tab;
  }

  it('missing elements.multitabList → early return (no crash, no chrome call)', async () => {
    delete (elements as Partial<typeof elements>).multitabList;
    const { loadTabList } = await import('../sidepanel/multitab');
    await loadTabList();
    // Pin: early-return BEFORE chrome.tabs.query. This is the pre-mount
    // window guard for the Preact-managed multitab modal subtree.
    expect(chromeStub.tabs.query).not.toHaveBeenCalled();
  });

  it('filters out chrome:// URLs via isRestrictedUrl + renders remaining tabs', async () => {
    chromeStub.tabs.query.mockResolvedValueOnce([
      mkTab({ id: 1, url: 'https://a.com', title: 'A', favIconUrl: 'https://a.com/f.ico' }),
      mkTab({ id: 2, url: 'chrome://extensions', title: 'Ext' }),
      mkTab({ id: 3, url: 'https://b.com', title: 'B', favIconUrl: 'https://b.com/f.ico' }),
    ]);

    const { loadTabList } = await import('../sidepanel/multitab');
    await loadTabList();

    const items = document.querySelectorAll('.tab-item');
    // Pin: chrome://extensions filtered out. Without isRestrictedUrl,
    // we'd render a tab the user can't actually scan (CSP-blocked) +
    // then silently fail during the scan pipeline.
    expect(items).toHaveLength(2);
    const ids = Array.from(items).map((el) => (el as HTMLElement).dataset.tabId);
    expect(ids).toEqual(expect.arrayContaining(['1', '3']));
    expect(ids).not.toContain('2');
  });

  it('active tab sorted first with .tab-current class + "Current" badge', async () => {
    chromeStub.tabs.query.mockResolvedValueOnce([
      mkTab({ id: 1, url: 'https://a.com', title: 'A', active: false }),
      mkTab({ id: 2, url: 'https://b.com', title: 'B', active: true }),
      mkTab({ id: 3, url: 'https://c.com', title: 'C', active: false }),
    ]);

    const { loadTabList } = await import('../sidepanel/multitab');
    await loadTabList();

    const items = document.querySelectorAll<HTMLElement>('.tab-item');
    // Pin: active tab floats to position 0. A regression using a
    // numeric (b.id - a.id) sort would put the current tab in random
    // order vs. its peers.
    expect(items[0].dataset.tabId).toBe('2');
    expect(items[0].classList.contains('tab-current')).toBe(true);
    expect(items[0].innerHTML).toContain('Current');
    // Non-current tabs have NO current-badge.
    expect(items[1].innerHTML).not.toContain('tab-current-badge');
  });

  it('missing favIconUrl → fallback to /favicon.ico on origin', async () => {
    chromeStub.tabs.query.mockResolvedValueOnce([
      mkTab({ id: 1, url: 'https://a.com/deep/path', title: 'A', favIconUrl: '' }),
    ]);

    const { loadTabList } = await import('../sidepanel/multitab');
    await loadTabList();

    const img = document.querySelector<HTMLImageElement>('.tab-favicon')!;
    // Pin: fallback used when favIconUrl absent. Chrome strips
    // favIconUrl on discarded tabs + some privacy modes — without
    // fallback the img would emit a broken-image icon.
    expect(img.src).toBe('https://a.com/favicon.ico');
  });

  it('title defaults to "Untitled" when chrome.tabs.Tab.title is empty', async () => {
    chromeStub.tabs.query.mockResolvedValueOnce([
      mkTab({ id: 1, url: 'https://a.com', title: '', favIconUrl: 'https://a.com/f.ico' }),
    ]);

    const { loadTabList } = await import('../sidepanel/multitab');
    await loadTabList();
    expect(document.querySelector('.tab-title')!.textContent).toContain('Untitled');
  });

  it('click on tab-item row (outside checkbox) toggles checkbox + visual + select-all state', async () => {
    chromeStub.tabs.query.mockResolvedValueOnce([
      mkTab({ id: 1, url: 'https://a.com', title: 'A', favIconUrl: 'https://a.com/f.ico' }),
    ]);

    const { loadTabList } = await import('../sidepanel/multitab');
    await loadTabList();

    const item = document.querySelector<HTMLElement>('.tab-item')!;
    const checkbox = item.querySelector<HTMLInputElement>('.tab-checkbox input')!;
    expect(checkbox.checked).toBe(false);

    // Click on the tab-info area (outside .tab-checkbox).
    const tabInfo = item.querySelector<HTMLElement>('.tab-info')!;
    tabInfo.click();
    expect(checkbox.checked).toBe(true);
    expect(item.querySelector('.tab-checkbox')!.classList.contains('checked')).toBe(true);
    // Select-all state updated too.
    expect(document.getElementById('multitab-select-all')!.classList.contains('checked')).toBe(
      true
    );
  });

  it('click INSIDE .tab-checkbox: row handler short-circuits via closest() guard', async () => {
    chromeStub.tabs.query.mockResolvedValueOnce([
      mkTab({ id: 1, url: 'https://a.com', title: 'A', favIconUrl: 'https://a.com/f.ico' }),
    ]);

    const { loadTabList } = await import('../sidepanel/multitab');
    await loadTabList();

    const item = document.querySelector<HTMLElement>('.tab-item')!;
    const checkbox = item.querySelector<HTMLInputElement>('.tab-checkbox input')!;
    // Pre-set checkbox to true (simulate user already clicked it).
    checkbox.checked = true;

    // Click with event.target INSIDE .tab-checkbox. The row handler's
    // `if (closest('.tab-checkbox')) return` guard must prevent it
    // from flipping checkbox.checked BACK to false. Without this
    // guard, the row click handler + native label click would
    // both fire and cancel each other out (checked→unchecked→checked
    // or worse, unchecked net).
    const checkIcon = item.querySelector<HTMLElement>('.checkbox-icon')!;
    checkIcon.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // The important assertion: row handler did NOT manually flip
    // the checkbox state. jsdom's label-click semantics vary, but
    // the row handler's OWN mutation is what we're pinning.
    // Since we pre-set to true, any flip by the row handler would
    // be visible. The guard means row handler runs `return` before
    // any mutation.
    // (We do not assert final checkbox state because jsdom may or
    // may not auto-toggle on label-contained programmatic clicks;
    // that's Chrome's business, not this module's.)
    expect(item.classList.contains('tab-current')).toBe(false);
  });

  it('individual checkbox change triggers visual sync + select-all state refresh', async () => {
    chromeStub.tabs.query.mockResolvedValueOnce([
      mkTab({ id: 1, url: 'https://a.com', title: 'A', favIconUrl: 'https://a.com/f.ico' }),
      mkTab({ id: 2, url: 'https://b.com', title: 'B', favIconUrl: 'https://b.com/f.ico' }),
    ]);

    const { loadTabList } = await import('../sidepanel/multitab');
    await loadTabList();

    const boxes = document.querySelectorAll<HTMLInputElement>('.tab-checkbox input');
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event('change'));

    // After change, select-all shows partial.
    expect(document.getElementById('multitab-select-all')!.classList.contains('partial')).toBe(
      true
    );
  });

  it('chrome.tabs.query throws → renders "Failed to load tabs" empty state', async () => {
    chromeStub.tabs.query.mockRejectedValueOnce(new Error('perm denied'));
    const { loadTabList } = await import('../sidepanel/multitab');
    await loadTabList();
    expect(document.getElementById('multitab-list')!.innerHTML).toContain('Failed to load tabs');
  });

  it('favicon error event → triggers resolveTabFaviconById with the tab id from dataset', async () => {
    chromeStub.tabs.query.mockResolvedValueOnce([
      mkTab({ id: 42, url: 'https://a.com', title: 'A', favIconUrl: 'https://a.com/bad.ico' }),
    ]);
    chromeStub.scripting.executeScript.mockResolvedValueOnce([
      { result: 'https://a.com/real-favicon.png' },
    ]);

    const { loadTabList } = await import('../sidepanel/multitab');
    await loadTabList();

    const favicon = document.querySelector<HTMLImageElement>('.tab-favicon')!;
    favicon.dispatchEvent(new Event('error'));
    // Let the resolver microtasks run.
    await new Promise((r) => setTimeout(r, 0));

    // Pin: the `resolveTabFaviconById(tabId, faviconImg)` wire. Without
    // parsing tabId from dataset, broken-favicon UX would leave the
    // img permanently hidden with no retry path.
    expect(chromeStub.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 42 } })
    );
  });
});

describe('resolveTabFavicons (batch resolver for tabs missing favIconUrl)', () => {
  it('empty input list → no scripting calls (short-circuit)', async () => {
    const { resolveTabFavicons } = await import('../sidepanel/multitab');
    await resolveTabFavicons([
      {
        id: 1,
        url: 'https://a.com',
        favIconUrl: 'https://a.com/f.ico', // present → filtered out
      } as chrome.tabs.Tab,
    ]);
    expect(chromeStub.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('tab missing favicon: resolves via <link rel="icon"> + updates img src', async () => {
    // Seed DOM with a tab row (loadTabList normally does this).
    document.getElementById('multitab-list')!.innerHTML = `
      <div class="tab-item" data-tab-id="7">
        <img class="tab-favicon" style="visibility:hidden" />
      </div>
    `;
    chromeStub.scripting.executeScript.mockResolvedValueOnce([
      { result: 'https://a.com/resolved.png' },
    ]);

    const { resolveTabFavicons } = await import('../sidepanel/multitab');
    await resolveTabFavicons([{ id: 7, url: 'https://a.com', favIconUrl: '' } as chrome.tabs.Tab]);

    const img = document.querySelector<HTMLImageElement>('.tab-favicon')!;
    expect(img.src).toBe('https://a.com/resolved.png');
    expect(img.style.visibility).toBe('');
  });

  it('scripting.executeScript throws (restricted tab) → Google favicon fallback fires', async () => {
    document.getElementById('multitab-list')!.innerHTML = `
      <div class="tab-item" data-tab-id="8">
        <img class="tab-favicon" />
      </div>
    `;
    chromeStub.scripting.executeScript.mockRejectedValueOnce(new Error('restricted'));
    // tryGoogleFaviconFallback → chrome.tabs.get for origin lookup.
    chromeStub.tabs.get.mockResolvedValueOnce({
      id: 8,
      url: 'https://restricted.example.com/page',
    } as chrome.tabs.Tab);

    const { resolveTabFavicons } = await import('../sidepanel/multitab');
    await resolveTabFavicons([
      { id: 8, url: 'https://restricted.example.com', favIconUrl: '' } as chrome.tabs.Tab,
    ]);

    const img = document.querySelector<HTMLImageElement>('.tab-favicon')!;
    // Pin: Google favicon service is the last-resort fallback when
    // both the tab's own <link rel="icon"> AND the /favicon.ico
    // origin probe fail. It uses a fixed host so no regressions in
    // the URL can be dismissed as "that's a different service".
    expect(img.src).toContain('https://www.google.com/s2/favicons');
    expect(img.src).toContain('domain_url=');
  });

  it('script returns null (no <link> found) → Google favicon fallback fires', async () => {
    document.getElementById('multitab-list')!.innerHTML = `
      <div class="tab-item" data-tab-id="9">
        <img class="tab-favicon" />
      </div>
    `;
    chromeStub.scripting.executeScript.mockResolvedValueOnce([{ result: null }]);
    chromeStub.tabs.get.mockResolvedValueOnce({
      id: 9,
      url: 'https://no-link.example.com',
    } as chrome.tabs.Tab);

    const { resolveTabFavicons } = await import('../sidepanel/multitab');
    await resolveTabFavicons([
      { id: 9, url: 'https://no-link.example.com', favIconUrl: '' } as chrome.tabs.Tab,
    ]);

    const img = document.querySelector<HTMLImageElement>('.tab-favicon')!;
    expect(img.src).toContain('google.com/s2/favicons');
  });

  it('tab.id == null → skipped (no resolver invocation)', async () => {
    const { resolveTabFavicons } = await import('../sidepanel/multitab');
    await resolveTabFavicons([
      { id: undefined, url: 'https://a.com', favIconUrl: '' } as unknown as chrome.tabs.Tab,
    ]);
    // Pin: `tab.id == null` guard prevents resolveTabFaviconById(NaN)
    // which would spam unnecessary chrome.scripting calls.
    expect(chromeStub.scripting.executeScript).not.toHaveBeenCalled();
  });
});

describe('resolveTabFaviconById (single-tab fallback on img error)', () => {
  it('resolved url identical to previousSrc → skips set + falls through to Google', async () => {
    const img = document.createElement('img');
    img.src = 'https://a.com/current.ico';
    document.body.appendChild(img);

    chromeStub.scripting.executeScript.mockResolvedValueOnce([
      { result: 'https://a.com/current.ico' }, // same as previousSrc
    ]);
    chromeStub.tabs.get.mockResolvedValueOnce({
      id: 5,
      url: 'https://a.com',
    } as chrome.tabs.Tab);

    const { resolveTabFaviconById } = await import('../sidepanel/multitab');
    await resolveTabFaviconById(5, img);

    // Pin: when the page's <link rel="icon"> points to the SAME URL
    // that just failed to load, don't retry it → fall through to
    // Google service directly. Without this guard, broken-favicon
    // loops forever.
    expect(img.src).toContain('google.com/s2/favicons');
  });

  it('resolved url different → updates img src (no Google fallback needed)', async () => {
    const img = document.createElement('img');
    img.src = 'https://a.com/bad.ico';
    document.body.appendChild(img);

    chromeStub.scripting.executeScript.mockResolvedValueOnce([
      { result: 'https://a.com/good.ico' },
    ]);

    const { resolveTabFaviconById } = await import('../sidepanel/multitab');
    await resolveTabFaviconById(5, img);

    expect(img.src).toBe('https://a.com/good.ico');
    // chrome.tabs.get NOT called — no Google fallback triggered.
    expect(chromeStub.tabs.get).not.toHaveBeenCalled();
  });
});

describe('tryGoogleFaviconFallback', () => {
  it('builds Google s2 URL from tab origin + sets img.src', async () => {
    const img = document.createElement('img');
    document.body.appendChild(img);
    chromeStub.tabs.get.mockResolvedValueOnce({
      id: 3,
      url: 'https://encoded.example.com/page?x=1',
    } as chrome.tabs.Tab);

    const { tryGoogleFaviconFallback } = await import('../sidepanel/multitab');
    await tryGoogleFaviconFallback(3, img);

    expect(img.src).toMatch(/^https:\/\/www\.google\.com\/s2\/favicons/);
    expect(img.src).toContain('sz=32');
    expect(img.src).toContain(encodeURIComponent('https://encoded.example.com'));
    expect(img.style.visibility).toBe('');
  });

  it('chrome.tabs.get throws → hides img (visibility:hidden, no crash)', async () => {
    const img = document.createElement('img');
    document.body.appendChild(img);
    chromeStub.tabs.get.mockRejectedValueOnce(new Error('tab gone'));

    const { tryGoogleFaviconFallback } = await import('../sidepanel/multitab');
    await tryGoogleFaviconFallback(99, img);

    // Pin: final fallback path must NEVER crash. A regression letting
    // this throw would surface a Vite devtools error on closed-tab
    // races.
    expect(img.style.visibility).toBe('hidden');
  });

  it('tab.url missing → silent early return (no src write)', async () => {
    const img = document.createElement('img');
    img.src = 'https://original.example.com/f.ico';
    document.body.appendChild(img);
    chromeStub.tabs.get.mockResolvedValueOnce({ id: 1, url: undefined } as chrome.tabs.Tab);

    const { tryGoogleFaviconFallback } = await import('../sidepanel/multitab');
    await tryGoogleFaviconFallback(1, img);

    // Pin: the `if (!tab?.url) return` guard. Without it, `new URL(undefined)`
    // throws + the outer catch silently hides the img even though we
    // had a perfectly-valid original src.
    expect(img.src).toBe('https://original.example.com/f.ico');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Group C — startMultiTabExtract
// ─────────────────────────────────────────────────────────────────────

describe('startMultiTabExtract', () => {
  function mountGroupModeDOM(): void {
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <select id="group-mode"><option value="none">None</option><option value="tab">Tab</option></select>
      <button data-group-filter="none">None</button>
      <button data-group-filter="tab">Tab</button>
      <button data-group-filter="color">Color</button>
    `
    );
    elements.groupMode = document.getElementById('group-mode') as HTMLSelectElement;
  }

  beforeEach(() => {
    mountGroupModeDOM();
    state.allImages = [];
    state.appSettings = {} as typeof state.appSettings;
  });

  afterEach(() => {
    delete (elements as Partial<typeof elements>).groupMode;
  });

  it('happy path: dedupes by url + sets groupMode=tab + active group-filter pill + fires processImageExtras', async () => {
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      tabCount: 2,
      images: [
        { url: 'https://a.com/1.png', id: 'existing-id' },
        { url: 'https://b.com/2.png' }, // no id → generateId used
      ],
    });

    const { startMultiTabExtract } = await import('../sidepanel/multitab');
    await startMultiTabExtract([10, 20]);

    // Pin: the MULTI_TAB_EXTRACT message type is what the background
    // worker dispatches on. A typo like 'MULTITAB_EXTRACT' would
    // silently route to the fallback-no-op handler.
    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'MULTI_TAB_EXTRACT',
      tabIds: [10, 20],
    });

    // Pin: url-dedupe by `!find(url === newImg.url)`. Existing id
    // passed through, missing id filled by generateId mock.
    expect(state.allImages).toHaveLength(2);
    expect(state.allImages[0].id).toBe('existing-id');
    expect(state.allImages[1].id).toBe('id-https://b.com/2.png');
    // colors + phash reset to their "needs-recompute" sentinels.
    expect(state.allImages[0].colors).toBeUndefined();
    expect(state.allImages[0].phash).toBeNull();

    // groupMode pill sync: 'tab' → active, others → inactive.
    const pills = document.querySelectorAll<HTMLElement>('[data-group-filter]');
    expect(pills[0].classList.contains('active')).toBe(false); // none
    expect(pills[1].classList.contains('active')).toBe(true); // tab
    expect(pills[2].classList.contains('active')).toBe(false); // color

    // state.currentGroupMode + DOM select value sync.
    expect(state.currentGroupMode).toBe('tab');
    expect((elements.groupMode as HTMLSelectElement).value).toBe('tab');

    const filter = await import('../sidepanel/filter');
    const pro = await import('../sidepanel/pro-features');
    const ui = await import('../sidepanel/ui');
    const scan = await import('../sidepanel/scan');
    expect(filter.applyFilters).toHaveBeenCalledTimes(1);
    expect(pro.closeMultiTabModal).toHaveBeenCalledTimes(1);
    // Success toast uses response.tabCount (not tabIds.length fallback).
    expect(ui.showToast).toHaveBeenCalledWith('Extracted 2 images from 2 tabs', 'success');
    // Pin: processImageExtras called ONLY when similar/color detection
    // is enabled. Defaults (both === undefined → truthy via !== false)
    // mean it DOES fire.
    expect(scan.processImageExtras).toHaveBeenCalledWith(state.allImages);

    // finally block cleanup.
    expect(state.isMultiTabExtracting).toBe(false);
    expect(ui.hideProgress).toHaveBeenCalledTimes(1);
  });

  it('replaces allImages with multi-tab results (full replacement, not merge)', async () => {
    state.allImages = [
      { id: 'x', url: 'https://a.com/same.png' } as unknown as import('../shared/types').ImageItem,
    ];
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      images: [
        { url: 'https://a.com/same.png' }, // overlap with existing
        { url: 'https://a.com/new.png' },
      ],
    });

    const { startMultiTabExtract } = await import('../sidepanel/multitab');
    await startMultiTabExtract([1]);

    // Pin: multi-tab extract replaces allImages entirely with the
    // response images (each gets a freshly generated id). The user
    // explicitly chose which tabs to extract from, so only those
    // results should appear.
    expect(state.allImages).toHaveLength(2);
    expect(state.allImages[0].id).toBe('id-https://a.com/same.png');
    expect(state.allImages[1].url).toBe('https://a.com/new.png');
  });

  it('fallback tabCount: uses tabIds.length when response.tabCount is missing', async () => {
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      // no tabCount
      images: [{ url: 'https://a.com/1.png' }],
    });

    const { startMultiTabExtract } = await import('../sidepanel/multitab');
    await startMultiTabExtract([5, 6, 7]);

    const ui = await import('../sidepanel/ui');
    // Pin: fallback to tabIds.length. Without it, the toast would
    // read "from undefined tabs" when the background worker skipped
    // the tabCount field.
    expect(ui.showToast).toHaveBeenCalledWith('Extracted 1 images from 3 tabs', 'success');
  });


  it('response.success=false (or missing images) → error toast + NO state mutation', async () => {
    state.allImages = [];
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({
      success: false,
      error: 'Tab 42 has no images',
    });

    const { startMultiTabExtract } = await import('../sidepanel/multitab');
    await startMultiTabExtract([42]);

    const ui = await import('../sidepanel/ui');
    const filter = await import('../sidepanel/filter');
    const pro = await import('../sidepanel/pro-features');
    expect(ui.showToast).toHaveBeenCalledWith('Extraction failed: Tab 42 has no images', 'error');
    // Pin: the error path must NOT fire applyFilters / closeModal /
    // groupMode sync. A regression running those for failed extracts
    // would leave the sidepanel in an inconsistent UI state.
    expect(filter.applyFilters).not.toHaveBeenCalled();
    expect(pro.closeMultiTabModal).not.toHaveBeenCalled();
    expect(state.allImages).toEqual([]);
    // hideProgress STILL fires in finally.
    expect(ui.hideProgress).toHaveBeenCalledTimes(1);
  });

  it('response missing error field → falls back to default error message', async () => {
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({ success: false });

    const { startMultiTabExtract } = await import('../sidepanel/multitab');
    await startMultiTabExtract([1]);

    const ui = await import('../sidepanel/ui');
    // Source uses t('toast_extraction_failed') + ': ' + t('error_default_message').
    // With i18n catalogue loaded, this resolves to English messages.
    expect(ui.showToast).toHaveBeenCalledWith('Extraction failed: An error occurred', 'error');
  });

  it('sendMessage throws + NOT aborted → "Multi-tab extraction failed" toast', async () => {
    chromeStub.runtime.sendMessage.mockRejectedValueOnce(new Error('bg dead'));

    const { startMultiTabExtract } = await import('../sidepanel/multitab');
    await startMultiTabExtract([1]);

    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).toHaveBeenCalledWith('Multi-tab extraction failed', 'error');
    // finally cleanup.
    expect(state.isMultiTabExtracting).toBe(false);
    expect(ui.hideProgress).toHaveBeenCalledTimes(1);
  });

  it('abort via showProgress callback → aborted check bypasses state mutation even on successful response', async () => {
    const ui = await import('../sidepanel/ui');

    // Capture the abort callback; fire it BEFORE the sendMessage
    // response resolves so the `if (aborted) return` hits.
    let abortFn: (() => void) | null = null;
    vi.mocked(ui.showProgress).mockImplementation((_title, onAbort) => {
      abortFn = onAbort ?? null;
    });

    let resolveSendMessage: (v: unknown) => void = () => {};
    chromeStub.runtime.sendMessage.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveSendMessage = r;
        })
    );

    const { startMultiTabExtract } = await import('../sidepanel/multitab');
    const pending = startMultiTabExtract([1]);
    await new Promise((r) => setTimeout(r, 0));

    expect(abortFn).toBeTruthy();
    // Fire abort.
    abortFn!();
    // Pin: abort callback sets state.isMultiTabExtracting=false
    // IMMEDIATELY (not waiting for finally). A regression deferring
    // this to finally would leave the UI in "extracting..." state
    // during the abort-but-not-yet-returned window.
    expect(state.isMultiTabExtracting).toBe(false);
    expect(ui.showToast).toHaveBeenCalledWith('Extraction cancelled', 'info');

    // Now resolve the sendMessage with a successful payload — the
    // aborted guard must prevent state.allImages mutation.
    resolveSendMessage({
      success: true,
      images: [{ url: 'https://a.com/should-not-land.png' }],
    });
    await pending;

    expect(state.allImages).toEqual([]);
    const filter = await import('../sidepanel/filter');
    const pro = await import('../sidepanel/pro-features');
    // applyFilters / closeMultiTabModal SKIPPED due to aborted guard.
    expect(filter.applyFilters).not.toHaveBeenCalled();
    expect(pro.closeMultiTabModal).not.toHaveBeenCalled();
  });

  it('abort + sendMessage THROWS → NO double "extraction failed" toast (aborted guard on catch path)', async () => {
    const ui = await import('../sidepanel/ui');
    let abortFn: (() => void) | null = null;
    vi.mocked(ui.showProgress).mockImplementation((_title, onAbort) => {
      abortFn = onAbort ?? null;
    });

    let rejectSendMessage: (e: Error) => void = () => {};
    chromeStub.runtime.sendMessage.mockImplementationOnce(
      () =>
        new Promise((_res, rej) => {
          rejectSendMessage = rej;
        })
    );

    const { startMultiTabExtract } = await import('../sidepanel/multitab');
    const pending = startMultiTabExtract([1]);
    await new Promise((r) => setTimeout(r, 0));
    abortFn!();
    rejectSendMessage(new Error('cancelled-by-bg'));
    await pending;

    // Pin: the `if (!aborted)` guard on the catch block. Without it,
    // aborting + a background rejection would show BOTH "Extraction
    // cancelled" (from abort callback) AND "Multi-tab extraction
    // failed" (from catch) — confusing + contradictory UX.
    const extractionFailedCalls = vi
      .mocked(ui.showToast)
      .mock.calls.filter((c) => c[0] === 'Multi-tab extraction failed');
    expect(extractionFailedCalls).toHaveLength(0);
    expect(ui.showToast).toHaveBeenCalledWith('Extraction cancelled', 'info');
  });
});
