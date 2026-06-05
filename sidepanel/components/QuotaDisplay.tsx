// QuotaDisplay — Settings page component that shows usage quotas
// with a compact Free vs Pro comparison table. Features are grouped
// by category (Core Pro → AI → Batch Ops → Storage) with inline
// remaining-count display to keep the table short.
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../shared/i18n';
import { getFreeLimits } from '../../shared/constants';
import { getRemainingMonthlyFreeAiTags } from '../../shared/ai-free-quota';
import { collectionGetAll } from '../../shared/collection';
import { getAllFeatureQuotas, type TrackedFeature } from '../../shared/feature-quota';
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

interface QuotaGroup {
  title: string;
  rows: QuotaRow[];
}

export function QuotaDisplay() {
  const isPro = useStoreSelector((s) => s.isProUser);
  const aiQuotaRemaining = useStoreSelector((s) => s.aiQuotaRemaining);
  const aiQuotaLimit = useStoreSelector((s) => s.aiQuotaLimit);
  useStoreSelector((s) => s.localeTick);

  const [collectionCount, setCollectionCount] = useState(0);
  const [freeAiUsed, setFreeAiUsed] = useState(0);
  const [featureQuotas, setFeatureQuotas] = useState<Record<
    TrackedFeature,
    { remaining: number; limit: number; used: number }
  > | null>(null);

  useEffect(() => {
    if (!isPro) {
      getRemainingMonthlyFreeAiTags().then((remaining) => {
        const limits = getFreeLimits();
        setFreeAiUsed(limits.MAX_MONTHLY_AI_TAGS - remaining);
      });
      getAllFeatureQuotas().then(setFeatureQuotas);
    }
  }, [isPro]);

  useEffect(() => {
    collectionGetAll().then((items) => setCollectionCount(items.length));
  }, []);

  const limits = getFreeLimits();
  const perMonth = t('quota_per_month');
  const perDay = t('quota_per_day');
  const perBatch = t('quota_per_batch');
  const unitItems = t('quota_unit_items');

  function featureRemaining(feature: TrackedFeature): number | undefined {
    return featureQuotas?.[feature]?.remaining;
  }

  function featureExhausted(feature: TrackedFeature): boolean {
    return featureQuotas?.[feature]?.remaining === 0;
  }

  // Grouped by category, ordered from high-value to low-value features
  const groups: QuotaGroup[] = [
    {
      title: t('quota_group_core'),
      rows: [
        {
          label: t('quota_multitab'),
          freeLimit: `${limits.MAX_MONTHLY_MULTI_TAB}${perMonth}`,
          proLimit: '∞',
          remaining: featureRemaining('multiTab'),
          exhausted: featureExhausted('multiTab'),
        },
        {
          label: t('quota_dedup'),
          freeLimit: `${limits.MAX_MONTHLY_DEDUP}${perMonth}`,
          proLimit: '∞',
          remaining: featureRemaining('dedup'),
          exhausted: featureExhausted('dedup'),
        },
        {
          label: t('quota_reverse_search'),
          freeLimit: `${limits.REVERSE_SEARCH_ENGINES.length} ${t('quota_engines')}`,
          proLimit: `4 ${t('quota_engines')}`,
        },
        {
          label: t('quota_live_monitor'),
          freeLimit: `${limits.MAX_MONTHLY_LIVE_MONITOR}${perMonth}`,
          proLimit: '∞',
          remaining: featureRemaining('liveMonitor'),
          exhausted: featureExhausted('liveMonitor'),
        },
      ],
    },
    {
      title: t('quota_group_ai'),
      rows: [
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
      ],
    },
    {
      title: t('quota_group_batch'),
      rows: [
        {
          label: t('quota_zip_download'),
          freeLimit: `${limits.MAX_ZIP_IMAGES}${perBatch}`,
          proLimit: '∞',
        },
        {
          label: t('quota_batch_copy'),
          freeLimit: `${limits.MAX_BATCH_COPY_URLS}${perBatch}`,
          proLimit: '∞',
        },
        {
          label: t('quota_eagle_export'),
          freeLimit: `${limits.MAX_EAGLE_EXPORT_PER_BATCH}${perBatch}`,
          proLimit: '∞',
        },
        {
          label: t('quota_batch_delete'),
          freeLimit: `${limits.MAX_BATCH_DELETE}${perBatch}`,
          proLimit: '∞',
        },
        {
          label: t('quota_batch_favorite'),
          freeLimit: `${limits.MAX_BATCH_FAVORITE}${perBatch}`,
          proLimit: '∞',
        },
        {
          label: t('quota_batch_highlight'),
          freeLimit: `${limits.MAX_DAILY_BATCH_HIGHLIGHT}${perDay}`,
          proLimit: '∞',
          remaining: featureRemaining('batchHighlight'),
          exhausted: featureExhausted('batchHighlight'),
        },
      ],
    },
    {
      title: t('quota_group_storage'),
      rows: [
        {
          label: t('quota_collection'),
          freeLimit: `${limits.MAX_COLLECTION_ITEMS}${unitItems}`,
          proLimit: '∞',
          remaining: isPro ? undefined : Math.max(0, limits.MAX_COLLECTION_ITEMS - collectionCount),
          exhausted: !isPro && collectionCount >= limits.MAX_COLLECTION_ITEMS,
        },
        {
          label: t('quota_format_convert'),
          freeLimit: `${limits.MAX_MONTHLY_FORMAT_CONVERT}${perMonth}`,
          proLimit: '∞',
          remaining: featureRemaining('formatConvert'),
          exhausted: featureExhausted('formatConvert'),
        },
      ],
    },
  ];

  return (
    <div class="quota-display">
      <div class="quota-header">
        <span class="quota-header-feature">{t('quota_header_feature')}</span>
        <span class={`quota-header-plan${!isPro ? ' quota-header-current' : ''}`}>Free</span>
        <span class={`quota-header-plan quota-header-pro${isPro ? ' quota-header-current' : ''}`}>
          Pro
        </span>
      </div>
      <div class="quota-list">
        {groups.map((group) => (
          <div class="quota-group" key={group.title}>
            <div class="quota-group-title">{group.title}</div>
            {group.rows.map((row) => (
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
                  <span class="quota-limit-text quota-limit-pro">
                    {row.proLimit === '∞' ? <span class="quota-infinity">∞</span> : row.proLimit}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
