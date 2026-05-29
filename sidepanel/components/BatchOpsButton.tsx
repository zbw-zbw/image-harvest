// Batch operations toolbar — Pro-only actions (favorite, AI tag, delete)
import { t } from '../../shared/i18n';
import { useStoreSelector } from './storeHook';
import { state } from '../state';
import { showToast } from '../ui';
import { showProUpgradeModal } from '../settings';
import { track } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
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

function proBlock(feature: string): boolean {
  if (!state.isProUser) {
    showToast(t('pro_batch_operation'), 'warning');
    void track(EVENTS.PRO_FEATURE_BLOCKED, { feature });
    showProUpgradeModal();
    return true;
  }
  return false;
}

export function BatchOpsButton() {
  const selectedSize = useStoreSelector((s) => s.selectedImages.size);
  const filteredCount = useStoreSelector((s) => s.filteredImages.length);
  useStoreSelector((s) => s.localeTick);

  const effectiveCount = selectedSize > 0 ? selectedSize : filteredCount;
  const disabled = effectiveCount === 0;
  const countLabel = effectiveCount > 0 ? ` (${effectiveCount})` : '';

  function handleFavorite(): void {
    if (proBlock('batch_favorite')) return;
    const images =
      selectedSize > 0
        ? state.filteredImages.filter((img) => state.selectedImages.has(img.id))
        : state.filteredImages;
    void batchAddToCollection(images);
  }

  function handleAiTag(): void {
    if (proBlock('batch_ai_tag')) return;
    const images =
      selectedSize > 0
        ? state.filteredImages.filter((img) => state.selectedImages.has(img.id))
        : state.filteredImages;
    void batchAiTag(images);
  }

  function handleDelete(): void {
    if (proBlock('batch_delete')) return;
    const ids =
      selectedSize > 0
        ? Array.from(state.selectedImages)
        : state.filteredImages.map((img) => img.id);
    void deleteSelectedImages(ids);
  }

  return (
    <div class="batch-ops-group">
      <button
        class="status-action-btn batch-op-btn"
        type="button"
        title={t('toolbar_batch_favorite')}
        disabled={disabled}
        onClick={handleFavorite}
      >
        <IconStar />
        <span class="btn-label">
          {t('toolbar_batch_favorite')}
          {countLabel}
        </span>
      </button>
      <button
        class="status-action-btn batch-op-btn"
        type="button"
        title={t('toolbar_batch_ai_tag')}
        disabled={disabled}
        onClick={handleAiTag}
      >
        <IconAiTag />
        <span class="btn-label">
          {t('toolbar_batch_ai_tag')}
          {countLabel}
        </span>
      </button>
      <button
        class="status-action-btn batch-op-btn batch-op-delete"
        type="button"
        title={t('toolbar_batch_delete')}
        disabled={disabled}
        onClick={handleDelete}
      >
        <IconTrash />
        <span class="btn-label">
          {t('toolbar_batch_delete')}
          {countLabel}
        </span>
      </button>
    </div>
  );
}
