// A/B experiment bucketing — Sprint 2.4, generalized to a multi-experiment
// registry ahead of conversion-optimization Phase 2.
//
// Decides which variant of a user-facing experiment a given install belongs
// to. Buckets are STABLE per install AND per experiment: hashing the
// persisted instance id salted with the experiment id means the same user
// always sees the same variant of a given test, while two experiments
// assign their buckets independently (no correlated assignment biasing
// results).
//
// Why not chrome.storage random-coin-flip on first open?
//   1. Determinism makes debugging trivially reproducible — given an
//      instanceId, you can predict the bucket without round-tripping
//      storage.
//   2. We avoid a "first-open assigned bucket" race in MV3 service workers
//      where two simultaneous reads can both think they're the first.
//   3. The hash is one-way; we never expose the raw instanceId, only its
//      mod-N output.
//
// ⚠️ ASSIGNMENT STABILITY CONTRACT: the salt format `${experimentId}:${id}`
// and the FNV-1a hash MUST never change for a live experiment — reshuffling
// buckets mid-flight invalidates its funnel data. tests/ab-experiment.test.ts
// pins known id→bucket pairs to enforce this.
//
// Privacy note: the underlying instanceId is the SAME identifier
// shared/license.ts uses (getOrCreateInstanceId), but the *output* of
// this module is just an enum-like bucket label ("a" | "b"). The label
// is what ships in telemetry, NOT the instanceId. See telemetry.ts for
// how the bucket gets injected into every event envelope.

import { getOrCreateInstanceId } from './license';

/**
 * Allowed bucket labels. Two-bucket A/B is the only mode we support today;
 * extending to A/B/C/... is a matter of growing this union and updating
 * the modulo in `bucketFor`.
 */
export type AbBucket = 'a' | 'b';

/**
 * Experiment registry — the single place new experiments are declared.
 *
 * To launch a new experiment:
 *   1. Add an entry here with a unique, versioned id (e.g. 'paywall_copy_v1').
 *      The id is the hash salt — NEVER reuse or rename a live id.
 *   2. Read the bucket at the surface via getExperimentBucket(EXPERIMENTS.X).
 *   3. Ship the bucket explicitly in that surface's telemetry props (the
 *      envelope-level `abBucket` stays reserved for PRO_UPSELL_COPY for
 *      backward compatibility with the existing funnel).
 *   4. Retire by deleting the entry once the experiment concludes.
 */
export const EXPERIMENTS = {
  PRO_UPSELL_COPY: 'pro_upsell_copy_v1',
  /**
   * Phase-2a activation experiment. a = legacy welcome (CTA closes the
   * tab), b = guided onboarding (CTA opens the side panel on the welcome
   * page's demo gallery + coach marks until the first download).
   * Primary metric: share of installs completing a first download within
   * 7 days (onboarding_download_done vs download_* baseline).
   */
  ONBOARDING_FLOW: 'onboarding_flow_v1',
  /**
   * Conversion diagnosis experiment (2026-09). Usage data shows free users
   * never reach the zip quota wall, so no purchase pressure ever forms.
   * a = control (current limits: remote config or FREE_LIMITS default),
   * b = treatment: per-batch zip quota tightened to a fixed 10 (single
   * variable — see getFreeLimits overlay). Primary signal: does
   * pro_feature_blocked(feature=batch_zip) fire, and does anyone flow to
   * soft_paywall_* → checkout. Sample is small (~350 installs): read
   * direction only, no significance testing.
   */
  QUOTA_TIGHTEN_V1: 'quota_tighten_v1',
} as const;
export type ExperimentId = (typeof EXPERIMENTS)[keyof typeof EXPERIMENTS];

/** Back-compat alias — pre-registry callers/tests import this name. */
export const EXPERIMENT_PRO_UPSELL_COPY = EXPERIMENTS.PRO_UPSELL_COPY;

// In-memory cache keyed by experiment id so `getCachedBucket()` is
// synchronous after the first resolution. The first caller does the
// chrome.storage.local round-trip once at startup; everything after that
// hits this cache.
const cachedBuckets = new Map<string, AbBucket>();

/**
 * Cheap, deterministic 32-bit hash of a UTF-8 string. We use FNV-1a
 * because (a) it has no external dependency, (b) it's perfectly
 * adequate for uniform bucketing, (c) it can run in any JS context
 * including the MV3 service worker where SubtleCrypto is async-only
 * and we want a sync answer.
 *
 * NOT cryptographic — we never use this for anything where hash
 * collisions or preimage attacks would matter. Bucketing is the only
 * consumer.
 */
function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime multiplication via Math.imul keeps us in the
    // signed-int range; the `>>> 0` at the end converts back to unsigned.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Map an instanceId to a stable bucket for a given experiment. Exported for
 * tests; production callers should use `getExperimentBucket()` which adds
 * caching. Defaults to the Pro-upsell experiment for pre-registry callers.
 *
 * Salting with the experiment id means every experiment assigns its buckets
 * *independently* — a user can be in A for the copy test and B for some
 * later pricing test without correlated assignment biasing the results.
 */
export function bucketFor(
  instanceId: string,
  experimentId: string = EXPERIMENTS.PRO_UPSELL_COPY
): AbBucket {
  return fnv1a32(experimentId + ':' + instanceId) % 2 === 0 ? 'a' : 'b';
}

/**
 * Resolve the current install's bucket for an experiment. Async because the
 * underlying instanceId may not have been created yet; subsequent calls hit
 * the in-memory cache.
 */
export async function getExperimentBucket(experimentId: ExperimentId): Promise<AbBucket> {
  const cached = cachedBuckets.get(experimentId);
  if (cached) return cached;
  // E2E builds pin quota experiments to the control bucket: suites like
  // download-many-warning.e2e.ts assert behavior against FREE_LIMITS
  // defaults, and a persistent context that happens to hash into 'b' would
  // change enforced limits mid-suite. Not cached so production behavior
  // is untouched by this branch.
  if (typeof __E2E__ !== 'undefined' && __E2E__ && experimentId === EXPERIMENTS.QUOTA_TIGHTEN_V1) {
    return 'a';
  }
  let bucket: AbBucket;
  try {
    const id = await getOrCreateInstanceId();
    bucket = bucketFor(id, experimentId);
  } catch {
    // Falling back to 'a' on storage failure means a degraded user gets
    // the control variant. Better than crashing the surface's render.
    bucket = 'a';
  }
  cachedBuckets.set(experimentId, bucket);
  mirrorBucketsToGlobalThis();
  return bucket;
}

/**
 * Mirror every resolved bucket onto globalThis so synchronous consumers
 * that must NOT import this module (constants.ts > getFreeLimits — a static
 * import there would drag license.ts into the whole repo's loading graph and
 * break vi.mock hoisting in test files) can read experiment state.
 * Keyed by experiment id; written on every resolution.
 */
function mirrorBucketsToGlobalThis(): void {
  const holder = globalThis as Record<string, unknown>;
  holder.__abBuckets = Object.fromEntries(cachedBuckets);
}

/** Back-compat wrapper for the original single-experiment API. */
export async function getProUpsellBucket(): Promise<AbBucket> {
  return getExperimentBucket(EXPERIMENTS.PRO_UPSELL_COPY);
}

/**
 * Synchronous accessor returning the previously-cached bucket. Returns
 * null if the experiment's bucket hasn't been awaited yet. Used by the
 * telemetry envelope injector which can't await on every track() call
 * — the bucket is seeded once at startup, then read synchronously per
 * event. Defaults to the Pro-upsell experiment (the envelope-level
 * `abBucket` prop) for backward compatibility.
 */
export function getCachedBucket(
  experimentId: ExperimentId = EXPERIMENTS.PRO_UPSELL_COPY
): AbBucket | null {
  return cachedBuckets.get(experimentId) ?? null;
}

// ── Test hooks ──────────────────────────────────────────────────────────────

export const __test = {
  reset(): void {
    cachedBuckets.clear();
    mirrorBucketsToGlobalThis();
  },
  /** Force a cached bucket (bypasses storage). Used by component tests
   * that need to render a specific variant without touching license.ts.
   * Passing null clears that experiment's cache entry. */
  setBucket(
    bucket: AbBucket | null,
    experimentId: ExperimentId = EXPERIMENTS.PRO_UPSELL_COPY
  ): void {
    if (bucket === null) {
      cachedBuckets.delete(experimentId);
    } else {
      cachedBuckets.set(experimentId, bucket);
    }
    mirrorBucketsToGlobalThis();
  },
};
