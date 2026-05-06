// Anonymous telemetry SDK for Image Harvest.
//
// Design contract (see implementation_plan.md → "User Review Required"):
//   1. OPT-IN by default, but a single setOptIn(false) call must produce
//      complete silence — no buffering, no flush, no retry, nothing on disk.
//   2. ZERO PII. The envelope shipped to the server contains only:
//        - instanceIdHash (SHA-256 of the install id, truncated)
//        - extension version, ui locale, plan tag
//        - whitelisted event names + whitelisted prop keys
//      No URL, no page title, no image url, no IP (the server discards it
//      after country lookup), no user-typed text.
//   3. RESILIENT but not infinite: failed batches are persisted to
//      chrome.storage.local; the queue is capped at 100 events to prevent
//      a permanent outage from blowing up local storage.
//   4. CHEAP: 5-second batch window OR 20-event high-water mark, whichever
//      hits first. Background service workers go dormant aggressively, so
//      we also flush on `beforeunload` / port disconnect (callers wire
//      that, the SDK exposes flushNow()).
//
// This file is intentionally framework-agnostic: it can be imported from
// background, sidepanel, popup, content scripts. The only browser API it
// hard-depends on is `crypto.subtle` (available in MV3 service workers and
// all modern extension contexts) and `chrome.storage.local` (with a no-op
// fallback so unit tests in jsdom don't blow up).

import {
  TELEMETRY_API_URL,
  TELEMETRY_FLUSH_INTERVAL_MS,
  TELEMETRY_BATCH_SIZE,
  TELEMETRY_MAX_QUEUE,
} from './constants';
import {
  EVENT_PROP_SCHEMAS,
  EVENTS,
  isKnownEvent,
  sanitizeEventProps,
  type TelemetryEventName,
} from './telemetry-events';
import type { TelemetryAck, TelemetryEnvelope, TelemetryEvent, TelemetryProps } from './types';

// ── Storage keys ───────────────────────────────────────────────────────────
const STORAGE_KEY_OPT_IN = 'telemetryOptIn';
const STORAGE_KEY_QUEUE = 'telemetryQueue';
const STORAGE_KEY_INSTANCE_HASH = 'telemetryInstanceHash';
// Telemetry uses its OWN install id rather than reaching into shared/license.ts
// for two reasons:
//   1. Decoupling — license.ts depends on chrome.storage.local at module
//      load time, which forces every telemetry consumer (including unit
//      tests under node) to mock the chrome.* surface. Owning the id here
//      lets the SDK route everything through the test-injectable
//      StorageAdapter.
//   2. Privacy — the on-the-wire identifier is a SHA-256 truncated digest;
//      it doesn't matter whether the source string is the license-side
//      install id or one we generate ourselves. Keeping them separate
//      means a future privacy audit only has to inspect this file.
const STORAGE_KEY_INSTANCE_ID = 'telemetryInstanceId';

// ── Test-injectable adapters ───────────────────────────────────────────────
// Keep these as module-level mutable references so unit tests can swap them
// without monkey-patching globals. Production code never touches these
// outside of __resetForTests.

interface StorageAdapter {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

const defaultStorage: StorageAdapter = {
  async get<T = unknown>(key: string): Promise<T | undefined> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return undefined;
    const r = await chrome.storage.local.get(key);
    return r[key] as T | undefined;
  },
  async set(key, value) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [key]: value });
  },
  async remove(key) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.remove(key);
  },
};

let storage: StorageAdapter = defaultStorage;
let fetchImpl: typeof fetch =
  typeof fetch !== 'undefined'
    ? fetch.bind(globalThis)
    : ((async () => new Response('', { status: 0 })) as typeof fetch);
let nowImpl: () => number = () => Date.now();

// ── Module state ───────────────────────────────────────────────────────────
let queue: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let optInCache: boolean | null = null; // null = unread; true/false = decided
let instanceHashCache: string | null = null;
let envelopeMeta: { version: string; lang: string; plan: string; abBucket: string | null } = {
  version: '0.0.0',
  lang: 'en',
  plan: 'free',
  // A/B experiment bucket (Sprint 2.4). Null until shared/ab-experiment.ts
  // resolves and the host (background / sidepanel init) seeds it via
  // setEnvelopeMeta. When non-null, every event whose schema declares
  // `abBucket` as an allowed prop key gets it injected automatically —
  // see `track()` below.
  abBucket: null,
};
let inFlight = false; // prevents two concurrent flushes from sending dupes
// Tracks the promise of the currently-in-flight flush so test code (and
// any caller that needs strict drain semantics) can `await` on it. We use
// Promise.resolve() as the sentinel "nothing in flight" value so callers
// never have to null-check.
let inFlightPromise: Promise<void> = Promise.resolve();

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Set the stable envelope dimensions. Call this once during init from the
 * extension context (background reads pkg version from runtime, sidepanel
 * reads locale from chrome.i18n / settings, etc.). Cheap to call multiple
 * times — only updates the in-memory object.
 */
export function setEnvelopeMeta(meta: Partial<typeof envelopeMeta>): void {
  envelopeMeta = { ...envelopeMeta, ...meta };
}

/**
 * The single tracking entrypoint. Call sites should import EVENTS from
 * shared/telemetry-events.ts and pass the typed name:
 *
 *   track(EVENTS.SCAN_TRIGGERED, { mode: 'manual' });
 *
 * Contract:
 *   - If opt-in is false → instant no-op (no buffering, no fetch).
 *   - If event name is unknown → silent drop (dev console warn in DEV).
 *   - Props are sanitized client-side; server re-sanitizes as defense in depth.
 *   - Returns immediately; actual flushing is async + batched.
 */
export async function track(
  name: TelemetryEventName | string,
  props?: TelemetryProps
): Promise<void> {
  const opted = await isOptedIn();
  if (!opted) return;
  if (!isKnownEvent(name)) {
    if (typeof console !== 'undefined') {
      console.warn('[telemetry] unknown event dropped:', name);
    }
    return;
  }
  // Auto-inject the A/B bucket into any event whose schema declares
  // `abBucket` as an allowed prop key. Caller-provided abBucket wins
  // (lets a single emit override for testing); otherwise we stamp the
  // current envelope's bucket so the funnel can always join events to
  // a variant without us touching every track() call site.
  let mergedProps = props;
  if (envelopeMeta.abBucket && EVENT_PROP_SCHEMAS[name]?.includes('abBucket')) {
    if (!mergedProps || mergedProps.abBucket === undefined) {
      mergedProps = { ...(mergedProps ?? {}), abBucket: envelopeMeta.abBucket };
    }
  }
  const evt: TelemetryEvent = {
    event: name,
    ts: nowImpl(),
    props: sanitizeEventProps(name, mergedProps),
  };
  if (evt.props === undefined) delete evt.props;

  queue.push(evt);
  // High-water mark → flush immediately to bound memory usage.
  if (queue.length >= TELEMETRY_BATCH_SIZE) {
    void flushNow();
    return;
  }
  scheduleFlush();
}

/**
 * Force-flush pending events. Used by callers that know they're about to
 * lose context (port disconnect, before-unload, manual user trigger).
 * Always safe to call; concurrent flushes are coalesced — a second
 * concurrent caller awaits the in-flight one rather than racing it.
 *
 * The inFlightPromise tracking is what makes test isolation possible:
 * a `await flushNow()` from test code now genuinely drains everything,
 * including any prior fire-and-forget `void flushNow()` from track().
 */
export async function flushNow(): Promise<void> {
  if (inFlight) {
    // Coalesce: don't start a parallel flush, just await the current one.
    await inFlightPromise;
    return;
  }
  if (queue.length === 0) {
    // Still try to drain the persisted retry queue.
    inFlight = true;
    inFlightPromise = (async () => {
      try {
        await drainRetryQueue();
      } finally {
        inFlight = false;
      }
    })();
    await inFlightPromise;
    return;
  }
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  inFlight = true;
  const batch = queue.splice(0, TELEMETRY_BATCH_SIZE);
  inFlightPromise = (async () => {
    try {
      const ok = await sendBatch(batch);
      if (!ok) await persistForRetry(batch);
      else await drainRetryQueue();
    } finally {
      inFlight = false;
    }
  })();
  await inFlightPromise;
}

/**
 * Read the opt-in flag with caching. The first call reads from storage;
 * subsequent calls hit the in-memory cache until setOptIn() invalidates.
 * Defaults to TRUE (opt-in) when the user has never made a choice — see
 * implementation_plan.md "default opt-in but completely off-able".
 */
export async function isOptedIn(): Promise<boolean> {
  if (optInCache !== null) return optInCache;
  const v = await storage.get<boolean>(STORAGE_KEY_OPT_IN);
  optInCache = v === undefined ? true : Boolean(v);
  return optInCache;
}

/**
 * Persist the opt-in choice. When flipping to FALSE we synchronously drop
 * any pending in-memory events AND clear the on-disk retry queue, so a
 * user who opts out is genuinely silent from this moment on.
 */
export async function setOptIn(enabled: boolean): Promise<void> {
  optInCache = enabled;
  await storage.set(STORAGE_KEY_OPT_IN, enabled);
  if (!enabled) {
    queue = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await storage.remove(STORAGE_KEY_QUEUE);
  }
  // Record the consent decision itself so we have a count of opt-ins vs
  // opt-outs in the funnel. This event fires AFTER the cache flip, so
  // disabling correctly produces zero events from this point forward.
  if (enabled) {
    await track(EVENTS.TELEMETRY_OPT_IN);
  }
}

// ── Internals ──────────────────────────────────────────────────────────────

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, TELEMETRY_FLUSH_INTERVAL_MS);
}

async function getInstanceHash(): Promise<string> {
  if (instanceHashCache) return instanceHashCache;
  const cached = await storage.get<string>(STORAGE_KEY_INSTANCE_HASH);
  if (cached) {
    instanceHashCache = cached;
    return cached;
  }
  // Lazy-create our own install id. Same shape as shared/license.ts's
  // getOrCreateInstanceId but routed through the SDK's StorageAdapter so
  // tests don't need to mock chrome.* just to receive a hash.
  let id = await storage.get<string>(STORAGE_KEY_INSTANCE_ID);
  if (!id) {
    id = 'tinst_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    await storage.set(STORAGE_KEY_INSTANCE_ID, id);
  }
  const hash = await sha256Hex(id);
  instanceHashCache = hash.slice(0, 16);
  await storage.set(STORAGE_KEY_INSTANCE_HASH, instanceHashCache);
  return instanceHashCache;
}

/** SHA-256 → lowercase hex. Falls back to a deterministic non-crypto digest
 * only when SubtleCrypto is unavailable (jsdom in some test setups). The
 * fallback is acceptable because the digest is *not* a security boundary
 * — it just deduplicates installs in the funnel. */
async function sha256Hex(input: string): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle) {
    const buf = new TextEncoder().encode(input);
    const digest = await subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Non-crypto fallback (cyrb53-style) — only hits in degraded test envs.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(16, '0').repeat(4); // 64 hex chars to mirror SHA-256
}

async function buildEnvelope(events: TelemetryEvent[]): Promise<TelemetryEnvelope> {
  return {
    instanceIdHash: await getInstanceHash(),
    version: envelopeMeta.version,
    lang: envelopeMeta.lang,
    plan: envelopeMeta.plan,
    schemaVersion: 1,
    events,
  };
}

/** Returns true iff the server accepted the batch. Network/HTTP errors
 * resolve as `false` (NOT throw) so the caller can take the retry path. */
async function sendBatch(batch: TelemetryEvent[]): Promise<boolean> {
  try {
    const envelope = await buildEnvelope(batch);
    const resp = await fetchImpl(TELEMETRY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
      // Allow telemetry to land even on tab close / sw teardown.
      keepalive: true,
    });
    if (!resp.ok) return false;
    const ack = (await resp.json().catch(() => null)) as TelemetryAck | null;
    return Boolean(ack?.ok);
  } catch {
    return false;
  }
}

async function persistForRetry(batch: TelemetryEvent[]): Promise<void> {
  const existing = (await storage.get<TelemetryEvent[]>(STORAGE_KEY_QUEUE)) ?? [];
  const merged = existing.concat(batch);
  // Keep only the most recent N — drop oldest first. Old events are less
  // valuable (already-stale conversion data) and we MUST bound disk usage.
  const trimmed = merged.length > TELEMETRY_MAX_QUEUE ? merged.slice(-TELEMETRY_MAX_QUEUE) : merged;
  await storage.set(STORAGE_KEY_QUEUE, trimmed);
}

/** Try to ship anything that previously failed. Called opportunistically on
 * every successful flush so we don't need a separate retry timer. */
async function drainRetryQueue(): Promise<void> {
  const persisted = await storage.get<TelemetryEvent[]>(STORAGE_KEY_QUEUE);
  if (!persisted || persisted.length === 0) return;
  const ok = await sendBatch(persisted);
  if (ok) await storage.remove(STORAGE_KEY_QUEUE);
}

// ── Test hooks (do NOT use in production code) ─────────────────────────────

export const __test = {
  reset(): void {
    queue = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    optInCache = null;
    instanceHashCache = null;
    envelopeMeta = { version: '0.0.0', lang: 'en', plan: 'free', abBucket: null };
    inFlight = false;
    // CRITICAL: also reset inFlightPromise to a fresh resolved Promise.
    // The previous Promise reference may still be held by `await` chains
    // in microtask queue from the prior test; if we leak it forward, a
    // subsequent waitForIdle()/flushNow() coalesce check can mis-await
    // a stale Promise, leaving the new flush silently un-driven. This is
    // exactly what bit the "flushes once the 5s window elapses" case
    // when the full suite ran end-to-end.
    inFlightPromise = Promise.resolve();
    storage = defaultStorage;
    fetchImpl = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : fetchImpl;
    nowImpl = () => Date.now();
  },
  setStorage(adapter: StorageAdapter): void {
    storage = adapter;
  },
  setFetch(impl: typeof fetch): void {
    fetchImpl = impl;
  },
  setNow(impl: () => number): void {
    nowImpl = impl;
  },
  getQueueSnapshot(): TelemetryEvent[] {
    return [...queue];
  },
  /** Awaits the currently-in-flight flush (if any) so test code can be
   * sure no fire-and-forget Promise from `track()`'s high-water-mark
   * branch leaks into the next test case's mock fetch capture. */
  async waitForIdle(): Promise<void> {
    while (inFlight) {
      await inFlightPromise;
    }
  },
};
