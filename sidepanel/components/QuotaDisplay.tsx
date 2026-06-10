// QuotaDisplay — Settings page component that shows usage quotas
// with a compact Free vs Pro comparison table. When remote copy config
// is available, groups/rows are built dynamically from the API so that
// admin changes propagate instantly. Falls back to hardcoded layout when
// the remote copy hasn't loaded yet.
import { useEffect, useState } from 'preact/hooks';
import { t, getLocale } from '../../shared/i18n';
import { getFreeLimits } from '../../shared/constants';
import { getRemainingMonthlyFreeAiTags } from '../../shared/ai-free-quota';
import { getAllFeatureQuotas, type TrackedFeature } from '../../shared/feature-quota';
import {
  getFeatureCopySynchronous,
  interpolateFeatureDesc,
  type FeatureCopyConfig,
} from '../../shared/remote-config';
import { useStoreSelector } from './storeHook';

interface QuotaRow {
  label: string;
  freeLimit: string;
  proLimit: string;
  /** Remaining count for free users (inline display) */
  remaining?: number;
  /** Whether this quota is exhausted */
  exhausted?: boolean;
  /** Used/max for Pro users */
  used?: number;
  max?: number;
}

/**
 * Build a flat list of quota rows. No grouping — just a single ordered list.
 * Features whose free limit is 0 (Pro-only) are hidden for free users so the
 * settings page only shows features with meaningful remaining counts.
 */
function buildQuotaRows(
  copy: FeatureCopyConfig | null,
  locale: string,
  limitsRecord: Record<string, unknown>,
  limits: ReturnType<typeof getFreeLimits>,
  isPro: boolean,
  aiQuotaLimit: number,
  aiQuotaRemaining: number,
  freeAiUsed: number,
  featureRemaining: (f: TrackedFeature) => number | undefined,
  featureExhausted: (f: TrackedFeature) => boolean,
  trackedFeatureMap: Record<string, TrackedFeature>
): QuotaRow[] {
  if (!copy) {
    return buildFallbackRows(
      limits,
      isPro,
      aiQuotaLimit,
      aiQuotaRemaining,
      freeAiUsed,
      featureRemaining,
      featureExhausted
    );
  }

  const lang = locale.startsWith('zh') ? 'zh' : 'en';
  const rows: QuotaRow[] = [];

  // Settings page only shows features with monthly/daily usage quotas
  // that the user actively consumes (AI tags, color copy).
  const SETTINGS_QUOTA_FEATURES = new Set(['aiTag', 'colorCopy']);

  for (const featureKey of copy.featureOrder) {
    const feat = copy.features[featureKey];
    if (!feat) continue;
    if (!SETTINGS_QUOTA_FEATURES.has(featureKey)) continue;

    const freeDesc = interpolateFeatureDesc(feat.free[lang] || feat.free['en'] || '', limitsRecord);
    const proDesc = interpolateFeatureDesc(feat.pro[lang] || feat.pro['en'] || '', limitsRecord);
    const label = feat.label[lang] || feat.label['en'] || featureKey;
    const tracked = trackedFeatureMap[featureKey];
    const row: QuotaRow = { label, freeLimit: freeDesc, proLimit: proDesc };

    if (featureKey === 'aiTag') {
      if (isPro) {
        row.used = aiQuotaLimit - aiQuotaRemaining;
        row.max = aiQuotaLimit;
      } else {
        row.remaining = limits.MAX_MONTHLY_AI_TAGS - freeAiUsed;
        row.exhausted = freeAiUsed >= limits.MAX_MONTHLY_AI_TAGS;
      }
    } else if (tracked) {
      row.remaining = featureRemaining(tracked);
      row.exhausted = featureExhausted(tracked);
    }

    rows.push(row);
  }

  return rows;
}

/** Hardcoded fallback when remote copy config is not available. */
function buildFallbackRows(
  limits: ReturnType<typeof getFreeLimits>,
  isPro: boolean,
  aiQuotaLimit: number,
  aiQuotaRemaining: number,
  freeAiUsed: number,
  featureRemaining: (f: TrackedFeature) => number | undefined,
  featureExhausted: (f: TrackedFeature) => boolean
): QuotaRow[] {
  const perMonth = t('quota_per_month');

  // Only show features with trackable monthly/daily quotas.
  // Fixed per-batch limits and non-quota features are excluded.
  return [
    // AI Tags
    isPro
      ? {
          label: t('quota_ai_tags'),
          freeLimit: `${limits.MAX_MONTHLY_AI_TAGS}${perMonth}`,
          proLimit: `${aiQuotaLimit}${perMonth}`,
          used: aiQuotaLimit - aiQuotaRemaining,
          max: aiQuotaLimit,
        }
      : {
          label: t('quota_ai_tags'),
          freeLimit: `${limits.MAX_MONTHLY_AI_TAGS}${perMonth}`,
          proLimit: `${aiQuotaLimit}${perMonth}`,
          remaining: limits.MAX_MONTHLY_AI_TAGS - freeAiUsed,
          exhausted: freeAiUsed >= limits.MAX_MONTHLY_AI_TAGS,
        },
    // Color copy
    {
      label: t('quota_color_copy'),
      freeLimit: `${limits.MAX_MONTHLY_COLOR_COPY}${perMonth}`,
      proLimit: t('quota_unlimited'),
      remaining: featureRemaining('colorCopy'),
      exhausted: featureExhausted('colorCopy'),
    },
  ];
}

export function QuotaDisplay() {
  const isPro = useStoreSelector((s) => s.isProUser);
  const aiQuotaRemaining = useStoreSelector((s) => s.aiQuotaRemaining);
  const aiQuotaLimit = useStoreSelector((s) => s.aiQuotaLimit);
  useStoreSelector((s) => s.localeTick);

  const [freeAiUsed, setFreeAiUsed] = useState(0);
  const [featureQuotas, setFeatureQuotas] = useState<Record<
    TrackedFeature,
    { remaining: number; limit: number; used: number }
  > | null>(null);

  const refreshQuotas = () => {
    if (!isPro) {
      getRemainingMonthlyFreeAiTags().then((remaining) => {
        const limits = getFreeLimits();
        setFreeAiUsed(limits.MAX_MONTHLY_AI_TAGS - remaining);
      });
      getAllFeatureQuotas().then(setFeatureQuotas);
    }
  };

  useEffect(() => {
    refreshQuotas();
    // Listen for quota storage changes to refresh in real-time
    const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('featureQuota' in changes) refreshQuotas();
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, [isPro]);

  const limits = getFreeLimits();

  function featureRemaining(feature: TrackedFeature): number | undefined {
    return featureQuotas?.[feature]?.remaining;
  }

  function featureExhausted(feature: TrackedFeature): boolean {
    return featureQuotas?.[feature]?.remaining === 0;
  }

  // Feature key → TrackedFeature mapping for remaining/exhausted display
  const trackedFeatureMap: Record<string, TrackedFeature> = {
    multiTab: 'multiTab',
    dedup: 'dedup',
    liveMonitor: 'liveMonitor',
    batchHighlight: 'batchHighlight',
    formatConvert: 'formatConvert',
    colorCopy: 'colorCopy',
  };

  // Build the flat limits record for template interpolation
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
    proAiMonthlyQuota: aiQuotaLimit,
  };

  const rows: QuotaRow[] = buildQuotaRows(
    getFeatureCopySynchronous(),
    getLocale(),
    limitsRecord,
    limits,
    isPro,
    aiQuotaLimit,
    aiQuotaRemaining,
    freeAiUsed,
    featureRemaining,
    featureExhausted,
    trackedFeatureMap
  );

  return (
    <div class="quota-display">
      <div class="quota-header">
        <span class="quota-header-feature">{t('quota_header_feature')}</span>
        <span class={`quota-header-plan${!isPro ? ' quota-header-current' : ''}`}>
          {t('quota_header_free')}
        </span>
        <span class={`quota-header-plan quota-header-pro${isPro ? ' quota-header-current' : ''}`}>
          Pro
        </span>
      </div>
      <div class="quota-list">
        {rows.map((row) => (
          <div class="quota-row" key={row.label}>
            <div class="quota-cell quota-cell-feature">
              <span class="quota-label">{row.label}</span>
              {!isPro && row.remaining !== undefined && (
                <span class={`quota-inline-remaining${row.exhausted ? ' exhausted' : ''}`}>
                  {row.remaining} {t('quota_remaining')}
                </span>
              )}
              {isPro && row.used !== undefined && row.max !== undefined && (
                <span class="quota-inline-remaining quota-inline-remaining-pro">
                  {t('quota_used_count', { used: row.used, max: row.max })}
                </span>
              )}
            </div>
            <div class={`quota-cell quota-cell-plan${!isPro ? ' quota-cell-current' : ''}`}>
              <span class="quota-limit-text">{row.freeLimit}</span>
            </div>
            <div
              class={`quota-cell quota-cell-plan quota-cell-pro${isPro ? ' quota-cell-current' : ''}`}
            >
              <span class="quota-limit-text quota-limit-pro">{row.proLimit}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
