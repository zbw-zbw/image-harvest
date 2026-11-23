// Tests for shared/trial-pro-usage.ts — the record of which Pro features a
// trial has actually put to work, and the (previously silent) producer of
// PRO_FEATURE_USED.
//
// Scope:
//   - Only trial plans are recorded; free, paid and missing licences are not
//   - One record per feature per install, and the event fires exactly once
//   - getTrialProFeaturesUsed keeps first-use order and drops unknown keys
//     left behind by an older build
//   - Storage failures are swallowed (the feature itself must still run)
//
// Storage is a real in-memory Map behind a chrome stub, same shape as
// tests/trial-recap.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTrack } = vi.hoisted(() => ({
  mockTrack: vi.fn(() => Promise.resolve()),
}));

vi.mock('../shared/telemetry', () => ({
  track: mockTrack,
}));

import { EVENTS } from '../shared/telemetry-events';
import { getTrialProFeaturesUsed, recordProFeatureUse } from '../shared/trial-pro-usage';

const STORAGE_KEY = '_trial_pro_features_used';

let storage: Map<string, unknown>;

function installChromeStorage(): void {
  storage = new Map();
  (globalThis as unknown as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const wanted = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const key of wanted) {
            if (storage.has(key)) out[key] = storage.get(key);
          }
          return out;
        }),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(patch)) storage.set(key, value);
        }),
      },
    },
  };
}

function licenseWithPlan(plan: string): void {
  storage.set('licenseData', { key: 'HARVEST-TEST', plan });
}

beforeEach(() => {
  vi.clearAllMocks();
  installChromeStorage();
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('recordProFeatureUse', () => {
  it('stores the feature and fires PRO_FEATURE_USED for a trial plan', async () => {
    licenseWithPlan('trial');

    await recordProFeatureUse('dedup');

    expect(storage.get(STORAGE_KEY)).toEqual(['dedup']);
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith(EVENTS.PRO_FEATURE_USED, { feature: 'dedup' });
  });

  it('records each feature once, even on repeated use', async () => {
    licenseWithPlan('trial');

    await recordProFeatureUse('multiTab');
    await recordProFeatureUse('multiTab');
    await recordProFeatureUse('deepScan');

    expect(storage.get(STORAGE_KEY)).toEqual(['multiTab', 'deepScan']);
    expect(mockTrack).toHaveBeenCalledTimes(2);
    expect(mockTrack).toHaveBeenLastCalledWith(EVENTS.PRO_FEATURE_USED, { feature: 'deepScan' });
  });

  it('ignores paid, free and missing licences', async () => {
    licenseWithPlan('pro');
    await recordProFeatureUse('dedup');

    licenseWithPlan('free');
    await recordProFeatureUse('dedup');

    storage.delete('licenseData');
    await recordProFeatureUse('dedup');

    expect(storage.has(STORAGE_KEY)).toBe(false);
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('swallows storage failures so the user action still completes', async () => {
    licenseWithPlan('trial');
    (
      globalThis as unknown as { chrome: { storage: { local: { get: unknown } } } }
    ).chrome.storage.local.get = vi.fn(async () => {
      throw new Error('quota exceeded');
    });

    await expect(recordProFeatureUse('colorCopy')).resolves.toBeUndefined();
    expect(mockTrack).not.toHaveBeenCalled();
  });
});

describe('getTrialProFeaturesUsed', () => {
  it('returns an empty list when nothing was recorded', async () => {
    expect(await getTrialProFeaturesUsed()).toEqual([]);
  });

  it('preserves first-use order and drops unknown keys', async () => {
    storage.set(STORAGE_KEY, ['deepScan', 'removedFeature', 'formatConvert']);

    expect(await getTrialProFeaturesUsed()).toEqual(['deepScan', 'formatConvert']);
  });

  it('tolerates a non-array value from an older build', async () => {
    storage.set(STORAGE_KEY, { legacy: true });
    expect(await getTrialProFeaturesUsed()).toEqual([]);
  });
});
