// Collection modal UI — split out of pro-features.ts so the ~210 lines of
// modal rendering + 14 SVG icon strings + JSZip-driven export pipeline
// stay off the sidepanel main bundle. Loaded on demand the first time a
// user clicks the "Collection" toolbar button or the export button.
//
// What stays in pro-features.ts (synchronous):
//   - addToCollection / removeFromCollection / isImageInCollection
//     (called from ImageCard render loop — must not be async-imported)
//   - closeCollectionModal (called from message.ts ESC handler)

import type JSZipType from 'jszip';
import { collectionGetAll } from '../shared/collection';
import { t } from '../shared/i18n';
import type { CollectionItem, ImageItem } from '../shared/types';
import {
  downloadSingle,
  formatTimestamp,
  getActivePageInfo,
  openInNewTab,
  showReverseSearchMenu,
} from './actions';
import { removeFromCollection } from './pro-features';
import { elements, state } from './state';
import { hideProgress, showConfirmDialog, showProgress, showToast, updateProgress } from './ui';
import { formatBytes, generateFilename, truncateUrl } from './utils';

// ── Selection state for batch operations ──
const selectedCollectionItems = new Set<string>();
let currentCollectionItems: CollectionItem[] = [];

function updateCollectionCount(): void {
  const countEl = document.getElementById('collection-count');
  if (!countEl) return;
  const total = currentCollectionItems.length;
  const selected = selectedCollectionItems.size;
  countEl.textContent =
    selected > 0
      ? t('collection_count_selected', { selected, total })
      : total > 0
        ? t('collection_count', { total })
        : '';
}

function updateBatchButtons(): void {
  const hasSelection = selectedCollectionItems.size > 0;
  const batchDl = document.getElementById(
    'btn-collection-batch-download'
  ) as HTMLButtonElement | null;
  const batchDel = document.getElementById(
    'btn-collection-batch-delete'
  ) as HTMLButtonElement | null;
  if (batchDl) batchDl.disabled = !hasSelection;
  if (batchDel) batchDel.disabled = !hasSelection;
}

function updateSelectAllCheckbox(): void {
  const btn = document.getElementById('collection-select-all');
  if (!btn) return;
  const total = currentCollectionItems.length;
  const selected = selectedCollectionItems.size;
  const allChecked = total > 0 && selected === total;
  const partial = selected > 0 && selected < total;
  btn.classList.toggle('checked', allChecked);
  btn.classList.toggle('partial', partial);
}

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';

function updateCardCheckbox(card: Element, isSelected: boolean): void {
  card.classList.toggle('selected', isSelected);
  const cbDiv = card.querySelector('.collection-card-checkbox') as HTMLElement | null;
  if (!cbDiv) return;
  cbDiv.classList.toggle('checked', isSelected);
  const iconSpan = cbDiv.querySelector('.checkbox-icon') as HTMLElement | null;
  if (iconSpan) iconSpan.innerHTML = isSelected ? CHECK_SVG : '';
}

function toggleCollectionItemSelection(itemId: string): void {
  if (selectedCollectionItems.has(itemId)) {
    selectedCollectionItems.delete(itemId);
  } else {
    selectedCollectionItems.add(itemId);
  }
  const card = document.querySelector(`.collection-card[data-id="${itemId}"]`);
  if (card) updateCardCheckbox(card, selectedCollectionItems.has(itemId));
  updateSelectAllCheckbox();
  updateBatchButtons();
  updateCollectionCount();
}

function toggleCollectionSelectAll(): void {
  const allSelected = selectedCollectionItems.size === currentCollectionItems.length;
  if (allSelected) {
    selectedCollectionItems.clear();
  } else {
    for (const item of currentCollectionItems) {
      selectedCollectionItems.add(item.id);
    }
  }
  // Update all card visuals
  document.querySelectorAll('.collection-card').forEach((card) => {
    const id = (card as HTMLElement).dataset.id!;
    updateCardCheckbox(card, selectedCollectionItems.has(id));
  });
  updateSelectAllCheckbox();
  updateBatchButtons();
  updateCollectionCount();
}

async function batchDownloadCollection(): Promise<void> {
  const selectedItems = currentCollectionItems.filter((item) =>
    selectedCollectionItems.has(item.id)
  );
  if (selectedItems.length === 0) return;

  if (selectedItems.length === 1) {
    downloadSingle(selectedItems[0] as unknown as ImageItem, null);
    return;
  }

  let aborted = false;
  try {
    showProgress(t('toast_downloading'), () => {
      aborted = true;
      showToast(t('toast_download_cancelled'), 'info');
    });

    const { default: JSZip } = (await import('jszip')) as { default: typeof JSZipType };
    const zip = new JSZip();
    const pageInfo = await getActivePageInfo();
    const failed: string[] = [];

    for (let i = 0; i < selectedItems.length; i++) {
      if (aborted) return;
      updateProgress(i + 1, selectedItems.length, truncateUrl(selectedItems[i].url, 40));
      try {
        const resp = await fetch(selectedItems[i].url, { mode: 'cors' });
        if (resp.ok) {
          const blob = await resp.blob();
          zip.file(
            generateFilename(selectedItems[i] as unknown as ImageItem, i, null, pageInfo),
            blob
          );
        } else {
          failed.push(selectedItems[i].url);
        }
      } catch {
        failed.push(selectedItems[i].url);
      }
    }

    if (aborted) return;
    if (failed.length > 0) {
      zip.file('_failed.txt', 'Failed to download:\n' + failed.join('\n'));
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const blobUrl = URL.createObjectURL(content);
    const ts = formatTimestamp(new Date());
    await chrome.downloads.download({
      url: blobUrl,
      filename: `collection-${ts}.zip`,
      saveAs: false,
    });
    URL.revokeObjectURL(blobUrl);

    const successCount = selectedItems.length - failed.length;
    if (successCount === 0) {
      showToast(t('toast_download_all_failed'), 'error');
    } else {
      showToast(t('toast_download_completed', { count: successCount }), 'success');
    }
  } catch (error) {
    if (!aborted) {
      showToast(t('toast_download_failed') + ': ' + (error as Error).message, 'error');
    }
  } finally {
    hideProgress();
  }
}

async function batchDeleteCollection(): Promise<void> {
  const count = selectedCollectionItems.size;
  if (count === 0) return;

  const confirmed = await showConfirmDialog({
    title: t('collection_batch_delete'),
    message: t('collection_batch_delete_confirm', { count }),
    confirmText: t('common_confirm'),
    cancelText: t('common_cancel'),
    type: 'warning',
  });
  if (!confirmed) return;

  const idsToDelete = [...selectedCollectionItems];
  for (const id of idsToDelete) {
    await removeFromCollection(id);
    // Update favorite button in main grid
    const mainCard = document.querySelector(`.image-card[data-id="${id}"] .btn-favorite`);
    if (mainCard) {
      mainCard.classList.remove('favorited');
      (mainCard as HTMLElement).title = 'Add to collection';
    }
  }

  selectedCollectionItems.clear();
  showToast(t('toast_collection_batch_deleted', { count }), 'success');
  loadCollection(
    (document.getElementById('collection-search') as HTMLInputElement | null)?.value?.trim() || ''
  );
}

function bindCollectionToolbarEvents(): void {
  const selectAllBtn = document.getElementById('collection-select-all');
  if (selectAllBtn) {
    selectAllBtn.onclick = () => toggleCollectionSelectAll();
  }
  const batchDlBtn = document.getElementById('btn-collection-batch-download');
  if (batchDlBtn) {
    batchDlBtn.onclick = () => void batchDownloadCollection();
  }
  const batchDelBtn = document.getElementById('btn-collection-batch-delete');
  if (batchDelBtn) {
    batchDelBtn.onclick = () => void batchDeleteCollection();
  }
}

export function showCollectionModal(): void {
  // Reset selection state on open
  selectedCollectionItems.clear();

  // Open the Preact-managed shell. cached refs may be stale because Preact
  // owns the modal subtree now — re-resolve via getElementById.
  state.collectionModalState = { open: true };
  const modalEl = document.getElementById('collection-modal');
  const modalBody = modalEl?.querySelector('.modal-body');
  if (modalBody) {
    modalBody.scrollTop = 0;
    requestAnimationFrame(() => {
      modalBody.scrollTop = 0;
    });
  }
  // Bind search input. The input lives inside the Preact subtree; use a
  // fresh lookup so we don't grab a detached reference from cacheElements().
  const searchInput = document.getElementById('collection-search') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.value = '';
    searchInput.oninput = () => {
      // Clear selection when search changes
      selectedCollectionItems.clear();
      loadCollection(searchInput.value.trim());
    };
  }
  // Bind toolbar batch action events
  bindCollectionToolbarEvents();
  loadCollection();
}

export async function loadCollection(searchQuery = ''): Promise<void> {
  if (!elements.collectionBody) return;

  try {
    let items: CollectionItem[] = await collectionGetAll();

    // Filter by search query
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      items = items.filter(
        (item) =>
          (item.url && item.url.toLowerCase().includes(lowerQuery)) ||
          (item.sourceTitle && item.sourceTitle.toLowerCase().includes(lowerQuery)) ||
          (item.sourceUrl && item.sourceUrl.toLowerCase().includes(lowerQuery)) ||
          (item.tags && item.tags.some((tag: string) => tag.toLowerCase().includes(lowerQuery)))
      );
    }

    // Sort by newest first
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // Cache items for batch operations
    currentCollectionItems = items;

    // Remove stale selections (items no longer in filtered list)
    for (const id of [...selectedCollectionItems]) {
      if (!items.some((item) => item.id === id)) {
        selectedCollectionItems.delete(id);
      }
    }

    if (items.length === 0) {
      elements.collectionBody.innerHTML = `
        <div class="collection-empty">
          <div class="collection-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
          <p>${searchQuery ? t('collection_no_match') : t('collection_empty_title')}</p>
          <p style="font-size:11px;margin-top:4px;color:var(--text-tertiary)">${searchQuery ? t('collection_no_match_hint') : t('collection_empty_hint')}</p>
        </div>`;
      return;
    }

    elements.collectionBody.innerHTML = `
      <div class="collection-grid">
        ${items
          .map((item) => {
            const dims = item.width && item.height ? `${item.width}×${item.height}` : '';
            const format = ((item.format as string | undefined) || 'unknown').toUpperCase();
            const fileSize = item.fileSize ? formatBytes(item.fileSize as number) : '';
            return `
          <div class="image-card collection-card${selectedCollectionItems.has(item.id) ? ' selected' : ''}" data-id="${item.id}">
            <div class="collection-item-select">
              <div class="collection-card-checkbox${selectedCollectionItems.has(item.id) ? ' checked' : ''}" data-id="${item.id}">
                <span class="checkbox-icon">${selectedCollectionItems.has(item.id) ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</span>
              </div>
            </div>
            <div class="card-thumb checkerboard">
              <img src="${item.url}" alt="" loading="lazy">
            </div>
            <div class="card-info-bar">
              <div class="card-tags">
                <span class="card-tag format">${format}</span>
                ${dims ? `<span class="card-tag dims">${dims}</span>` : ''}
                ${fileSize ? `<span class="card-tag filesize">${fileSize}</span>` : ''}
              </div>
              <div class="card-actions">
                <button class="card-action-btn btn-search-collection" title="${t('menu_reverse_search')}" data-url="${item.url}">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </button>
                <button class="card-action-btn btn-dl-collection" data-url="${item.url}" data-format="${item.format || ''}" title="Download">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button class="card-action-btn btn-remove-collection" data-id="${item.id}" title="${t('card_remove_from_collection')}">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
            <div class="card-url-row">
              <div class="card-url" title="${item.url}">${item.url}</div>
              <div class="card-url-actions">
                <button class="card-action-btn btn-copy-collection" data-url="${item.url}" title="${t('card_copy_url')}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
                <button class="card-action-btn btn-open-collection" data-url="${item.url}" title="${t('card_open_in_new_tab')}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </button>
              </div>
            </div>
          </div>`;
          })
          .join('')}
      </div>`;

    // Bind action events
    elements.collectionBody
      .querySelectorAll<HTMLElement>('.btn-remove-collection')
      .forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const confirmed = await showConfirmDialog({
            title: t('confirm_delete_title'),
            message: t('confirm_delete_collection_message'),
            confirmText: t('common_remove'),
            cancelText: t('common_cancel'),
            type: 'danger',
          });
          if (!confirmed) return;
          await removeFromCollection(btn.dataset.id!);
          // Also update favorite button state in main grid
          const mainCard = document.querySelector(
            `.image-card[data-id="${btn.dataset.id}"] .btn-favorite`
          );
          if (mainCard) {
            mainCard.classList.remove('favorited');
            (mainCard as HTMLElement).title = 'Add to collection';
          }
          loadCollection(
            (elements.collectionSearch as HTMLInputElement | null)?.value?.trim() || ''
          );
        });
      });

    elements.collectionBody.querySelectorAll<HTMLElement>('.btn-open-collection').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openInNewTab(btn.dataset.url!);
      });
    });

    elements.collectionBody.querySelectorAll<HTMLElement>('.btn-copy-collection').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(btn.dataset.url!);
          showToast(t('toast_url_copied_single'), 'success');
        } catch {
          showToast(t('toast_url_copy_failed'), 'error');
        }
      });
    });

    elements.collectionBody.querySelectorAll<HTMLElement>('.btn-dl-collection').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const imgObj = {
          url: btn.dataset.url!,
          format: btn.dataset.format || 'unknown',
        } as unknown as ImageItem;
        downloadSingle(imgObj, null);
      });
    });

    elements.collectionBody
      .querySelectorAll<HTMLElement>('.btn-search-collection')
      .forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          showReverseSearchMenu(btn.dataset.url!, e.currentTarget as HTMLElement);
        });
      });

    // Bind checkbox selection events
    elements.collectionBody
      .querySelectorAll<HTMLElement>('.collection-card-checkbox')
      .forEach((cbDiv) => {
        cbDiv.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleCollectionItemSelection(cbDiv.dataset.id!);
        });
      });

    // Click anywhere on card to toggle selection (except action buttons)
    elements.collectionBody.querySelectorAll<HTMLElement>('.collection-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        // Don't toggle if clicking on action buttons, checkboxes, or links
        if (
          target.closest(
            '.card-action-btn, .card-actions, .card-url-actions, .collection-card-checkbox, a'
          )
        )
          return;
        toggleCollectionItemSelection(card.dataset.id!);
      });
    });

    // Update toolbar state after render
    updateSelectAllCheckbox();
    updateBatchButtons();
    updateCollectionCount();

    // Handle broken images
    elements.collectionBody.querySelectorAll<HTMLImageElement>('.card-thumb img').forEach((img) => {
      img.addEventListener('load', () => {
        img.classList.add('loaded');
        img.parentElement?.classList.add('loaded');
      });
      img.addEventListener('error', () => {
        img.style.display = 'none';
        img.parentElement?.classList.add('loaded');
      });
    });
  } catch {
    elements.collectionBody.innerHTML = `
      <div class="collection-empty">
        <div class="collection-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
        <p>${t('toast_collection_load_failed')}</p>
      </div>`;
  }
}

export async function exportCollection(): Promise<void> {
  // Hoisted out of `try` so the `catch` block below can read it without
  // running into a TDZ / no-undef bug.
  let aborted = false;

  try {
    const items: CollectionItem[] = await collectionGetAll();

    if (items.length === 0) {
      showToast(t('toast_collection_empty'), 'info');
      return;
    }

    showProgress(t('toast_exporting_collection'), () => {
      aborted = true;
      showToast(t('toast_export_cancelled'), 'info');
    });

    const { default: JSZip } = (await import('jszip')) as { default: typeof JSZipType };
    const zip = new JSZip();
    const pageInfo = await getActivePageInfo();
    const folder = zip.folder('collection')!;

    for (let i = 0; i < items.length; i++) {
      if (aborted) return;

      updateProgress(i + 1, items.length, truncateUrl(items[i].url, 40));
      try {
        const resp = await fetch(items[i].url, { mode: 'cors' });
        if (resp.ok) {
          const blob = await resp.blob();
          folder.file(generateFilename(items[i] as unknown as ImageItem, i, null, pageInfo), blob);
        }
      } catch {
        /* skip */
      }
    }

    if (aborted) return;

    const content = await zip.generateAsync({ type: 'blob' });
    const blobUrl = URL.createObjectURL(content);
    const ts = formatTimestamp(new Date());
    await chrome.downloads.download({
      url: blobUrl,
      filename: `collection-${ts}.zip`,
      saveAs: false,
    });
    URL.revokeObjectURL(blobUrl);
    showToast(t('toast_collection_exported'), 'success');
  } catch {
    if (!aborted) showToast(t('toast_collection_export_failed'), 'error');
  } finally {
    hideProgress();
  }
}
