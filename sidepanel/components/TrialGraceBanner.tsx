// Banner shown during the 3-day post-trial grace window.
//
// The CTA used to open the in-panel ProUpgradeModal. For someone who has
// just spent 7 days inside the product, that modal's job (explain what Pro
// is) is already done; its win-back branch then sends them to the pricing
// page anyway, making the website a two-click destination. Going straight
// there removes a click and, via trigger=trial_expired, gives the website
// funnel a segment that can be measured on its own.

import { useEffect } from 'preact/hooks';
import { pricingPageUrl } from '../../shared/constants';
import { t } from '../../shared/i18n';
import { track } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { maybeReportTrialGraceBanner } from '../../shared/trial';
import { useStoreSelector } from './storeHook';

export function TrialGraceBanner() {
  const inGrace = useStoreSelector((s) => s.inTrialGracePeriod);
  const daysLeft = useStoreSelector((s) => s.trialGraceDaysRemaining);

  // Impression telemetry, throttled to once/day/install inside
  // maybeReportTrialGraceBanner — the banner is persistent UI for the
  // whole grace window, so an unthrottled event would count panel opens.
  useEffect(() => {
    if (!inGrace) return;
    void maybeReportTrialGraceBanner(daysLeft);
  }, [inGrace, daysLeft]);

  if (!inGrace) return null;

  const handleUpgrade = () => {
    void track(EVENTS.TRIAL_GRACE_CTA_CLICKED);
    chrome.tabs.create({ url: pricingPageUrl('trial_expired') });
  };

  return (
    <div class="trial-grace-banner">
      <span class="trial-grace-text">{t('trial_grace_message', { days: String(daysLeft) })}</span>
      <button class="btn btn-small btn-primary trial-grace-btn" onClick={handleUpgrade}>
        {t('trial_grace_upgrade_btn')}
      </button>
    </div>
  );
}
