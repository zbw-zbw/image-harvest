// What a trial user has actually put to work.
//
// Why this exists: the day-3/5/7 recap can already say "N images downloaded"
// (shared/paywall-state counts every successful download), but downloads
// undersell the trial. The quiet Pro features — dedup, multi-tab extraction,
// format conversion, live monitoring, colour copy, link resolve, deep scan —
// are exactly what the user would lose, and nothing recorded that they used
// them: every quota call site increments only for free users by design.
//
// So this module keeps a small set of Pro features the current install
// touched *while on a trial plan*. The recap names them back to the user,
// which is concrete in a way a countdown is not.
//
// It is also the first producer of PRO_FEATURE_USED, declared in
// telemetry-events.ts since 2026-06 but never emitted. The event fires once
// per feature per install (the stored set doubles as the dedupe), which
// answers "which Pro features do trials actually use" without turning a
// power user's afternoon into queue noise.

import { track } from './telemetry';
import { EVENTS } from './telemetry-events';

export type ProFeatureKey =
  | 'multiTab'
  | 'dedup'
  | 'formatConvert'
  | 'liveMonitor'
  | 'colorCopy'
  | 'linkResolve'
  | 'deepScan';

const PRO_FEATURE_KEYS: ProFeatureKey[] = [
  'multiTab',
  'dedup',
  'formatConvert',
  'liveMonitor',
  'colorCopy',
  'linkResolve',
  'deepScan',
];

const STORAGE_KEY = '_trial_pro_features_used';

/**
 * Chip labels reuse the existing Pro-feature titles, so naming a feature here
 * costs no new translation in any of the 15 catalogues.
 */
const LABEL_KEYS: Record<ProFeatureKey, string> = {
  multiTab: 'pro_feature_multitab_title',
  dedup: 'pro_feature_dedup_title',
  formatConvert: 'pro_feature_format_title',
  liveMonitor: 'pro_feature_live_monitor_title',
  colorCopy: 'pro_feature_color_title',
  linkResolve: 'pro_feature_reverse_search_title',
  deepScan: 'feature_deep_scan',
};

/** i18n catalogue key for a feature's display name. */
export function proFeatureLabelKey(feature: ProFeatureKey): string {
  return LABEL_KEYS[feature];
}

/**
 * Storage is user-writable and survives releases, so a renamed key must not
 * reach t() as a missing lookup. Unknown entries are dropped, duplicates are
 * collapsed, and the stored (first-use) order is preserved — the recap shows
 * the features in the order the user met them.
 */
function normalizeUsed(raw: unknown): ProFeatureKey[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<ProFeatureKey>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    if ((PRO_FEATURE_KEYS as string[]).includes(entry)) {
      used.add(entry as ProFeatureKey);
    }
  }
  return [...used];
}

/**
 * Note that the user used `feature`. Call it on the success path only —
 * a blocked or failed action is not usage.
 *
 * No-op unless the stored license says plan === 'trial': paid and free users
 * are out of scope, and grace-period users already have their own banner.
 * Best-effort throughout: bookkeeping never breaks the action itself.
 */
export async function recordProFeatureUse(feature: ProFeatureKey): Promise<void> {
  try {
    const data = await chrome.storage.local.get(['licenseData', STORAGE_KEY]);
    const license = data.licenseData as { plan?: string } | undefined;
    if (license?.plan !== 'trial') return;

    const used = normalizeUsed(data[STORAGE_KEY]);
    if (used.includes(feature)) return;

    await chrome.storage.local.set({ [STORAGE_KEY]: [...used, feature] });
    void track(EVENTS.PRO_FEATURE_USED, { feature });
  } catch {
    // Storage or telemetry failure — the feature the user asked for still ran.
  }
}

/** Features used during the trial so far, in order of first use. */
export async function getTrialProFeaturesUsed(): Promise<ProFeatureKey[]> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeUsed(data[STORAGE_KEY]);
  } catch {
    return [];
  }
}
