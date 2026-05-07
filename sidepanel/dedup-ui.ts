// Dedup modal UI — split out of pro-features.ts so the modal rendering +
// removal pipeline stays off the sidepanel main bundle. Loaded on demand
// the first time a user clicks the "Dedup" toolbar button or the
// "Remove duplicates" action inside the modal.
//
// What stays in pro-features.ts (synchronous):
//   - closeDedupModal (called from message.ts ESC handler)
//   - removeImageById (called from ImageCard render loop)
//   - detectSimilarImages (called from scan.ts + settings.ts)

import { t } from '../shared/i18n';
import { applyFilters } from './filter';
import { closeDedupModal, detectSimilarImages } from './pro-features';
import { showProUpgradeModal } from './settings';
import { state } from './state';
import { showConfirmDialog, showToast } from './ui';

export function showDedupModal(): void {
  // Open the Preact-managed shell. The cached `elements.dedupModal` ref may
  // be stale (Preact replaced the DOM node on mount), so look it up fresh
  // when we need to scroll the body.
  state.dedupModalState = { open: true };
  const modalEl = document.getElementById('dedup-modal');
  const modalBody = modalEl?.querySelector('.modal-body');
  if (modalBody) modalBody.scrollTop = 0;

  // Re-resolve the body slot too — it lives inside the Preact-rendered
  // subtree so the cached ref is unreliable.
  const dedupBody = document.getElementById('dedup-body');
  if (dedupBody) {
    if (state.similarGroups.length === 0) {
      dedupBody.innerHTML = `<p class="empty-message">${t('dedup_no_similar')}</p>`;
      return;
    }
    dedupBody.innerHTML = `${state.similarGroups
      .map(
        (group, gi) => `
      <div class="dedup-group" data-group="${gi}">
        <div class="dedup-group-title">${t('dedup_group_title', { index: gi + 1, count: group.length })}</div>
        <div class="dedup-group-images">
          ${group
            .map(
              (img, ii) => `
            <div class="dedup-image" data-group="${gi}" data-index="${ii}">
              <div class="dedup-image-thumb">
                <img src="${img.url}" alt="">
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `
      )
      .join('')}`;

    // Click image to toggle selection (mark for removal)
    dedupBody.querySelectorAll('.dedup-image').forEach((el) => {
      el.addEventListener('click', () => {
        el.classList.toggle('selected');
      });
    });
  }
}

export async function removeDuplicates(): Promise<void> {
  if (!state.isProUser) {
    closeDedupModal();
    showToast('Removing duplicates is a Pro feature. Upgrade to unlock!', 'warning');
    showProUpgradeModal();
    return;
  }

  const toRemove = new Set<string>();

  state.similarGroups.forEach((group, gi) => {
    group.forEach((img, ii) => {
      const el = document.querySelector(`.dedup-image[data-group="${gi}"][data-index="${ii}"]`);
      if (el && el.classList.contains('selected')) toRemove.add(img.id);
    });
  });

  // If no images were manually selected, default to removing all duplicates
  // in each similar group (keep the first image, remove the rest).
  if (toRemove.size === 0) {
    state.similarGroups.forEach((group) => {
      for (let i = 1; i < group.length; i++) {
        toRemove.add(group[i].id);
      }
    });
  }

  if (toRemove.size === 0) {
    showToast('No duplicate images found', 'info');
    return;
  }

  const confirmed = await showConfirmDialog({
    title: 'Remove Duplicates',
    message: `Are you sure you want to remove ${toRemove.size} selected duplicate image${toRemove.size > 1 ? 's' : ''}?`,
    confirmText: 'Remove',
    cancelText: 'Cancel',
    type: 'danger',
  });
  if (!confirmed) return;

  state.allImages = state.allImages.filter((img) => !toRemove.has(img.id));
  state.selectedImages = new Set([...state.selectedImages].filter((id) => !toRemove.has(id)));

  closeDedupModal();
  applyFilters();
  detectSimilarImages();
  showToast(`Removed ${toRemove.size} duplicate images`, 'success');
}
