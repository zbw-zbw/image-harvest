// Scan progress overlay — replaces the imperative show/hide/update logic
// previously living in sidepanel/scan.ts (showScanOverlay / hideScanOverlay /
// updateScanProgress). State now flows through `state.scanProgress`; this
// component projects every field into the DOM declaratively.
//
// Cancel button still uses the legacy `#btn-scan-cancel` id because the
// click handler is bound in init.ts — Preact rendering doesn't change which
// DOM id receives the click.
import { useStoreSelector } from './storeHook';
import { t } from '../../shared/i18n';

export function ScanProgressOverlay() {
  const sp = useStoreSelector((s) => s.scanProgress);
  const percent = sp.total > 0 ? Math.round((sp.current / sp.total) * 100) : 0;
  const text =
    sp.total === 0
      ? t('scan_discovering')
      : t('scan_progress_text', { current: sp.current, total: sp.total });
  // The progress bar is hidden during the indeterminate "discovery" phase;
  // the spinner is sufficient signal that work is happening.
  const barClass = `progress-bar${sp.indeterminate ? ' hidden' : ''}`;
  return (
    <div id="scan-overlay" class={`scan-overlay${sp.visible ? '' : ' hidden'}`}>
      <div class="scan-overlay-float">
        <div class="scan-overlay-content">
          <button id="btn-scan-cancel" class="icon-btn scan-cancel-btn" title={t('scan_cancel')}>
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
          <div class="progress-spinner" />
          <h3 id="scan-progress-title">{sp.title}</h3>
          <div class={barClass}>
            <div id="scan-progress-fill" class="progress-fill" style={`width:${percent}%`} />
          </div>
          <p id="scan-progress-text">{text}</p>
          <p id="scan-progress-current" class="progress-current" title={sp.currentUrl}>
            {/* &nbsp; placeholder keeps the line height when no URL is active. */}
            {sp.currentUrl || '\u00A0'}
          </p>
        </div>
      </div>
    </div>
  );
}
