// Unit tests for the QUOTA_TIGHTEN_V1 experiment overlay in getFreeLimits()
// (shared/constants.ts).
//
// What we pin:
//   - Bucket b tightens MAX_ZIP_IMAGES to the fixed treatment value (10),
//     overriding BOTH the hardcoded default and remote config — the overlay
//     must win so the experiment survives admin-limit changes mid-flight.
//   - Bucket a and the not-yet-resolved state (null) keep the merged
//     control value: unresolved buckets conservatively serve control.
//   - Single variable: no other limit key changes in bucket b.
//   - FREE_LIMITS constant is never mutated (callers get a copy).
//
// The bucket is seeded via ab-experiment's __test.setBucket (which mirrors to
// globalThis.__abBuckets exactly like production getExperimentBucket) so no
// chrome storage is touched. Remote config is faked through the same
// globalThis.__remoteConfig key remote-config.ts populates in production.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EXPERIMENTS, __test } from '../shared/ab-experiment';
import { FREE_LIMITS, getFreeLimits } from '../shared/constants';

beforeEach(() => {
  __test.reset();
});

afterEach(() => {
  __test.reset();
  delete (globalThis as Record<string, unknown>).__remoteConfig;
  delete (globalThis as Record<string, unknown>).__abBuckets;
});

function setRemote(config: Record<string, unknown>): void {
  (globalThis as Record<string, unknown>).__remoteConfig = config;
}

describe('QUOTA_TIGHTEN_V1 overlay in getFreeLimits', () => {
  it('bucket b tightens MAX_ZIP_IMAGES to the fixed treatment value (10)', () => {
    __test.setBucket('b', EXPERIMENTS.QUOTA_TIGHTEN_V1);
    expect(getFreeLimits().MAX_ZIP_IMAGES).toBe(FREE_LIMITS.QUOTA_TIGHTEN_B_MAX_ZIP_IMAGES);
    expect(getFreeLimits().MAX_ZIP_IMAGES).toBe(10);
  });

  it('bucket b wins over remote config (experiment must survive admin changes)', () => {
    setRemote({ maxZipImages: 30 });
    __test.setBucket('b', EXPERIMENTS.QUOTA_TIGHTEN_V1);
    expect(getFreeLimits().MAX_ZIP_IMAGES).toBe(10);
  });

  it('bucket a keeps the remote value (true control)', () => {
    setRemote({ maxZipImages: 30 });
    __test.setBucket('a', EXPERIMENTS.QUOTA_TIGHTEN_V1);
    expect(getFreeLimits().MAX_ZIP_IMAGES).toBe(30);
  });

  it('unresolved bucket (null) conservatively serves control', () => {
    setRemote({ maxZipImages: 30 });
    expect(getFreeLimits().MAX_ZIP_IMAGES).toBe(30);

    delete (globalThis as Record<string, unknown>).__remoteConfig;
    expect(getFreeLimits().MAX_ZIP_IMAGES).toBe(FREE_LIMITS.MAX_ZIP_IMAGES);
    expect(FREE_LIMITS.MAX_ZIP_IMAGES).toBe(50);
  });

  it('single variable — bucket b changes ONLY the zip quota', () => {
    setRemote({
      maxZipImages: 30,
      maxBatchCopyUrls: 7,
      maxMonthlyLinkResolve: 9,
    });
    __test.setBucket('b', EXPERIMENTS.QUOTA_TIGHTEN_V1);
    const limits = getFreeLimits();

    expect(limits.MAX_ZIP_IMAGES).toBe(10);
    expect(limits.MAX_BATCH_COPY_URLS).toBe(7);
    expect(limits.MAX_MONTHLY_LINK_RESOLVE).toBe(9);
  });

  it('never mutates the FREE_LIMITS constant', () => {
    __test.setBucket('b', EXPERIMENTS.QUOTA_TIGHTEN_V1);
    getFreeLimits();
    expect(FREE_LIMITS.MAX_ZIP_IMAGES).toBe(50);
  });

  it('other experiments do not trigger the overlay', () => {
    __test.setBucket('b'); // default experiment = PRO_UPSELL_COPY
    expect(getFreeLimits().MAX_ZIP_IMAGES).toBe(FREE_LIMITS.MAX_ZIP_IMAGES);
  });

  it('reads the bucket from the globalThis mirror (the contract constants.ts depends on)', () => {
    // Production wiring: getExperimentBucket resolves → ab-experiment mirrors
    // to globalThis.__abBuckets → getFreeLimits reads it. Simulate the mirror
    // directly to pin that constants.ts never imports ab-experiment.
    const holder = globalThis as Record<string, unknown>;
    holder.__abBuckets = { quota_tighten_v1: 'b' };
    expect(getFreeLimits().MAX_ZIP_IMAGES).toBe(10);
  });
});
