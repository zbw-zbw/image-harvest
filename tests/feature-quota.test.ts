// Unit tests for shared/feature-quota.ts — monthly/daily usage tracking
// with chrome.storage.local persistence. Focus: the v1.1.0 linkResolve
// feature (3 free resolves/month) plus the generic quota mechanics it
// shares with the other tracked features.
//
// Storage schema (STORAGE_KEYS.FEATURE_QUOTA):
//   { monthly: { "2026-06": { multiTab: 2, ..., linkResolve: 1 } },
//     daily:   { "2026-06-04": { batchHighlight: 2 } } }

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock chrome.storage.local — in-memory object shared per test.
const mockStorage: Record<string, unknown> = {};
const chromeStorageMock = {
  local: {
    get: vi.fn(async (key: string) => {
      return { [key]: mockStorage[key] };
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(mockStorage, items);
    }),
  },
};
vi.stubGlobal('chrome', { storage: chromeStorageMock });

import {
  checkFeatureQuota,
  incrementFeatureUsage,
  getAllFeatureQuotas,
  quotaBlockedMessage,
  type MonthlyFeature,
} from '../shared/feature-quota';
import { STORAGE_KEYS, FREE_LIMITS } from '../shared/constants';

/** Mirrors currentMonthKey() — UTC-based like the implementation. */
function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Build a stored featureQuota blob with a single monthly feature count. */
function storedMonthly(feature: MonthlyFeature, count: number): void {
  mockStorage[STORAGE_KEYS.FEATURE_QUOTA] = {
    monthly: { [currentMonth()]: { [feature]: count } },
    daily: {},
  };
}

beforeEach(() => {
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// linkResolve — the v1.1.0 feature
// ─────────────────────────────────────────────────────────────────────

describe('checkFeatureQuota — linkResolve', () => {
  it('fresh storage → allowed with full 3-resolve monthly quota', async () => {
    const quota = await checkFeatureQuota('linkResolve');
    expect(quota).toEqual({
      allowed: true,
      remaining: FREE_LIMITS.MAX_MONTHLY_LINK_RESOLVE,
      limit: FREE_LIMITS.MAX_MONTHLY_LINK_RESOLVE,
      used: 0,
    });
    expect(quota.limit).toBe(3);
  });

  it('partially used quota → allowed with correct remaining', async () => {
    storedMonthly('linkResolve', 2);
    const quota = await checkFeatureQuota('linkResolve');
    expect(quota).toEqual({ allowed: true, remaining: 1, limit: 3, used: 2 });
  });

  it('exhausted quota → not allowed, remaining clamped to 0', async () => {
    storedMonthly('linkResolve', 3);
    const quota = await checkFeatureQuota('linkResolve');
    expect(quota.allowed).toBe(false);
    expect(quota.remaining).toBe(0);
    expect(quota.used).toBe(3);
  });

  it('over-quota (server-side raised then lowered) → remaining stays clamped at 0', async () => {
    storedMonthly('linkResolve', 7);
    const quota = await checkFeatureQuota('linkResolve');
    expect(quota.allowed).toBe(false);
    expect(quota.remaining).toBe(0);
  });
});

describe('incrementFeatureUsage — linkResolve', () => {
  it('increments from zero and returns remaining', async () => {
    const remaining = await incrementFeatureUsage('linkResolve');
    expect(remaining).toBe(2);
    const stored = mockStorage[STORAGE_KEYS.FEATURE_QUOTA] as {
      monthly: Record<string, Record<string, number>>;
    };
    expect(stored.monthly[currentMonth()].linkResolve).toBe(1);
  });

  it('increments existing count toward the limit', async () => {
    storedMonthly('linkResolve', 2);
    const remaining = await incrementFeatureUsage('linkResolve');
    expect(remaining).toBe(0);
  });

  it('third increment exhausts the quota and a fourth still returns 0', async () => {
    await incrementFeatureUsage('linkResolve');
    await incrementFeatureUsage('linkResolve');
    expect(await incrementFeatureUsage('linkResolve')).toBe(0);
    // Past the limit the counter keeps going but remaining floors at 0.
    expect(await incrementFeatureUsage('linkResolve')).toBe(0);
    const stored = mockStorage[STORAGE_KEYS.FEATURE_QUOTA] as {
      monthly: Record<string, Record<string, number>>;
    };
    expect(stored.monthly[currentMonth()].linkResolve).toBe(4);
  });

  it('monthly record created by an OLDER version lacking linkResolve is upgraded in place', async () => {
    // Pin: the field-backfill branch — a v1.0.x monthly record has no
    // linkResolve key. Without `== null → 0` initialization, the
    // increment would produce NaN and permanently corrupt the record.
    mockStorage[STORAGE_KEYS.FEATURE_QUOTA] = {
      monthly: { [currentMonth()]: { multiTab: 1 } },
      daily: {},
    };

    const remaining = await incrementFeatureUsage('linkResolve');
    expect(remaining).toBe(2);
    const stored = mockStorage[STORAGE_KEYS.FEATURE_QUOTA] as {
      monthly: Record<string, Record<string, number>>;
    };
    expect(stored.monthly[currentMonth()].linkResolve).toBe(1);
    // Sibling feature counters survive the upgrade untouched.
    expect(stored.monthly[currentMonth()].multiTab).toBe(1);
  });

  it('prunes stale months on save (only current month kept)', async () => {
    mockStorage[STORAGE_KEYS.FEATURE_QUOTA] = {
      monthly: {
        '2020-01': { linkResolve: 99 },
        [currentMonth()]: { linkResolve: 1 },
      },
      daily: {},
    };

    await incrementFeatureUsage('linkResolve');
    const stored = mockStorage[STORAGE_KEYS.FEATURE_QUOTA] as {
      monthly: Record<string, unknown>;
    };
    expect(Object.keys(stored.monthly)).toEqual([currentMonth()]);
  });
});

describe('getAllFeatureQuotas — linkResolve registration', () => {
  it('includes linkResolve with the default free limit', async () => {
    const quotas = await getAllFeatureQuotas();
    expect(quotas.linkResolve).toBeDefined();
    expect(quotas.linkResolve.limit).toBe(FREE_LIMITS.MAX_MONTHLY_LINK_RESOLVE);
    expect(quotas.linkResolve.used).toBe(0);
  });

  it('reports used counts for linkResolve alongside the other features', async () => {
    storedMonthly('linkResolve', 2);
    const quotas = await getAllFeatureQuotas();
    expect(quotas.linkResolve).toEqual({ remaining: 1, limit: 3, used: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────
// quotaBlockedMessage — shared toast builder
// ─────────────────────────────────────────────────────────────────────

describe('quotaBlockedMessage', () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key;

  it('non-zero limit → monthly quota-exhausted wording with feature name + limit', () => {
    const message = quotaBlockedMessage(t, 'feature_link_resolve', 3);
    expect(message).toContain('quota_exhausted_monthly');
    expect(message).toContain('feature_link_resolve');
    expect(message).toContain('"limit":"3"');
  });

  it('zero limit → clean Pro-exclusive upgrade wording (no "0 times per month")', async () => {
    // Pin: features with limit 0 (Pro-exclusive) must NOT render the
    // absurd "0 times per month" string.
    const message = quotaBlockedMessage(t, 'feature_color_filter', 0);
    expect(message).toBe('pro_feature_upgrade_required');
  });
});

// ─────────────────────────────────────────────────────────────────────
// deepScan — the v1.2.0 daily-quota feature (3 free scans/day)
// ─────────────────────────────────────────────────────────────────────

/** Mirrors currentDayKey() — UTC-based like the implementation. */
function currentDay(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Build a stored featureQuota blob with a single daily feature count. */
function storedDaily(feature: 'batchHighlight' | 'deepScan', count: number): void {
  mockStorage[STORAGE_KEYS.FEATURE_QUOTA] = {
    monthly: {},
    daily: { [currentDay()]: { [feature]: count } },
  };
}

describe('checkFeatureQuota — deepScan (daily)', () => {
  it('fresh storage → allowed with full 3-scan daily quota', async () => {
    const quota = await checkFeatureQuota('deepScan');
    expect(quota).toEqual({
      allowed: true,
      remaining: FREE_LIMITS.MAX_DAILY_DEEP_SCAN,
      limit: FREE_LIMITS.MAX_DAILY_DEEP_SCAN,
      used: 0,
    });
    expect(quota.limit).toBe(3);
  });

  it('exhausted daily quota → not allowed, remaining clamped to 0', async () => {
    storedDaily('deepScan', 3);
    const quota = await checkFeatureQuota('deepScan');
    expect(quota.allowed).toBe(false);
    expect(quota.remaining).toBe(0);
    expect(quota.used).toBe(3);
  });
});

describe('incrementFeatureUsage — deepScan (daily)', () => {
  it('increments from zero and returns remaining', async () => {
    const remaining = await incrementFeatureUsage('deepScan');
    expect(remaining).toBe(2);
    const stored = mockStorage[STORAGE_KEYS.FEATURE_QUOTA] as {
      daily: Record<string, Record<string, number>>;
    };
    expect(stored.daily[currentDay()].deepScan).toBe(1);
  });

  it('daily record created by an OLDER version lacking deepScan is upgraded in place (no NaN)', async () => {
    // Pin the == null → 0 backfill: a v1.1.x daily record only has
    // batchHighlight; without the guard, `undefined += 1` yields NaN and
    // permanently corrupts the record.
    mockStorage[STORAGE_KEYS.FEATURE_QUOTA] = {
      monthly: {},
      daily: { [currentDay()]: { batchHighlight: 2 } },
    };

    const remaining = await incrementFeatureUsage('deepScan');
    expect(remaining).toBe(2);
    const stored = mockStorage[STORAGE_KEYS.FEATURE_QUOTA] as {
      daily: Record<string, Record<string, number>>;
    };
    expect(stored.daily[currentDay()].deepScan).toBe(1);
    expect(stored.daily[currentDay()].batchHighlight).toBe(2);
  });

  it('prunes stale days on save (only current day kept)', async () => {
    mockStorage[STORAGE_KEYS.FEATURE_QUOTA] = {
      monthly: {},
      daily: {
        '2020-01-01': { deepScan: 99 },
        [currentDay()]: { deepScan: 1 },
      },
    };

    await incrementFeatureUsage('deepScan');
    const stored = mockStorage[STORAGE_KEYS.FEATURE_QUOTA] as {
      daily: Record<string, unknown>;
    };
    expect(Object.keys(stored.daily)).toEqual([currentDay()]);
  });
});

describe('getAllFeatureQuotas — deepScan registration', () => {
  it('includes deepScan with the default free limit', async () => {
    const quotas = await getAllFeatureQuotas();
    expect(quotas.deepScan).toBeDefined();
    expect(quotas.deepScan.limit).toBe(FREE_LIMITS.MAX_DAILY_DEEP_SCAN);
    expect(quotas.deepScan.used).toBe(0);
  });
});

describe('quotaBlockedMessage — daily period', () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key;

  it('daily feature → quota_exhausted_daily wording (not monthly)', () => {
    const message = quotaBlockedMessage(t, 'feature_deep_scan', 3, 'daily');
    expect(message).toContain('quota_exhausted_daily');
    expect(message).toContain('feature_deep_scan');
    expect(message).toContain('"limit":"3"');
  });

  it('default period stays monthly (backwards compatible)', () => {
    const message = quotaBlockedMessage(t, 'feature_link_resolve', 3);
    expect(message).toContain('quota_exhausted_monthly');
  });
});
