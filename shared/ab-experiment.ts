// A/B experiment bucketing — Sprint 2.4.
//
// Decides which variant of a user-facing experiment a given install belongs
// to. Buckets are STABLE per install: hashing the persisted instance id
// means the same user always sees the same variant, no matter how many
// times they reopen the panel or which surface (sidepanel vs popup) they
// open from.
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
 * The single experiment slot for Sprint 2. We deliberately don't introduce
 * a per-experiment registry yet — only one in-flight test at a time keeps
 * the funnel math interpretable. When a second experiment lands, replace
 * this with `{ experimentId: string; bucket: AbBucket }` and migrate
 * callers.
 */
export const EXPERIMENT_PRO_UPSELL_COPY = 'pro_upsell_copy_v1';

// In-memory cache so `getProUpsellBucket()` is synchronous after the first
// resolution. The first caller does the chrome.storage.local round-trip
// once at startup; everything after that hits this cache.
let cachedBucket: AbBucket | null = null;

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
 * Map an instanceId to a stable bucket. Exported for tests; production
 * callers should use `getProUpsellBucket()` which adds caching.
 */
export function bucketFor(instanceId: string): AbBucket {
  // Salting with the experiment name means a future second experiment
  // assigns its buckets *independently* — a user can be in A for the
  // copy test and B for some later pricing test without correlated
  // assignment biasing the results.
  return fnv1a32(EXPERIMENT_PRO_UPSELL_COPY + ':' + instanceId) % 2 === 0 ? 'a' : 'b';
}

/**
 * Resolve the current install's bucket for the Pro upsell copy
 * experiment. Async because the underlying instanceId may not have been
 * created yet; subsequent calls hit the in-memory cache.
 */
export async function getProUpsellBucket(): Promise<AbBucket> {
  if (cachedBucket !== null) return cachedBucket;
  try {
    const id = await getOrCreateInstanceId();
    cachedBucket = bucketFor(id);
  } catch {
    // Falling back to 'a' on storage failure means a degraded user gets
    // the control variant. Better than crashing the upsell modal render.
    cachedBucket = 'a';
  }
  return cachedBucket;
}

/**
 * Synchronous accessor returning the previously-cached bucket. Returns
 * null if `getProUpsellBucket()` hasn't been awaited yet. Used by the
 * telemetry envelope injector which can't await on every track() call
 * — the bucket is seeded once at startup, then read synchronously per
 * event.
 */
export function getCachedBucket(): AbBucket | null {
  return cachedBucket;
}

// ── Test hooks ──────────────────────────────────────────────────────────────

export const __test = {
  reset(): void {
    cachedBucket = null;
  },
  /** Force the cached bucket (bypasses storage). Used by component tests
   * that need to render a specific variant without touching license.ts. */
  setBucket(bucket: AbBucket | null): void {
    cachedBucket = bucket;
  },
};
