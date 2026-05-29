// Collection modal shell. Inner #collection-body is populated by
// pro-features.ts > loadCollection. The toolbar's search input + export
// button keep their original ids so existing event bindings in init.ts and
// pro-features.ts > showCollectionModal continue to work.
import { useStoreSelector } from './storeHook';
import { state } from '../state';
import { t } from '../../shared/i18n';

function close(): void {
  state.collectionModalState = { open: false };
}

export function CollectionModal() {
  const open = useStoreSelector((s) => s.collectionModalState.open);
  return (
    <div id="collection-modal" class={`modal${open ? '' : ' hidden'}`}>
      <div class="modal-overlay" onClick={close} />
      <div class="modal-content collection-content">
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
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {t('collection_modal_title')}
          </h2>
          <div class="modal-header-actions">
            <button
              id="btn-collection-back"
              class="icon-btn"
              title={t('common_close')}
              onClick={close}
            >
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
        </div>
        <div class="collection-toolbar">
          <input
            type="text"
            id="collection-search"
            placeholder={t('collection_search_placeholder')}
            class="collection-search-input"
          />
          <button
            id="btn-collection-export"
            class="icon-btn"
            title={t('collection_export_tooltip')}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          {/* Body slot — populated by pro-features.ts > loadCollection. */}
          <div id="collection-body" class="collection-body" />
        </div>
      </div>
    </div>
  );
}
