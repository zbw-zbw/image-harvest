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

/** Toolbar label: "Found N images". */
export function FoundActionCount() {
  const count = useStoreSelector((s) => s.filteredImages.length);
  return <span id="found-action-count">{count}</span>;
}

/**
 * Inline similar-image indicator next to "Found N images".
 * Renders "(N similar)" as a clickable link that opens the dedup modal.
 * Always visible — shows count 0 when no similar groups exist.
 */
export function SimilarInline() {
  const count = useStoreSelector((s) => s.similarGroups.length);
  useStoreSelector((s) => s.localeTick);

  const handleClick = async () => {
    if (count === 0) return;
    const { showDedupModal } = await import('../pro-features');
    showDedupModal();
  };

  return (
    <span class="similar-inline">
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
  const text =
    selectedSize > 0
      ? t('toolbar_download_selected', { count: selectedSize })
      : t('toolbar_download_all') + (filteredCount > 0 ? ` (${filteredCount})` : '');
  return <span id="download-label">{text}</span>;
}
