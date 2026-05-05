// Unit tests for sidepanel/message.ts — the sidepanel half of the
// background↔sidepanel message bus, plus the global keyboard handler.
//
// Pinned contracts:
//   - showDiscoveredToastDebounced
//     * accumulates count across rapid calls
//     * 1500 ms debounce window resets on each call
//     * fires exactly one toast with the accumulated count, then resets
//   - handleMessage — IMAGES_DISCOVERED 4-guard chain
//     * fromTabId mismatch        → drop
//     * isTabSwitching            → drop
//     * isSilentScanning / fetch-only / multi-tab extracting → drop
//     * isScanning + images       → buffer + scanProgress.title update
//     * else (live monitor)       → applyFilters + debounced toast
//   - handleMessage — DOWNLOAD / LICENSE / MULTI_TAB_EXTRACT branches
//   - handleKeyDown
//     * ESC modal-close priority chain (settings → dedup → collection
//       → multitab → dropdowns → clearSelection)
//     * INPUT/TEXTAREA/SELECT bubble-out (no shortcut hijack while typing)
//     * Ctrl/Cmd+A → selectAll, Enter (with selection) → ZIP

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_TYPES } from '../shared/constants';

// Mock heavy neighbors so importing message.ts doesn't drag the whole
// UI/render/IPC graph into the test.
vi.mock('../sidepanel/actions', () => ({
  clearSelection: vi.fn(),
  downloadSelectedAsZip: vi.fn(),
  hideDownloadDropdown: vi.fn(),
  selectAll: vi.fn(),
}));
vi.mock('../sidepanel/filter', () => ({
  applyFilters: vi.fn(),
}));
vi.mock('../sidepanel/scan', () => ({
  processImageExtras: vi.fn(),
  updateScanProgress: vi.fn(),
}));
vi.mock('../sidepanel/render', () => ({
  renderImages: vi.fn(),
}));
vi.mock('../sidepanel/settings', () => ({
  applyProFeatureVisibility: vi.fn(),
  closeAllFilterDropdowns: vi.fn(),
  closeSettings: vi.fn(),
}));
vi.mock('../sidepanel/pro-features', () => ({
  closeCollectionModal: vi.fn(),
  closeDedupModal: vi.fn(),
  closeMultiTabModal: vi.fn(),
}));
vi.mock('../sidepanel/ui', () => ({
  hideProgress: vi.fn(),
  showToast: vi.fn(),
  updateFilterButtonLabels: vi.fn(),
  updateProgress: vi.fn(),
}));

import {
  showDiscoveredToastDebounced,
  handleMessage,
  handleKeyDown,
} from '../sidepanel/message';
import { state, store, elements } from '../sidepanel/state';
import type { ImageItem } from '../shared/types';

beforeEach(() => {
  store.reset();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

afterEach(() => {
  store.reset();
  document.body.innerHTML = '';
  // Drain any pending debounce timer from the previous test so the
  // module-level discoveredToastCount counter inside message.ts
  // returns to 0 before the next test starts. We unconditionally
  // switch to fake timers and runAllTimers() — this works whether
  // the test had fake or real timers, because runAllTimers fires
  // any timer registered with the active timer impl, and the
  // pre-existing real-timer setTimeout handle is still callable
  // by the JS engine if the test left it pending.
  vi.useFakeTimers();
  vi.runAllTimers();
  vi.useRealTimers();
});

function makeImg(overrides: Partial<ImageItem> = {}): ImageItem {
  return {
    id: 'x',
    url: 'https://example.com/photo.jpg',
    naturalWidth: 800,
    naturalHeight: 600,
    format: 'jpg',
    ...overrides,
  } as ImageItem;
}

// ─────────────────────────────────────────────────────────────────────
// showDiscoveredToastDebounced
// ─────────────────────────────────────────────────────────────────────

describe('showDiscoveredToastDebounced', () => {
  it('does NOT fire the toast before the 1500ms debounce window elapses', async () => {
    vi.useFakeTimers();
    showDiscoveredToastDebounced(3);

    vi.advanceTimersByTime(1499);
    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).not.toHaveBeenCalled();
  });

  it('fires the toast with the accumulated count after 1500ms of silence', async () => {
    vi.useFakeTimers();
    showDiscoveredToastDebounced(2);
    vi.advanceTimersByTime(500);
    showDiscoveredToastDebounced(3); // resets timer + accumulates → 5
    vi.advanceTimersByTime(500);
    showDiscoveredToastDebounced(4); // resets timer + accumulates → 9
    vi.advanceTimersByTime(1500);

    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).toHaveBeenCalledTimes(1);
    expect(ui.showToast).toHaveBeenCalledWith('9 new images discovered', 'info');
  });

  it('resets the count to 0 after firing — second burst starts fresh', async () => {
    vi.useFakeTimers();
    showDiscoveredToastDebounced(5);
    vi.advanceTimersByTime(1500);

    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).toHaveBeenLastCalledWith('5 new images discovered', 'info');

    // Second burst — count should NOT carry the previous 5.
    showDiscoveredToastDebounced(2);
    vi.advanceTimersByTime(1500);
    expect(ui.showToast).toHaveBeenLastCalledWith('2 new images discovered', 'info');
  });

  it('each call within the window restarts the 1500ms timer (true debounce, not throttle)', async () => {
    vi.useFakeTimers();
    showDiscoveredToastDebounced(1);
    vi.advanceTimersByTime(1000);
    showDiscoveredToastDebounced(1); // timer restarted
    vi.advanceTimersByTime(1000);
    // Total elapsed = 2000ms, but last call was 1000ms ago → not yet
    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500); // now 1500ms since last call
    expect(ui.showToast).toHaveBeenCalledTimes(1);
    expect(ui.showToast).toHaveBeenCalledWith('2 new images discovered', 'info');
  });
});

// ─────────────────────────────────────────────────────────────────────
// handleMessage — IMAGES_DISCOVERED 4-guard chain
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage — IMAGES_DISCOVERED guards', () => {
  beforeEach(() => {
    state.currentTabId = 100;
    state.isInitialized = true;
    state.isScanning = false;
    state.isFetching = false;
    state.isSilentScanning = false;
    state.isMultiTabExtracting = false;
    state.isTabSwitching = false;
    state.allImages = [];
  });

  it('drops messages from a different tab (fromTabId !== currentTabId)', async () => {
    handleMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      fromTabId: 999, // different from currentTabId=100
      images: [makeImg({ id: 'a' })],
    });
    expect(state.allImages).toHaveLength(0);
    const filterMod = await import('../sidepanel/filter');
    expect(filterMod.applyFilters).not.toHaveBeenCalled();
  });

  it('drops messages while isTabSwitching (incoming tab will load fresh)', async () => {
    state.isTabSwitching = true;
    handleMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      fromTabId: 100,
      images: [makeImg({ id: 'a' })],
    });
    expect(state.allImages).toHaveLength(0);
  });

  it('drops messages while isSilentScanning (final response is authoritative)', () => {
    state.isSilentScanning = true;
    handleMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      fromTabId: 100,
      images: [makeImg({ id: 'a' })],
    });
    expect(state.allImages).toHaveLength(0);
  });

  it('drops messages during fetch-only mode (isFetching && !isScanning)', () => {
    state.isFetching = true;
    state.isScanning = false;
    handleMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      fromTabId: 100,
      images: [makeImg({ id: 'a' })],
    });
    expect(state.allImages).toHaveLength(0);
  });

  it('drops messages while isMultiTabExtracting', () => {
    state.isMultiTabExtracting = true;
    handleMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      fromTabId: 100,
      images: [makeImg({ id: 'a' })],
    });
    expect(state.allImages).toHaveLength(0);
  });

  it('null fromTabId is treated as same-tab (allows messages without sender info)', async () => {
    // Fake timers so the debounced toast registered downstream by
    // showDiscoveredToastDebounced (live-monitor branch fires here)
    // can be drained by afterEach — otherwise the module-level count
    // leaks into later tests in this file.
    vi.useFakeTimers();
    handleMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      // no fromTabId
      images: [makeImg({ id: 'a', url: 'https://x.com/a.jpg' })],
    });
    // No active scan and isInitialized=true → live monitor branch fires
    expect(state.allImages).toHaveLength(1);
    const filterMod = await import('../sidepanel/filter');
    expect(filterMod.applyFilters).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// handleMessage — IMAGES_DISCOVERED active-scan branch
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage — IMAGES_DISCOVERED during active scan', () => {
  beforeEach(() => {
    state.currentTabId = 100;
    state.isInitialized = true;
    state.isScanning = true;
    state.isFetching = false;
    state.isSilentScanning = false;
    state.isMultiTabExtracting = false;
    state.isTabSwitching = false;
    state.allImages = [];
    state.scanDiscoveredCount = 0;
    state.scanDiscoveredImages = [];
    state.scanSkeletonLimit = 30;
  });

  it('appends new images to allImages (dedup by URL) + bumps scanDiscoveredCount', async () => {
    handleMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      fromTabId: 100,
      images: [
        makeImg({ id: 'a', url: 'https://x.com/a.jpg' }),
        makeImg({ id: 'b', url: 'https://x.com/b.jpg' }),
      ],
    });
    expect(state.allImages).toHaveLength(2);
    expect(state.scanDiscoveredCount).toBe(2);
    expect(state.scanDiscoveredImages).toHaveLength(2);
  });

  it('dedups by URL when the same image arrives twice in a scan burst', () => {
    state.allImages = [makeImg({ id: 'existing', url: 'https://x.com/a.jpg' })];

    handleMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      fromTabId: 100,
      images: [
        makeImg({ id: 'a', url: 'https://x.com/a.jpg' }), // dup
        makeImg({ id: 'b', url: 'https://x.com/b.jpg' }), // new
      ],
    });
    expect(state.allImages).toHaveLength(2); // 1 existing + 1 new
  });

  it('updates scanProgress.title to "Found N images" (overrides scan-loading text)', () => {
    handleMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      fromTabId: 100,
      images: [makeImg({ id: 'a', url: 'https://x.com/a.jpg' })],
    });
    expect(state.scanProgress.title).toBe('Found 1 images');
  });

  it('only triggers applyFilters while under the skeleton limit (avoid mid-scan flicker)', async () => {
    state.allImages = new Array(40).fill(0).map((_, i) =>
      makeImg({ id: `e${i}`, url: `https://x.com/e${i}.jpg` })
    );
    // prevCount = 40 ≥ scanSkeletonLimit=30 → applyFilters NOT called
    handleMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      fromTabId: 100,
      images: [makeImg({ id: 'new', url: 'https://x.com/new.jpg' })],
    });

    const filterMod = await import('../sidepanel/filter');
    expect(filterMod.applyFilters).not.toHaveBeenCalled();
    // But the image was still appended (visible after final render)
    expect(state.allImages).toHaveLength(41);
  });

  it('updates DOM #foundCount when the cached element ref exists', () => {
    const foundCountEl = document.createElement('span');
    foundCountEl.id = 'found-count';
    document.body.appendChild(foundCountEl);
    elements.foundCount = foundCountEl;

    handleMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      fromTabId: 100,
      images: [
        makeImg({ id: 'a', url: 'https://x.com/a.jpg' }),
        makeImg({ id: 'b', url: 'https://x.com/b.jpg' }),
      ],
    });
    expect(foundCountEl.textContent).toBe('2');
  });
});

// ─────────────────────────────────────────────────────────────────────
// handleMessage — live monitoring branch (post-init, no active scan)
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage — IMAGES_DISCOVERED live monitor', () => {
  beforeEach(() => {
    state.currentTabId = 100;
    state.isInitialized = true;
    state.isScanning = false;
    state.isFetching = false;
    state.isSilentScanning = false;
    state.isMultiTabExtracting = false;
    state.isTabSwitching = false;
    state.allImages = [];
  });

  it('appends + applyFilters + debounced toast when truly new images arrive', async () => {
    vi.useFakeTimers();
    // Drain any residual debounce state from previous tests (the module
    // holds discoveredToastCount + a real-timer setTimeout handle from
    // upstream guard tests that called handleMessage's live-monitor
    // branch with addedCount>0). advanceTimersByTime under fake timers
    // also fires the still-pending real-timer callback once installed
    // by lolex, ensuring the count resets to 0 before we assert.
    vi.advanceTimersByTime(2000);
    const ui = await import('../sidepanel/ui');
    (ui.showToast as ReturnType<typeof vi.fn>).mockClear();

    handleMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      fromTabId: 100,
      images: [makeImg({ id: 'a', url: 'https://x.com/a.jpg' })],
    });
    expect(state.allImages).toHaveLength(1);
    const filterMod = await import('../sidepanel/filter');
    expect(filterMod.applyFilters).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1500);
    expect(ui.showToast).toHaveBeenCalledWith('1 new images discovered', 'info');
  });

  it('NO-OP when every incoming image is already in allImages (addedCount === 0)', async () => {
    state.allImages = [makeImg({ id: 'existing', url: 'https://x.com/a.jpg' })];

    handleMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      fromTabId: 100,
      images: [makeImg({ id: 'a', url: 'https://x.com/a.jpg' })],
    });
    const filterMod = await import('../sidepanel/filter');
    expect(filterMod.applyFilters).not.toHaveBeenCalled();
  });

  it('skipped entirely when isInitialized is false (init flow owns rendering)', async () => {
    state.isInitialized = false;
    handleMessage({
      type: MESSAGE_TYPES.IMAGES_DISCOVERED,
      fromTabId: 100,
      images: [makeImg({ id: 'a', url: 'https://x.com/a.jpg' })],
    });
    expect(state.allImages).toHaveLength(0);
    const filterMod = await import('../sidepanel/filter');
    expect(filterMod.applyFilters).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// handleMessage — DOWNLOAD / LICENSE / MULTI_TAB_EXTRACT branches
// ─────────────────────────────────────────────────────────────────────

describe('handleMessage — DOWNLOAD branches', () => {
  it('DOWNLOAD_PROGRESS forwards to updateProgress(completed, total, current, imageCount)', async () => {
    handleMessage({
      type: MESSAGE_TYPES.DOWNLOAD_PROGRESS,
      completed: 3,
      total: 10,
      current: 'photo.jpg',
      imageCount: 7,
    });
    const ui = await import('../sidepanel/ui');
    expect(ui.updateProgress).toHaveBeenCalledWith(3, 10, 'photo.jpg', 7);
  });

  it('DOWNLOAD_PROGRESS defaults missing completed/total to 0', async () => {
    handleMessage({ type: MESSAGE_TYPES.DOWNLOAD_PROGRESS });
    const ui = await import('../sidepanel/ui');
    expect(ui.updateProgress).toHaveBeenCalledWith(0, 0, undefined, undefined);
  });

  it('DOWNLOAD_COMPLETE → hideProgress + success toast with count', async () => {
    handleMessage({ type: MESSAGE_TYPES.DOWNLOAD_COMPLETE, count: 5 });
    const ui = await import('../sidepanel/ui');
    expect(ui.hideProgress).toHaveBeenCalledTimes(1);
    expect(ui.showToast).toHaveBeenCalledWith('Downloaded 5 images', 'success');
  });

  it('DOWNLOAD_ERROR → hideProgress + error toast with reason (or "Unknown error")', async () => {
    handleMessage({ type: MESSAGE_TYPES.DOWNLOAD_ERROR, error: 'CORS denied' });
    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).toHaveBeenCalledWith('Download failed: CORS denied', 'error');

    vi.clearAllMocks();
    handleMessage({ type: MESSAGE_TYPES.DOWNLOAD_ERROR }); // no reason
    expect(ui.showToast).toHaveBeenCalledWith('Download failed: Unknown error', 'error');
  });
});

describe('handleMessage — CLEAR_SELECTION + LICENSE_STATUS_CHANGED', () => {
  it('CLEAR_SELECTION empties selectedImages and re-renders', async () => {
    state.selectedImages = new Set(['a', 'b', 'c']);
    handleMessage({ type: MESSAGE_TYPES.CLEAR_SELECTION });
    expect(state.selectedImages.size).toBe(0);
    const renderMod = await import('../sidepanel/render');
    expect(renderMod.renderImages).toHaveBeenCalledTimes(1);
  });

  it('LICENSE_STATUS_CHANGED → applyProFeatureVisibility (refreshes Pro gates UI)', async () => {
    handleMessage({ type: MESSAGE_TYPES.LICENSE_STATUS_CHANGED });
    const settingsMod = await import('../sidepanel/settings');
    expect(settingsMod.applyProFeatureVisibility).toHaveBeenCalledTimes(1);
  });
});

describe('handleMessage — MULTI_TAB_EXTRACT', () => {
  beforeEach(() => {
    state.allImages = [];
    state.appSettings = {
      ...state.appSettings,
      enableSimilarDetection: false,
      enableColorExtraction: false,
    };
  });

  it('success: merges deduped images, switches groupMode→tab, closes modal, success toast', async () => {
    handleMessage({
      type: MESSAGE_TYPES.MULTI_TAB_EXTRACT_COMPLETE,
      success: true,
      images: [
        makeImg({ id: 'a', url: 'https://x.com/a.jpg' }),
        makeImg({ id: 'b', url: 'https://x.com/b.jpg' }),
      ],
      tabCount: 4,
    });

    expect(state.allImages).toHaveLength(2);
    expect(state.currentGroupMode).toBe('tab');

    const ui = await import('../sidepanel/ui');
    const proMod = await import('../sidepanel/pro-features');
    const filterMod = await import('../sidepanel/filter');
    expect(ui.hideProgress).toHaveBeenCalledTimes(1);
    expect(filterMod.applyFilters).toHaveBeenCalledTimes(1);
    expect(proMod.closeMultiTabModal).toHaveBeenCalledTimes(1);
    expect(ui.showToast).toHaveBeenCalledWith(
      'Extracted 2 images from 4 tabs',
      'success'
    );
  });

  it('success: dedups by URL when an extracted image already exists', () => {
    state.allImages = [makeImg({ id: 'existing', url: 'https://x.com/a.jpg' })];
    handleMessage({
      type: MESSAGE_TYPES.MULTI_TAB_EXTRACT_COMPLETE,
      success: true,
      images: [
        makeImg({ id: 'a', url: 'https://x.com/a.jpg' }), // dup
        makeImg({ id: 'b', url: 'https://x.com/b.jpg' }), // new
      ],
      tabCount: 2,
    });
    expect(state.allImages).toHaveLength(2);
  });

  it('success + Pro features enabled → triggers processImageExtras on the new images', async () => {
    state.appSettings = {
      ...state.appSettings,
      enableSimilarDetection: true,
      enableColorExtraction: true,
    };
    handleMessage({
      type: MESSAGE_TYPES.MULTI_TAB_EXTRACT_COMPLETE,
      success: true,
      images: [makeImg({ id: 'a', url: 'https://x.com/a.jpg' })],
      tabCount: 1,
    });
    const scanMod = await import('../sidepanel/scan');
    expect(scanMod.processImageExtras).toHaveBeenCalledTimes(1);
  });

  it('success=false → hideProgress + "Extraction failed" error toast', async () => {
    handleMessage({
      type: MESSAGE_TYPES.MULTI_TAB_EXTRACT_COMPLETE,
      success: false,
    });
    const ui = await import('../sidepanel/ui');
    expect(ui.hideProgress).toHaveBeenCalledTimes(1);
    expect(ui.showToast).toHaveBeenCalledWith('Extraction failed', 'error');
  });

  it('MULTI_TAB_EXTRACT_ERROR → hideProgress + error toast with reason fallback', async () => {
    handleMessage({
      type: MESSAGE_TYPES.MULTI_TAB_EXTRACT_ERROR,
      error: 'tab dead',
    });
    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).toHaveBeenCalledWith(
      'Multi-tab extraction failed: tab dead',
      'error'
    );

    vi.clearAllMocks();
    handleMessage({ type: MESSAGE_TYPES.MULTI_TAB_EXTRACT_ERROR });
    expect(ui.showToast).toHaveBeenCalledWith(
      'Multi-tab extraction failed: Unknown error',
      'error'
    );
  });
});

describe('handleMessage — defensive', () => {
  it('returns silently when message is null/undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => handleMessage(null as any)).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => handleMessage(undefined as any)).not.toThrow();
  });

  it('returns silently when message has no type', () => {
    expect(() => handleMessage({})).not.toThrow();
  });

  it('unknown message type is a no-op (no crash, no UI side effect)', async () => {
    handleMessage({ type: 'TOTALLY_UNKNOWN_TYPE_XYZ' });
    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).not.toHaveBeenCalled();
    expect(ui.hideProgress).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// handleKeyDown — ESC modal-close priority chain
// ─────────────────────────────────────────────────────────────────────

describe('handleKeyDown — ESC modal priority chain', () => {
  function press(key: string, opts: KeyboardEventInit = {}): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { key, ...opts });
    handleKeyDown(e);
    return e;
  }

  it('ESC with settings modal open → closeSettings (highest priority)', async () => {
    state.settingsModalState = { ...state.settingsModalState, open: true };
    state.dedupModalState = { ...state.dedupModalState, open: true };

    press('Escape');

    const settingsMod = await import('../sidepanel/settings');
    const proMod = await import('../sidepanel/pro-features');
    expect(settingsMod.closeSettings).toHaveBeenCalledTimes(1);
    expect(proMod.closeDedupModal).not.toHaveBeenCalled();
  });

  it('ESC with dedup modal open (settings closed) → closeDedupModal', async () => {
    state.dedupModalState = { ...state.dedupModalState, open: true };
    state.collectionModalState = { ...state.collectionModalState, open: true };

    press('Escape');

    const proMod = await import('../sidepanel/pro-features');
    expect(proMod.closeDedupModal).toHaveBeenCalledTimes(1);
    expect(proMod.closeCollectionModal).not.toHaveBeenCalled();
  });

  it('ESC with collection modal open → closeCollectionModal', async () => {
    state.collectionModalState = { ...state.collectionModalState, open: true };
    press('Escape');
    const proMod = await import('../sidepanel/pro-features');
    expect(proMod.closeCollectionModal).toHaveBeenCalledTimes(1);
  });

  it('ESC with multitab modal open → closeMultiTabModal', async () => {
    state.multitabModalState = { ...state.multitabModalState, open: true };
    press('Escape');
    const proMod = await import('../sidepanel/pro-features');
    expect(proMod.closeMultiTabModal).toHaveBeenCalledTimes(1);
  });

  it('ESC with no modals + no selection → closes dropdowns only (no clearSelection)', async () => {
    state.selectedImages = new Set();
    press('Escape');
    const actMod = await import('../sidepanel/actions');
    const settingsMod = await import('../sidepanel/settings');
    expect(actMod.hideDownloadDropdown).toHaveBeenCalledTimes(1);
    expect(settingsMod.closeAllFilterDropdowns).toHaveBeenCalledTimes(1);
    expect(actMod.clearSelection).not.toHaveBeenCalled();
  });

  it('ESC with no modals + selection → also calls clearSelection', async () => {
    state.selectedImages = new Set(['a', 'b']);
    press('Escape');
    const actMod = await import('../sidepanel/actions');
    expect(actMod.clearSelection).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// handleKeyDown — Ctrl/Cmd+A + Enter shortcuts
// ─────────────────────────────────────────────────────────────────────

describe('handleKeyDown — Ctrl/Cmd+A + Enter', () => {
  function makeEvent(key: string, opts: KeyboardEventInit = {}): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { key, cancelable: true, ...opts });
    return e;
  }

  it('Ctrl+A → preventDefault + selectAll', async () => {
    const e = makeEvent('a', { ctrlKey: true });
    handleKeyDown(e);
    expect(e.defaultPrevented).toBe(true);
    const actMod = await import('../sidepanel/actions');
    expect(actMod.selectAll).toHaveBeenCalledTimes(1);
  });

  it('Cmd+A (meta) → preventDefault + selectAll (mac parity)', async () => {
    const e = makeEvent('a', { metaKey: true });
    handleKeyDown(e);
    expect(e.defaultPrevented).toBe(true);
    const actMod = await import('../sidepanel/actions');
    expect(actMod.selectAll).toHaveBeenCalledTimes(1);
  });

  it('Enter with selection → preventDefault + downloadSelectedAsZip(null)', async () => {
    state.selectedImages = new Set(['a', 'b']);
    const e = makeEvent('Enter');
    handleKeyDown(e);
    expect(e.defaultPrevented).toBe(true);
    const actMod = await import('../sidepanel/actions');
    expect(actMod.downloadSelectedAsZip).toHaveBeenCalledWith(null);
  });

  it('Enter WITHOUT selection → no-op (no preventDefault, no download)', async () => {
    state.selectedImages = new Set();
    const e = makeEvent('Enter');
    handleKeyDown(e);
    expect(e.defaultPrevented).toBe(false);
    const actMod = await import('../sidepanel/actions');
    expect(actMod.downloadSelectedAsZip).not.toHaveBeenCalled();
  });

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])(
    'Ctrl+A inside <%s> is NOT hijacked — selectAll skipped, default behavior preserved',
    async (tagName) => {
      const target = document.createElement(tagName.toLowerCase());
      document.body.appendChild(target);
      // KeyboardEvent dispatched directly; e.target is read-only on
      // synthesized events, so we use Object.defineProperty.
      const e = new KeyboardEvent('keydown', {
        key: 'a',
        ctrlKey: true,
        cancelable: true,
      });
      Object.defineProperty(e, 'target', { value: target });
      handleKeyDown(e);

      expect(e.defaultPrevented).toBe(false);
      const actMod = await import('../sidepanel/actions');
      expect(actMod.selectAll).not.toHaveBeenCalled();
    }
  );

  it('Enter inside <INPUT> is NOT hijacked (form submit / native handler preserved)', async () => {
    state.selectedImages = new Set(['a']);
    const target = document.createElement('input');
    document.body.appendChild(target);
    const e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    Object.defineProperty(e, 'target', { value: target });
    handleKeyDown(e);

    expect(e.defaultPrevented).toBe(false);
    const actMod = await import('../sidepanel/actions');
    expect(actMod.downloadSelectedAsZip).not.toHaveBeenCalled();
  });

  it('unhandled key (e.g. "x") is a complete no-op', async () => {
    const e = makeEvent('x');
    handleKeyDown(e);
    expect(e.defaultPrevented).toBe(false);
    const actMod = await import('../sidepanel/actions');
    expect(actMod.selectAll).not.toHaveBeenCalled();
    expect(actMod.downloadSelectedAsZip).not.toHaveBeenCalled();
  });
});
