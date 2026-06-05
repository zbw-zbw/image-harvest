// Dedup (similar-image) modal shell. The inner `#dedup-body` is still
// populated imperatively by dedup-ui.ts > showDedupModal — we only
// take ownership of the visibility / overlay / header / footer here so
// closing/opening becomes a single store mutation.
//
// IMPORTANT: The `#dedup-body` slot is managed via a ref callback so that
// Preact never diffs or replaces its children. Without this, any re-render
// of DedupModal (e.g. from localeTick) would output an empty <div> and
// wipe whatever showDedupModal() wrote imperatively.
import { useRef } from 'preact/hooks';
import { useStoreSelector } from './storeHook';
import { state } from '../state';
import { t } from '../../shared/i18n';

function close(): void {
  state.dedupModalState = { open: false };
}

/**
 * Imperatively-managed body slot. We use a ref callback + a stable DOM
 * node that Preact never reconciles against so imperative innerHTML
 * writes survive re-renders.
 */
function DedupBodySlot() {
  const containerRef = useRef<HTMLDivElement>(null);
  // Return the container with dangerouslySetInnerHTML set to a single
  // nbsp — this tells Preact "I own this subtree" and prevents it from
  // ever diffing children. The real content is written by dedup-ui.ts.
  return (
    <div
      id="dedup-body"
      class="dedup-body"
      ref={containerRef}
      dangerouslySetInnerHTML={{ __html: '' }}
    />
  );
}

export function DedupModal() {
  const open = useStoreSelector((s) => s.dedupModalState.open);
  return (
    <div id="dedup-modal" class={`modal${open ? '' : ' hidden'}`}>
      <div class="modal-overlay" onClick={close} />
      <div class="modal-content dedup-content">
        <div class="modal-header">
          <h2>
            <svg
              class="modal-title-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="2" y="2" width="8" height="8" rx="1" />
              <rect x="14" y="2" width="8" height="8" rx="1" />
              <rect x="2" y="14" width="8" height="8" rx="1" />
              <rect x="14" y="14" width="8" height="8" rx="1" />
              <path d="M12 2v8M2 12h8M14 12h8M12 14v8" />
            </svg>
            {t('dedup_modal_title')}
          </h2>
          <button id="btn-dedup-close" class="icon-btn" onClick={close}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <DedupBodySlot />
        </div>
        <div class="modal-footer">
          <button id="btn-cancel-dedup" class="btn btn-secondary" onClick={close}>
            {t('common_cancel')}
          </button>
          {/* btn-remove-duplicates click handler is bound in init.ts > bindEvents.
              Keeping the same id ensures the existing binding still hits this node. */}
          <button id="btn-remove-duplicates" class="btn btn-primary">
            {t('dedup_remove_duplicates')} <span class="pro-badge pro-badge-mini">PRO</span>
          </button>
        </div>
      </div>
    </div>
  );
}
