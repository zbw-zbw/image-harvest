// Pro-status badge in the top-left of the toolbar. Two mutually-exclusive
// pieces of UI:
//   - Free user: "Upgrade to Pro" call-to-action
//   - Pro user:  inline plan + expiry + a deactivate button
//
// The previous imperative implementation lived in settings.ts >
// updateTopProStatus(): it queried the DOM, toggled .hidden, and stuffed
// plan / expiry strings into separate <span>s on every license check.
//
// The component subscribes to two pieces of state:
//   - `isProUser` (already in the store) — drives which half is visible.
//   - `proLicenseInfo` — populated by setProLicenseInfo() below from
//     settings.ts after the background returns license details.
//
// Click handlers (Upgrade / Deactivate) keep their original DOM ids so the
// existing event bindings in init.ts continue to work unchanged.
import { useStoreSelector } from './storeHook';
import { state } from '../state';
import { t } from '../../shared/i18n';

/**
 * Plan + expiry payload pushed by settings.ts after a license check.
 * Mirrors the subset of the GET_LICENSE_STATUS response the badge needs.
 */
export interface ProLicenseInfo {
  plan: 'monthly' | 'yearly' | 'lifetime' | string;
  /** Unix-epoch seconds/ms OR ISO-8601 string; ignored for lifetime plans. */
  expiresAt?: number | string;
}

const PLAN_LABELS: Record<string, () => string> = {
  trial: () => t('plan_trial'),
  monthly: () => t('plan_monthly'),
  yearly: () => t('plan_yearly'),
  lifetime: () => t('plan_lifetime'),
};

function formatDateYMD(timestamp: number | string): string {
  let d: Date;
  if (typeof timestamp === 'string') {
    // ISO date string from backend (e.g. "2026-06-08T00:00:00.000Z")
    d = new Date(timestamp);
  } else {
    // Backend can send seconds OR milliseconds; normalize defensively.
    const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
    d = new Date(ms);
  }
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/**
 * Helper for settings.ts to push fresh license details into the store.
 * Lives here next to the component that consumes it so the type and the
 * field name stay coupled.
 */
export function setProLicenseInfo(info: ProLicenseInfo | null): void {
  state.proLicenseInfo = info;
}

function trialDaysRemaining(expiresAt: number | string | undefined): number | null {
  if (!expiresAt) return null;
  let expMs: number;
  if (typeof expiresAt === 'string') {
    expMs = new Date(expiresAt).getTime();
  } else {
    expMs = expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
  }
  if (Number.isNaN(expMs)) return null;
  return Math.max(0, Math.ceil((expMs - Date.now()) / 86_400_000));
}

export function ProStatusBadge() {
  const isPro = useStoreSelector((s) => s.isProUser);
  const info = useStoreSelector((s) => s.proLicenseInfo);
  // Subscribe to localeTick so a runtime language switch triggers re-render
  useStoreSelector((s) => s.localeTick);
  const planLabel = info?.plan ? PLAN_LABELS[info.plan]?.() || info.plan : '';
  const isTrial = info?.plan === 'trial';
  const daysLeft = isTrial ? trialDaysRemaining(info?.expiresAt) : null;
  let expiryLabel = '';
  if (info?.plan !== 'lifetime' && info?.expiresAt && !isTrial) {
    expiryLabel = t('plan_expires_date', { date: formatDateYMD(info.expiresAt) });
  }
  return (
    <div id="pro-status-area" class="pro-status-area">
      <div id="pro-status-free" class={`pro-status-free${isPro ? ' hidden' : ''}`}>
        <button id="btn-upgrade-pro" class="btn-upgrade-pro" title={t('common_upgrade')}>
          <span class="icon-rocket">
            <svg
              width="14"
              height="14"
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
          </span>
          <span>{t('common_upgrade')}</span>
        </button>
      </div>
      <div id="pro-status-active" class={`pro-status-active${isPro ? '' : ' hidden'}`}>
        <span class="pro-active-badge">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {t('pro_active_badge')}
        </span>
        {planLabel && (
          <span id="pro-plan-label" class="pro-plan-label">
            {isTrial && daysLeft != null
              ? t('trial_days_remaining', { days: String(daysLeft) })
              : planLabel}
          </span>
        )}
        {expiryLabel && (
          <span id="pro-expiry-label" class="pro-expiry-label">
            {expiryLabel}
          </span>
        )}
        <button
          id="btn-top-deactivate"
          class="btn-deactivate-inline"
          title={t('pro_deactivate_tooltip')}
          aria-label={t('pro_deactivate_tooltip')}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
