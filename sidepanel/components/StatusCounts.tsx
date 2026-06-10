// Status-bar count components. Each one was previously updated by an
// imperative `elements.foo.textContent = ...` scattered across render.ts /
// actions.ts / message.ts / pro-features.ts / ui.ts. Migrating to Preact
// concentrates the logic in one place and makes the displays automatically
// reactive to store changes.
//
// All three components are intentionally tiny and stateless — they exist
// purely to project a single store value into the DOM. The legacy call
// sites have been left as no-op comments so any new contributor can grep
// for the old element id and immediately find this file.
import { t } from '../../shared/i18n';
import { useStoreSelector } from './storeHook';

/**
 * Toolbar label: "Found N images".
 * Hidden while a scan is in progress to avoid confusing partial counts;
 * fades in smoothly once scanning completes.
 */
export function FoundActionCount() {
  const count = useStoreSelector((s) => s.filteredImages.length);
  const isScanning = useStoreSelector((s) => s.isScanning);

  if (isScanning) return <span id="found-action-count" class="status-hidden" />;

  return (
    <span id="found-action-count" class="status-fade-in">
      {count}
    </span>
  );
}

/**
 * Inline similar-image indicator next to "Found N images".
 * Renders "(N similar)" as a clickable link that opens the dedup modal.
 * Hidden during scanning to stay consistent with the found-count above.
 */
export function SimilarInline() {
  const count = useStoreSelector((s) => {
    if (s.similarGroups.length === 0) return 0;
    const filteredIds = new Set(s.filteredImages.map((img) => img.id));
    return s.similarGroups.filter(
      (group) => group.filter((img) => filteredIds.has(img.id)).length >= 2
    ).length;
  });
  const isScanning = useStoreSelector((s) => s.isScanning);
  useStoreSelector((s) => s.localeTick);

  const handleClick = async () => {
    if (count === 0) return;
    const { showDedupModal } = await import('../pro-features');
    showDedupModal();
  };

  if (isScanning) return <span class="similar-inline status-hidden" />;

  return (
    <span class="similar-inline status-fade-in">
      (
      <a
        class={`similar-inline-link${count === 0 ? ' disabled' : ''}`}
        role="button"
        tabIndex={count > 0 ? 0 : -1}
        title={count > 0 ? t('title_view_similar') : undefined}
        onClick={handleClick}
      >
        {t('status_similar_count', { count })}
      </a>
      )
    </span>
  );
}

/**
 * Download button label. "Download All" when nothing selected, otherwise
 * "Download (N)" so the user can see the action count without parsing the
 * separate selectedCount widget.
 *
 * We subscribe to .size rather than the Set itself: the Set reference does
 * not change when items are added/removed, so a reference-equality selector
 * would never re-render. Reading .size lets the default Object.is comparison
 * fire only when the count actually changes.
 */
export function DownloadLabel() {
  const selectedSize = useStoreSelector((s) => s.selectedImages.size);
  const filteredCount = useStoreSelector((s) => s.filteredImages.length);
  // Subscribe to localeTick so a runtime language switch triggers re-render
  useStoreSelector((s) => s.localeTick);
  // Text label: always use the plain "Download" form so that .btn-label
  // can be safely hidden on narrow viewports without losing the count.
  // The count is shown separately via .btn-count (always visible).
  const textLabel = t('toolbar_download_all');
  // .btn-count is always visible (even when .btn-label is hidden on narrow
  // viewports), so we always populate it — selected count takes priority.
  const countLabel =
    selectedSize > 0 ? `(${selectedSize})` : filteredCount > 0 ? `(${filteredCount})` : '';
  return (
    <span id="download-label">
      <span class="btn-label">{textLabel}</span>
      <span class="btn-count">{countLabel}</span>
    </span>
  );
}
