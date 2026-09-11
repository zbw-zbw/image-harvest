// NoticeStrip — the single 26px hint row at the top of the sidepanel (v1.2
// redesign). Consolidates three legacy banners into ONE always-26px slot:
//
//   priority 1: trial-grace  (post-expiry conversion window — time-boxed)
//   priority 2: soft-paywall (download-threshold upsell)
//   priority 3: referral     (share-to-earn growth)
//
// Only the highest-priority ELIGIBLE notice renders; the others wait.
// The ✕ dismisses THAT notice for 24h (per-type localStorage timestamp) —
// the next-priority notice may take the row on the next eligibility check.
// Pro users see nothing.
//
// Legacy DOM ids kept for tests & continuity:
//   #soft-paywall-banner, #btn-soft-paywall-try, #btn-soft-paywall-close.
// The old "Maybe later" button is gone — the ✕ is the dismissal path now.
import { useCallback, useEffect, useState } from 'preact/hooks';
import { t } from '../../shared/i18n';
import { track } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { markDismissed, markShown, shouldShowBanner } from '../../shared/paywall-state';
import { isTrialEligible, maybeReportTrialGraceBanner } from '../../shared/trial';
import { state } from '../state';
import { showToast } from '../ui';
import { useStoreSelector } from './storeHook';

/** Which source currently owns the strip. */
type NoticeKind = 'trial-grace' | 'paywall' | 'referral';

const DISMISS_MS = 24 * 60 * 60 * 1000; // 24h
const dismissKey = (kind: NoticeKind) => `notice_dismissed_${kind.replace('-', '_')}`;

function isDismissed(kind: NoticeKind): boolean {
  try {
    const raw = localStorage.getItem(dismissKey(kind));
    if (!raw) return false;
    return Date.now() - parseInt(raw, 10) < DISMISS_MS;
  } catch {
    return false;
  }
}

/** 12px inline stroke icon — clock for grace, rocket for paywall, gift for referral. */
function StripIcon({ kind }: { kind: NoticeKind }) {
  if (kind === 'trial-grace') {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  if (kind === 'paywall') {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      </svg>
    );
  }
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <polyline points="20 12 20 22 4 22 4 12" />
      <rect x="2" y="7" width="20" height="5" />
      <line x1="12" y1="22" x2="12" y2="7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </svg>
  );
}

export function NoticeStrip() {
  const isPro = useStoreSelector((s) => s.isProUser);
  const inGrace = useStoreSelector((s) => s.inTrialGracePeriod);
  const daysLeft = useStoreSelector((s) => s.trialGraceDaysRemaining);
  useStoreSelector((s) => s.localeTick); // re-render on locale switch

  const [paywallEligible, setPaywallEligible] = useState(false);
  const [trialEligible, setTrialEligible] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Paywall eligibility is a one-shot async decision at panel-open time
  // (chrome.storage round-trips) — same contract as the legacy banner.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (state.isProUser) return;
      if (!(await shouldShowBanner())) return;
      const eligible = await isTrialEligible();
      // Persist the show BEFORE revealing the row: markShown/markDismissed
      // are unsynchronized read-modify-write cycles, so a dismissal racing
      // a still-in-flight markShown can have its dismissedAt overwritten
      // by markShown's save. Once the row is visible, markShown has already
      // landed — a dismiss can only write on top of a settled state.
      await markShown();
      if (cancelled) return;
      setTrialEligible(eligible);
      setPaywallEligible(true);
      void track(EVENTS.SOFT_PAYWALL_SHOWN);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Grace impression telemetry (once/day/install throttle inside helper).
  useEffect(() => {
    if (!inGrace) return;
    void maybeReportTrialGraceBanner(daysLeft);
  }, [inGrace, daysLeft]);

  // Priority resolution — first eligible & un-dismissed notice wins.
  let kind: NoticeKind | null = null;
  if (!isPro) {
    if (inGrace && !isDismissed('trial-grace')) kind = 'trial-grace';
    else if (paywallEligible && !isDismissed('paywall')) kind = 'paywall';
    else if (!isDismissed('referral')) kind = 'referral';
  }

  const handleDismiss = useCallback(() => {
    if (!kind) return;
    try {
      localStorage.setItem(dismissKey(kind), String(Date.now()));
    } catch {
      /* non-fatal */
    }
    if (kind === 'paywall') {
      void markDismissed();
      void track(EVENTS.SOFT_PAYWALL_DISMISSED, { action: 'close' });
    }
    setHidden(true);
  }, [kind]);

  const handleGraceUpgrade = () => {
    void track(EVENTS.TRIAL_GRACE_CTA_CLICKED);
    state.proUpgradeModalState = { open: true, errorText: '' };
  };

  const handlePaywallTry = () => {
    void track(EVENTS.SOFT_PAYWALL_CTA_CLICKED, { action: 'trial' });
    state.proUpgradeModalState = { open: true, errorText: '' };
  };

  const handleReferralCopy = async () => {
    const { copyReferralLink } = await import('../../shared/referral');
    await copyReferralLink();
    showToast(t('referral_link_copied'), 'success');
  };

  if (!kind || hidden) return null;

  const ctaKey =
    kind === 'trial-grace'
      ? 'trial_grace_upgrade_btn'
      : kind === 'paywall'
        ? trialEligible
          ? 'paywall_banner_try_cta'
          : 'paywall_banner_upgrade_cta'
        : 'referral_banner_copy';
  const textKey =
    kind === 'trial-grace'
      ? 'trial_grace_message'
      : kind === 'paywall'
        ? 'paywall_banner_title'
        : 'referral_banner_text';

  return (
    <div
      class={`notice-strip notice-strip--${kind}`}
      id={kind === 'paywall' ? 'soft-paywall-banner' : undefined}
      role="region"
    >
      <StripIcon kind={kind} />
      <span class="notice-strip-text">
        {t(textKey, kind === 'trial-grace' ? { days: String(daysLeft) } : undefined)}
      </span>
      <button
        type="button"
        class="btn btn-primary btn-sm notice-strip-cta"
        id={kind === 'paywall' ? 'btn-soft-paywall-try' : undefined}
        onClick={
          kind === 'trial-grace'
            ? handleGraceUpgrade
            : kind === 'paywall'
              ? handlePaywallTry
              : () => void handleReferralCopy()
        }
      >
        {t(ctaKey)}
      </button>
      <button
        type="button"
        class="notice-strip-close icon-btn"
        id={kind === 'paywall' ? 'btn-soft-paywall-close' : undefined}
        title={t('common_dismiss')}
        aria-label={t('common_dismiss')}
        onClick={handleDismiss}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
