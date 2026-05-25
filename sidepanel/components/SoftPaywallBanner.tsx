// Soft paywall banner — the gentle counterpart to ProUpgradeModal.
//
// Appears at the top of the sidepanel ONCE the user has accumulated enough
// successful downloads (SOFT_PAYWALL_THRESHOLD), and only when the
// shouldShowBanner() gate in shared/paywall-state.ts returns true. The
// banner is non-blocking (no overlay), occupies its own row above the
// toolbar, and offers two CTAs:
//   - If trial-eligible: Primary "Try Pro Free" — opens the upgrade modal.
//   - If trial-ineligible (already used trial): Primary "Upgrade Now" — opens
//     the upgrade modal with purchase-focused messaging.
//   - Secondary "Maybe later" — dismiss + start the cooldown window.
//
// The banner state (visible / hidden) lives in this component as a useState
// hook because it's purely transient UI and never read by anyone else.
// Persistent decisions go through shared/paywall-state.ts.
import { useEffect, useState } from 'preact/hooks';
import { markDismissed, markShown, shouldShowBanner } from '../../shared/paywall-state';
import { state } from '../state';
import { track } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { t } from '../../shared/i18n';
import { isTrialEligible } from '../../shared/trial';

/**
 * Open the Pro upgrade modal. We DO NOT call markResolved() here — the
 * user might still abandon the modal without converting. resolved is set
 * only when a trial actually starts or a license activates (handled by
 * trial.ts and license.ts respectively, both of which mark the soft
 * paywall resolved on success).
 */
function openUpgradeModal(): void {
  state.proUpgradeModalState = { open: true, errorText: '' };
  void track(EVENTS.SOFT_PAYWALL_DISMISSED, { action: 'trial' });
}

export function SoftPaywallBanner() {
  const [visible, setVisible] = useState(false);
  const [trialEligible, setTrialEligible] = useState(false);

  // Decide visibility and trial eligibility once per mount. The decisions
  // are async (chrome.storage round-trips) so we render hidden first and
  // pop in afterward — visually identical to "no banner" for users who
  // don't qualify.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Pro users never see the soft paywall. Reading state.isProUser
      // here (rather than subscribing to it) is intentional: the soft
      // paywall is a one-shot decision at panel open time, not a live
      // reaction to plan changes mid-session.
      if (state.isProUser) return;
      const ok = await shouldShowBanner();
      if (cancelled || !ok) return;
      const eligible = await isTrialEligible();
      if (cancelled) return;
      setTrialEligible(eligible);
      await markShown();
      void track(EVENTS.SOFT_PAYWALL_SHOWN);
      setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleDismiss(): void {
    void markDismissed();
    void track(EVENTS.SOFT_PAYWALL_DISMISSED, { action: 'later' });
    setVisible(false);
  }

  function handleClose(): void {
    void markDismissed();
    void track(EVENTS.SOFT_PAYWALL_DISMISSED, { action: 'close' });
    setVisible(false);
  }

  function handleTry(): void {
    openUpgradeModal();
    setVisible(false);
  }

  if (!visible) return null;

  const ctaKey = trialEligible ? 'paywall_banner_try_cta' : 'paywall_banner_upgrade_cta';
  const descKey = trialEligible ? 'paywall_banner_desc' : 'paywall_banner_upgrade_desc';

  return (
    <div
      id="soft-paywall-banner"
      class={`soft-paywall-banner${trialEligible ? '' : ' soft-paywall-banner--upgrade'}`}
      role="region"
      aria-label="Pro upgrade suggestion"
    >
      <div class="soft-paywall-banner-icon" aria-hidden="true">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
          <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
          <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
          <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
        </svg>
      </div>
      <div class="soft-paywall-banner-text">
        <strong>{t('paywall_banner_title')}</strong>
        <span>{t(descKey)}</span>
      </div>
      <div class="soft-paywall-banner-actions">
        <button
          id="btn-soft-paywall-try"
          type="button"
          class={`btn btn-primary btn-sm${trialEligible ? '' : ' btn-upgrade-cta'}`}
          onClick={handleTry}
        >
          {t(ctaKey)}
        </button>
        <button
          id="btn-soft-paywall-later"
          type="button"
          class="btn btn-secondary btn-sm"
          onClick={handleDismiss}
        >
          {t('paywall_banner_later')}
        </button>
      </div>
      <button
        id="btn-soft-paywall-close"
        type="button"
        class="soft-paywall-banner-close icon-btn"
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
