// Toolbar "Copy URLs" button — Sprint 3.4.
//
// Single-source-of-truth for the batch-copy CTA. Renders into the legacy
// `#batch-url-copy-mount` slot in pages/_shared-body.html (toolbar row 2,
// next to "Select all"). Subscribes to:
//   - state.selectedImages.size  → enables/disables the button + label
//   - state.filteredImages       → derives "fallback" count when nothing
//                                  is selected (mirrors Download All UX)
//
// Click → sidepanel/actions.copyImageUrls(urls). The actions module owns
// the Pro guard + telemetry + clipboard write so this component stays
// purely presentational.
//
// Why a Preact component rather than imperative DOM bind in init.ts? The
// label needs to react to selection changes ("Copy URLs" → "Copy 12 URLs"
// → disabled when 0). Doing that imperatively meant another listener
// added to the already-busy updateSelectionUI() in actions.ts; a tiny
// component subscribed via useStoreSelector is both shorter and more
// maintainable.
import { copyImageUrls, getSelectedOrFilteredUrls } from '../actions';
import { t } from '../../shared/i18n';
import { useStoreSelector } from './storeHook';

function IconCopy() {
  // Same SVG as the per-card copy-url button (sidepanel/components/icons),
  // inlined here so this component has no internal dependency tree beyond
  // Preact + the store. Keeps the button render fast on every selection
  // change.
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
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function BatchUrlCopyButton() {
  // Selected count drives both the label and the disabled state. We read
  // .size rather than the Set itself so reference-stable mutations
  // (selectedImages.add / .delete in place) still trigger re-renders —
  // the store's notifySelectors fires after every assignment.
  const selectedSize = useStoreSelector((s) => s.selectedImages.size);
  const filteredCount = useStoreSelector((s) => s.filteredImages.length);

  // Effective copy count: prefer selection, fall back to all-filtered.
  // Matches the Download All / Download Selected dual-purpose behavior so
  // users don't have to learn two different selection models.
  const effectiveCount = selectedSize > 0 ? selectedSize : filteredCount;
  const disabled = effectiveCount === 0;

  // Label collapses to icon-only when nothing is available (consistent
  // with how the Download button greys out below the toolbar). When at
  // least one image is available, surface the count so users can verify
  // BEFORE clicking that they're about to copy what they expect.
  const label =
    selectedSize > 0
      ? t('toolbar.copy_urls') + ` (${selectedSize})`
      : t('toolbar.copy_urls');

  const title = disabled ? t('toolbar.copy_urls.empty') : t('toolbar.copy_urls.tooltip');

  function handleClick(): void {
    if (disabled) return;
    const urls = getSelectedOrFilteredUrls();
    void copyImageUrls(urls);
  }

  return (
    <button
      id="btn-batch-copy-urls"
      class="select-all-btn batch-url-copy-btn"
      type="button"
      title={title}
      disabled={disabled}
      onClick={handleClick}
    >
      <span class="select-all-checkbox">
        <IconCopy />
      </span>
      <span class="select-all-text">{label}</span>
    </button>
  );
}
