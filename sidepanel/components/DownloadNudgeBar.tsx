// Download nudge bar — 2026-10-13 growth experiment #1.
//
// The full-funnel audit (1070 installs) found the sharpest break in the
// core funnel: 71% scan but only 29% ever download — 455 installs saw a
// median of 42 images and still never saved one. Part discoverability:
// the ONLY download button is a btn-small in the footer status bar, far
// below the fold of a full image grid. This bar closes that gap with a
// prominent "N images ready to download" strip + primary CTA right above
// the grid, shown whenever a scan's results are on screen.
//
// Visibility is fully derived from the store (no local state):
//   images on screen, not mid-scan, and not yet acted on this session.
// `state.downloadNudgeDismissed` flips true after a successful batch
// download (actions.ts) or an explicit close, and resets at the start of
// every visible scan (scan.ts) and on tab switch (tab-lifecycle.ts).
//
// The CTA downloads ALL filtered images — selection-free by design: the
// never-downloaded cohort's median is 42 images; requiring a select-all
// first adds a step between intent and action. Free users above the zip
// limit hit the existing batch_zip wall via downloadSelectedAsZip.
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../../shared/i18n';
import { track } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { state } from '../state';
import { useStoreSelector } from './storeHook';
import { downloadSelectedAsZip } from '../actions';

export function DownloadNudgeBar() {
  const count = useStoreSelector((s) => s.filteredImages.length);
  const visible = useStoreSelector(
    (s) =>
      s.uiScreen === 'images' &&
      s.filteredImages.length > 0 &&
      !s.downloadNudgeDismissed &&
      !s.isFetching &&
      !s.isScanning &&
      !s.isDeepScanning
  );

  // Impression telemetry: once per panel session. The bar re-appears after
  // every scan and tab switch, so per-appearance tracking would measure
  // panel opens, not reach — same lesson as the trial banners.
  const reported = useRef(false);
  useEffect(() => {
    if (visible && !reported.current) {
      reported.current = true;
      void track(EVENTS.DOWNLOAD_NUDGE_SHOWN, { count });
    }
  }, [visible, count]);

  if (!visible) return null;

  function handleDownload(): void {
    void track(EVENTS.DOWNLOAD_NUDGE_CTA_CLICKED, { count });
    // Target format null = keep original formats; passing the images
    // directly bypasses the selection so this is genuinely "all of them".
    void downloadSelectedAsZip(null, state.filteredImages);
  }

  function handleClose(): void {
    state.downloadNudgeDismissed = true;
    void track(EVENTS.DOWNLOAD_NUDGE_DISMISSED, { count });
  }

  return (
    <div id="download-nudge-bar" class="download-nudge-bar" role="region">
      <span class="download-nudge-icon" aria-hidden="true">
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
      </span>
      <span class="download-nudge-text">
        {t('nudge_download_message', { count: String(count) })}
      </span>
      <button
        id="btn-download-nudge"
        type="button"
        class="btn btn-primary btn-small download-nudge-btn"
        onClick={handleDownload}
      >
        {t('nudge_download_cta')}
      </button>
      <button
        type="button"
        class="download-nudge-close icon-btn"
        title={t('common_dismiss')}
        aria-label={t('common_dismiss')}
        onClick={handleClose}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
