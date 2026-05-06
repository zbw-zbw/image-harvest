// Rating prompt modal — Sprint 3.6.
//
// A small overlay modal that asks the user to leave a 5-star review on
// the Chrome Web Store after they've accumulated enough successful
// downloads (RATING_PROMPT_THRESHOLD). Counterpart of SoftPaywallBanner
// but with stricter framing:
//   - Modal (not banner) because the click-through to the store is the
//     entire point — we want explicit attention, not peripheral nudging.
//   - 3 CTAs: "Rate now" (primary), "Maybe later" (cooldown), "Don't
//     ask again" (resolved). Both "Rate now" and "Don't ask again"
//     mark resolved=true; "Maybe later" only starts the cooldown.
//
// Visibility decision is made once per mount via shouldShowRatingPrompt().
// Pro users are NOT exempted (a happy Pro user is exactly who we want
// reviewing the listing); the gate is purely behavioral.
import { useEffect, useState } from 'preact/hooks';
import {
  markRatingPromptDismissed,
  markRatingPromptResolved,
  markRatingPromptShown,
  shouldShowRatingPrompt,
} from '../../shared/rating-prompt-state';
import { t } from '../../shared/i18n';

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await shouldShowRatingPrompt();
      if (cancelled || !ok) return;
      await markRatingPromptShown();
      setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleRateNow(): void {
    // Open in a new tab. We use window.open rather than chrome.tabs.create
    // so the modal works in any context (sidepanel + popup) without
    // permission gymnastics. The browser will navigate to the store
    // listing's reviews tab; we mark resolved synchronously so a fast
    // re-open won't show the modal again.
    void markRatingPromptResolved();
    window.open(CHROME_STORE_REVIEW_URL, '_blank', 'noopener,noreferrer');
    setVisible(false);
  }

  function handleLater(): void {
    void markRatingPromptDismissed();
    setVisible(false);
  }

  function handleNever(): void {
    void markRatingPromptResolved();
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

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
          {t('rating_title')}
        </h2>
        <p class="rating-prompt-desc">{t('rating_desc')}</p>

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
      </div>
    </div>
  );
}
