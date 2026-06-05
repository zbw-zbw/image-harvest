import { t } from '../../shared/i18n';
import { MESSAGE_TYPES, getFreeLimits } from '../../shared/constants';
import { track } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { useStoreSelector } from './storeHook';
import { state, store } from '../state';
import { showToast } from '../ui';
import { showProUpgradeModal } from '../settings';
import type { EagleItem } from '../../shared/export-eagle';

function IconEagle() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M22 2L13.5 11" />
      <path d="M22 2L15 22l-4-9-9-4z" />
    </svg>
  );
}

export function EagleExportButton() {
  const isPro = useStoreSelector((s) => s.isProUser);
  const selectedSize = useStoreSelector((s) => s.selectedImages.size);
  const filteredCount = useStoreSelector((s) => s.filteredImages.length);
  const isExporting = useStoreSelector((s) => s.isEagleExporting);
  useStoreSelector((s) => s.localeTick);

  const effectiveCount = selectedSize > 0 ? selectedSize : filteredCount;
  const disabled = effectiveCount === 0 || isExporting;

  const textLabel = isExporting ? t('eagle_export_label') + '...' : t('eagle_export_label');
  const countLabel = !isExporting && effectiveCount > 0 ? ` (${effectiveCount})` : '';

  async function handleClick(): Promise<void> {
    if (!isPro) {
      // Check single-batch size limit
      if (effectiveCount > getFreeLimits().MAX_EAGLE_EXPORT_PER_BATCH) {
        showToast(
          t('toast_eagle_free_limit', { max: String(getFreeLimits().MAX_EAGLE_EXPORT_PER_BATCH) }),
          'warning'
        );
        showProUpgradeModal();
        return;
      }
    }
    if (disabled) return;

    const images =
      selectedSize > 0
        ? state.filteredImages.filter((img) => state.selectedImages.has(img.id))
        : state.filteredImages;

    const items: EagleItem[] = images.map((img) => {
      let name = img.alt || '';
      if (!name) {
        try {
          name = new URL(img.url).pathname.split('/').pop() || img.id;
        } catch {
          name = img.id;
        }
      }
      return { url: img.url, name, website: img.tabUrl, tags: img.aiTags };
    });

    void track(EVENTS.EXPORT_EAGLE_STARTED, { count: items.length });
    store.set('isEagleExporting', true);
    showToast(t('toast_eagle_exporting', { count: String(items.length) }), 'info');

    const t0 = Date.now();
    try {
      const response = (await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.EXPORT_TO_EAGLE,
        items,
      })) as { success: boolean; added?: number; failed?: number; error?: string };

      store.set('isEagleExporting', false);

      if (!response?.success) {
        const reason = response?.error || 'api_error';
        if (reason === 'eagle_not_running') {
          showToast(t('toast_eagle_not_running'), 'error');
        } else {
          showToast(t('toast_eagle_failed'), 'error');
        }
        void track(EVENTS.EXPORT_EAGLE_FAILED, { reason });
        return;
      }

      showToast(t('toast_eagle_success', { count: String(response.added ?? 0) }), 'success');
      void track(EVENTS.EXPORT_EAGLE_COMPLETED, {
        count: response.added ?? 0,
        durationMs: Date.now() - t0,
      });
    } catch (error) {
      store.set('isEagleExporting', false);
      showToast(t('toast_eagle_failed'), 'error');
      void track(EVENTS.EXPORT_EAGLE_FAILED, { reason: (error as Error).message });
    }
  }

  return (
    <button
      id="btn-eagle-export"
      class="status-action-btn eagle-export-btn"
      type="button"
      title={t('batch_tooltip_eagle')}
      disabled={disabled}
      onClick={() => void handleClick()}
    >
      <IconEagle />
      <span class="btn-label">{textLabel}</span>
      {countLabel && <span class="btn-count">{countLabel}</span>}
    </button>
  );
}
