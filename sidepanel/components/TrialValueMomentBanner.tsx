import { t } from '../../shared/i18n';
import { getFreeLimits } from '../../shared/constants';
import { track } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { state } from '../state';
import { useStoreSelector } from './storeHook';

/**
 * Trial value-moment banner (B-plan, 2026-09-28).
 *
 * Rendered right after a trial user completes a ≥50-image batch download —
 * the strongest "moment of delight" in the whole product. Non-blocking:
 * a single amber line ("Downloaded N images · X days left") with a Pro
 * anchor button. Cleared on tab switch together with toasts.
 *
 * Impression telemetry (TRIAL_VALUE_MOMENT_SHOWN) is fired by the trigger
 * in actions.ts, NOT here — the banner has no mount/effect lifecycle of its
 * own (unlike TrialGraceBanner), so the trigger site is the accurate
 * "actually shown" moment. Daily-capped since 2026-10-13 by
 * claimTrialValueMomentToday (one impression per UTC day) after a trial
 * user triggered the banner 20+ times in one day via ~1000-image batches.
 *
 * Variant 'first_scan' (Phase 1) reuses the same slot for the one-shot echo
 * after the first successful scan: same promise (you are on Pro, here is how
 * long it lasts), but it names the free floor while the results are on
 * screen. Fired once per install from scan.ts.
 */
export function TrialValueMomentBanner() {
  const moment = useStoreSelector((s) => s.trialValueMoment);

  if (!moment) return null;

  const isFirstScan = moment.variant === 'first_scan';

  const handleUpgrade = () => {
    if (isFirstScan) {
      void track(EVENTS.TRIAL_FIRST_SCAN_CTA_CLICKED, {
        count: moment.count,
        daysRemaining: moment.daysRemaining,
      });
    } else {
      void track(EVENTS.TRIAL_VALUE_MOMENT_CTA_CLICKED, {
        count: moment.count,
        daysRemaining: moment.daysRemaining,
      });
    }
    state.proUpgradeModalState = { open: true, errorText: '' };
  };

  // Note: the trigger sites own the claimed/shown telemetry and the one-shot
  // gating, so this component stays a pure render of whatever state holds.
  const message = isFirstScan
    ? t('trial_first_scan_message', {
        count: moment.count,
        days: moment.daysRemaining,
        zip: getFreeLimits().MAX_ZIP_IMAGES,
      })
    : t('trial_value_moment_message', {
        count: moment.count,
        days: moment.daysRemaining,
      });

  return (
    <div class="trial-value-moment-banner">
      <span class="trial-value-moment-text">{message}</span>
      <button class="btn btn-small btn-primary trial-value-moment-btn" onClick={handleUpgrade}>
        {isFirstScan ? t('trial_first_scan_cta') : t('trial_grace_upgrade_btn')}
      </button>
    </div>
  );
}
