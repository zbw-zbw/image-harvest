// Unit tests for background/license.ts — the chrome.alarms scheduler
// that triggers a periodic license re-verification and broadcasts the
// result to every connected UI port.
//
// Two contracts to pin:
//   1. initLicenseAlarm is idempotent — if the alarm already exists
//      (extension reload after install), we do NOT re-create it.
//   2. The onAlarm callback filters by name, calls periodicLicenseCheck,
//      and broadcasts a LICENSE_STATUS_CHANGED message whose shape
//      matches what the popup / sidepanel UI expects.
//
// The two return shapes of periodicLicenseCheck (full ProUserInfo vs
// the bare { isPro: false } shape) both need to round-trip without
// crashing — that's why the production code uses `'plan' in result`
// before forwarding plan/status.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_TYPES, LICENSE_CHECK_INTERVAL } from '../shared/constants';

// Stub shared/license BEFORE importing background/license so the
// import chain picks up our mock instead of the real implementation
// (which would touch chrome.storage and fetch).
vi.mock('../shared/license', () => ({
  periodicLicenseCheck: vi.fn(),
}));

interface AlarmsStub {
  get: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  onAlarm: { addListener: ReturnType<typeof vi.fn> };
}
interface ChromeStub {
  alarms: AlarmsStub;
}

function installChromeStub(existingAlarm: chrome.alarms.Alarm | null): ChromeStub {
  const stub: ChromeStub = {
    alarms: {
      get: vi.fn((_name: string, cb: (alarm: chrome.alarms.Alarm | undefined) => void) => {
        // chrome.alarms.get callback receives `undefined` when the
        // alarm doesn't exist (not null).
        cb(existingAlarm ?? undefined);
      }),
      create: vi.fn(),
      onAlarm: { addListener: vi.fn() },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = stub;
  return stub;
}

const { initLicenseAlarm } = await import('../background/license');
const { uiPorts } = await import('../background/utils');
const sharedLicense = await import('../shared/license');

interface BroadcastCapture {
  type: string;
  isPro: boolean;
  plan?: string;
  status?: string;
}

function attachBroadcastCapture(): BroadcastCapture[] {
  const captured: BroadcastCapture[] = [];
  const port = {
    postMessage: (msg: unknown) => captured.push(msg as BroadcastCapture),
  };
  uiPorts.add(port as unknown as chrome.runtime.Port);
  return captured;
}

let chromeStub: ChromeStub;

beforeEach(() => {
  uiPorts.clear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
  uiPorts.clear();
  vi.restoreAllMocks();
});

describe('initLicenseAlarm — alarm registration', () => {
  it('creates the periodic alarm when it does not yet exist', () => {
    chromeStub = installChromeStub(null);

    initLicenseAlarm();

    expect(chromeStub.alarms.get).toHaveBeenCalledWith(
      'license-periodic-check',
      expect.any(Function)
    );
    expect(chromeStub.alarms.create).toHaveBeenCalledWith('license-periodic-check', {
      periodInMinutes: LICENSE_CHECK_INTERVAL / 60000, // 24h → 1440 min
    });
  });

  it('is idempotent — does NOT re-create when the alarm already exists', () => {
    chromeStub = installChromeStub({
      name: 'license-periodic-check',
      scheduledTime: Date.now() + 60_000,
      periodInMinutes: 1440,
    });

    initLicenseAlarm();

    expect(chromeStub.alarms.get).toHaveBeenCalledTimes(1);
    expect(chromeStub.alarms.create).not.toHaveBeenCalled();
  });

  it('always registers an onAlarm listener (independent of whether the alarm pre-existed)', () => {
    chromeStub = installChromeStub({
      name: 'license-periodic-check',
      scheduledTime: Date.now(),
      periodInMinutes: 1440,
    });

    initLicenseAlarm();

    expect(chromeStub.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
  });
});

describe('initLicenseAlarm — onAlarm callback', () => {
  it('ignores alarms with a different name (no periodicLicenseCheck call)', async () => {
    chromeStub = installChromeStub(null);
    initLicenseAlarm();

    const onAlarm = chromeStub.alarms.onAlarm.addListener.mock.calls[0][0] as (
      alarm: chrome.alarms.Alarm
    ) => Promise<void>;

    await onAlarm({
      name: 'some-other-alarm',
      scheduledTime: Date.now(),
    });

    expect(sharedLicense.periodicLicenseCheck).not.toHaveBeenCalled();
  });

  it('broadcasts full ProUserInfo (plan + status) when the check returns a pro user', async () => {
    chromeStub = installChromeStub(null);
    vi.mocked(sharedLicense.periodicLicenseCheck).mockResolvedValue({
      isPro: true,
      plan: 'yearly',
      status: 'active',
    } as Awaited<ReturnType<typeof sharedLicense.periodicLicenseCheck>>);

    initLicenseAlarm();
    const captured = attachBroadcastCapture();

    const onAlarm = chromeStub.alarms.onAlarm.addListener.mock.calls[0][0] as (
      alarm: chrome.alarms.Alarm
    ) => Promise<void>;

    await onAlarm({ name: 'license-periodic-check', scheduledTime: Date.now() });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      type: MESSAGE_TYPES.LICENSE_STATUS_CHANGED,
      isPro: true,
      plan: 'yearly',
      status: 'active',
    });
  });

  it('broadcasts the bare { isPro: false } shape with plan/status undefined for never-licensed users', async () => {
    chromeStub = installChromeStub(null);
    vi.mocked(sharedLicense.periodicLicenseCheck).mockResolvedValue({
      isPro: false,
    } as Awaited<ReturnType<typeof sharedLicense.periodicLicenseCheck>>);

    initLicenseAlarm();
    const captured = attachBroadcastCapture();

    const onAlarm = chromeStub.alarms.onAlarm.addListener.mock.calls[0][0] as (
      alarm: chrome.alarms.Alarm
    ) => Promise<void>;

    await onAlarm({ name: 'license-periodic-check', scheduledTime: Date.now() });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      type: MESSAGE_TYPES.LICENSE_STATUS_CHANGED,
      isPro: false,
      plan: undefined,
      status: undefined,
    });
  });

  it('broadcasts to every connected UI port (multi-surface fanout)', async () => {
    chromeStub = installChromeStub(null);
    vi.mocked(sharedLicense.periodicLicenseCheck).mockResolvedValue({
      isPro: false,
    } as Awaited<ReturnType<typeof sharedLicense.periodicLicenseCheck>>);

    initLicenseAlarm();
    const a = attachBroadcastCapture();
    const b = attachBroadcastCapture();

    const onAlarm = chromeStub.alarms.onAlarm.addListener.mock.calls[0][0] as (
      alarm: chrome.alarms.Alarm
    ) => Promise<void>;

    await onAlarm({ name: 'license-periodic-check', scheduledTime: Date.now() });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].type).toBe(MESSAGE_TYPES.LICENSE_STATUS_CHANGED);
    expect(b[0].type).toBe(MESSAGE_TYPES.LICENSE_STATUS_CHANGED);
  });
});
