// Trial-expiry toolbar badge.
//
// The reach problem this solves (baseline 2026-11-26): 992 trial_expired
// events against 3 shown side-panel expiry notices. Every in-panel win-back
// surface is gated on the panel being open, and 83% of trial users never come
// back after their first day. The toolbar badge needs no permission
// (manifest has no `notifications`) and no panel.
//
// One shot per install. The sentinel is written when the badge lights;
// sidepanel/init.ts already clears the badge text on every panel open. A
// later refresh must not re-light it, otherwise the badge would measure
// service-worker wakes rather than reach.
//
// The global badge slot is shared with the install nudge ("1", set in
// background/index.ts onInstalled). Every "nothing to say" branch therefore
// returns noop instead of clearing: only a badge this module lit may be
// cleared.

import { LICENSE_STATUS } from '../shared/constants';
import { getLicenseData } from '../shared/license';
import { track } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';
import type { LicenseData } from '../shared/types';

export const TRIAL_BADGE_TEXT = '!';
export const TRIAL_BADGE_COLOR = '#2a8323';

const STORAGE_KEY_TRIAL_BADGE_SHOWN = '_trial_badge_shown_at';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrialBadgeInput {
  trialExpired: boolean;
  hasPaidLicense: boolean;
  alreadyLit: boolean;
}

export type TrialBadgeAction = 'set' | 'clear' | 'noop';

/**
 * Pure decision table — kept separate from chrome/storage so the rules can be
 * read and tested without any IO.
 */
export function decideTrialBadge(input: TrialBadgeInput): TrialBadgeAction {
  if (input.hasPaidLicense) return input.alreadyLit ? 'clear' : 'noop';
  if (!input.trialExpired || input.alreadyLit) return 'noop';
  return 'set';
}

function readBadgeState(license: LicenseData | null, now: number) {
  const isTrial = license?.plan === 'trial';
  const expiresAt = license?.expiresAt ?? 0;
  return {
    trialExpired: isTrial && expiresAt > 0 && expiresAt <= now,
    hasPaidLicense: Boolean(
      license?.licenseKey &&
      !isTrial &&
      license.status === LICENSE_STATUS.ACTIVE &&
      (!license.expiresAt || license.expiresAt > now)
    ),
    daysSinceExpiry:
      isTrial && expiresAt > 0 ? Math.max(1, Math.ceil((now - expiresAt) / DAY_MS)) : 0,
  };
}

async function wasBadgeLit(): Promise<boolean> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY_TRIAL_BADGE_SHOWN);
    return Boolean(data[STORAGE_KEY_TRIAL_BADGE_SHOWN]);
  } catch {
    // Fail closed: if we cannot tell, prefer silence over a repeat nag.
    return true;
  }
}

/**
 * Reconcile the toolbar badge with the current license state.
 *
 * Call from every place the license can lapse: SW startup, the 24h license
 * alarm, and the VALIDATE_LICENSE handler (where trial_expired is first
 * observed on the expiry day itself).
 */
export async function refreshTrialBadge(now = Date.now()): Promise<TrialBadgeAction> {
  let license: LicenseData | null = null;
  try {
    license = await getLicenseData();
  } catch {
    return 'noop';
  }

  const { trialExpired, hasPaidLicense, daysSinceExpiry } = readBadgeState(license, now);
  const action = decideTrialBadge({
    trialExpired,
    hasPaidLicense,
    alreadyLit: await wasBadgeLit(),
  });

  if (action === 'noop') return 'noop';

  try {
    await chrome.action.setBadgeText({ text: action === 'set' ? TRIAL_BADGE_TEXT : '' });
  } catch {
    // Restricted profile or API unavailable — leave the sentinel untouched so
    // a later wake can retry.
    return 'noop';
  }

  if (action === 'clear') return 'clear';

  void chrome.action.setBadgeBackgroundColor({ color: TRIAL_BADGE_COLOR }).catch(() => {});

  try {
    await chrome.storage.local.set({ [STORAGE_KEY_TRIAL_BADGE_SHOWN]: now });
  } catch {
    /* non-fatal — worst case the badge lights again on the next wake */
  }

  await track(EVENTS.TRIAL_BADGE_SHOWN, { daysSinceExpiry });
  return 'set';
}
