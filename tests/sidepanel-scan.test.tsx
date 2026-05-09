// Unit tests for the scan state machine in sidepanel/scan.ts.
//
// Scope:
//   - showScanOverlay / hideScanOverlay: scanProgress field updates
//     + .scanning-disabled CSS class toggling on .toolbar / .status-bar
//   - updateScanProgress: the indeterminate flag transition (total===0
//     PRESERVES the current indeterminate value, total>0 forces it to
//     false). This is the crux of the loading→determinate handoff —
//     a refactor that eagerly clears indeterminate would silently
//     turn the first "still discovering" frame into a 0% bar.
//   - handleScanCancel: aborted flag + two branches (some images
//     already discovered → applyFilters; none → showEmpty)
//
// Out of scope (lazy-load / chrome.tabs heavy paths):
//   - silentRescan / rescanWithProgress / fetchImages / fetchImageDataUrl /
//     processImageExtras / patchCardExtras
//   These exercise chrome.runtime.sendMessage long chains and live
//   under e2e coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock every transitive import that pulls in DOM/chrome side effects.
// The state-machine functions themselves only touch state.scanProgress
// and document.querySelectorAll('.toolbar, .status-bar') — the rest of
// the imports are dead weight for our test.
vi.mock('virtua', () => ({ Virtualizer: vi.fn() }));
vi.mock('../sidepanel/ui', () => ({
  hideLoading: vi.fn(),
  showEmpty: vi.fn(),
  showError: vi.fn(),
  showLoading: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock('../sidepanel/filter', () => ({
  applyFilters: vi.fn(),
  renderColorSwatches: vi.fn(),
}));
vi.mock('../sidepanel/pro-features', () => ({
  detectSimilarImages: vi.fn(),
  renderColorBar: vi.fn(),
}));
vi.mock('../sidepanel/actions', () => ({
  updateSelectionUI: vi.fn(),
}));
vi.mock('../shared/storage', async () => {
  // Forward only the symbols pro-features.ts / state.ts won't pull in.
  // saveTabImageCache is the one scan.ts imports — stub it to a no-op.
  return {
    saveTabImageCache: vi.fn(),
    // The real module exports many other helpers; the imports we don't
    // touch don't matter because vi.mock factory replaces the whole module.
    getAppSettings: vi.fn().mockResolvedValue({}),
  };
});

import {
  showScanOverlay,
  hideScanOverlay,
  updateScanProgress,
  handleScanCancel,
} from '../sidepanel/scan';
import { state, store } from '../sidepanel/state';

beforeEach(() => {
  store.reset();
  document.body.innerHTML = `
    <div class="toolbar"></div>
    <div class="status-bar"></div>
  `;
});

afterEach(() => {
  store.reset();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// showScanOverlay
// ─────────────────────────────────────────────────────────────────────

describe('showScanOverlay', () => {
  it('flips visible:true and sets current/total on scanProgress', () => {
    showScanOverlay(3, 10);

    expect(state.scanProgress.visible).toBe(true);
    expect(state.scanProgress.current).toBe(3);
    expect(state.scanProgress.total).toBe(10);
  });

  it('preserves pre-existing scanProgress fields (e.g. title/indeterminate set by caller)', () => {
    // showLoading / rescanWithProgress set title + indeterminate BEFORE
    // calling showScanOverlay. The merge contract must preserve them.
    state.scanProgress = {
      ...state.scanProgress,
      title: 'Scanning current page…',
      indeterminate: true,
    };

    showScanOverlay(0, 0);

    expect(state.scanProgress.title).toBe('Scanning current page…');
    expect(state.scanProgress.indeterminate).toBe(true);
    expect(state.scanProgress.visible).toBe(true);
  });

  it('adds .scanning-disabled to .toolbar and .status-bar', () => {
    showScanOverlay(0, 0);

    const toolbar = document.querySelector('.toolbar');
    const statusBar = document.querySelector('.status-bar');
    expect(toolbar?.classList.contains('scanning-disabled')).toBe(true);
    expect(statusBar?.classList.contains('scanning-disabled')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// hideScanOverlay
// ─────────────────────────────────────────────────────────────────────

describe('hideScanOverlay', () => {
  it('flips visible:false AND clears indeterminate + currentUrl (next-scan reset contract)', () => {
    state.scanProgress = {
      ...state.scanProgress,
      visible: true,
      indeterminate: true,
      currentUrl: 'https://x.com/last.jpg',
      current: 5,
      total: 10,
    };

    hideScanOverlay();

    expect(state.scanProgress.visible).toBe(false);
    expect(state.scanProgress.indeterminate).toBe(false);
    expect(state.scanProgress.currentUrl).toBe('');
  });

  it('does NOT clear current/total/title (they may still be inspected by inspectors)', () => {
    state.scanProgress = {
      ...state.scanProgress,
      current: 7,
      total: 12,
      title: 'Done',
    };

    hideScanOverlay();

    // Intentional: only visible/indeterminate/currentUrl reset; current/
    // total/title are stale-but-harmless because visible:false hides
    // the overlay component anyway.
    expect(state.scanProgress.current).toBe(7);
    expect(state.scanProgress.total).toBe(12);
    expect(state.scanProgress.title).toBe('Done');
  });

  it('removes .scanning-disabled from .toolbar and .status-bar', () => {
    document.querySelector('.toolbar')?.classList.add('scanning-disabled');
    document.querySelector('.status-bar')?.classList.add('scanning-disabled');

    hideScanOverlay();

    expect(document.querySelector('.toolbar')?.classList.contains('scanning-disabled')).toBe(false);
    expect(document.querySelector('.status-bar')?.classList.contains('scanning-disabled')).toBe(
      false
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// updateScanProgress — indeterminate transition contract
// ─────────────────────────────────────────────────────────────────────

describe('updateScanProgress — indeterminate handoff', () => {
  it('forces indeterminate:false when a real total (>0) arrives', () => {
    state.scanProgress = { ...state.scanProgress, indeterminate: true };

    updateScanProgress(2, 5, 'https://x.com/a.jpg');

    expect(state.scanProgress.indeterminate).toBe(false);
    expect(state.scanProgress.current).toBe(2);
    expect(state.scanProgress.total).toBe(5);
    expect(state.scanProgress.currentUrl).toBe('https://x.com/a.jpg');
  });

  it('PRESERVES the existing indeterminate value when total === 0 (loading mode)', () => {
    // The crux of the contract: while we're still discovering and
    // don't yet know the total, every progress tick comes in with
    // total=0 and MUST NOT flip indeterminate off — otherwise the
    // bar would briefly render at 0% before snapping to determinate
    // mode.
    state.scanProgress = { ...state.scanProgress, indeterminate: true };

    updateScanProgress(1, 0, 'https://x.com/a.jpg');

    expect(state.scanProgress.indeterminate).toBe(true);
    expect(state.scanProgress.current).toBe(1);
    expect(state.scanProgress.total).toBe(0);
  });

  it('also preserves indeterminate:false when total === 0 (post-determinate ticks)', () => {
    // Symmetric to the above: once determinate, a zero-total tick
    // shouldn't accidentally flip back into indeterminate.
    state.scanProgress = { ...state.scanProgress, indeterminate: false };

    updateScanProgress(1, 0);

    expect(state.scanProgress.indeterminate).toBe(false);
  });

  it('defaults currentUrl to "" when caller omits the third arg', () => {
    updateScanProgress(3, 10);
    expect(state.scanProgress.currentUrl).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────
// handleScanCancel — abort + branch on discovered images
// ─────────────────────────────────────────────────────────────────────

describe('handleScanCancel', () => {
  it('sets scanAborted, clears isScanning + isFetching, hides overlay', async () => {
    state.scanAborted = false;
    state.isScanning = true;
    state.isFetching = true;
    state.scanProgress = { ...state.scanProgress, visible: true };

    handleScanCancel();

    expect(state.scanAborted).toBe(true);
    expect(state.isScanning).toBe(false);
    expect(state.isFetching).toBe(false);
    // hideScanOverlay was invoked → visible:false
    expect(state.scanProgress.visible).toBe(false);

    const ui = await import('../sidepanel/ui');
    expect(ui.hideLoading).toHaveBeenCalledTimes(1);
  });

  it('with discovered images → calls applyFilters + emits "N images found" toast (no showEmpty)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state.allImages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as any;
    // applyFilters is mocked (no-op), so pre-set filteredImages to match
    // the count the toast should display. The real applyFilters would
    // populate this from allImages; here we simulate that outcome.
    state.filteredImages = [...state.allImages];

    handleScanCancel();

    const filterMod = await import('../sidepanel/filter');
    const ui = await import('../sidepanel/ui');
    expect(filterMod.applyFilters).toHaveBeenCalledTimes(1);
    expect(ui.showEmpty).not.toHaveBeenCalled();
    // Prefix comes from i18n key 'toast.download.cancelled' → "Download cancelled";
    // the " · N images found" suffix is appended in scan.ts L33-40 without translation.
    expect(ui.showToast).toHaveBeenCalledWith('Download cancelled · Found 3 images', 'info');
  });

  it('without discovered images → calls showEmpty + emits bare "Scan cancelled" toast (no applyFilters)', async () => {
    state.allImages = [];

    handleScanCancel();

    const filterMod = await import('../sidepanel/filter');
    const ui = await import('../sidepanel/ui');
    expect(ui.showEmpty).toHaveBeenCalledTimes(1);
    expect(filterMod.applyFilters).not.toHaveBeenCalled();
    // Same i18n key as the populated-branch test above — English resolves to
    // "Download cancelled" without the count suffix.
    expect(ui.showToast).toHaveBeenCalledWith('Download cancelled', 'info');
  });
});
