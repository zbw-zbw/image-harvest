// Pro-only "live monitoring is active" badge in the toolbar. Replaces the
// imperative `elements.liveIndicator.classList.toggle('hidden', ...)` path
// in sidepanel/settings.ts > updateLiveIndicator(). The component is mounted
// once during init and re-renders whenever its inputs change in the store.
import { useStoreSelector } from './storeHook';
import { t } from '../../shared/i18n';

export function LiveIndicator() {
  // Visibility = pro user AND live monitoring not explicitly disabled.
  // Mirrors the legacy logic in updateLiveIndicator() so behaviour is
  // identical post-migration.
  const isActive = useStoreSelector((s) => s.isProUser && s.appSettings.liveMonitoring !== false);

  return (
    <span
      class={`live-indicator${isActive ? '' : ' hidden'}`}
      title={t('live_indicator_tooltip')}
    >
      <span class="live-dot" />
      {t('live_indicator_label')}
    </span>
  );
}
