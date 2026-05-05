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

/**
 * Plan + expiry payload pushed by settings.ts after a license check.
 * Mirrors the subset of the GET_LICENSE_STATUS response the badge needs.
 */
export interface ProLicenseInfo {
  plan: 'monthly' | 'yearly' | 'lifetime' | string;
  /** Unix-epoch seconds; ignored for lifetime plans. */
  expiresAt?: number;
}

const PLAN_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  yearly: 'Yearly',
  lifetime: 'Lifetime',
};

function formatDateYMD(timestamp: number): string {
  // Backend can send seconds OR milliseconds; normalize defensively.
  const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const d = new Date(ms);
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

export function ProStatusBadge() {
  const isPro = useStoreSelector((s) => s.isProUser);
  const info = useStoreSelector((s) => s.proLicenseInfo);
  const planLabel = info?.plan ? PLAN_LABELS[info.plan] || info.plan : '';
  let expiryLabel = '';
  if (info?.plan === 'lifetime') {
    expiryLabel = 'Never expires';
  } else if (info?.expiresAt) {
    expiryLabel = `Expires: ${formatDateYMD(info.expiresAt)}`;
  }
  return (
    <div id="pro-status-area" class="pro-status-area">
      <div id="pro-status-free" class={`pro-status-free${isPro ? ' hidden' : ''}`}>
        <button id="btn-upgrade-pro" class="btn-upgrade-pro" title="Upgrade to Pro">
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
          <span>Upgrade to Pro</span>
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
          Pro Active
        </span>
        {planLabel && (
          <span id="pro-plan-label" class="pro-plan-label">
            {planLabel}
          </span>
        )}
        {expiryLabel && (
          <span id="pro-expiry-label" class="pro-expiry-label">
            {expiryLabel}
          </span>
        )}
        <button id="btn-top-deactivate" class="btn-top-deactivate" title="Deactivate license">
          Deactivate
        </button>
      </div>
    </div>
  );
}
