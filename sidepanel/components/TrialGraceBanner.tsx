import { useEffect } from 'preact/hooks';
import { t } from '../../shared/i18n';
import { track } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { maybeReportTrialGraceBanner } from '../../shared/trial';
import { state } from '../state';
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
    state.proUpgradeModalState = { open: true, errorText: '' };
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
