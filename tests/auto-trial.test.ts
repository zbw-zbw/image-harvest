// Tests for background/auto-trial.ts — auto-activate trial on install/update.
//
// Scope:
//   - autoStartTrial: eligible + success, eligible + network fail (schedules retry),
//     not eligible (no-op), terminal errors (no retry)
//   - initAutoTrialAlarm: alarm fires and retries correctly
//   - Retry exhaustion after MAX_RETRIES

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsTrialEligible = vi.fn();
const mockStartTrial = vi.fn();
const mockTrack = vi.fn();
const mockFlushNow = vi.fn();
const mockMarkResolved = vi.fn();
const mockBroadcastToPopup = vi.fn();

vi.mock('../shared/trial', () => ({
  isTrialEligible: mockIsTrialEligible,
  startTrial: mockStartTrial,
}));

vi.mock('../shared/telemetry', () => ({
  track: mockTrack,
  flushNow: mockFlushNow,
}));

vi.mock('../shared/paywall-state', () => ({
  markResolved: mockMarkResolved,
}));

vi.mock('../background/utils', () => ({
  broadcastToPopup: mockBroadcastToPopup,
}));

let storage: Map<string, unknown>;
let alarms: Map<string, { delayInMinutes?: number }>;
let alarmListeners: Array<(alarm: { name: string }) => void>;

function installChromeStubs(): void {
  storage = new Map();
  alarms = new Map();
  alarmListeners = [];

  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => {
          return storage.has(key) ? { [key]: storage.get(key) } : {};
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) {
            storage.set(k, v);
          }
        }),
        remove: vi.fn(async (key: string) => {
          storage.delete(key);
        }),
      },
    },
    alarms: {
      create: vi.fn((name: string, opts: { delayInMinutes?: number }) => {
        alarms.set(name, opts);
      }),
      clear: vi.fn((name: string) => {
        alarms.delete(name);
      }),
      onAlarm: {
        addListener: vi.fn((fn: (alarm: { name: string }) => void) => {
          alarmListeners.push(fn);
        }),
      },
    },
    runtime: {
      getManifest: () => ({ version: '1.0.5' }),
    },
  };
}

describe('background/auto-trial', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    installChromeStubs();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  async function importModule() {
    return await import('../background/auto-trial');
  }

  describe('autoStartTrial', () => {
    it('activates trial for eligible user on install', async () => {
      mockIsTrialEligible.mockResolvedValue(true);
      mockStartTrial.mockResolvedValue({
        success: true,
        plan: 'trial',
        expiresAt: Date.now() + 7 * 86400000,
      });

      const { autoStartTrial } = await importModule();
      await autoStartTrial('install');

      expect(mockStartTrial).toHaveBeenCalledOnce();
      expect(mockMarkResolved).toHaveBeenCalledOnce();
      expect(mockTrack).toHaveBeenCalledWith('trial_auto_started', { source: 'install' });
      expect(mockFlushNow).toHaveBeenCalledOnce();
      expect(mockBroadcastToPopup).toHaveBeenCalledWith(
        expect.objectContaining({ isPro: true, plan: 'trial', status: 'active' })
      );
      // Pending state should be cleared
      expect(storage.has('_auto_trial_pending')).toBe(false);
    });

    it('activates trial for eligible user on update', async () => {
      mockIsTrialEligible.mockResolvedValue(true);
      mockStartTrial.mockResolvedValue({ success: true, plan: 'trial' });

      const { autoStartTrial } = await importModule();
      await autoStartTrial('update');

      expect(mockTrack).toHaveBeenCalledWith('trial_auto_started', { source: 'update' });
    });

    it('does nothing for ineligible user', async () => {
      mockIsTrialEligible.mockResolvedValue(false);

      const { autoStartTrial } = await importModule();
      await autoStartTrial('install');

      expect(mockStartTrial).not.toHaveBeenCalled();
      expect(mockTrack).not.toHaveBeenCalled();
    });

    it('schedules retry on network failure', async () => {
      mockIsTrialEligible.mockResolvedValue(true);
      mockStartTrial.mockResolvedValue({ success: false, error: 'trial_error_network' });

      const { autoStartTrial } = await importModule();
      await autoStartTrial('install');

      expect(alarms.has('auto-trial-retry')).toBe(true);
      expect(alarms.get('auto-trial-retry')?.delayInMinutes).toBe(1);
      expect(storage.get('_auto_trial_pending')).toEqual({ source: 'install', retryCount: 1 });
    });

    it('schedules retry on http failure', async () => {
      mockIsTrialEligible.mockResolvedValue(true);
      mockStartTrial.mockResolvedValue({ success: false, error: 'trial_error_http' });

      const { autoStartTrial } = await importModule();
      await autoStartTrial('install');

      expect(alarms.has('auto-trial-retry')).toBe(true);
    });

    it('does not retry on terminal error (already_redeemed)', async () => {
      mockIsTrialEligible.mockResolvedValue(true);
      mockStartTrial.mockResolvedValue({ success: false, error: 'trial_error_already_redeemed' });

      const { autoStartTrial } = await importModule();
      await autoStartTrial('install');

      expect(alarms.has('auto-trial-retry')).toBe(false);
    });

    it('gives up after MAX_RETRIES (3)', async () => {
      mockIsTrialEligible.mockResolvedValue(true);
      mockStartTrial.mockResolvedValue({ success: false, error: 'trial_error_network' });

      // Simulate 3 prior retries
      storage.set('_auto_trial_pending', { source: 'install', retryCount: 3 });

      const { autoStartTrial } = await importModule();
      await autoStartTrial('install');

      // Should NOT create another alarm — we've exhausted retries
      expect(alarms.has('auto-trial-retry')).toBe(false);
      expect(storage.has('_auto_trial_pending')).toBe(false);
    });

    it('uses exponential backoff for retry delays', async () => {
      mockIsTrialEligible.mockResolvedValue(true);
      mockStartTrial.mockResolvedValue({ success: false, error: 'trial_error_network' });

      const { autoStartTrial } = await importModule();

      // First failure: 1 minute
      await autoStartTrial('install');
      expect(alarms.get('auto-trial-retry')?.delayInMinutes).toBe(1);

      // Second failure: 5 minutes
      storage.set('_auto_trial_pending', { source: 'install', retryCount: 1 });
      alarms.clear();
      await autoStartTrial('install');
      expect(alarms.get('auto-trial-retry')?.delayInMinutes).toBe(5);

      // Third failure: 30 minutes
      storage.set('_auto_trial_pending', { source: 'install', retryCount: 2 });
      alarms.clear();
      await autoStartTrial('install');
      expect(alarms.get('auto-trial-retry')?.delayInMinutes).toBe(30);
    });
  });

  describe('initAutoTrialAlarm', () => {
    it('registers an alarm listener', async () => {
      const { initAutoTrialAlarm } = await importModule();
      initAutoTrialAlarm();

      expect(alarmListeners.length).toBe(1);
    });

    it('ignores alarms with other names', async () => {
      mockIsTrialEligible.mockResolvedValue(true);
      mockStartTrial.mockResolvedValue({ success: true, plan: 'trial' });

      const { initAutoTrialAlarm } = await importModule();
      initAutoTrialAlarm();

      // Fire an unrelated alarm
      alarmListeners[0]({ name: 'license-periodic-check' });

      // Should not have called startTrial
      expect(mockStartTrial).not.toHaveBeenCalled();
    });
  });
});
