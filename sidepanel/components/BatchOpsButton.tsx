// Batch operations toolbar — favorite, AI tag, delete.
// Free users can use batch delete/favorite with a per-batch limit;
// AI tag remains Pro-only.
import { t } from '../../shared/i18n';
import { getFreeLimits } from '../../shared/constants';
import { useStoreSelector } from './storeHook';
import { state } from '../state';
import { showToast } from '../ui';
import { showProUpgradeModal } from '../settings';
import { batchAddToCollection, batchAiTag, deleteSelectedImages } from '../actions';

function IconStar() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function IconAiTag() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/**
 * Resolve which images the batch action targets, applying the free-tier
 * per-batch limit when the user is not Pro.
 */
/**
 * Resolve target images. If the count exceeds the free limit, block the
 * operation entirely and show the Pro upgrade modal instead of silently
 * truncating to the first N items.
 */
function resolveTargetImages(
  limit: number | undefined,
  limitToastKey: string
): ReturnType<typeof state.filteredImages.filter> | null {
  const selectedSize = state.selectedImages.size;
  const images =
    selectedSize > 0
      ? state.filteredImages.filter((img) => state.selectedImages.has(img.id))
      : state.filteredImages;
  if (!state.isProUser && limit && images.length > limit) {
    showToast(t(limitToastKey, { max: String(limit) }), 'warning');
    showProUpgradeModal();
    return null;
  }
  return images;
}

/**
 * Resolve target IDs. If the count exceeds the free limit, block the
 * operation entirely, show toast + Pro upgrade modal.
 */
function resolveTargetIds(limit: number | undefined, limitToastKey: string): string[] | null {
  const selectedSize = state.selectedImages.size;
  const ids =
    selectedSize > 0 ? Array.from(state.selectedImages) : state.filteredImages.map((img) => img.id);
  if (!state.isProUser && limit && ids.length > limit) {
    showToast(t(limitToastKey, { max: String(limit) }), 'warning');
    showProUpgradeModal();
    return null;
  }
  return ids;
}

export function BatchOpsButton() {
  const selectedSize = useStoreSelector((s) => s.selectedImages.size);
  const filteredCount = useStoreSelector((s) => s.filteredImages.length);
  useStoreSelector((s) => s.localeTick);

  const effectiveCount = selectedSize > 0 ? selectedSize : filteredCount;
  const disabled = effectiveCount === 0;
  const countLabel = effectiveCount > 0 ? ` (${effectiveCount})` : '';

  function handleFavorite(): void {
    const limits = getFreeLimits();
    const freeLimit = state.isProUser ? undefined : limits.MAX_BATCH_FAVORITE;
    const images = resolveTargetImages(freeLimit, 'pro_batch_favorite_limit');
    if (!images || images.length === 0) return;
    void batchAddToCollection(images);
  }

  function handleAiTag(): void {
    const limits = getFreeLimits();
    const freeLimit = state.isProUser ? undefined : limits.MAX_BATCH_AI_TAGS;
    const images = resolveTargetImages(freeLimit, 'pro_batch_ai_tag_limit');
    if (!images || images.length === 0) return;
    void batchAiTag(images);
  }

  return (
    <div class="batch-ops-group" style="display:contents">
      <button
        class="status-action-btn batch-op-btn"
        type="button"
        title={t('batch_tooltip_favorite')}
        disabled={disabled}
        onClick={handleFavorite}
      >
        <IconStar />
        <span class="btn-label">{t('toolbar_batch_favorite')}</span>
        {countLabel && <span class="btn-count">{countLabel}</span>}
      </button>
      <button
        class="status-action-btn batch-op-btn"
        type="button"
        title={t('batch_tooltip_ai_tag')}
        disabled={disabled}
        onClick={handleAiTag}
      >
        <IconAiTag />
        <span class="btn-label">{t('toolbar_batch_ai_tag')}</span>
        {countLabel && <span class="btn-count">{countLabel}</span>}
      </button>
    </div>
  );
}

export function BatchDeleteButton() {
  const selectedSize = useStoreSelector((s) => s.selectedImages.size);
  const filteredCount = useStoreSelector((s) => s.filteredImages.length);
  useStoreSelector((s) => s.localeTick);

  const effectiveCount = selectedSize > 0 ? selectedSize : filteredCount;
  const disabled = effectiveCount === 0;
  const countLabel = effectiveCount > 0 ? ` (${effectiveCount})` : '';

  function handleDelete(): void {
    const limits = getFreeLimits();
    const freeLimit = state.isProUser ? undefined : limits.MAX_BATCH_DELETE;
    const ids = resolveTargetIds(freeLimit, 'pro_batch_delete_limit');
    if (!ids || ids.length === 0) return;
    void deleteSelectedImages(ids);
  }

  return (
    <button
      class="status-action-btn batch-op-delete"
      type="button"
      title={t('batch_tooltip_delete')}
      disabled={disabled}
      onClick={handleDelete}
    >
      <IconTrash />
      <span class="btn-label">{t('toolbar_batch_delete')}</span>
      {countLabel && <span class="btn-count">{countLabel}</span>}
    </button>
  );
}
