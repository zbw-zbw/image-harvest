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

import { Fragment, type ComponentChildren, type VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStoreSelector } from './storeHook';
import { state } from '../state';
import { t } from '../../shared/i18n';
import { track, flushNow } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { getProUpsellBucket, type AbBucket } from '../../shared/ab-experiment';
import { getState as getPaywallState, markResolved } from '../../shared/paywall-state';
import { pricingPageUrl, MESSAGE_TYPES, getFreeLimits } from '../../shared/constants';
import { getFeatureCopySynchronous, interpolateFeatureDesc } from '../../shared/remote-config';
import { getLocale } from '../../shared/i18n';
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
  // Attribution: 'modal' tells the website funnel WHICH touchpoint sent
  // this visit (vs. the settings get-Pro link) — mirrors the trigger prop
  // on the telemetry event above.
  chrome.tabs.create({ url: pricingPageUrl('modal') });
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
            {/* Gold-tinted chip marks this as a Pro (paid) surface — the one
                place the amber accent leads. */}
            <span class="pro-modal-title-icon" aria-hidden="true">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
              </svg>
            </span>
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
          {/* ── Section 1: trial / pricing CTAs (hero — the value prop) ──── */}
          {trialEligible ? (
            <div class="pro-upgrade-cta-section">
              <div class="pro-upgrade-trial-header">
                <div class="pro-upgrade-trial-badge">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 12 20 22 4 22 4 12" />
                    <rect x="2" y="7" width="20" height="5" />
                    <line x1="12" y1="22" x2="12" y2="7" />
                    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                    <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
                  </svg>
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

          {/* ── Section 2: Pro features with Free vs Pro comparison ──── */}
          <ProFeatureCompareList />

          {/* ── Section 3: license key activation (de-emphasized, bottom) ── */}
          <div class="pro-upgrade-divider" aria-hidden="true">
            <span>{t('pro_already_have_key')}</span>
          </div>
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
        </div>
      </div>
    </div>
  );
}

function FeatureCompareCard({
  iconKey,
  title,
  desc,
  free,
  pro,
}: {
  iconKey: string;
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
          {FEATURE_ICON_SVGS[iconKey] ?? FALLBACK_ICON}
        </span>
        <div class="pro-fc-info">
          <strong class="pro-fc-title">{title}</strong>
          <p class="pro-fc-desc">{desc}</p>
        </div>
      </div>
      <div class="pro-fc-badges">
        <span class={`pro-fc-badge pro-fc-free${isDash ? ' pro-fc-na' : ''}`}>
          {isDash ? X_ICON : free}
        </span>
        <span class={`pro-fc-badge pro-fc-pro${isCheck ? ' pro-fc-check' : ''}`}>
          {isCheck ? CHECK_ICON : pro}
        </span>
      </div>
    </div>
  );
}

// Lucide-style inline SVG icons for known feature keys. stroke=currentColor
// so the tinted .pro-fc-icon chip controls the color; unknown keys (remote
// config can add features) fall back to the generic zap glyph.
function svgIcon(children: ComponentChildren): VNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const FALLBACK_ICON = svgIcon(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />);

const FEATURE_ICON_SVGS: Partial<Record<string, VNode>> = {
  smartExtract: svgIcon(
    <Fragment>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Fragment>
  ),
  zipDownload: svgIcon(
    <Fragment>
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </Fragment>
  ),
  batchCopyUrls: svgIcon(
    <Fragment>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Fragment>
  ),
  batchDelete: svgIcon(
    <Fragment>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </Fragment>
  ),
  batchFavorite: svgIcon(
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  ),
  collection: svgIcon(
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  ),
  aiTag: svgIcon(
    <Fragment>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </Fragment>
  ),
  batchHighlight: svgIcon(
    <Fragment>
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4Z" />
    </Fragment>
  ),
  multiTab: svgIcon(
    <Fragment>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </Fragment>
  ),
  dedup: svgIcon(
    <Fragment>
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </Fragment>
  ),
  formatConvert: svgIcon(
    <Fragment>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </Fragment>
  ),
  liveMonitor: svgIcon(
    <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
  ),
  reverseSearch: svgIcon(
    <Fragment>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
      <path d="m16 16-1.9-1.9" />
    </Fragment>
  ),
  eagleExport: svgIcon(
    <Fragment>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" x2="12" y1="2" y2="15" />
    </Fragment>
  ),
  colorCopy: svgIcon(
    <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />
  ),
  customNaming: svgIcon(
    <Fragment>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Fragment>
  ),
  advancedGrouping: svgIcon(
    <Fragment>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </Fragment>
  ),
};

// Small glyphs for the FREE/PRO comparison badges (replace the old ✗/✓ text).
const CHECK_ICON = (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="3"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const X_ICON = (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="3"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

/** Dynamically builds the feature comparison list from remote copy config,
 *  falling back to getFreeLimits() when remote copy is unavailable. */
function ProFeatureCompareList() {
  const limits = getFreeLimits();
  const copy = getFeatureCopySynchronous();
  const locale = getLocale();
  const lang = locale.startsWith('zh') ? 'zh' : 'en';

  // Build flat limits record for template interpolation
  const limitsRecord: Record<string, unknown> = {
    maxZipImages: limits.MAX_ZIP_IMAGES,
    maxBatchCopyUrls: limits.MAX_BATCH_COPY_URLS,
    maxCollectionItems: limits.MAX_COLLECTION_ITEMS,
    maxMonthlyAiTags: limits.MAX_MONTHLY_AI_TAGS,
    maxEagleExportPerBatch: limits.MAX_EAGLE_EXPORT_PER_BATCH,
    maxBatchDelete: limits.MAX_BATCH_DELETE,
    maxBatchFavorite: limits.MAX_BATCH_FAVORITE,
    maxMonthlyColorCopy: limits.MAX_MONTHLY_COLOR_COPY,
    maxMonthlyMultiTab: limits.MAX_MONTHLY_MULTI_TAB,
    maxMonthlyDedup: limits.MAX_MONTHLY_DEDUP,
    maxMonthlyFormatConvert: limits.MAX_MONTHLY_FORMAT_CONVERT,
    maxMonthlyLiveMonitor: limits.MAX_MONTHLY_LIVE_MONITOR,
    maxMonthlyBatchHighlight: limits.MAX_MONTHLY_BATCH_HIGHLIGHT,
    proAiMonthlyQuota: (() => {
      const remote = (globalThis as Record<string, unknown>).__remoteConfig as
        | Record<string, unknown>
        | undefined;
      return typeof remote?.proAiMonthlyQuota === 'number' ? remote.proAiMonthlyQuota : 100;
    })(),
  };

  // If remote copy is available, build cards dynamically
  if (copy) {
    // Filter out features where both free and pro show "✓" (not interesting for upsell)
    const upsellFeatures = copy.featureOrder.filter((key) => {
      const feat = copy.features[key];
      if (!feat) return false;
      const freeVal = feat.free[lang] || feat.free['en'] || '';
      const proVal = feat.pro[lang] || feat.pro['en'] || '';
      return freeVal !== proVal; // Only show features where Pro offers more
    });

    return (
      <div class="pro-features-compare" style={{ marginTop: '14px' }}>
        <div class="pro-fc-header">
          <span class="pro-fc-header-feature">{t('pro_compare_feature')}</span>
          <div class="pro-fc-header-badges">
            <span class="pro-fc-header-label pro-fc-free">FREE</span>
            <span class="pro-fc-header-label pro-fc-pro">PRO</span>
          </div>
        </div>
        {upsellFeatures.map((featureKey) => {
          const feat = copy.features[featureKey]!;
          const label = feat.label[lang] || feat.label['en'] || featureKey;
          const freeDesc = interpolateFeatureDesc(
            feat.free[lang] || feat.free['en'] || '',
            limitsRecord
          );
          const proDesc = interpolateFeatureDesc(
            feat.pro[lang] || feat.pro['en'] || '',
            limitsRecord
          );

          return (
            <FeatureCompareCard
              key={featureKey}
              iconKey={featureKey}
              title={label}
              desc=""
              free={freeDesc}
              pro={proDesc}
            />
          );
        })}
      </div>
    );
  }

  // Fallback: hardcoded cards
  const perBatch = t('pro_compare_per_batch');
  const timesPerMonth = t('pro_compare_times_per_month');
  const unlimited = t('pro_compare_unlimited');
  const allEngines = t('pro_compare_all_engines');
  const engineCount = limits.REVERSE_SEARCH_ENGINES.length;

  return (
    <div class="pro-features-compare" style={{ marginTop: '14px' }}>
      <div class="pro-fc-header">
        <span class="pro-fc-header-feature">{t('pro_compare_feature')}</span>
        <div class="pro-fc-header-badges">
          <span class="pro-fc-header-label pro-fc-free">FREE</span>
          <span class="pro-fc-header-label pro-fc-pro">PRO</span>
        </div>
      </div>
      {/* — Features with free tier (limited usage) — */}
      <FeatureCompareCard
        iconKey="zipDownload"
        title={t('pro_feature_batch_title')}
        desc={t('pro_feature_batch_desc_pro')}
        free={`${limits.MAX_ZIP_IMAGES} ${perBatch}`}
        pro={unlimited}
      />
      <FeatureCompareCard
        iconKey="zap"
        title={t('pro_feature_batch_ops_title')}
        desc={t('pro_feature_batch_ops_desc_pro')}
        free={`${limits.MAX_BATCH_DELETE} ${perBatch}`}
        pro={unlimited}
      />
      <FeatureCompareCard
        iconKey="aiTag"
        title={t('pro_feature_ai_tag_title')}
        desc={t('pro_feature_ai_tag_desc_pro')}
        free={`${limits.MAX_MONTHLY_AI_TAGS} ${timesPerMonth}`}
        pro={unlimited}
      />
      <FeatureCompareCard
        iconKey="colorCopy"
        title={t('pro_feature_color_title')}
        desc={t('pro_feature_color_desc_pro')}
        free={`${limits.MAX_MONTHLY_COLOR_COPY} ${timesPerMonth}`}
        pro={unlimited}
      />
      <FeatureCompareCard
        iconKey="reverseSearch"
        title={t('pro_feature_reverse_search_title')}
        desc={t('pro_feature_reverse_search_desc_pro')}
        free={`${engineCount} ${t('pro_compare_engines')}`}
        pro={allEngines}
      />
      <FeatureCompareCard
        iconKey="eagleExport"
        title={t('pro_feature_eagle_title')}
        desc={t('pro_feature_eagle_desc_pro')}
        free={`${limits.MAX_EAGLE_EXPORT_PER_BATCH} ${perBatch}`}
        pro={unlimited}
      />
      {/* — Pro-exclusive features (unavailable on free) — */}
      <FeatureCompareCard
        iconKey="multiTab"
        title={t('pro_feature_multitab_title')}
        desc={t('pro_feature_multitab_desc_pro')}
        free={
          limits.MAX_MONTHLY_MULTI_TAB > 0
            ? `${limits.MAX_MONTHLY_MULTI_TAB} ${timesPerMonth}`
            : '—'
        }
        pro={unlimited}
      />
      <FeatureCompareCard
        iconKey="dedup"
        title={t('pro_feature_dedup_title')}
        desc={t('pro_feature_dedup_desc_pro')}
        free={limits.MAX_MONTHLY_DEDUP > 0 ? `${limits.MAX_MONTHLY_DEDUP} ${timesPerMonth}` : '—'}
        pro={unlimited}
      />
      <FeatureCompareCard
        iconKey="formatConvert"
        title={t('pro_feature_format_title')}
        desc={t('pro_feature_format_desc_pro')}
        free={
          limits.MAX_MONTHLY_FORMAT_CONVERT > 0
            ? `${limits.MAX_MONTHLY_FORMAT_CONVERT} ${timesPerMonth}`
            : '—'
        }
        pro={unlimited}
      />
      <FeatureCompareCard
        iconKey="liveMonitor"
        title={t('pro_feature_live_monitor_title')}
        desc={t('pro_feature_live_monitor_desc_pro')}
        free={
          limits.MAX_MONTHLY_LIVE_MONITOR > 0
            ? `${limits.MAX_MONTHLY_LIVE_MONITOR} ${timesPerMonth}`
            : '—'
        }
        pro={unlimited}
      />
    </div>
  );
}
