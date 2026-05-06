// Pro Upgrade modal — Sprint 2.2 redesign.
//
// What changed from the v1 modal:
//   - The hero is no longer "input your license key". For a NOT-YET-paid
//     user that input is meaningless and was the entire above-the-fold area.
//     The new layout puts the value prop and a 7-day free trial CTA front
//     and center; the activation form moves to a collapsed bottom section
//     for the small minority who already bought a key.
//   - Two CTAs at the top: "Start Free Trial" (primary) → trial flow,
//     "View Pricing" (secondary) → pricing page in new tab.
//   - A/B copy variant on the headline + sub-headline. The bucket comes
//     from shared/ab-experiment.ts; B uses a personalized line built from
//     the user's actual download count, A uses the generic value prop.
//
// Stable id contract preserved (license-ui.ts > bindLicenseModalEvents
// looks them up by getElementById, so they MUST keep working):
//   - #pro-upgrade-modal           — modal shell, bindProGuards binds overlay click
//   - #btn-pro-upgrade-close       — top-right close X
//   - #pro-modal-key-input         — license key text input
//   - #btn-pro-modal-activate      — activate button next to the input
//   - #pro-modal-error             — single-line error <p> under the input
//   - #link-pro-modal-get          — "Don't have a key? Get Pro →" link
//
// New ids introduced this sprint (free to rename in future since no
// external module references them yet):
//   - #btn-pro-modal-trial         — primary "Start Free Trial" CTA
//   - #btn-pro-modal-pricing       — secondary "View Pricing" CTA
//   - #pro-modal-trial-error       — error line for the trial CTA path

import { useEffect, useState } from 'preact/hooks';
import { useStoreSelector } from './storeHook';
import { state } from '../state';
import { track, flushNow } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { getProUpsellBucket, type AbBucket } from '../../shared/ab-experiment';
import { getState as getPaywallState, markResolved } from '../../shared/paywall-state';
import { PRICING_PAGE_URL, MESSAGE_TYPES } from '../../shared/constants';
import { showToast } from '../ui';
import { applyProFeatureVisibility } from '../settings';

function close(): void {
  // Clear errorText on close so the next open starts clean.
  state.proUpgradeModalState = { open: false, errorText: '' };
  // Telemetry: dismissal tells us the upsell didn't convert. Pair with
  // pro_upsell_shown (emitted by settings.ts > showProUpgradeModal) to
  // compute conversion rate per (shown → cta_clicked) and abandonment
  // per (shown → dismissed). Trigger is intentionally generic; the
  // origin feature was already attached to PRO_FEATURE_BLOCKED upstream.
  void track(EVENTS.PRO_UPSELL_DISMISSED, { trigger: 'modal_close' });
}

// ── A/B copy variants ──────────────────────────────────────────────────────
//
// `download` is the user's lifetime success-counted download count from
// shared/paywall-state.ts. Used by the B variant to assemble a
// personalized value-prop line. A is the static control.
function variantHeadline(bucket: AbBucket, download: number): string {
  if (bucket === 'b' && download >= 5) {
    return `You've downloaded ${download} images — go unlimited`;
  }
  return 'Unlock Pro Features';
}

function variantSubline(bucket: AbBucket): string {
  if (bucket === 'b') {
    return 'Power users save 10× more time with batch + multi-tab + reverse search.';
  }
  return 'Batch downloads, multi-tab extract, reverse search & more.';
}

// ── Trial CTA: kicks off the 7-day free trial flow.
//
// Implementation note: the actual trial start endpoint + shared/trial.ts
// helper land in Sprint 2.3. Until then this CTA fires the telemetry event
// (so funnel data starts accruing immediately) and surfaces a friendly
// "coming soon" toast. As soon as the trial module ships, the body of
// `handleStartTrial` swaps to the real call without touching call sites.
async function handleStartTrial(
  setError: (msg: string) => void,
  setLoading: (loading: boolean) => void,
): Promise<void> {
  void track(EVENTS.PRO_UPSELL_CTA_CLICKED, { trigger: 'modal', cta: 'trial' });

  let startTrial: typeof import('../../shared/trial').startTrial;
  try {
    ({ startTrial } = await import('../../shared/trial'));
  } catch {
    setError('Trial unavailable. Please try again later.');
    return;
  }

  setError('');
  setLoading(true);

  try {
    const result = await startTrial();
    if (!result.success) {
      setError(result.error || 'Could not start your trial. Please try again.');
      return;
    }
    void track(EVENTS.TRIAL_STARTED);
    void flushNow();
    await markResolved();
    showToast('Your 7-day Pro trial is active!', 'success');
    try {
      await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.VALIDATE_LICENSE });
    } catch {
      /* best-effort — settings reopen will re-sync regardless */
    }
    applyProFeatureVisibility();
    state.proUpgradeModalState = { open: false, errorText: '' };
  } finally {
    setLoading(false);
  }
}

function handlePricingClick(e: MouseEvent): void {
  e.preventDefault();
  void track(EVENTS.PRO_UPSELL_CTA_CLICKED, { trigger: 'modal', cta: 'pricing' });
  chrome.tabs.create({ url: PRICING_PAGE_URL });
}

/**
 * Telemetry-only handler for the legacy "Get Pro →" link in the
 * already-have-a-key footer. Navigation is performed by
 * license-ui.ts > bindLicenseModalEvents (it preventDefaults and calls
 * chrome.tabs.create), so we just observe the click here.
 */
function handleLegacyGetProClick(): void {
  void track(EVENTS.PRO_UPSELL_CTA_CLICKED, { trigger: 'modal', cta: 'get_pro' });
}

export function ProUpgradeModal() {
  const ms = useStoreSelector((s) => s.proUpgradeModalState);
  const [bucket, setBucket] = useState<AbBucket>('a');
  const [downloadCount, setDownloadCount] = useState(0);
  const [trialError, setTrialError] = useState('');
  const [trialLoading, setTrialLoading] = useState(false);

  // Resolve A/B bucket + paywall download count once on mount. Both are
  // cheap (cache-hit after first call) and feed the variant copy. We
  // resolve them eagerly so the headline doesn't flicker A→B when the
  // modal opens.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [b, ps] = await Promise.all([
        getProUpsellBucket(),
        getPaywallState(),
      ]);
      if (cancelled) return;
      setBucket(b);
      setDownloadCount(ps.downloadCount);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset trial error every time the modal closes so it doesn't
  // resurface on the next open.
  useEffect(() => {
    if (!ms.open) setTrialError('');
  }, [ms.open]);

  return (
    <div id="pro-upgrade-modal" class={`modal${ms.open ? '' : ' hidden'}`}>
      <div class="modal-overlay" onClick={close} />
      <div class="modal-content pro-upgrade-content">
        <div class="modal-header">
          <h2>
            <svg
              class="modal-title-icon"
              width="20"
              height="20"
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
            {variantHeadline(bucket, downloadCount)}
          </h2>
          <button id="btn-pro-upgrade-close" class="icon-btn" onClick={close} aria-label="Close">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          {/* ── Section 1: value prop + feature highlights ─────────────── */}
          <div class="pro-upgrade-hero">
            <p class="pro-upgrade-desc">{variantSubline(bucket)}</p>
          </div>
          <div class="pro-upgrade-features">
            <ul class="pro-feature-list">
              <ProFeatureItem
                title="Unlimited batch download"
                desc="ZIP any number of images in one go — no Free-tier cap."
              />
              <ProFeatureItem
                title="Multi-tab extraction"
                desc="Pull images from every open tab simultaneously."
              />
              <ProFeatureItem
                title="Reverse image search"
                desc="Search via Google, TinEye, Baidu, and Yandex with one click."
              />
              <ProFeatureItem
                title="Similar & duplicate detection"
                desc="Auto-group lookalikes using perceptual hashing."
              />
              <ProFeatureItem
                title="Color extraction & filtering"
                desc="Filter your gallery by dominant color palette."
              />
            </ul>
          </div>

          {/* ── Section 2: trial / pricing CTAs ─────────────────────────── */}
          <div class="pro-upgrade-cta-section">
            <div class="pro-upgrade-trial-badge">
              <span aria-hidden="true">🎁</span>
              7-Day Free Trial · No credit card required
            </div>
            <div class="pro-upgrade-cta-row">
              <button
                id="btn-pro-modal-trial"
                type="button"
                class="btn btn-primary btn-block"
                disabled={trialLoading}
                onClick={() => {
                  void handleStartTrial(setTrialError, setTrialLoading);
                }}
              >
                {trialLoading ? 'Starting…' : 'Start Free Trial'}
              </button>
              <button
                id="btn-pro-modal-pricing"
                type="button"
                class="btn btn-secondary btn-block"
                onClick={handlePricingClick}
              >
                View Pricing →
              </button>
            </div>
            <p
              id="pro-modal-trial-error"
              class={`license-error${trialError ? '' : ' hidden'}`}
            >
              {trialError}
            </p>
          </div>

          {/* ── Section 3: legacy already-have-a-key activation form ───── */}
          <div class="pro-upgrade-divider">
            <span>Already have a key?</span>
          </div>
          <div class="pro-upgrade-input-section">
            <div class="license-input-row">
              {/* Input + activate button keep their original ids so
                  license-ui.ts > bindLicenseModalEvents continues to work
                  unchanged. Same for the error <p> + "Get Pro" link below. */}
              <input
                type="text"
                id="pro-modal-key-input"
                class="license-input"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                maxlength={19}
                spellcheck={false}
                autocomplete="off"
              />
              <button id="btn-pro-modal-activate" class="btn btn-primary btn-sm">
                Activate
              </button>
            </div>
            <p id="pro-modal-error" class={`license-error${ms.errorText ? '' : ' hidden'}`}>
              {ms.errorText}
            </p>
            <p class="setting-desc license-hint">
              {`Don't have a key? `}
              <a
                id="link-pro-modal-get"
                href="#"
                class="license-link"
                onClick={handleLegacyGetProClick}
              >
                Get Pro →
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface FeatureProps {
  title: string;
  desc: string;
}

function ProFeatureItem({ title, desc }: FeatureProps) {
  return (
    <li>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <div>
        <strong>{title}</strong>
        <p>{desc}</p>
      </div>
    </li>
  );
}
