// 7-day Pro free trial — Sprint 2.3.
//
// Why a separate module from shared/license.ts?
//   - License is the source of truth for "what plan does the user have
//     right now". Trial is the source of truth for "has the user ever
//     redeemed their one-shot 7-day Pro grant".
//   - Keeping them split means license.ts stays unaware of the trial
//     business rule (single-redemption per install) — it just sees a
//     license with `plan === 'trial'` like any other plan. Expiry of
//     trials piggybacks on the existing `expiresAt` check inside
//     isProUser(); no special-casing needed there.
//
// Flow:
//   1. UI calls startTrial() (e.g. ProUpgradeModal "Start Free Trial" CTA).
//   2. We check the local "redeemed" sentinel — if set, return error
//      instantly. This protects against the user uninstalling and
//      reinstalling to re-trial within the same Chrome profile (the
//      `instanceId` survives uninstall via chrome.storage.local).
//   3. We POST to website/api/trial/start with the install's instanceId.
//      Server checks its own DB for any prior redemption (defense in
//      depth — different machine, same person? we can't fully prevent
//      it without an account, but at least we deny same-instanceId
//      double-dips).
//   4. Server responds with a real LicenseData payload (plan="trial",
//      expiresAt = now + 7d). We persist it through the same
//      saveLicenseData path used by paid licenses, so isProUser()
//      treats trial users identically to paid Pro users.
//   5. Trial expiry is automatic: validateLicenseRemote will return
//      valid=false once the server-side expiresAt elapses, and isProUser
//      handles the downgrade. We additionally fire a TRIAL_EXPIRED
//      telemetry event from the helper below for funnel reporting.

import { LICENSE_API_URL, LICENSE_STATUS } from './constants';
import { getLicenseData, getOrCreateInstanceId, saveLicenseData } from './license';
import type { LicenseData } from './types';
import { track } from './telemetry';
import { EVENTS } from './telemetry-events';

const STORAGE_KEY_TRIAL_REDEEMED = '_trial_redeemed_at';
const STORAGE_KEY_TRIAL_EXPIRED_REPORTED = '_trial_expired_reported';

/** 7 days in milliseconds — kept as a literal to avoid an extra constants import. */
export const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export interface TrialStartResult {
  success: boolean;
  error?: string;
  plan?: string;
  expiresAt?: number;
}

interface TrialApiResponse {
  success: boolean;
  error?: string;
  licenseKey?: string;
  plan?: string;
  expiresAt?: number;
}

/**
 * Has the user already redeemed their trial on this install?
 *
 * Two checks: the local sentinel (cheap, sync-ish) AND the active
 * license being a trial that hasn't expired (handles the case where
 * the sentinel was somehow cleared but the trial license persists).
 * Either positive answer means "no further trial allowed".
 */
export async function isTrialEligible(): Promise<boolean> {
  try {
    const local = await chrome.storage.local.get(STORAGE_KEY_TRIAL_REDEEMED);
    if (local[STORAGE_KEY_TRIAL_REDEEMED]) return false;
  } catch {
    // Storage unreachable — fall through to the license check; worst case
    // we let the server make the final decision.
  }
  const license = await getLicenseData();
  if (license?.plan === 'trial' || license?.plan === 'lifetime') {
    return false;
  }
  return true;
}

/**
 * Start the 7-day free trial. Idempotent client-side: a second call after
 * a successful first one short-circuits with the cached "already redeemed"
 * error so the UI never double-charges the server.
 */
export async function startTrial(): Promise<TrialStartResult> {
  if (!(await isTrialEligible())) {
    return {
      success: false,
      error: 'You have already used your free trial on this install.',
    };
  }

  const instanceId = await getOrCreateInstanceId();
  let response: TrialApiResponse;
  try {
    const resp = await fetch(LICENSE_API_URL.replace(/\/license$/, '/trial/start'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId }),
    });
    if (!resp.ok) {
      // 409 = server says you've already redeemed. Persist the sentinel
      // so future calls short-circuit without a network round trip.
      if (resp.status === 409) {
        await chrome.storage.local.set({
          [STORAGE_KEY_TRIAL_REDEEMED]: Date.now(),
        });
        return {
          success: false,
          error: 'You have already used your free trial.',
        };
      }
      return {
        success: false,
        error: `Could not start trial (HTTP ${resp.status}).`,
      };
    }
    response = (await resp.json()) as TrialApiResponse;
  } catch (err) {
    console.error('Trial start network error:', err);
    return {
      success: false,
      error: 'Network error. Please check your connection and try again.',
    };
  }

  if (!response.success || !response.licenseKey) {
    return {
      success: false,
      error: response.error || 'Server declined the trial.',
    };
  }

  // Persist as a regular license so isProUser() and the rest of the
  // license code path treats it identically to a paid plan.
  const expiresAt = response.expiresAt ?? Date.now() + TRIAL_DURATION_MS;
  const licenseData: LicenseData = {
    licenseKey: response.licenseKey,
    status: LICENSE_STATUS.ACTIVE,
    plan: response.plan ?? 'trial',
    expiresAt,
    lastVerified: Date.now(),
    instanceId,
  };
  await saveLicenseData(licenseData);

  // Local sentinel — also a redemption record. Stored separately from
  // the license itself so a future deactivate doesn't make the user
  // appear "trial-eligible" again.
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY_TRIAL_REDEEMED]: Date.now(),
    });
  } catch {
    /* non-fatal — server-side check is the real defense */
  }

  return {
    success: true,
    plan: licenseData.plan ?? 'trial',
    expiresAt,
  };
}

/**
 * Returns true iff the install currently holds an active trial license
 * (plan === 'trial' AND not expired). Pro / paid users return false here
 * — callers wanting "any Pro" should keep using isProUser().
 */
export async function isTrialActive(): Promise<boolean> {
  const license = await getLicenseData();
  if (!license) return false;
  if (license.plan !== 'trial') return false;
  if (!license.expiresAt) return false;
  return license.expiresAt > Date.now();
}

/**
 * Check whether a trial license has just expired and fire TRIAL_EXPIRED
 * exactly once per redemption so the funnel can compute trial → paid
 * conversion rates. Idempotent — safe to call from periodic background
 * checks.
 *
 * The "fired-once" sentinel is stored separately from the redeemed
 * sentinel so users who upgrade to a paid plan after trial expiry
 * still keep both records.
 */
export async function reportTrialExpiryIfNeeded(): Promise<boolean> {
  const license = await getLicenseData();
  if (!license || license.plan !== 'trial') return false;
  if (!license.expiresAt || license.expiresAt > Date.now()) return false;

  try {
    const flag = await chrome.storage.local.get(STORAGE_KEY_TRIAL_EXPIRED_REPORTED);
    if (flag[STORAGE_KEY_TRIAL_EXPIRED_REPORTED]) return false;
    await chrome.storage.local.set({
      [STORAGE_KEY_TRIAL_EXPIRED_REPORTED]: Date.now(),
    });
  } catch {
    return false;
  }

  await track(EVENTS.TRIAL_EXPIRED);
  return true;
}

/**
 * Snapshot of the trial state for UI display ("3 days remaining").
 * Returns null when no trial is active. Computes everything off the
 * persisted license — no network round trip.
 */
export interface TrialSnapshot {
  active: boolean;
  expiresAt: number;
  msRemaining: number;
}

export async function getTrialState(): Promise<TrialSnapshot | null> {
  const license = await getLicenseData();
  if (!license || license.plan !== 'trial' || !license.expiresAt) return null;
  const msRemaining = Math.max(0, license.expiresAt - Date.now());
  return {
    active: msRemaining > 0,
    expiresAt: license.expiresAt,
    msRemaining,
  };
}
