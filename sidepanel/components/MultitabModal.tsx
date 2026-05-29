// Multi-Tab Extract modal shell. The tab list (#multitab-list) and the
// extraction-progress strip in the footer remain imperatively rendered by
// pro-features.ts > loadTabList / startExtraction. The Preact component
// only owns the wrapper visibility and the static chrome.
import { useStoreSelector } from './storeHook';
import { state } from '../state';
import { t } from '../../shared/i18n';

function close(): void {
  state.multitabModalState = { open: false };
}

export function MultitabModal() {
  const open = useStoreSelector((s) => s.multitabModalState.open);
  return (
    <div id="multitab-modal" class={`modal${open ? '' : ' hidden'}`}>
      <div class="modal-overlay" onClick={close} />
      <div class="modal-content multitab-content">
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
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            {t('multitab_modal_title')}
          </h2>
          <button id="btn-multitab-close" class="icon-btn" onClick={close}>
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
        <div class="multitab-select-all-bar">
          {/* Click handler bound in init.ts; keep the id so it still hits. */}
          <button id="multitab-select-all" class="select-all-btn" title={t('toolbar_select_all')}>
            <span class="select-all-checkbox">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                class="check-icon hidden"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span class="select-all-text">{t('toolbar_select_all')}</span>
          </button>
        </div>
        <div class="modal-body">
          {/* Body slot — populated by pro-features.ts > loadTabList. */}
          <div id="multitab-list" class="multitab-list" />
        </div>
        <div class="modal-footer">
          <button id="btn-cancel-multitab" class="btn btn-secondary" onClick={close}>
            {t('common_cancel')}
          </button>
          <button id="btn-start-extraction" class="btn btn-primary">
            {t('multitab_start_extraction')}
            {!state.isProUser && (
              <span class="pro-badge pro-badge-mini" style={{ marginLeft: '6px' }}>
                PRO
              </span>
            )}
          </button>
          {/* Extraction progress strip — toggled by pro-features.ts via legacy
              classList. We render it static (always present) so the existing
              code can keep adding/removing the `hidden` class. */}
          <div id="extraction-progress" class="extraction-progress hidden">
            <div class="progress-bar">
              <div id="extraction-fill" class="progress-fill" />
            </div>
            <span id="extraction-text">{t('multitab_progress_default')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
