import { t } from '../../shared/i18n';
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
 * in actions.ts, NOT here — the banner has no mount/effect lifecycle of
 * its own (unlike TrialGraceBanner), so the trigger site is the accurate
 * "actually shown" moment. NOT throttled: ≥50-image batches are rare.
 */
export function TrialValueMomentBanner() {
  const moment = useStoreSelector((s) => s.trialValueMoment);

  if (!moment) return null;

  const handleUpgrade = () => {
    void track(EVENTS.TRIAL_VALUE_MOMENT_CTA_CLICKED, {
      count: moment.count,
      daysRemaining: moment.daysRemaining,
    });
    state.proUpgradeModalState = { open: true, errorText: '' };
  };

  return (
    <div class="trial-value-moment-banner">
      <span class="trial-value-moment-text">
        {t('trial_value_moment_message', {
          count: String(moment.count),
          days: String(moment.daysRemaining),
        })}
      </span>
      <button class="btn btn-small btn-primary trial-value-moment-btn" onClick={handleUpgrade}>
        {t('trial_grace_upgrade_btn')}
      </button>
    </div>
  );
}
