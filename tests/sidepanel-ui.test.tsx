// Unit tests for sidepanel/ui.ts — focused on:
//   - calcSkeletonCount: pure responsive math (4 density × list/grid × popup)
//   - getMinCardWidth: hard-coded 250px contract (don't drift silently)
//   - showToast: 2-step setTimeout pipeline (fade @ 2500, remove @ 3000)
//   - showError / showEmpty / showRestricted / hideRestricted /
//     clearCurrentImages / resetStatusBar / hideAll: state-driven screens
//   - showProgress / hideProgress / updateProgress / handleProgressClose:
//     downloadProgress object replacement + abort-callback wiring
//   - showConfirmDialog: returns a Promise that resolves with confirmDialog
//
// Out of scope (DOM-heavy or observer wiring):
//   - checkNarrowMode (tested implicitly via calcSkeletonCount feeders)
//   - initResizeObserver (observer side effect)
//   - showLoading / hideLoading (orchestration of 5+ submodules)
//   - applyViewMode / toggleViewMode (DOM class swap orchestration)
//   - updateFilterButtonLabels (100-line filter UI label derivation)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sidepanel/actions', () => ({
  hideDownloadDropdown: vi.fn(),
}));
vi.mock('../sidepanel/scan', () => ({
  hideScanOverlay: vi.fn(),
  showScanOverlay: vi.fn(),
}));
vi.mock('../sidepanel/settings', () => ({
  closeAllFilterDropdowns: vi.fn(),
}));

import {
  applyViewMode,
  calcSkeletonCount,
  checkNarrowMode,
  clearCurrentImages,
  getMinCardWidth,
  handleProgressClose,
  hideAll,
  hideProgress,
  hideRestricted,
  resetStatusBar,
  showConfirmDialog,
  showEmpty,
  showError,
  showProgress,
  showRestricted,
  showToast,
  toggleViewMode,
  updateProgress,
} from '../sidepanel/ui';
import { state, store, elements } from '../sidepanel/state';

beforeEach(() => {
  store.reset();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

afterEach(() => {
  store.reset();
  document.body.innerHTML = '';
  // Drain showToast's pending setTimeouts so module-level state
  // (toastIdCounter is benign; toasts list is store-reset above).
  vi.useFakeTimers();
  vi.runAllTimers();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────
// getMinCardWidth — hard-coded contract (don't drift silently)
// ─────────────────────────────────────────────────────────────────────

describe('getMinCardWidth', () => {
  it('returns 250 (the documented two-column threshold for compact info-bar)', () => {
    // The 250 number encodes a layout invariant: compact tags (~126px) +
    // 4 actions (~91px) + padding/border (~25px) ≈ 242, rounded to 250
    // for safety. checkNarrowMode uses this to decide list-vs-grid.
    expect(getMinCardWidth()).toBe(250);
  });
});

// ─────────────────────────────────────────────────────────────────────
// calcSkeletonCount — responsive math
// ─────────────────────────────────────────────────────────────────────

describe('calcSkeletonCount — density × view × popup matrix', () => {
  function setDensity(cls: '' | 'density-compact' | 'density-comfortable' | 'popup-mode'): void {
    document.body.innerHTML = '<div id="app"></div>';
    const app = document.getElementById('app')!;
    if (cls) app.classList.add(cls);
  }

  // Card heights derived from the in-source comments:
  //   default  thumb=120 → card = 120+40+37+3 = 200
  //   compact  thumb=80  → card = 80+40+37+3  = 160
  //   comfort  thumb=180 → card = 180+40+37+3 = 260
  //   list     thumb=100 → card = 100+40+37+3 = 180
  //
  // Rows formula: max(1, ceil((containerH - 2*padding + gap) / (card + gap)))

  it('default density / grid view: 600px container fits 3 rows × 2 cols = 6', () => {
    setDensity('');
    // (600 - 2*10 + 10) / (200 + 10) = 590/210 ≈ 2.81 → ceil = 3 rows
    expect(calcSkeletonCount(600, false)).toBe(6);
  });

  it('default density / list view: 600px container = 4 rows × 1 col', () => {
    setDensity('');
    // list card=180; (600-20+10)/(180+10) = 590/190 ≈ 3.10 → 4 rows × 1
    expect(calcSkeletonCount(600, true)).toBe(4);
  });

  it('compact density / grid view: smaller card → more rows', () => {
    setDensity('density-compact');
    // gap=6, padding=6, card=160; (600-12+6)/(160+6) = 594/166 ≈ 3.58 → 4 rows × 2
    expect(calcSkeletonCount(600, false)).toBe(8);
  });

  it('compact density / list view: 600px = 4 rows × 1 col', () => {
    setDensity('density-compact');
    // gap=6, padding=6, card=180; (600-12+6)/(180+6) = 594/186 ≈ 3.19 → 4 rows × 1
    expect(calcSkeletonCount(600, true)).toBe(4);
  });

  it('comfortable density / grid view: bigger card → fewer rows', () => {
    setDensity('density-comfortable');
    // gap=14, padding=14, card=260; (600-28+14)/(260+14) = 586/274 ≈ 2.14 → 3 rows × 2
    expect(calcSkeletonCount(600, false)).toBe(6);
  });

  it('comfortable density / list view: 600px = 4 rows × 1', () => {
    setDensity('density-comfortable');
    // gap=14, padding=14, card=180 (list always 100+40+37+3); (600-28+14)/(180+14) = 586/194 ≈ 3.02 → 4 rows × 1
    expect(calcSkeletonCount(600, true)).toBe(4);
  });

  it('popup-mode + grid: same per-density thumb heights (matches density bucket)', () => {
    setDensity('popup-mode');
    // No density class → default thumb=120 → card=200
    // (600-20+10)/(200+10) ≈ 2.81 → 3 rows × 2 cols = 6
    expect(calcSkeletonCount(600, false)).toBe(6);
  });

  it('clamps to a MINIMUM of 1 row even when the container is tiny', () => {
    setDensity('');
    // 1 row × 2 cols = 2 minimum (Math.max(1, ...) on rows, then * cols)
    expect(calcSkeletonCount(10, false)).toBe(2);
  });

  it('clamps to a minimum of 1 in list view (1 row × 1 col = 1)', () => {
    setDensity('');
    expect(calcSkeletonCount(10, true)).toBe(1);
  });

  it('handles missing #app element (no density class read) — falls through to defaults', () => {
    // No #app in DOM at all → all isCompact/isComfortable/isPopup = false
    document.body.innerHTML = '';
    // default math: 6 for grid view at 600px
    expect(calcSkeletonCount(600, false)).toBe(6);
  });

  it('large container scales linearly: 1200px / grid / default = 6 rows × 2 cols', () => {
    setDensity('');
    // (1200-20+10)/(200+10) = 1190/210 ≈ 5.67 → 6 rows × 2 cols = 12
    expect(calcSkeletonCount(1200, false)).toBe(12);
  });
});

// ─────────────────────────────────────────────────────────────────────
// showToast — 2-step setTimeout pipeline
// ─────────────────────────────────────────────────────────────────────

describe('showToast', () => {
  it('replaces state.toasts with a single new toast (only-one-visible policy)', () => {
    state.toasts = [{ id: 99, message: 'old', type: 'info', fadingOut: false }];
    showToast('new', 'success');
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].message).toBe('new');
    expect(state.toasts[0].type).toBe('success');
    expect(state.toasts[0].fadingOut).toBe(false);
    expect(state.toasts[0].id).not.toBe(99); // new id
  });

  it('defaults type to "info" when omitted', () => {
    showToast('hello');
    expect(state.toasts[0].type).toBe('info');
  });

  it('marks fadingOut=true at 2500ms (the toast is still visible until 3000)', () => {
    vi.useFakeTimers();
    showToast('msg', 'info');
    const id = state.toasts[0].id;

    vi.advanceTimersByTime(2499);
    expect(state.toasts[0].fadingOut).toBe(false);

    vi.advanceTimersByTime(1);
    expect(state.toasts.find((t) => t.id === id)?.fadingOut).toBe(true);
  });

  it('removes the toast at 3000ms', () => {
    vi.useFakeTimers();
    showToast('msg', 'info');
    const id = state.toasts[0].id;

    vi.advanceTimersByTime(2999);
    expect(state.toasts.find((t) => t.id === id)).toBeDefined();

    vi.advanceTimersByTime(1);
    expect(state.toasts.find((t) => t.id === id)).toBeUndefined();
  });

  it('a NEWER toast that replaces an older one cancels the older fade-out (id mismatch guard)', () => {
    vi.useFakeTimers();
    showToast('first', 'info');
    const firstId = state.toasts[0].id;

    vi.advanceTimersByTime(1000);
    showToast('second', 'success'); // replaces first
    const secondId = state.toasts[0].id;
    expect(secondId).not.toBe(firstId);

    // At the original first toast's 2500ms mark (= +2500 from start =
    // +1500 from now), the fade-out callback for `firstId` fires but
    // finds the toasts list contains only `secondId` and silently
    // bails — pin that the second toast is NOT marked fadingOut.
    vi.advanceTimersByTime(1500);
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].id).toBe(secondId);
    expect(state.toasts[0].fadingOut).toBe(false);
  });

  it('each call uses a strictly increasing id (keyed reconciliation re-runs animation)', () => {
    showToast('a');
    const a = state.toasts[0].id;
    showToast('b');
    const b = state.toasts[0].id;
    showToast('c');
    const c = state.toasts[0].id;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

// ─────────────────────────────────────────────────────────────────────
// State display screens
// ─────────────────────────────────────────────────────────────────────

describe('showError / showEmpty / showRestricted', () => {
  it('showError sets uiScreen="error" and populates errorInfo', () => {
    showError('CSP_BLOCKED', 'Blocked by CSP', 'Try refreshing');
    expect(state.uiScreen).toBe('error');
    expect(state.errorInfo).toEqual({
      code: 'CSP_BLOCKED',
      message: 'Blocked by CSP',
      workaround: 'Try refreshing',
    });
  });

  it('showError applies sane fallbacks for empty code / message', () => {
    showError('', '');
    expect(state.errorInfo!.code).toBe('Error');
    expect(state.errorInfo!.message).toBe('An error occurred');
  });

  it('showEmpty sets uiScreen="empty" and emptyInfo.isNoResults=false by default', () => {
    showEmpty();
    expect(state.uiScreen).toBe('empty');
    expect(state.emptyInfo.isNoResults).toBe(false);
  });

  it('showEmpty(true) marks isNoResults=true (filter returned empty vs. truly no images)', () => {
    showEmpty(true);
    expect(state.emptyInfo.isNoResults).toBe(true);
  });

  it('showEmpty hides the .image-grid-wrapper so empty-state can center-fill', () => {
    document.body.innerHTML = '<div class="image-grid-wrapper"></div>';
    showEmpty();
    expect(document.querySelector('.image-grid-wrapper')?.classList.contains('hidden')).toBe(true);
  });

  it('showRestricted sets uiScreen="restricted" + invalidates render cache + hides chrome', async () => {
    document.body.innerHTML = `
      <div class="toolbar"></div>
      <div class="status-bar"></div>
      <div class="image-grid-wrapper"></div>
    `;
    state.lastRenderedFilteredIds = 'stale-cache-key';

    showRestricted();

    expect(state.uiScreen).toBe('restricted');
    // Cache invalidation is critical: without it a subsequent
    // applyFilters() after hideRestricted() sees matching IDs and
    // skips renderImages().
    expect(state.lastRenderedFilteredIds).toBeNull();

    // Calls down-stream cleanup (mocked).
    const settingsMod = await import('../sidepanel/settings');
    const actMod = await import('../sidepanel/actions');
    const scanMod = await import('../sidepanel/scan');
    expect(settingsMod.closeAllFilterDropdowns).toHaveBeenCalledTimes(1);
    expect(actMod.hideDownloadDropdown).toHaveBeenCalledTimes(1);
    expect(scanMod.hideScanOverlay).toHaveBeenCalledTimes(1);

    // Chrome elements hidden.
    expect(document.querySelector('.toolbar')?.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('.status-bar')?.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('.image-grid-wrapper')?.classList.contains('hidden')).toBe(true);
  });
});

describe('hideRestricted', () => {
  it('flips uiScreen back to "images" and unhides chrome', async () => {
    document.body.innerHTML = `
      <div class="toolbar hidden"></div>
      <div class="status-bar hidden"></div>
      <div class="image-grid-wrapper hidden"></div>
    `;
    state.uiScreen = 'restricted';

    hideRestricted();

    expect(state.uiScreen).toBe('images');
    const scanMod = await import('../sidepanel/scan');
    expect(scanMod.hideScanOverlay).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.toolbar')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('.status-bar')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('.image-grid-wrapper')?.classList.contains('hidden')).toBe(false);
  });

  it('does NOT change uiScreen when not currently "restricted" (idempotent guard)', () => {
    state.uiScreen = 'images';
    hideRestricted();
    expect(state.uiScreen).toBe('images');

    state.uiScreen = 'empty';
    hideRestricted();
    expect(state.uiScreen).toBe('empty');
  });
});

describe('clearCurrentImages / resetStatusBar / hideAll', () => {
  it('clearCurrentImages empties allImages, filteredImages, selectedImages, render cache', () => {
    state.allImages = [{ id: 'a' } as never, { id: 'b' } as never];
    state.filteredImages = [{ id: 'a' } as never];
    state.selectedImages = new Set(['a', 'b']);
    state.lastRenderedFilteredIds = 'cache-key-a';

    clearCurrentImages();

    expect(state.allImages).toEqual([]);
    expect(state.filteredImages).toEqual([]);
    expect(state.selectedImages.size).toBe(0);
    expect(state.lastRenderedFilteredIds).toBeNull();
  });

  it('clearCurrentImages clears imageGrid.innerHTML when ref cached', () => {
    const grid = document.createElement('div');
    grid.innerHTML = '<div class="image-card"></div>';
    document.body.appendChild(grid);
    elements.imageGrid = grid;

    clearCurrentImages();
    expect(grid.innerHTML).toBe('');
  });

  it('resetStatusBar zeros foundCount text + clears similarGroups + hides dedup widgets', () => {
    const foundCount = document.createElement('span');
    foundCount.textContent = '42';
    document.body.appendChild(foundCount);
    elements.foundCount = foundCount;

    const btnDedup = document.createElement('button');
    btnDedup.style.display = 'inline-flex';
    document.body.appendChild(btnDedup);
    elements.btnDedup = btnDedup;

    const dedupInfo = document.createElement('div');
    dedupInfo.id = 'dedup-info';
    document.body.appendChild(dedupInfo);

    state.similarGroups = [{ id: 'g1' } as never];

    resetStatusBar();

    expect(foundCount.textContent).toBe('0');
    expect(state.similarGroups).toEqual([]);
    expect(btnDedup.style.display).toBe('none');
    expect(dedupInfo.classList.contains('hidden')).toBe(true);
  });

  it('hideAll hides imageGrid + loadingState and resets uiScreen to "images"', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    elements.imageGrid = grid;

    const loading = document.createElement('div');
    document.body.appendChild(loading);
    elements.loadingState = loading;

    state.uiScreen = 'restricted';

    hideAll();

    expect(grid.classList.contains('hidden')).toBe(true);
    expect(loading.classList.contains('hidden')).toBe(true);
    expect(state.uiScreen).toBe('images');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Progress modal
// ─────────────────────────────────────────────────────────────────────

describe('showProgress / updateProgress / hideProgress / handleProgressClose', () => {
  it('showProgress flips visible:true + sets title + stores abort callback', () => {
    const onAbort = vi.fn();
    showProgress('Downloading 5 images', onAbort);

    expect(state.downloadProgress.visible).toBe(true);
    expect(state.downloadProgress.title).toBe('Downloading 5 images');
  });

  it('showProgress applies "Downloading..." default when title omitted/empty', () => {
    showProgress('');
    expect(state.downloadProgress.title).toBe('Downloading...');
  });

  it('updateProgress patches current/total/currentFile/imageCount without touching visible', () => {
    state.downloadProgress = { ...state.downloadProgress, visible: true };
    updateProgress(3, 10, 'photo.jpg', 7);
    expect(state.downloadProgress.current).toBe(3);
    expect(state.downloadProgress.total).toBe(10);
    expect(state.downloadProgress.currentFile).toBe('photo.jpg');
    expect(state.downloadProgress.imageCount).toBe(7);
    expect(state.downloadProgress.visible).toBe(true);
  });

  it('updateProgress defaults missing currentFile to "" and imageCount to null', () => {
    updateProgress(1, 1);
    expect(state.downloadProgress.currentFile).toBe('');
    expect(state.downloadProgress.imageCount).toBeNull();
  });

  it('hideProgress flips visible:false (preserves other fields for UX continuity)', () => {
    state.downloadProgress = {
      ...state.downloadProgress,
      visible: true,
      current: 5,
      total: 10,
    };
    hideProgress();
    expect(state.downloadProgress.visible).toBe(false);
    // current/total intentionally not cleared — overlay is hidden anyway.
    expect(state.downloadProgress.current).toBe(5);
  });

  it('handleProgressClose invokes the stored abort callback then hides', () => {
    const onAbort = vi.fn();
    showProgress('test', onAbort);
    handleProgressClose();

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(state.downloadProgress.visible).toBe(false);
  });

  it('handleProgressClose with NO abort callback just hides (no crash)', () => {
    showProgress('test'); // no onAbort
    expect(() => handleProgressClose()).not.toThrow();
    expect(state.downloadProgress.visible).toBe(false);
  });

  it('hideProgress clears the abort callback so subsequent close is no-op', () => {
    const onAbort = vi.fn();
    showProgress('test', onAbort);
    hideProgress(); // clears progressAbortCallback
    handleProgressClose(); // should NOT call onAbort again

    expect(onAbort).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// View mode toggle — grid ↔ list class swap orchestration
// ─────────────────────────────────────────────────────────────────────

describe('applyViewMode / toggleViewMode', () => {
  function mountViewModeDOM(): {
    grid: HTMLDivElement;
    groupA: HTMLDivElement;
    groupB: HTMLDivElement;
    btnToggle: HTMLButtonElement;
    iconGrid: HTMLElement;
    iconList: HTMLElement;
    label: HTMLElement;
  } {
    document.body.innerHTML = `
      <div id="image-grid"></div>
      <div class="group-content"></div>
      <div class="group-content"></div>
      <button id="btn-view-toggle"></button>
      <div id="icon-grid"></div>
      <div id="icon-list"></div>
      <span id="view-toggle-label"></span>
    `;
    const grid = document.getElementById('image-grid') as HTMLDivElement;
    const groups = document.querySelectorAll<HTMLDivElement>('.group-content');
    const btnToggle = document.getElementById('btn-view-toggle') as HTMLButtonElement;
    elements.imageGrid = grid;
    elements.btnViewToggle = btnToggle;
    return {
      grid,
      groupA: groups[0],
      groupB: groups[1],
      btnToggle,
      iconGrid: document.getElementById('icon-grid')!,
      iconList: document.getElementById('icon-list')!,
      label: document.getElementById('view-toggle-label')!,
    };
  }

  afterEach(() => {
    delete (elements as Partial<typeof elements>).imageGrid;
    delete (elements as Partial<typeof elements>).btnViewToggle;
  });

  it('applyViewMode("list") writes state.currentViewMode + flips list-view class on grid + every .group-content', () => {
    const { grid, groupA, groupB } = mountViewModeDOM();
    applyViewMode('list');
    expect(state.currentViewMode).toBe('list');
    expect(grid.classList.contains('list-view')).toBe(true);
    // Pin: per-group re-sync. Group-collapsed grids are separate DOM
    // subtrees and would render as grid-view (wrong width) if the
    // class swap only hit the top-level #image-grid.
    expect(groupA.classList.contains('list-view')).toBe(true);
    expect(groupB.classList.contains('list-view')).toBe(true);
  });

  it('applyViewMode("grid") removes list-view class from every list-view bucket', () => {
    const { grid, groupA } = mountViewModeDOM();
    grid.classList.add('list-view');
    groupA.classList.add('list-view');
    applyViewMode('grid');
    expect(grid.classList.contains('list-view')).toBe(false);
    expect(groupA.classList.contains('list-view')).toBe(false);
  });

  it('applyViewMode swaps the btn-view-toggle title + icon visibility + label text', () => {
    const { btnToggle, iconGrid, iconList, label } = mountViewModeDOM();
    applyViewMode('list');
    expect(btnToggle.title).toBe('Switch to grid view');
    // In list mode, show the grid icon (as the "switch-to" affordance).
    expect(iconGrid.classList.contains('hidden')).toBe(false);
    expect(iconList.classList.contains('hidden')).toBe(true);
    expect(label.textContent).toBe('Grid');

    applyViewMode('grid');
    expect(btnToggle.title).toBe('Switch to list view');
    expect(iconGrid.classList.contains('hidden')).toBe(true);
    expect(iconList.classList.contains('hidden')).toBe(false);
    expect(label.textContent).toBe('List');
  });

  it('applyViewMode is a no-op on absent grid/toggle/icons/label (defensive null-checks)', () => {
    document.body.innerHTML = '';
    // Pin: every pluggable DOM lookup must short-circuit on missing
    // element. This is the "popup mode before DOMContentLoaded" guard.
    expect(() => applyViewMode('list')).not.toThrow();
    expect(state.currentViewMode).toBe('list');
  });

  it('toggleViewMode flips list ↔ grid round-trip and propagates via applyViewMode', () => {
    mountViewModeDOM();
    // Internal userViewMode starts as 'list' (module-private); first call flips to 'grid'.
    toggleViewMode();
    expect(state.currentViewMode).toBe('grid');
    toggleViewMode();
    expect(state.currentViewMode).toBe('list');
  });
});

// ─────────────────────────────────────────────────────────────────────
// checkNarrowMode — reactive compact/list-mode toggle
// ─────────────────────────────────────────────────────────────────────

describe('checkNarrowMode', () => {
  function mountNarrowDOM(clientWidth: number): {
    grid: HTMLDivElement;
    app: HTMLDivElement;
    btnToggle: HTMLButtonElement;
    toolbarRight: HTMLDivElement;
  } {
    document.body.innerHTML = `
      <div id="app">
        <div class="toolbar">
          <div class="toolbar-right">
            <button id="btn-view-toggle"></button>
          </div>
        </div>
        <div id="image-grid"></div>
      </div>
    `;
    const grid = document.getElementById('image-grid') as HTMLDivElement;
    Object.defineProperty(grid, 'clientWidth', {
      configurable: true,
      value: clientWidth,
    });
    elements.imageGrid = grid;
    elements.btnViewToggle = document.getElementById('btn-view-toggle') as HTMLButtonElement;
    return {
      grid,
      app: document.getElementById('app') as HTMLDivElement,
      btnToggle: elements.btnViewToggle as HTMLButtonElement,
      toolbarRight: document.querySelector('.toolbar-right') as HTMLDivElement,
    };
  }

  afterEach(() => {
    delete (elements as Partial<typeof elements>).imageGrid;
    delete (elements as Partial<typeof elements>).btnViewToggle;
  });

  it('early-returns when elements.imageGrid is null (no crash on pre-bootstrap call)', () => {
    document.body.innerHTML = '';
    delete (elements as Partial<typeof elements>).imageGrid;
    expect(() => checkNarrowMode()).not.toThrow();
  });

  it('wide viewport (≥ 2×250 + gap = 520px available) keeps compact-mode OFF + toggle visible', () => {
    // 700px - 20px padding = 680px available; 680 >= 500 + 10 gap → canFitTwoColumns.
    // (680 - 10) / 2 = 335 >= 310 compactThreshold → isCompact = false.
    const { app, btnToggle, toolbarRight } = mountNarrowDOM(700);
    checkNarrowMode();
    expect(app.classList.contains('compact-mode')).toBe(false);
    expect(btnToggle.style.display).toBe('');
    expect(toolbarRight.style.display).toBe('');
  });

  it('narrow viewport (< 520px available) flips compact-mode ON + hides view toggle + forces list view', () => {
    // 400px - 20px = 380 available; 380 < 500+10 → cannot fit 2 cols → isCompact = true.
    const { app, btnToggle, toolbarRight, grid } = mountNarrowDOM(400);
    checkNarrowMode();
    expect(app.classList.contains('compact-mode')).toBe(true);
    // Pin: view-toggle button AND its containing .toolbar-right both
    // hidden. Leaving toolbar-right visible would leave an empty gap
    // that throws off the toolbar-left flex layout.
    expect(btnToggle.style.display).toBe('none');
    expect(toolbarRight.style.display).toBe('none');
    // Auto-switches to list view via applyViewMode('list').
    expect(state.currentViewMode).toBe('list');
    expect(grid.classList.contains('list-view')).toBe(true);
  });

  it('medium viewport (can fit 2 cols but each < 310px) flips compact-mode ON while keeping toggle visible', () => {
    // 600px - 20px = 580 >= 510 → canFitTwoColumns = true.
    // (580 - 10) / 2 = 285 < 310 → isCompact = true.
    const { app, btnToggle } = mountNarrowDOM(600);
    checkNarrowMode();
    expect(app.classList.contains('compact-mode')).toBe(true);
    // canFitTwoColumns is still true, so toggle stays visible.
    expect(btnToggle.style.display).toBe('');
  });

  it('isNarrowMode state machine: widening back from narrow restores user view mode (not forced-list)', () => {
    // First narrow → forces list (sets isNarrowMode = true).
    mountNarrowDOM(400);
    checkNarrowMode();
    expect(state.currentViewMode).toBe('list');

    // Now widen: mount a fresh DOM with wide client width.
    const { grid } = mountNarrowDOM(700);
    checkNarrowMode();
    // Pin: after widening, the module's internal userViewMode
    // ('list' at bootstrap) is restored. Without this state machine,
    // the user would be stuck in whatever mode they were forced into.
    expect(state.currentViewMode).toBe('list');
    expect(grid.classList.contains('list-view')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// showConfirmDialog — promise-returning modal open/close contract
// ─────────────────────────────────────────────────────────────────────

describe('showConfirmDialog', () => {
  it('flips confirmDialog.open=true and stores the config + resolver (not yet resolved)', async () => {
    const promise = showConfirmDialog({
      title: 'Delete all?',
      message: 'This cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Keep',
      type: 'danger',
    });
    expect(state.confirmDialog.open).toBe(true);
    expect(state.confirmDialog.config).toEqual({
      title: 'Delete all?',
      message: 'This cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Keep',
      type: 'danger',
    });
    expect(typeof state.confirmDialog.resolve).toBe('function');
    // Pin: the returned Promise is NOT pre-resolved. A regression
    // resolving synchronously inside the constructor would cause the
    // caller's `.then` to fire before the modal even rendered.
    // Manually resolve so afterEach doesn't leave dangling promises.
    state.confirmDialog.resolve!(true);
    await expect(promise).resolves.toBe(true);
  });

  it('applies default confirmText="Confirm" + cancelText="Cancel" + type="warning" when omitted', async () => {
    const promise = showConfirmDialog({ title: 't', message: 'm' });
    expect(state.confirmDialog.config).toEqual({
      title: 't',
      message: 'm',
      confirmText: 'Confirm',
      cancelText: 'Cancel',
      type: 'warning',
    });
    state.confirmDialog.resolve!(false);
    await expect(promise).resolves.toBe(false);
  });

  it('resolves an already-open prior dialog with false when a new one opens (stack-of-one policy)', async () => {
    // Pin: only one confirm dialog visible at a time. Calling code
    // for rapid back-to-back actions (e.g. bulk-delete follow-up)
    // must not leave a stale pending promise that could resolve with
    // the wrong value later.
    const first = showConfirmDialog({ title: 'first', message: 'm1' });
    const second = showConfirmDialog({ title: 'second', message: 'm2' });
    await expect(first).resolves.toBe(false);
    expect(state.confirmDialog.config?.title).toBe('second');
    state.confirmDialog.resolve!(true);
    await expect(second).resolves.toBe(true);
  });

  it('resolver writes through to the awaited Promise (smoke test the happy path)', async () => {
    const promise = showConfirmDialog({ title: 't', message: 'm' });
    state.confirmDialog.resolve!(true);
    await expect(promise).resolves.toBe(true);
  });
});
