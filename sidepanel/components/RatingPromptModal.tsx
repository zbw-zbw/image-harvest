// Rating prompt modal — Sprint 3.6, two-step since 2026-11-26.
//
// Step 1 asks a zero-cost sentiment question ("Works great" / "Needs
// work"); only thumbs-up advances to the store ask. Why: the 90d funnel
// (scripts/rating-funnel.ts in the backend repo) showed 202 installs
// shown the direct store ask → 62% "later", 17% "never", 4% "rate".
// The store ask is a big request mid-workflow; a one-click sentiment
// gate lowers the first-commitment cost and routes unhappy users to the
// feedback form instead of the store (protects the listing rating).
//   - thumbs-up -> step 2: stars + "Write a review" (resolved on click)
//   - thumbs-down -> feedback form + 14d cooldown (they may come around)
//   - "Maybe later" / X -> cooldown; "Don't ask again" -> resolved forever
//
// Visibility decision runs at mount AND again whenever state.ratingCheckTick
// bumps (a successful download just completed — the "moment of delight").
// Pro users are NOT exempted (a happy Pro user is exactly who we want
// reviewing the listing); the gate is purely behavioral.
//
// We defer the visibility check until the current scan has finished to
// avoid overlapping with the loading overlay.
import { useEffect, useState } from 'preact/hooks';
import {
  getRatingPromptState,
  markRatingPromptDismissed,
  markRatingPromptResolved,
  markRatingPromptShown,
  shouldShowRatingPrompt,
} from '../../shared/rating-prompt-state';
import { UNINSTALL_FEEDBACK_URL } from '../../shared/constants';
import { t } from '../../shared/i18n';
import { track } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { state } from '../state';
import { useStoreSelector } from './storeHook';

/**
 * Chrome Web Store reviews URL for our listing. Extracted as a constant
 * so updating the listing ID doesn't require a code search.
 *
 * Same listing ID used by the unrelated isRestrictedUrl test fixture —
 * keeping them in sync prevents the e2e from breaking when we relist.
 */
export const CHROME_STORE_REVIEW_URL =
  'https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo/reviews';

export function RatingPromptModal() {
  const [visible, setVisible] = useState(false);
  // Two-step flow: sentiment gate first, store ask only after thumbs-up.
  const [step, setStep] = useState<'sentiment' | 'store'>('sentiment');
  // Cumulative download count at prompt time — personalizes the copy
  // (2026-10-13 experiment #4: the audit showed CTA distribution
  // later 56 / never 12 / rate 3; the old beg-style copy gave the user
  // no concrete reason to engage. Grounding the ask in their own number
  // reframes it as feedback on work they actually did.)
  const [downloadCount, setDownloadCount] = useState(0);
  // Re-run the gate check when a download completes (see actions.ts).
  const ratingCheckTick = useStoreSelector((s) => s.ratingCheckTick);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Wait until the current scan is complete to avoid overlapping
      // with the loading overlay (skeleton cards, scan progress bar).
      // Poll state.isScanning and state.isFetching with a short delay.
      // Give up after 30s to avoid infinite polling if scan gets stuck.
      let waitMs = 0;
      while (!cancelled && (state.isScanning || state.isFetching) && waitMs < 30000) {
        await new Promise((r) => setTimeout(r, 300));
        waitMs += 300;
      }
      if (cancelled) return;

      const ok = await shouldShowRatingPrompt();
      if (cancelled || !ok) return;
      const rs = await getRatingPromptState();
      if (cancelled) return;
      setDownloadCount(rs.downloadCount);
      await markRatingPromptShown();
      // trigger distinguishes the "moment of delight" re-check (download)
      // from the legacy panel-open check so the funnel can compare their
      // CTA conversion rates.
      void track(EVENTS.RATING_PROMPT_SHOWN, {
        trigger: ratingCheckTick > 0 ? 'download' : 'mount',
      });
      setStep('sentiment');
      setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [ratingCheckTick]);

  function handleThumbsUp(): void {
    void track(EVENTS.RATING_PROMPT_SENTIMENT, { sentiment: 'up' });
    setStep('store');
  }

  function handleThumbsDown(): void {
    // Unhappy users go to the feedback form, never to the store. Cooldown
    // (not resolved) — a fix might win them back before the next arm.
    void track(EVENTS.RATING_PROMPT_SENTIMENT, { sentiment: 'down' });
    void markRatingPromptDismissed();
    window.open(UNINSTALL_FEEDBACK_URL, '_blank', 'noopener,noreferrer');
    setVisible(false);
  }

  function handleRateNow(): void {
    // Open in a new tab. We use window.open rather than chrome.tabs.create
    // so the modal works in any context (sidepanel + popup) without
    // permission gymnastics. The browser will navigate to the store
    // listing's reviews tab; we mark resolved synchronously so a fast
    // re-open won't show the modal again.
    void markRatingPromptResolved();
    void track(EVENTS.RATING_PROMPT_CTA, { action: 'rate' });
    window.open(CHROME_STORE_REVIEW_URL, '_blank', 'noopener,noreferrer');
    setVisible(false);
  }

  function handleLater(): void {
    void markRatingPromptDismissed();
    void track(EVENTS.RATING_PROMPT_CTA, { action: 'later' });
    setVisible(false);
  }

  function handleNever(): void {
    void markRatingPromptResolved();
    void track(EVENTS.RATING_PROMPT_CTA, { action: 'never' });
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      id="rating-prompt-modal"
      class="modal-overlay rating-prompt-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rating-prompt-title"
    >
      <div class="modal-content rating-prompt-content">
        <button
          type="button"
          class="modal-close icon-btn"
          aria-label={t('rating_close')}
          title={t('rating_close')}
          onClick={handleLater}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {step === 'sentiment' ? (
          <>
            <h2 id="rating-prompt-title" class="rating-prompt-title">
              {t('rating_title')}
            </h2>
            <p class="rating-prompt-desc">
              {t('rating_sentiment_desc', { count: String(downloadCount) })}
            </p>

            <div class="rating-prompt-actions">
              <button
                id="btn-rating-thumbs-up"
                type="button"
                class="btn btn-primary rating-prompt-thumb"
                onClick={handleThumbsUp}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                </svg>
                {t('rating_thumbs_up')}
              </button>
              <button
                id="btn-rating-thumbs-down"
                type="button"
                class="btn btn-secondary rating-prompt-thumb"
                onClick={handleThumbsDown}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
                </svg>
                {t('rating_thumbs_down')}
              </button>
              <button
                id="btn-rating-later"
                type="button"
                class="btn btn-text rating-prompt-never"
                onClick={handleLater}
              >
                {t('rating_later')}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* 5-star illustration — pure SVG so no asset dependency. */}
            <div class="rating-prompt-stars" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <svg
                  key={i}
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linejoin="round"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              ))}
            </div>

            <h2 id="rating-prompt-title" class="rating-prompt-title">
              {t('rating_step2_title')}
            </h2>
            <p class="rating-prompt-desc">{t('rating_step2_desc')}</p>

            <div class="rating-prompt-actions">
              <button
                id="btn-rating-rate-now"
                type="button"
                class="btn btn-primary"
                onClick={handleRateNow}
              >
                {t('rating_rate_now')}
              </button>
              <button
                id="btn-rating-later"
                type="button"
                class="btn btn-secondary"
                onClick={handleLater}
              >
                {t('rating_later')}
              </button>
              <button
                id="btn-rating-never"
                type="button"
                class="btn btn-text rating-prompt-never"
                onClick={handleNever}
              >
                {t('rating_never')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
