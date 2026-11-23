import { t } from '../../shared/i18n';
import { getFreeLimits } from '../../shared/constants';
import { track } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { state } from '../state';
import { useStoreSelector } from './storeHook';

/**
 * Trial value-moment banner (B-plan, 2026-09-28).
 *
 * One slot, three promises:
 *
 *   batch      A trial user just completed a ≥50-image batch download — the
 *              strongest "moment of delight" in the product. Daily-capped
 *              (claimTrialValueMomentToday) since 2026-10-13: a heavy
 *              harvester was triggering it 20+ times a day.
 *   first_scan One-shot echo after the first successful scan. The install
 *              page promised 7 days of Pro; this is where the promise meets
 *              actual images on screen, so it names the free floor.
 *   recap      Day 3 / 5 / 7 of the trial. Between the install page and the
 *              3-day expiry warning there was previously no signal at all,
 *              so the trial could lapse without the user ever noticing what
 *              they had. One impression per milestone, and the last one
 *              carries the annual anchor ($29.99/yr = $2.49/mo).
 *
 * Impression telemetry is fired by each trigger site, not here: this
 * component has no mount/effect lifecycle of its own (unlike
 * TrialGraceBanner), so the trigger is the accurate "actually shown" moment.
 * Keeping it a pure render also means a failed t() lookup can never cost a
 * telemetry event.
 */
export function TrialValueMomentBanner() {
  const moment = useStoreSelector((s) => s.trialValueMoment);

  if (!moment) return null;

  const handleUpgrade = () => {
    switch (moment.variant) {
      case 'first_scan':
        void track(EVENTS.TRIAL_FIRST_SCAN_CTA_CLICKED, {
          count: moment.count,
          daysRemaining: moment.daysRemaining,
        });
        break;
      case 'recap':
        void track(EVENTS.TRIAL_RECAP_CTA_CLICKED, {
          day: moment.day,
          count: moment.count,
          daysRemaining: moment.daysRemaining,
        });
        break;
      default:
        void track(EVENTS.TRIAL_VALUE_MOMENT_CTA_CLICKED, {
          count: moment.count,
          daysRemaining: moment.daysRemaining,
        });
    }
    state.proUpgradeModalState = { open: true, errorText: '' };
  };

  let message: string;
  let cta: string;
  if (moment.variant === 'first_scan') {
    message = t('trial_first_scan_message', {
      count: moment.count,
      days: moment.daysRemaining,
      zip: getFreeLimits().MAX_ZIP_IMAGES,
    });
    cta = t('trial_first_scan_cta');
  } else if (moment.variant === 'recap') {
    message = t('trial_recap_message', {
      day: moment.day,
      count: moment.count,
      days: moment.daysRemaining,
    });
    cta = t('trial_recap_cta');
  } else {
    message = t('trial_value_moment_message', {
      count: moment.count,
      days: moment.daysRemaining,
    });
    cta = t('trial_grace_upgrade_btn');
  }

  return (
    <div class="trial-value-moment-banner">
      <span class="trial-value-moment-text">
        {message}
        {moment.variant === 'recap' && (
          <span class="trial-recap-anchor">{t('trial_recap_anchor')}</span>
        )}
      </span>
      <button class="btn btn-small btn-primary trial-value-moment-btn" onClick={handleUpgrade}>
        {cta}
      </button>
    </div>
  );
}
