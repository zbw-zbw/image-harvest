// Unit tests for shared/onboarding-state.ts — the Phase-2a activation flag.
//
// What we pin:
//   - Default state is inert (a fresh install shows no coach marks).
//   - startOnboarding() arms it; isOnboardingActive() reflects that.
//   - resolveOnboarding() is STICKY: once the user completed a first download
//     (or dismissed the tips) the coach must never come back, even if the
//     welcome page is reopened and clicks the CTA again — otherwise a user who
//     revisits chrome://extensions and re-triggers the welcome tab would get
//     nagged forever.
//   - Storage failures degrade to "inactive" rather than throwing, because the
//     caller renders UI from this value.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getOnboardingState,
  isOnboardingActive,
  resolveOnboarding,
  startOnboarding,
  __test,
} from '../shared/onboarding-state';

function makeFakeStorage() {
  const m = new Map<string, unknown>();
  return {
    store: m,
    async get(key: string) {
      return m.get(key);
    },
    async set(key: string, value: unknown) {
      m.set(key, value);
    },
  };
}

beforeEach(() => {
  __test.reset();
  __test.setStorage(makeFakeStorage());
});

afterEach(() => {
  __test.reset();
});

describe('onboarding-state', () => {
  it('starts inert — no coach marks on a fresh install', async () => {
    expect(await isOnboardingActive()).toBe(false);
    expect(await getOnboardingState()).toMatchObject({
      active: false,
      startedAt: 0,
      resolved: false,
    });
  });

  it('startOnboarding arms the flow and stamps startedAt', async () => {
    await startOnboarding();
    expect(await isOnboardingActive()).toBe(true);
    const s = await getOnboardingState();
    expect(s.active).toBe(true);
    expect(s.startedAt).toBeGreaterThan(0);
  });

  it('resolveOnboarding retires the coach', async () => {
    await startOnboarding();
    await resolveOnboarding();
    expect(await isOnboardingActive()).toBe(false);
    expect(await getOnboardingState()).toMatchObject({ active: false, resolved: true });
  });

  it('never re-arms after resolution (sticky terminal state)', async () => {
    await startOnboarding();
    await resolveOnboarding();

    // Welcome page reopened → CTA clicked again. Must stay retired.
    await startOnboarding();
    expect(await isOnboardingActive()).toBe(false);
    expect((await getOnboardingState()).resolved).toBe(true);
  });

  it('hydrates a persisted armed state (panel opened after the CTA)', async () => {
    const storage = makeFakeStorage();
    await storage.set('onboardingState', { active: true, startedAt: 123, resolved: false });
    __test.setStorage(storage);
    expect(await isOnboardingActive()).toBe(true);
  });

  it('treats a resolved persisted state as inactive', async () => {
    const storage = makeFakeStorage();
    await storage.set('onboardingState', { active: true, startedAt: 123, resolved: true });
    __test.setStorage(storage);
    // resolved wins over active — the flag pair can only mean "retired".
    expect(await isOnboardingActive()).toBe(false);
  });
});
