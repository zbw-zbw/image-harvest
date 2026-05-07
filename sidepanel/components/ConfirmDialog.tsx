// Confirm dialog. Replaces the imperative `showConfirmDialog` that bound
// click listeners to static DOM nodes. The new design:
//   - showConfirmDialog() pushes ({ config, resolve }) into store
//   - <ConfirmDialog> reads state.confirmDialog and renders the active prompt
//   - Confirm/Cancel/overlay clicks call the stored resolve() and clear state
//
// Returning a Promise is preserved so existing call sites (await
// showConfirmDialog({...})) keep working unchanged.
import { useStoreSelector } from './storeHook';
import { state, type ConfirmDialogType } from '../state';
import { t } from '../../shared/i18n';

// SVG icons reused from the original ui.ts. Kept inline so the component
// has no external file dependency and the icons match the surrounding
// `confirm-dialog-icon` styling exactly.
const ICONS: Record<ConfirmDialogType, preact.VNode> = {
  warning: (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  danger: (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  info: (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

const ICON_CLASS: Record<ConfirmDialogType, string> = {
  warning: 'icon-warning',
  danger: 'icon-danger',
  info: 'icon-info',
};

/**
 * Resolve the active dialog with `result`, then clear the store entry so the
 * modal hides via the visibility binding below.
 */
function resolveDialog(result: boolean): void {
  const cur = state.confirmDialog;
  cur.resolve?.(result);
  state.confirmDialog = { open: false, config: null, resolve: null };
}

export function ConfirmDialog() {
  const dlg = useStoreSelector((s) => s.confirmDialog);
  const isPopup = useStoreSelector((s) => s.isPopupMode);
  const cfg = dlg.config;
  // We always render the shell so the close-anim CSS has something to animate.
  // When `cfg` is null we just stamp empty text — the modal is hidden anyway.
  const type: ConfirmDialogType = cfg?.type ?? 'warning';
  const confirmClass = type === 'danger' ? 'btn btn-danger' : 'btn btn-primary';
  return (
    <div id="confirm-dialog" class={`modal${dlg.open ? '' : ' hidden'}`}>
      <div class="modal-overlay" onClick={() => resolveDialog(false)} />
      <div class="modal-content confirm-dialog-content">
        {!isPopup && (
          <button
            id="btn-confirm-dialog-close"
            class="icon-btn confirm-dialog-close-btn"
            title={t('common_close')}
            onClick={() => resolveDialog(false)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
        <div class="confirm-dialog-body">
          <div id="confirm-dialog-icon" class={`confirm-dialog-icon ${ICON_CLASS[type]}`}>
            {ICONS[type]}
          </div>
          <h3 id="confirm-dialog-title" class="confirm-dialog-title">
            {cfg?.title ?? ''}
          </h3>
          <p id="confirm-dialog-message" class="confirm-dialog-message">
            {cfg?.message ?? ''}
          </p>
        </div>
        <div class="modal-footer">
          <button
            id="confirm-dialog-cancel"
            class="btn btn-secondary"
            onClick={() => resolveDialog(false)}
          >
            {cfg?.cancelText ?? t('common_cancel')}
          </button>
          <button
            id="confirm-dialog-confirm"
            class={confirmClass}
            onClick={() => resolveDialog(true)}
          >
            {cfg?.confirmText ?? t('common_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
