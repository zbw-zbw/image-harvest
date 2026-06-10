/**
 * Generic feature quota tracking module.
 *
 * Tracks monthly/daily usage counts for features that have limited free access.
 * Persisted in chrome.storage.local under STORAGE_KEYS.FEATURE_QUOTA.
 *
 * Storage schema:
 * {
 *   featureQuota: {
 *     monthly: { "2026-06": { multiTab: 2, dedup: 1, formatConvert: 3, liveMonitor: 0 } },
 *     daily: { "2026-06-04": { batchHighlight: 2 } }
 *   }
 * }
 */

import { STORAGE_KEYS, getFreeLimits } from './constants';

/** Features tracked on a monthly reset cycle. */
export type MonthlyFeature = 'multiTab' | 'dedup' | 'formatConvert' | 'liveMonitor' | 'colorCopy';

/** Features tracked on a daily reset cycle. */
export type DailyFeature = 'batchHighlight';

export type TrackedFeature = MonthlyFeature | DailyFeature;

interface QuotaData {
  monthly: Record<string, Record<MonthlyFeature, number>>;
  daily: Record<string, Record<DailyFeature, number>>;
}

const MONTHLY_FEATURES: MonthlyFeature[] = [
  'multiTab',
  'dedup',
  'formatConvert',
  'liveMonitor',
  'colorCopy',
];
const DAILY_FEATURES: DailyFeature[] = ['batchHighlight'];

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function currentDayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function loadQuotaData(): Promise<QuotaData> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.FEATURE_QUOTA);
    const raw = result[STORAGE_KEYS.FEATURE_QUOTA] as QuotaData | undefined;
    return raw || { monthly: {}, daily: {} };
  } catch {
    // chrome.storage unavailable (e.g. test environment)
    return { monthly: {}, daily: {} };
  }
}

async function saveQuotaData(data: QuotaData): Promise<void> {
  // Prune old entries to prevent unbounded storage growth.
  // Keep only current month for monthly, current day for daily.
  const monthKey = currentMonthKey();
  const dayKey = currentDayKey();
  const prunedMonthly: QuotaData['monthly'] = {};
  if (data.monthly[monthKey]) prunedMonthly[monthKey] = data.monthly[monthKey];
  const prunedDaily: QuotaData['daily'] = {};
  if (data.daily[dayKey]) prunedDaily[dayKey] = data.daily[dayKey];

  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.FEATURE_QUOTA]: { monthly: prunedMonthly, daily: prunedDaily },
    });
  } catch {
    // chrome.storage unavailable (e.g. test environment)
  }
}

function getMonthlyCount(data: QuotaData, feature: MonthlyFeature): number {
  const monthKey = currentMonthKey();
  return data.monthly[monthKey]?.[feature] ?? 0;
}

function getDailyCount(data: QuotaData, feature: DailyFeature): number {
  const dayKey = currentDayKey();
  return data.daily[dayKey]?.[feature] ?? 0;
}

function getLimit(feature: TrackedFeature): number {
  const limits = getFreeLimits();
  switch (feature) {
    case 'multiTab':
      return limits.MAX_MONTHLY_MULTI_TAB;
    case 'dedup':
      return limits.MAX_MONTHLY_DEDUP;
    case 'formatConvert':
      return limits.MAX_MONTHLY_FORMAT_CONVERT;
    case 'liveMonitor':
      return limits.MAX_MONTHLY_LIVE_MONITOR;
    case 'colorCopy':
      return limits.MAX_MONTHLY_COLOR_COPY;
    case 'batchHighlight':
      return limits.MAX_MONTHLY_BATCH_HIGHLIGHT;
  }
}

/**
 * Check if a feature has remaining free quota.
 * Returns { allowed: true, remaining } or { allowed: false, limit, used }.
 */
export async function checkFeatureQuota(
  feature: TrackedFeature
): Promise<{ allowed: boolean; remaining: number; limit: number; used: number }> {
  const data = await loadQuotaData();
  const limit = getLimit(feature);
  const isMonthly = (MONTHLY_FEATURES as string[]).includes(feature);
  const used = isMonthly
    ? getMonthlyCount(data, feature as MonthlyFeature)
    : getDailyCount(data, feature as DailyFeature);
  const remaining = Math.max(0, limit - used);
  return { allowed: remaining > 0, remaining, limit, used };
}

/**
 * Increment usage count for a feature. Call this AFTER the feature has been
 * successfully used (not before — so failed attempts don't consume quota).
 * Returns updated remaining count.
 */
export async function incrementFeatureUsage(feature: TrackedFeature): Promise<number> {
  const data = await loadQuotaData();
  const limit = getLimit(feature);
  const isMonthly = (MONTHLY_FEATURES as string[]).includes(feature);

  if (isMonthly) {
    const monthKey = currentMonthKey();
    if (!data.monthly[monthKey]) {
      data.monthly[monthKey] = {
        multiTab: 0,
        dedup: 0,
        formatConvert: 0,
        liveMonitor: 0,
        colorCopy: 0,
      };
    }
    // Ensure the field exists — older monthly records may lack fields for
    // features added after the record was first created (e.g. colorCopy).
    if (data.monthly[monthKey][feature as MonthlyFeature] == null) {
      data.monthly[monthKey][feature as MonthlyFeature] = 0;
    }
    data.monthly[monthKey][feature as MonthlyFeature] += 1;
    await saveQuotaData(data);
    return Math.max(0, limit - data.monthly[monthKey][feature as MonthlyFeature]);
  } else {
    const dayKey = currentDayKey();
    if (!data.daily[dayKey]) {
      data.daily[dayKey] = { batchHighlight: 0 };
    }
    data.daily[dayKey][feature as DailyFeature] += 1;
    await saveQuotaData(data);
    return Math.max(0, limit - data.daily[dayKey][feature as DailyFeature]);
  }
}

/**
 * Get remaining quota for all tracked features at once.
 * Useful for displaying quota status in settings/UI.
 */
export async function getAllFeatureQuotas(): Promise<
  Record<TrackedFeature, { remaining: number; limit: number; used: number }>
> {
  const data = await loadQuotaData();
  const result = {} as Record<TrackedFeature, { remaining: number; limit: number; used: number }>;

  for (const feature of MONTHLY_FEATURES) {
    const limit = getLimit(feature);
    const used = getMonthlyCount(data, feature);
    result[feature] = { remaining: Math.max(0, limit - used), limit, used };
  }
  for (const feature of DAILY_FEATURES) {
    const limit = getLimit(feature);
    const used = getDailyCount(data, feature);
    result[feature] = { remaining: Math.max(0, limit - used), limit, used };
  }

  return result;
}

/**
 * Build the appropriate toast message when a feature quota check fails.
 * When limit is 0 the feature is Pro-exclusive — use a clean "Pro feature"
 * message instead of the confusing "0 times per month" wording.
 */
export function quotaBlockedMessage(
  translationFn: (key: string, params?: Record<string, string | number>) => string,
  featureI18nKey: string,
  limit: number
): string {
  if (limit === 0) {
    return translationFn('pro_feature_upgrade_required');
  }
  return translationFn('quota_exhausted_monthly', {
    feature: translationFn(featureI18nKey),
    limit: String(limit),
  });
}
