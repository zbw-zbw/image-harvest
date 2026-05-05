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
import { useStoreSelector } from './storeHook';

/** Toolbar label: "Found N images". */
export function FoundActionCount() {
  const count = useStoreSelector((s) => s.filteredImages.length);
  return <span id="found-action-count">{count}</span>;
}

/** Toolbar dedup button label: "N Similar". */
export function SimilarCount() {
  const count = useStoreSelector((s) => s.similarGroups.length);
  return <span id="similar-count">{count}</span>;
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
  const text = selectedSize > 0 ? `Download (${selectedSize})` : 'Download All';
  return <span id="download-label">{text}</span>;
}
