import { t } from '../../shared/i18n';
import { state } from '../state';
import { useStoreSelector } from './storeHook';

export function TrialGraceBanner() {
  const inGrace = useStoreSelector((s) => s.inTrialGracePeriod);
  const daysLeft = useStoreSelector((s) => s.trialGraceDaysRemaining);

  if (!inGrace) return null;

  const handleUpgrade = () => {
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
