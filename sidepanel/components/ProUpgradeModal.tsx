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

import { useEffect, useRef, useState } from 'preact/hooks';
import { useStoreSelector } from './storeHook';
import { state } from '../state';
import { t } from '../../shared/i18n';
import { track, flushNow } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { getProUpsellBucket, type AbBucket } from '../../shared/ab-experiment';
import { getState as getPaywallState, markResolved } from '../../shared/paywall-state';
import { PRICING_PAGE_URL, MESSAGE_TYPES, getFreeLimits } from '../../shared/constants';
import { showToast } from '../ui';
import { applyProFeatureVisibility } from '../settings';
import { startTrial as startTrialFn, isTrialEligible } from '../../shared/trial';

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
    return t('pro_headline_variant_b', { download });
  }
  return t('pro_headline_variant_a');
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
  setLoading: (loading: boolean) => void
): Promise<void> {
  void track(EVENTS.PRO_UPSELL_CTA_CLICKED, { trigger: 'modal', cta: 'trial' });

  setError('');
  setLoading(true);

  try {
    const result = await startTrialFn();
    if (!result.success) {
      setError(t(result.error || 'pro_trial_start_failed'));
      return;
    }
    void track(EVENTS.TRIAL_STARTED);
    void flushNow();
    await markResolved();
    showToast(t('pro_trial_started_toast'), 'success');
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

export function ProUpgradeModal() {
  const ms = useStoreSelector((s) => s.proUpgradeModalState);
  const [bucket, setBucket] = useState<AbBucket>('a');
  const [downloadCount, setDownloadCount] = useState(0);
  const [trialError, setTrialError] = useState('');
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialEligible, setTrialEligible] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Escape key handler + focus management
  useEffect(() => {
    if (!ms.open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      const first = contentRef.current?.querySelector<HTMLElement>(
        'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      first?.focus();
    }, 50);
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      previousFocusRef.current?.focus();
    };
  }, [ms.open]);

  // Resolve A/B bucket + paywall download count + trial eligibility once
  // on mount. All are cheap (cache-hit after first call) and feed the
  // variant copy / trial CTA visibility. We resolve them eagerly so the
  // headline doesn't flicker A→B when the modal opens.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [b, ps] = await Promise.all([getProUpsellBucket(), getPaywallState()]);
      if (cancelled) return;
      setBucket(b);
      setDownloadCount(ps.downloadCount);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-check trial eligibility every time the modal opens
  useEffect(() => {
    if (!ms.open) {
      setTrialError('');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const eligible = await isTrialEligible();
        if (!cancelled) setTrialEligible(eligible);
      } catch {
        if (!cancelled) setTrialEligible(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ms.open]);

  return (
    <div id="pro-upgrade-modal" class={`modal${ms.open ? '' : ' hidden'}`}>
      <div class="modal-overlay" onClick={close} />
      <div
        class="modal-content pro-upgrade-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-modal-title"
        ref={contentRef}
      >
        <div class="modal-header">
          <h2 id="pro-modal-title">
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
          {/* ── Section 1: license key activation form (top priority) ──── */}
          <div class="pro-upgrade-input-section">
            <div class="license-input-row">
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
                {t('pro_activate')}
              </button>
            </div>
            <p id="pro-modal-error" class={`license-error${ms.errorText ? '' : ' hidden'}`}>
              {ms.errorText}
            </p>
            <p class="pro-upgrade-get-pro-hint">
              {t('pro_no_key_hint')}{' '}
              <a id="link-pro-modal-get" href="#" class="license-link" onClick={handlePricingClick}>
                {t('pro_get_pro_link')}
              </a>
            </p>
          </div>

          {/* ── Section 2: trial / pricing CTAs ────────────────────────── */}
          {trialEligible ? (
            <div class="pro-upgrade-cta-section">
              <div class="pro-upgrade-trial-header">
                <div class="pro-upgrade-trial-badge">
                  <span aria-hidden="true">🎁</span>
                  {t('pro_trial_badge')}
                </div>
                <p class="pro-upgrade-trial-desc">{t('pro_trial_desc')}</p>
              </div>
              <ul class="pro-upgrade-trial-perks">
                <li>{t('pro_trial_perk_full_access')}</li>
                <li>{t('pro_trial_perk_no_card')}</li>
                <li>{t('pro_trial_perk_cancel')}</li>
              </ul>
              <div class="pro-upgrade-cta-row">
                <button
                  id="btn-pro-modal-trial"
                  type="button"
                  class="btn btn-primary btn-cta"
                  disabled={trialLoading}
                  onClick={() => {
                    void handleStartTrial(setTrialError, setTrialLoading);
                  }}
                >
                  {trialLoading ? t('pro_trial_starting') : t('pro_trial_start_cta')}
                </button>
                <button
                  id="btn-pro-modal-pricing"
                  type="button"
                  class="btn btn-cta btn-secondary"
                  onClick={handlePricingClick}
                >
                  {t('pro_pricing_cta')}
                </button>
              </div>
              <p id="pro-modal-trial-error" class={`license-error${trialError ? '' : ' hidden'}`}>
                {trialError}
              </p>
            </div>
          ) : null}

          {/* ── Section 3: Pro features with Free vs Pro comparison ──── */}
          <ProFeatureCompareList />
        </div>
      </div>
    </div>
  );
}

function FeatureCompareCard({
  icon,
  title,
  desc,
  free,
  pro,
}: {
  icon: string;
  gradient: string;
  title: string;
  desc: string;
  free: string;
  pro: string;
}) {
  const isDash = free === '—';
  const isCheck = pro === '✓';
  return (
    <div class="pro-fc-card">
      <div class="pro-fc-left">
        <span class="pro-fc-icon" aria-hidden="true">
          {icon}
        </span>
        <div class="pro-fc-info">
          <strong class="pro-fc-title">{title}</strong>
          <p class="pro-fc-desc">{desc}</p>
        </div>
      </div>
      <div class="pro-fc-badges">
        <span class={`pro-fc-badge pro-fc-free${isDash ? ' pro-fc-na' : ''}`}>
          {isDash ? '✗' : free}
        </span>
        <span class={`pro-fc-badge pro-fc-pro${isCheck ? ' pro-fc-check' : ''}`}>
          {isCheck ? '✓' : pro}
        </span>
      </div>
    </div>
  );
}

/** Dynamically builds the feature comparison list from getFreeLimits(). */
function ProFeatureCompareList() {
  const limits = getFreeLimits();
  const perMonth = t('pro_compare_per_month');
  const perDay = t('pro_compare_per_day');
  const unlimited = t('pro_compare_unlimited');
  const allEngines = t('pro_compare_all_engines');
  const engineCount = limits.REVERSE_SEARCH_ENGINES.length;

  return (
    <div class="pro-features-compare" style={{ marginTop: '14px' }}>
      <FeatureCompareCard
        icon="📦"
        gradient="gradient-blue"
        title={t('pro_feature_batch_title')}
        desc={t('pro_feature_batch_desc_pro')}
        free={`${limits.MAX_ZIP_IMAGES} ${perDay}`}
        pro={unlimited}
      />
      <FeatureCompareCard
        icon="🖥️"
        gradient="gradient-purple"
        title={t('pro_feature_multitab_title')}
        desc={t('pro_feature_multitab_desc_pro')}
        free={`${limits.MAX_MONTHLY_MULTI_TAB} ${perMonth}`}
        pro={unlimited}
      />
      <FeatureCompareCard
        icon="🔍"
        gradient="gradient-green"
        title={t('pro_feature_reverse_search_title')}
        desc={t('pro_feature_reverse_search_desc_pro')}
        free={`${engineCount} ${t('pro_compare_engines')}`}
        pro={allEngines}
      />
      <FeatureCompareCard
        icon="🏷️"
        gradient="gradient-cyan"
        title={t('pro_feature_ai_tag_title')}
        desc={t('pro_feature_ai_tag_desc_pro')}
        free={`${limits.MAX_MONTHLY_AI_TAGS} ${perMonth}`}
        pro={unlimited}
      />
      <FeatureCompareCard
        icon="🦅"
        gradient="gradient-amber"
        title={t('pro_feature_eagle_title')}
        desc={t('pro_feature_eagle_desc_pro')}
        free={`${limits.MAX_EAGLE_EXPORT_PER_BATCH} ${perMonth}`}
        pro={unlimited}
      />
      <FeatureCompareCard
        icon="🧹"
        gradient="gradient-orange"
        title={t('pro_feature_dedup_title')}
        desc={t('pro_feature_dedup_desc_pro')}
        free={`${limits.MAX_MONTHLY_DEDUP} ${perMonth}`}
        pro={unlimited}
      />
      <FeatureCompareCard
        icon="🎨"
        gradient="gradient-pink"
        title={t('pro_feature_color_title')}
        desc={t('pro_feature_color_desc_pro')}
        free="—"
        pro="✓"
      />
      <FeatureCompareCard
        icon="🔄"
        gradient="gradient-indigo"
        title={t('pro_feature_format_title')}
        desc={t('pro_feature_format_desc_pro')}
        free={`${limits.MAX_MONTHLY_FORMAT_CONVERT} ${perMonth}`}
        pro={unlimited}
      />
      <FeatureCompareCard
        icon="📡"
        gradient="gradient-teal"
        title={t('pro_feature_live_monitor_title')}
        desc={t('pro_feature_live_monitor_desc_pro')}
        free={`${limits.MAX_MONTHLY_LIVE_MONITOR} ${perMonth}`}
        pro={unlimited}
      />
    </div>
  );
}
