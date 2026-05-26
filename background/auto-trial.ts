// Auto-activate trial on install/update — Phase 1, v1.0.5.
//
// Automatically starts the 7-day Pro trial for:
//   - Brand new installs (reason=install)
//   - Existing users upgrading to v1.0.5 who never used their trial (reason=update)
//
// Uses chrome.alarms for retry on network failure, following the same
// pattern as background/license.ts periodic checks.

import { isTrialEligible, startTrial } from '../shared/trial';
import { track, flushNow } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';
import { markResolved } from '../shared/paywall-state';
import { broadcastToPopup } from './utils';
import { MESSAGE_TYPES } from '../shared/constants';

const STORAGE_KEY_PENDING = '_auto_trial_pending';
const ALARM_NAME = 'auto-trial-retry';
const MAX_RETRIES = 3;
const RETRY_DELAYS_MIN = [1, 5, 30]; // minutes: 1min, 5min, 30min

interface AutoTrialState {
  source: 'install' | 'update';
  retryCount: number;
}

/**
 * Attempt to auto-start the trial. Called from onInstalled (install/update)
 * and from the retry alarm. Idempotent — isTrialEligible() guards against
 * double-activation.
 */
export async function autoStartTrial(source: 'install' | 'update'): Promise<void> {
  const eligible = await isTrialEligible();
  if (!eligible) {
    await clearPending();
    return;
  }

  const result = await startTrial();
  if (result.success) {
    await clearPending();
    await markResolved();
    void track(EVENTS.TRIAL_AUTO_STARTED, { source });
    void flushNow();
    broadcastToPopup({
      type: MESSAGE_TYPES.LICENSE_STATUS_CHANGED,
      isPro: true,
      plan: 'trial',
      status: 'active',
    });
    return;
  }

  // Network or server failure — schedule retry if under the limit.
  if (result.error === 'trial_error_network' || result.error === 'trial_error_http') {
    await scheduleRetry(source);
  }
  // Other errors (already_redeemed, already_used, server_declined) are terminal.
}

async function scheduleRetry(source: 'install' | 'update'): Promise<void> {
  const state = await getPendingState();
  const retryCount = state ? state.retryCount + 1 : 1;

  if (retryCount > MAX_RETRIES) {
    await clearPending();
    return;
  }

  const newState: AutoTrialState = { source, retryCount };
  await chrome.storage.local.set({ [STORAGE_KEY_PENDING]: newState });

  const delayMinutes = RETRY_DELAYS_MIN[retryCount - 1] || 30;
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: delayMinutes });
}

async function getPendingState(): Promise<AutoTrialState | null> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY_PENDING);
    return (data[STORAGE_KEY_PENDING] as AutoTrialState) || null;
  } catch {
    return null;
  }
}

async function clearPending(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEY_PENDING);
    chrome.alarms.clear(ALARM_NAME);
  } catch {
    // non-fatal
  }
}

/**
 * Handle the retry alarm. Called from the alarm listener in this module's
 * init function.
 */
async function handleRetryAlarm(): Promise<void> {
  const state = await getPendingState();
  if (!state) return;
  await autoStartTrial(state.source);
}

/**
 * Initialize the auto-trial alarm listener. Must be called once at SW startup.
 */
export function initAutoTrialAlarm(): void {
  if (typeof chrome === 'undefined' || !chrome.alarms?.onAlarm) return;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    void handleRetryAlarm();
  });
}
