// Telemetry event catalog — single source of truth for event names and the
// shape of their `props` payload.
//
// Why a separate file from shared/telemetry.ts?
//   - The SDK (telemetry.ts) is concerned with transport, batching, retry,
//     opt-in. It must stay small so it can be inlined into background and
//     content/sidepanel bundles without dragging the full event catalog
//     into every consumer.
//   - This module is the *catalog*: what events exist, and what props they
//     accept. Both the client (for type-safe `track()` calls) and the
//     server (for whitelist validation) import from here.
//
// Privacy contract (enforced by code review, not by types):
//   - No prop value may contain a URL, page title, image URL, file path,
//     query string, or any free-form user-typed text.
//   - No prop key may identify a single user (no email, no IP, no userId).
//   - When in doubt, omit the prop. The funnel only needs *counts* per
//     bucket, not contents.

import type { TelemetryProps } from './types';

// ── Event names ────────────────────────────────────────────────────────────
// Grouped by funnel stage. Comment the *intent* of each event — future
// contributors should know whether it's safe to add new call sites.
export const EVENTS = {
  // Install / activation funnel
  EXTENSION_INSTALLED: 'ext_installed', // chrome.runtime.onInstalled (reason=install)
  EXTENSION_UPDATED: 'ext_updated', // chrome.runtime.onInstalled (reason=update)
  EXTENSION_FIRST_OPEN: 'ext_first_open', // first sidepanel/popup open ever

  // Privacy / consent
  TELEMETRY_OPT_IN: 'telemetry_opt_in',
  TELEMETRY_OPT_OUT: 'telemetry_opt_out',

  // Core usage funnel
  SCAN_TRIGGERED: 'scan_triggered',
  SCAN_COMPLETED: 'scan_completed', // props: { count: number, durationMs: number }
  IMAGES_SHOWN: 'images_shown', // props: { count: number }
  DOWNLOAD_SINGLE: 'download_single', // props: { format?: string }
  DOWNLOAD_BATCH: 'download_batch', // props: { count: number }
  COPY_URL_SINGLE: 'copy_url_single',
  COPY_URL_BATCH: 'copy_url_batch', // props: { count: number }

  // ⭐ Conversion funnel — the events that decide whether revenue happens
  PRO_UPSELL_SHOWN: 'pro_upsell_shown', // props: { trigger: string }
  PRO_UPSELL_DISMISSED: 'pro_upsell_dismissed',
  PRO_UPSELL_CTA_CLICKED: 'pro_upsell_cta_clicked', // "Get Pro →" / "Start Free Trial"
  PRICING_PAGE_VIEWED: 'pricing_viewed', // fired by the marketing site, not the extension
  CHECKOUT_STARTED: 'checkout_started', // fired by the marketing site
  LICENSE_ACTIVATED: 'license_activated', // props: { plan: string }
  TRIAL_STARTED: 'trial_started',
  TRIAL_AUTO_STARTED: 'trial_auto_started', // props: { source: 'install' | 'update' }
  TRIAL_EXPIRED: 'trial_expired',

  // Welcome page (Phase 2)
  WELCOME_PAGE_VIEWED: 'welcome_page_viewed', // props: { source: string }
  WELCOME_CTA_CLICKED: 'welcome_cta_clicked', // props: { action: string }

  // Eagle export (Phase 5)
  EXPORT_EAGLE_STARTED: 'export_eagle_started', // props: { count: number }
  EXPORT_EAGLE_COMPLETED: 'export_eagle_completed', // props: { count, durationMs }
  EXPORT_EAGLE_FAILED: 'export_eagle_failed', // props: { reason: string }

  // AI tagging (Phase 4)
  AI_TAG_REQUESTED: 'ai_tag_requested',
  AI_TAG_COMPLETED: 'ai_tag_completed', // props: { tagCount: number }
  AI_TAG_FAILED: 'ai_tag_failed', // props: { reason: string }
  AI_QUOTA_EXHAUSTED: 'ai_quota_exhausted',

  // Pro-feature touchpoints — tells us WHICH paywall is most effective
  PRO_FEATURE_BLOCKED: 'pro_feature_blocked', // props: { feature: string }
  PRO_FEATURE_USED: 'pro_feature_used', // props: { feature: string } (Pro users)

  // Soft paywall (Sprint 2)
  SOFT_PAYWALL_SHOWN: 'soft_paywall_shown',
  SOFT_PAYWALL_DISMISSED: 'soft_paywall_dismissed',
  SOFT_PAYWALL_CTA_CLICKED: 'soft_paywall_cta_clicked',

  // Health / errors (counts only, never the message)
  ERROR_OCCURRED: 'error_occurred', // props: { code: string }
} as const;

export type TelemetryEventName = (typeof EVENTS)[keyof typeof EVENTS];

// ── Server-side whitelist ──────────────────────────────────────────────────
// The receiver MUST drop any event whose name is not in this Set. This is a
// defense in depth: if the client is ever compromised or a bad SDK build
// ships, we don't pollute the table with arbitrary strings.
export const TELEMETRY_EVENT_WHITELIST: ReadonlySet<string> = new Set(Object.values(EVENTS));

// ── Allowed prop keys per event ────────────────────────────────────────────
// Keys NOT listed here are dropped server-side (and ideally never set
// client-side). Values are still constrained to TelemetryPropValue
// (string | number | boolean) by the type system.
//
// `*` here means "any whitelisted prop key is allowed for this event"; we
// don't currently use it because every event below has an explicit, narrow
// shape. If you need a new event, add it to EVENTS first AND add its prop
// keys here AND update the server whitelist test.
export const EVENT_PROP_SCHEMAS: Record<TelemetryEventName, readonly string[]> = {
  [EVENTS.EXTENSION_INSTALLED]: [],
  [EVENTS.EXTENSION_UPDATED]: ['fromVersion', 'toVersion'],
  [EVENTS.EXTENSION_FIRST_OPEN]: [],

  [EVENTS.TELEMETRY_OPT_IN]: [],
  [EVENTS.TELEMETRY_OPT_OUT]: [],

  [EVENTS.SCAN_TRIGGERED]: ['mode'], // mode: "auto" | "manual" | "rescan"
  [EVENTS.SCAN_COMPLETED]: ['count', 'durationMs'],
  [EVENTS.IMAGES_SHOWN]: ['count'],
  [EVENTS.DOWNLOAD_SINGLE]: ['format'],
  [EVENTS.DOWNLOAD_BATCH]: ['count'],
  [EVENTS.COPY_URL_SINGLE]: [],
  [EVENTS.COPY_URL_BATCH]: ['count'],

  // ⭐ Conversion funnel — abBucket is auto-injected by shared/telemetry.ts
  // from the envelope meta when the event schema declares it. We list it
  // explicitly on every conversion event so the funnel can slice control
  // vs. variant on EVERY step (shown / dismissed / cta / pricing / checkout
  // / activated / trial). Adding abBucket later requires a backfill, which
  // is painful — better to overdeclare now.
  [EVENTS.PRO_UPSELL_SHOWN]: ['trigger', 'abBucket'],
  [EVENTS.PRO_UPSELL_DISMISSED]: ['trigger', 'abBucket'],
  [EVENTS.PRO_UPSELL_CTA_CLICKED]: ['trigger', 'abBucket', 'cta'], // cta: "trial" | "pricing" | "activate" | "get_pro"
  [EVENTS.PRICING_PAGE_VIEWED]: ['referrer', 'abBucket'], // referrer: "extension" | "google" | "direct" | ...
  [EVENTS.CHECKOUT_STARTED]: ['plan', 'abBucket'],
  [EVENTS.LICENSE_ACTIVATED]: ['plan', 'abBucket'],
  [EVENTS.TRIAL_STARTED]: ['abBucket'],
  [EVENTS.TRIAL_AUTO_STARTED]: ['source', 'abBucket'],
  [EVENTS.TRIAL_EXPIRED]: ['abBucket'],

  [EVENTS.WELCOME_PAGE_VIEWED]: ['source'],
  [EVENTS.WELCOME_CTA_CLICKED]: ['action'],

  [EVENTS.EXPORT_EAGLE_STARTED]: ['count'],
  [EVENTS.EXPORT_EAGLE_COMPLETED]: ['count', 'durationMs'],
  [EVENTS.EXPORT_EAGLE_FAILED]: ['reason'],

  [EVENTS.AI_TAG_REQUESTED]: [],
  [EVENTS.AI_TAG_COMPLETED]: ['tagCount'],
  [EVENTS.AI_TAG_FAILED]: ['reason'],
  [EVENTS.AI_QUOTA_EXHAUSTED]: [],

  [EVENTS.PRO_FEATURE_BLOCKED]: ['feature', 'abBucket'],
  [EVENTS.PRO_FEATURE_USED]: ['feature'],

  [EVENTS.SOFT_PAYWALL_SHOWN]: ['triggerCount', 'abBucket'], // download count threshold
  [EVENTS.SOFT_PAYWALL_DISMISSED]: ['action', 'abBucket'], // action: "later" | "close"
  [EVENTS.SOFT_PAYWALL_CTA_CLICKED]: ['action', 'abBucket'], // action: "trial" | "pricing"

  [EVENTS.ERROR_OCCURRED]: ['code'],
};

// ── Validation helpers (used by both client SDK and server route) ──────────

/**
 * Returns true iff the event name is in the whitelist. Both sides of the
 * wire call this — the client uses it as a developer assertion, the server
 * uses it as a hard drop filter.
 */
export function isKnownEvent(name: string): name is TelemetryEventName {
  return TELEMETRY_EVENT_WHITELIST.has(name);
}

/**
 * Returns a sanitized copy of `props` with only the keys allowed for this
 * event. Unknown keys are silently dropped. Returns `undefined` if the
 * resulting object would be empty (so we don't ship `props: {}`).
 *
 * Server-side uses this as the second line of defense even after the
 * client has already filtered, because we can't trust the client.
 */
export function sanitizeEventProps(
  name: string,
  props: TelemetryProps | undefined
): TelemetryProps | undefined {
  if (!props || !isKnownEvent(name)) return undefined;
  const allowed = EVENT_PROP_SCHEMAS[name];
  if (allowed.length === 0) return undefined;

  const out: TelemetryProps = {};
  for (const key of allowed) {
    const v = props[key];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[key] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
