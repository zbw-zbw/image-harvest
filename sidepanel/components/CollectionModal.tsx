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
          <div class="collection-toolbar-actions">
            <button
              id="collection-select-all"
              class="select-all-btn"
              type="button"
              title={t('collection_select_all')}
            >
              <span class="select-all-checkbox">
                <svg
                  class="check-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span>{t('toolbar_select_all')}</span>
            </button>
            <span id="collection-count" class="collection-count" />
            <button
              id="btn-collection-batch-download"
              class="icon-btn collection-batch-btn"
              title={t('collection_batch_download')}
              disabled
            >
              <svg
                width="16"
                height="16"
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
            <button
              id="btn-collection-batch-delete"
              class="icon-btn collection-batch-btn collection-batch-delete"
              title={t('collection_batch_delete')}
              disabled
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
          <input
            type="text"
            id="collection-search"
            placeholder={t('collection_search_url_placeholder')}
            class="collection-search-input"
          />
        </div>
        <div class="modal-body">
          {/* Body slot — populated by pro-features.ts > loadCollection. */}
          <div id="collection-body" class="collection-body" />
        </div>
      </div>
    </div>
  );
}
