import { t } from '../../shared/i18n';
import { getFreeLimits, pricingPageUrl } from '../../shared/constants';
import { track } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { proFeatureLabelKey } from '../../shared/trial-pro-usage';
import { state } from '../state';
import { useStoreSelector } from './storeHook';

/** The panel is narrow; three chips is the readable ceiling. */
const MAX_RECAP_FEATURES = 3;

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
 *   ended      First panel open after the 3-day grace window, once per
 *              install (2026-11). Reopens the conversation for a cohort the
 *              grace banner drops silently: what they used, what it costs
 *              now, and where to pay — one click instead of a modal detour.
 *   weekly     Long-expired trials (Phase 2, 2026-11). The ended notice is
 *              one-shot inside days 3-33 after expiry; past that the panel
 *              used to go silent forever. At most four reminders, one per
 *              week, only on panel open.
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
      case 'ended':
        // Straight to pricing, like TrialGraceBanner: someone who has already
        // spent the trial inside the product does not need the modal's "what
        // is Pro" pitch, and trigger=trial_ended gives the website funnel its
        // own segment.
        void track(EVENTS.TRIAL_ENDED_NOTICE_CTA_CLICKED, {
          daysSinceExpiry: moment.daysSinceExpiry,
          count: moment.count,
        });
        chrome.tabs.create({ url: pricingPageUrl('trial_ended') });
        return;
      case 'weekly':
        // Same reasoning as 'ended': a returning expired trial user gets the
        // price, not the pitch. The trigger keeps weekly win-backs separable
        // from the one-shot post-grace notice in the website funnel.
        void track(EVENTS.TRIAL_WEEKLY_WINBACK_CTA_CLICKED, {
          week: moment.week,
          count: moment.count,
        });
        chrome.tabs.create({ url: pricingPageUrl('trial_weekly') });
        return;
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
  } else if (moment.variant === 'ended') {
    message = t('trial_ended_notice_message');
    cta = t('trial_ended_notice_cta');
  } else if (moment.variant === 'weekly') {
    message = t('trial_weekly_winback_message', {
      count: moment.count,
      zip: getFreeLimits().MAX_ZIP_IMAGES,
    });
    cta = t('trial_weekly_winback_cta');
  } else {
    message = t('trial_value_moment_message', {
      count: moment.count,
      days: moment.daysRemaining,
    });
    cta = t('trial_grace_upgrade_btn');
  }

  // Recaps, the post-grace notice and the weekly win-back all name what the
  // user actually used and what keeping it costs; batch/first_scan do not.
  const showsUsage =
    moment.variant === 'recap' || moment.variant === 'ended' || moment.variant === 'weekly';

  return (
    <div class="trial-value-moment-banner">
      <span class="trial-value-moment-text">
        {message}
        {showsUsage && moment.features.length > 0 && (
          <span class="trial-recap-features">
            <span class="trial-recap-features-label">{t('trial_recap_features')}</span>
            {moment.features.slice(0, MAX_RECAP_FEATURES).map((feature) => (
              <span class="trial-recap-chip" key={feature}>
                {t(proFeatureLabelKey(feature))}
              </span>
            ))}
          </span>
        )}
        {showsUsage && <span class="trial-recap-anchor">{t('trial_recap_anchor')}</span>}
      </span>
      <button class="btn btn-small btn-primary trial-value-moment-btn" onClick={handleUpgrade}>
        {cta}
      </button>
    </div>
  );
}
