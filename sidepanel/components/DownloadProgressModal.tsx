// Download progress modal — replaces showProgress / updateProgress /
// hideProgress in sidepanel/ui.ts. The modal markup differs slightly between
// popup and sidepanel modes (sidepanel has a modal-header + close button),
// so we render both variants and toggle based on `state.isPopupMode`.
//
// Close button keeps id `btn-progress-close` for the existing click handler
// in init.ts (it triggers the abort callback registered in showProgress).
import { useStoreSelector } from './storeHook';
import { t } from '../../shared/i18n';

export function DownloadProgressModal() {
  const dp = useStoreSelector((s) => s.downloadProgress);
  const isPopup = useStoreSelector((s) => s.isPopupMode);
  const percent = dp.total > 0 ? Math.round((dp.current / dp.total) * 100) : 0;
  // Multi-tab scans surface "X tabs · Y images found"; standard downloads
  // get the simpler "current / total" line.
  const text =
    dp.imageCount != null
      ? t('progress_multitab_text', { current: dp.current, total: dp.total, count: dp.imageCount })
      : t('progress_text', { current: dp.current, total: dp.total });
  return (
    <div id="progress-modal" class={`modal${dp.visible ? '' : ' hidden'}`}>
      <div class="modal-overlay" />
      <div class="modal-content progress-content">
        {!isPopup && (
          <div class="modal-header">
            <h2 id="progress-title">{dp.title}</h2>
            <button id="btn-progress-close" class="icon-btn" title={t('common_cancel')}>
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
        )}
        <div class="modal-body">
          <div class="progress-spinner" />
          {isPopup && <h3 id="progress-title">{dp.title}</h3>}
          <div class="progress-bar">
            <div id="progress-fill" class="progress-fill" style={`width:${percent}%`} />
          </div>
          <p id="progress-text">{text}</p>
          <p id="progress-current" class="progress-current">
            {dp.currentFile}
          </p>
        </div>
      </div>
    </div>
  );
}
