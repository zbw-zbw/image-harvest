// Unit tests for sidepanel/dedup-ui.ts — the 116-line lazy-loaded dedup
// modal that was previously at 0% coverage.
//
// Scope:
//   - showDedupModal: 3 branches (missing #dedup-body / empty groups /
//     populated groups + click-to-toggle event wiring)
//   - removeDuplicates: 4 branches
//       * non-Pro user → closeDedupModal + showToast(warning) +
//         showProUpgradeModal, early-return (no state mutation)
//       * Pro + no manual selection + empty similarGroups → showToast
//         ("No duplicate images found")
//       * Pro + manual selection (".selected" on data-group/data-index)
//         → confirm dialog → filter allImages/selectedImages, call
//         applyFilters + detectSimilarImages + closeDedupModal
//       * Pro + no manual selection + non-empty groups → default-keep-
//         first-remove-rest path
//       * confirm dialog cancelled → no state mutation
//
// All transitive DOM/side-effect deps mocked at module level.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sidepanel/filter', () => ({
  applyFilters: vi.fn(),
}));
vi.mock('../sidepanel/pro-features', () => ({
  closeDedupModal: vi.fn(),
  detectSimilarImages: vi.fn(),
}));
vi.mock('../sidepanel/settings', () => ({
  showProUpgradeModal: vi.fn(),
}));
vi.mock('../sidepanel/ui', () => ({
  showConfirmDialog: vi.fn(),
  showToast: vi.fn(),
}));

import { showDedupModal, removeDuplicates } from '../sidepanel/dedup-ui';
import { state } from '../sidepanel/state';
import type { ImageItem } from '../shared/types';

function mkImg(id: string, url = `https://x.com/${id}.png`): ImageItem {
  return { id, url, format: 'png' } as unknown as ImageItem;
}

function mountDedupDOM(): void {
  document.body.innerHTML = `
    <div id="dedup-modal">
      <div class="modal-body"></div>
    </div>
    <div id="dedup-body"></div>
  `;
}

/**
 * showDedupModal uses a double-rAF to defer imperative DOM writes so that
 * Preact can commit its render first. In jsdom (vitest), rAF callbacks are
 * scheduled but don't fire automatically. This helper flushes both frames.
 */
async function flushDedupRender(): Promise<void> {
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
}

beforeEach(() => {
  mountDedupDOM();
  state.similarGroups = [];
  state.allImages = [];
  state.filteredImages = [];
  state.selectedImages = new Set();
  state.isProUser = false;
  state.dedupModalState = { open: false };
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// showDedupModal
// ─────────────────────────────────────────────────────────────────────

describe('showDedupModal', () => {
  it('flips state.dedupModalState.open=true immediately', () => {
    showDedupModal();
    expect(state.dedupModalState.open).toBe(true);
  });

  it('empty similarGroups → renders "No similar images found" empty-state', async () => {
    state.similarGroups = [];
    showDedupModal();
    await flushDedupRender();
    const body = document.getElementById('dedup-body')!;
    expect(body.innerHTML).toContain('No similar images found');
    expect(body.innerHTML).toContain('empty-message');
  });

  it('populated similarGroups → renders group headers + thumbnails + click handlers', async () => {
    const allImgs = [mkImg('a'), mkImg('b'), mkImg('c'), mkImg('d'), mkImg('e')];
    state.similarGroups = [
      [allImgs[0], allImgs[1]],
      [allImgs[2], allImgs[3], allImgs[4]],
    ];
    state.filteredImages = allImgs;
    showDedupModal();
    await flushDedupRender();
    const body = document.getElementById('dedup-body')!;
    // Pin: group titles include 1-based index + count. A regression
    // using 0-based would ship "Group 0 (2 similar)" to users.
    expect(body.innerHTML).toContain('Group 1 (2 similar)');
    expect(body.innerHTML).toContain('Group 2 (3 similar)');
    // Thumbnail <img> src threaded through from image.url.
    const imgs = body.querySelectorAll<HTMLImageElement>('.dedup-image-thumb img');
    expect(imgs).toHaveLength(5);
    expect(imgs[0].src).toContain('a.png');
  });

  it('clicking .dedup-image toggles the .selected class (mark for removal)', async () => {
    state.similarGroups = [[mkImg('a'), mkImg('b')]];
    state.filteredImages = [mkImg('a'), mkImg('b')];
    showDedupModal();
    await flushDedupRender();
    const body = document.getElementById('dedup-body')!;
    const first = body.querySelector('.dedup-image') as HTMLElement;
    expect(first.classList.contains('selected')).toBe(false);
    first.click();
    expect(first.classList.contains('selected')).toBe(true);
    first.click();
    expect(first.classList.contains('selected')).toBe(false);
  });

  it('missing #dedup-body → no crash (defensive guard for pre-mount state)', () => {
    document.getElementById('dedup-body')?.remove();
    expect(() => showDedupModal()).not.toThrow();
    expect(state.dedupModalState.open).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// removeDuplicates
// ─────────────────────────────────────────────────────────────────────

describe('removeDuplicates', () => {
  it('non-Pro user with exhausted quota: closes modal + shows warning toast + opens Pro modal + NO state mutation', async () => {
    state.isProUser = false;
    state.allImages = [mkImg('a'), mkImg('b')];
    state.filteredImages = state.allImages;
    state.similarGroups = [[mkImg('a'), mkImg('b')]];

    // Mock feature-quota to return exhausted state
    const featureQuota = await import('../shared/feature-quota');
    vi.spyOn(featureQuota, 'checkFeatureQuota').mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 3,
      used: 3,
    });

    await removeDuplicates();

    const pro = await import('../sidepanel/pro-features');
    const settings = await import('../sidepanel/settings');
    const ui = await import('../sidepanel/ui');
    expect(pro.closeDedupModal).toHaveBeenCalledTimes(1);
    expect(ui.showToast).toHaveBeenCalled();
    expect(settings.showProUpgradeModal).toHaveBeenCalledTimes(1);
    // Pin: early-return BEFORE touching state. A regression running
    // the removal pipeline when quota exhausted would silently let them
    // bypass the paywall.
    expect(state.allImages).toHaveLength(2);
    expect(ui.showConfirmDialog).not.toHaveBeenCalled();
  });

  it('Pro + empty similarGroups: short-circuits with "No duplicate images found" info toast', async () => {
    state.isProUser = true;
    state.similarGroups = [];

    await removeDuplicates();

    const ui = await import('../sidepanel/ui');
    expect(ui.showToast).toHaveBeenCalledWith('No duplicate images found', 'info');
    expect(ui.showConfirmDialog).not.toHaveBeenCalled();
  });

  it('Pro + no manual selection + populated groups: defaults to "keep first, remove rest"', async () => {
    state.isProUser = true;
    state.allImages = [mkImg('a'), mkImg('b'), mkImg('c'), mkImg('d')];
    state.filteredImages = state.allImages;
    state.similarGroups = [
      [mkImg('a'), mkImg('b')],
      [mkImg('c'), mkImg('d')],
    ];
    showDedupModal();
    await flushDedupRender();
    const ui = await import('../sidepanel/ui');
    vi.mocked(ui.showConfirmDialog).mockResolvedValueOnce(true);

    await removeDuplicates();

    // Pin: b + d removed (each group's 1..end), a + c kept. A
    // regression using slice(0, -1) instead of slice(1) would keep
    // the wrong image in each group.
    expect(state.allImages.map((i) => i.id)).toEqual(['a', 'c']);
    expect(ui.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Remove Duplicates',
        type: 'danger',
        // i18n key confirm_remove_duplicates_message with {count}=2
        // produces "Are you sure you want to remove 2 selected duplicate image(s)?"
        message: expect.stringContaining('2 selected duplicate image'),
      })
    );
  });

  it('Pro + manual selection: removes only the ".selected" images (not default keep-first)', async () => {
    state.isProUser = true;
    state.allImages = [mkImg('a'), mkImg('b'), mkImg('c')];
    state.filteredImages = state.allImages;
    state.similarGroups = [[mkImg('a'), mkImg('b'), mkImg('c')]];
    showDedupModal();
    await flushDedupRender();
    // Manually select only 'a' (group=0, index=0) — this overrides
    // the default keep-first behavior.
    const firstEl = document.querySelector(
      '.dedup-image[data-group="0"][data-index="0"]'
    ) as HTMLElement;
    firstEl.classList.add('selected');

    const ui = await import('../sidepanel/ui');
    vi.mocked(ui.showConfirmDialog).mockResolvedValueOnce(true);

    await removeDuplicates();

    // Only 'a' removed. Pin: manual-selection wins over the default
    // keep-first heuristic. Reversing this precedence would delete the
    // user's explicit selection + keep everything else.
    expect(state.allImages.map((i) => i.id)).toEqual(['b', 'c']);
    // Confirm message uses i18n key with {count}=1
    expect(ui.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('1 selected duplicate image'),
      })
    );
  });

  it('Pro + confirmed: applyFilters + detectSimilarImages + closeDedupModal + success toast all fire', async () => {
    state.isProUser = true;
    state.allImages = [mkImg('a'), mkImg('b')];
    state.filteredImages = state.allImages;
    state.selectedImages = new Set(['a', 'b']);
    state.similarGroups = [[mkImg('a'), mkImg('b')]];
    showDedupModal();
    await flushDedupRender();
    const ui = await import('../sidepanel/ui');
    vi.mocked(ui.showConfirmDialog).mockResolvedValueOnce(true);

    await removeDuplicates();

    // state.selectedImages filtered to remove deleted ids.
    // Pin: without this, "Download selected" would silently reference
    // stale ids and skip the corresponding images.
    expect(state.selectedImages.has('b')).toBe(false);
    expect(state.selectedImages.has('a')).toBe(true);

    const filter = await import('../sidepanel/filter');
    const pro = await import('../sidepanel/pro-features');
    expect(filter.applyFilters).toHaveBeenCalledTimes(1);
    expect(pro.detectSimilarImages).toHaveBeenCalledTimes(1);
    expect(pro.closeDedupModal).toHaveBeenCalledTimes(1);
    expect(ui.showToast).toHaveBeenCalledWith(
      expect.stringMatching(/Removed \d+ duplicate images/),
      'success'
    );
  });

  it('Pro + confirm cancelled: NO state mutation + NO applyFilters/detectSimilarImages/closeDedupModal', async () => {
    state.isProUser = true;
    state.allImages = [mkImg('a'), mkImg('b')];
    state.filteredImages = state.allImages;
    state.similarGroups = [[mkImg('a'), mkImg('b')]];
    showDedupModal();
    await flushDedupRender();
    const ui = await import('../sidepanel/ui');
    vi.mocked(ui.showConfirmDialog).mockResolvedValueOnce(false);

    await removeDuplicates();

    // Pin: cancelling must be a full rollback — the user's allImages
    // list is untouched. A regression returning early from only the
    // toast path would still mutate state.
    expect(state.allImages).toHaveLength(2);
    const filter = await import('../sidepanel/filter');
    const pro = await import('../sidepanel/pro-features');
    expect(filter.applyFilters).not.toHaveBeenCalled();
    expect(pro.detectSimilarImages).not.toHaveBeenCalled();
    expect(pro.closeDedupModal).not.toHaveBeenCalled();
  });
});
