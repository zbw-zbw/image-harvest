// e2e: license activation/deactivation UI — sidepanel/license-ui.ts
// (lazy-loaded from settings.ts > showSettings on first Settings
// modal open). This is the user-paid path, until now had ZERO e2e
// coverage despite being the bridge between free and Pro states.
//
// Production link:
//   1. settings.ts > showSettings → void import('./license-ui')
//      → updateLicenseUI() (license-ui.ts L40) → sends
//      GET_LICENSE_STATUS, paints #license-inactive vs
//      #license-active.
//   2. bindLicenseModalEvents (L168) wires #btn-activate-license,
//      #btn-deactivate-license, the input formatter, and the Pro
//      Upgrade Modal twin form. Idempotent — guarded by a module
//      flag so reopen Settings doesn't double-bind.
//   3. activateLicenseFromInput (L97) is the shared handler for
//      both forms. Sends ACTIVATE_LICENSE, then on success calls
//      applyProFeatureVisibility (which itself sends another
//      GET_LICENSE_STATUS) and shows a toast.
//   4. Deactivate handler (L195-218) goes through showConfirmDialog
//      first, then DEACTIVATE_LICENSE, then applyProFeatureVisibility
//      again.
//
// Stub strategy: install a chrome.runtime.sendMessage shim that
// intercepts the four license-related message types AND maintains
// a synthesized server-side license state. Every other message
// type passes through to the real handler so other sidepanel
// internals keep working. Activate flips the synth state to
// active; Deactivate flips it back; the next GET_LICENSE_STATUS
// the sidepanel sends (via applyProFeatureVisibility) reads the
// new state and the UI converges.
import { test, expect } from '@playwright/test';
import {
  launchExtension,
  openSidepanelWithImages,
  startFixtureServer,
  type FixtureServer,
  type LaunchedExtension,
} from './_helpers/launchExtension';

let ext: LaunchedExtension;
let fixtureServer: FixtureServer;

test.beforeAll(async () => {
  fixtureServer = await startFixtureServer();
  ext = await launchExtension();
});

test.afterAll(async () => {
  await ext?.context.close();
  await fixtureServer?.close();
});

interface LicenseStubControls {
  shouldActivateSucceed: boolean;
  activateError?: string;
  shouldThrowOnActivate?: boolean;
  /**
   * Initial synth license state — defaults to inactive (free user).
   * Set to 'active' for deactivation tests so updateLicenseUI sees
   * the right starting point on the very first call.
   */
  initialStatus?: 'active' | 'inactive';
  initialLicenseKey?: string;
  initialPlan?: string;
}

/**
 * Install a chrome.runtime.sendMessage stub that handles the
 * four license-related message types and pass-through everything
 * else. Returns a getter so the test can inspect call counts.
 *
 * Must be installed BEFORE clicking #btn-settings — otherwise
 * the initial updateLicenseUI() runs against the real background.
 */
async function installLicenseStub(
  sidepanel: Awaited<ReturnType<typeof openSidepanelWithImages>>['sidepanel'],
  controls: LicenseStubControls
): Promise<void> {
  // launchExtension's persistent context is shared across the whole
  // file (one beforeAll). chrome.storage.local survives between
  // openSidepanelWithImages calls and so do any license keys the
  // previous test wrote — so clear it here before the stub takes
  // over, otherwise applyProFeatureVisibility's storage fallback
  // path can leak isProUser=true into a free-user test.
  await sidepanel.evaluate(async () => {
    interface ChromeStorage {
      storage: { local: { remove: (keys: string[]) => Promise<void> } };
    }
    const c = (window as unknown as { chrome: ChromeStorage }).chrome;
    await c.storage.local.remove([
      'license',
      'licenseKey',
      'licenseStatus',
      'licensePlan',
      'licenseExpiresAt',
    ]);
  });

  // Force the in-memory store to mirror the stub's initial license
  // state — applyProFeatureVisibility may have already pushed an
  // (unrelated) value into state.isProUser during sidepanel boot,
  // and the test paths that depend on the inactive baseline (empty
  // key, formatter, failed activation, network error) need
  // isProUser=false from the start.
  await sidepanel.evaluate((wantPro) => {
    interface IH {
      store: { set: (k: string, v: unknown) => void };
    }
    const w = window as unknown as { __IH__: IH };
    w.__IH__.store.set('isProUser', wantPro);
  }, controls.initialStatus === 'active');

  await sidepanel.evaluate((cfg) => {
    interface ChromeRuntime {
      runtime: {
        sendMessage: (...args: unknown[]) => Promise<unknown>;
      };
    }
    interface MsgEnvelope {
      type?: string;
      licenseKey?: string;
    }
    interface SynthState {
      hasLicense: boolean;
      status: 'active' | 'inactive';
      licenseKey?: string;
      plan?: string;
      expiresAt?: number;
    }
    interface CallRecord {
      type: string;
      licenseKey?: string;
    }

    const c = (window as unknown as { chrome: ChromeRuntime }).chrome;
    const original = c.runtime.sendMessage.bind(c.runtime);

    // Module-private synth state. Starts inactive by default;
    // tests targeting the deactivation path pass initialStatus:
    // 'active' so updateLicenseUI on the first Settings open sees
    // an active license without an extra round-trip.
    const initialStatus = cfg.initialStatus || 'inactive';
    const state: SynthState =
      initialStatus === 'active'
        ? {
            hasLicense: true,
            status: 'active',
            licenseKey: cfg.initialLicenseKey,
            plan: cfg.initialPlan || 'lifetime',
          }
        : { hasLicense: false, status: 'inactive' };
    const calls: CallRecord[] = [];

    (
      window as unknown as {
        __IH_LIC_STATE__: SynthState;
        __IH_LIC_CALLS__: CallRecord[];
        __IH_LIC_CFG__: typeof cfg;
      }
    ).__IH_LIC_STATE__ = state;
    (window as unknown as { __IH_LIC_CALLS__: CallRecord[] }).__IH_LIC_CALLS__ = calls;
    (window as unknown as { __IH_LIC_CFG__: typeof cfg }).__IH_LIC_CFG__ = cfg;

    c.runtime.sendMessage = ((msg: unknown, ...rest: unknown[]) => {
      const m = msg as MsgEnvelope;
      const type = m?.type ?? '';
      switch (type) {
        case 'GET_LICENSE_STATUS': {
          calls.push({ type });
          return Promise.resolve({
            hasLicense: state.hasLicense,
            status: state.status,
            licenseKey: state.licenseKey,
            plan: state.plan,
            expiresAt: state.expiresAt,
            isPro: state.status === 'active',
          });
        }
        case 'ACTIVATE_LICENSE': {
          calls.push({ type, licenseKey: m.licenseKey });
          const liveCfg = (window as unknown as { __IH_LIC_CFG__: typeof cfg }).__IH_LIC_CFG__;
          if (liveCfg.shouldThrowOnActivate) {
            return Promise.reject(new Error('synthetic network error'));
          }
          if (liveCfg.shouldActivateSucceed) {
            state.hasLicense = true;
            state.status = 'active';
            state.licenseKey = m.licenseKey;
            state.plan = 'lifetime';
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({
            success: false,
            error: liveCfg.activateError || 'Activation failed',
          });
        }
        case 'DEACTIVATE_LICENSE': {
          calls.push({ type });
          state.hasLicense = false;
          state.status = 'inactive';
          state.licenseKey = undefined;
          state.plan = undefined;
          return Promise.resolve({ success: true });
        }
        case 'VALIDATE_LICENSE': {
          calls.push({ type });
          // applyProFeatureVisibility (settings.ts L429) reads
          // proStatus?.isPro — surface the synth state under that
          // key, not under {valid}, so the activate→isProUser
          // pipeline converges.
          return Promise.resolve({ isPro: state.status === 'active' });
        }
        default:
          return original(msg, ...rest);
      }
    }) as typeof c.runtime.sendMessage;
  }, controls);
}

async function readLicenseCalls(
  sidepanel: Awaited<ReturnType<typeof openSidepanelWithImages>>['sidepanel']
): Promise<{ type: string; licenseKey?: string }[]> {
  return sidepanel.evaluate(() => {
    interface CallRecord {
      type: string;
      licenseKey?: string;
    }
    return (window as unknown as { __IH_LIC_CALLS__: CallRecord[] }).__IH_LIC_CALLS__ ?? [];
  });
}

async function openSettings(
  sidepanel: Awaited<ReturnType<typeof openSidepanelWithImages>>['sidepanel']
): Promise<void> {
  await sidepanel.evaluate(() => {
    document.getElementById('btn-settings')?.click();
  });
  await expect(sidepanel.locator('#settings-modal')).not.toHaveClass(/hidden/, {
    timeout: 5_000,
  });
  // updateLicenseUI is async (lazy import). Wait for either
  // section to settle into a non-default state.
  await expect
    .poll(
      async () =>
        sidepanel.evaluate(() => {
          const inactive = document.getElementById('license-inactive');
          const active = document.getElementById('license-active');
          return Boolean(inactive && active);
        }),
      { timeout: 3_000 }
    )
    .toBe(true);
}

test('empty key validation: clicking Activate without input surfaces #license-error and never sends ACTIVATE_LICENSE', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);
  await installLicenseStub(sidepanel, { shouldActivateSucceed: false });
  await openSettings(sidepanel);

  // Sanity: free-user flow → #license-inactive visible.
  await expect(sidepanel.locator('#license-inactive')).not.toHaveClass(/hidden/);
  await expect(sidepanel.locator('#license-active')).toHaveClass(/hidden/);

  const callsBefore = await readLicenseCalls(sidepanel);
  const activateCallsBefore = callsBefore.filter((c) => c.type === 'ACTIVATE_LICENSE').length;

  // Click activate with empty input.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-activate-license')?.click();
  });

  // Error surfaces (license-ui.ts L101-105).
  await expect(sidepanel.locator('#license-error')).not.toHaveClass(/hidden/, {
    timeout: 2_000,
  });
  await expect(sidepanel.locator('#license-error')).toContainText('Please enter a license key');

  // No ACTIVATE_LICENSE call landed (the early-return at L102-106
  // guards against it).
  const callsAfter = await readLicenseCalls(sidepanel);
  expect(callsAfter.filter((c) => c.type === 'ACTIVATE_LICENSE').length).toBe(activateCallsBefore);
});

test('input formatter: typing raw chars auto-inserts dashes every 4 characters and uppercases', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);
  await installLicenseStub(sidepanel, { shouldActivateSucceed: false });
  await openSettings(sidepanel);

  // Type lowercase + non-alphanumeric noise — formatter strips the
  // noise, uppercases, then dashes every 4 chars (license-ui.ts
  // L150-160).
  await sidepanel.evaluate(() => {
    const input = document.getElementById('license-key-input') as HTMLInputElement;
    input.value = 'aabb1122ccdd!!3344extra';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const formattedValue = await sidepanel.evaluate(() => {
    const input = document.getElementById('license-key-input') as HTMLInputElement;
    return input.value;
  });
  // 16 alphanumeric chars max, uppercase, dashes every 4.
  expect(formattedValue).toBe('AABB-1122-CCDD-3344');
});

test('happy activation: ACTIVATE_LICENSE → success → input cleared + toast + #license-active surfaces', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);
  await installLicenseStub(sidepanel, { shouldActivateSucceed: true });
  await openSettings(sidepanel);

  // Type a key.
  await sidepanel.evaluate(() => {
    const input = document.getElementById('license-key-input') as HTMLInputElement;
    input.value = 'TEST-1234-FAKE-KEY1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Wipe any stale toasts (the boot scan emits a 'Found N images'
  // toast that, if still in the DOM, would race against our
  // .toast.last() assertion below).
  await sidepanel.evaluate(() => {
    document.getElementById('toast-container')!.innerHTML = '';
  });

  await sidepanel.evaluate(() => {
    document.getElementById('btn-activate-license')?.click();
  });

  // Success toast.
  await expect(sidepanel.locator('.toast').last()).toContainText('Pro activated successfully!', {
    timeout: 3_000,
  });

  // Input cleared (license-ui.ts L122).
  await expect
    .poll(
      async () =>
        sidepanel.evaluate(() => {
          const input = document.getElementById('license-key-input') as HTMLInputElement;
          return input.value;
        }),
      { timeout: 2_000 }
    )
    .toBe('');

  // applyProFeatureVisibility ran → state.isProUser flipped to true
  // (VALIDATE_LICENSE stub now returns isPro:true).
  await expect
    .poll(
      async () =>
        sidepanel.evaluate(() => {
          interface IH {
            store: { get: <T>(k: string) => T };
          }
          const w = window as unknown as { __IH__: IH };
          return w.__IH__.store.get<boolean>('isProUser');
        }),
      { timeout: 3_000 }
    )
    .toBe(true);

  // ACTIVATE_LICENSE call shape pinned: type + licenseKey forwarded.
  const calls = await readLicenseCalls(sidepanel);
  const activateCalls = calls.filter((c) => c.type === 'ACTIVATE_LICENSE');
  expect(activateCalls).toHaveLength(1);
  expect(activateCalls[0].licenseKey).toBe('TEST-1234-FAKE-KEY1');

  // Re-trigger updateLicenseUI by closing + reopening Settings.
  // This is the production path users follow after activate (the
  // current Settings session keeps showing inactive until re-open
  // — see license-ui.ts; updateLicenseUI is only re-run on
  // showSettings).
  await sidepanel.evaluate(() => {
    document.getElementById('btn-settings-close')?.click();
  });
  await sidepanel.waitForTimeout(100);
  await sidepanel.evaluate(() => {
    document.getElementById('btn-settings')?.click();
  });

  // After a Settings reopen, #license-active becomes visible.
  await expect(sidepanel.locator('#license-active')).not.toHaveClass(/hidden/, {
    timeout: 5_000,
  });
  await expect(sidepanel.locator('#license-inactive')).toHaveClass(/hidden/);
});

test('failed activation: ACTIVATE_LICENSE returns error → #license-error surfaces server-provided message', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);
  await installLicenseStub(sidepanel, {
    shouldActivateSucceed: false,
    activateError: 'License key already in use',
  });
  await openSettings(sidepanel);

  await sidepanel.evaluate(() => {
    const input = document.getElementById('license-key-input') as HTMLInputElement;
    input.value = 'BAD1-BAD2-BAD3-BAD4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sidepanel.evaluate(() => {
    document.getElementById('btn-activate-license')?.click();
  });

  // Error surfaces with the stub-provided message (license-ui.ts L131-134).
  await expect(sidepanel.locator('#license-error')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });
  await expect(sidepanel.locator('#license-error')).toContainText('License key already in use');

  // isProUser stays false.
  const isPro = await sidepanel.evaluate(() => {
    interface IH {
      store: { get: <T>(k: string) => T };
    }
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<boolean>('isProUser');
  });
  expect(isPro).toBe(false);

  // No success toast.
  const toastTexts = await sidepanel.locator('.toast').allInnerTexts();
  expect(toastTexts.join(' ')).not.toContain('Pro activated successfully');
});

test('network error: sendMessage throws → #license-error surfaces "Network error" and button re-enables', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);
  await installLicenseStub(sidepanel, {
    shouldActivateSucceed: false,
    shouldThrowOnActivate: true,
  });
  await openSettings(sidepanel);

  await sidepanel.evaluate(() => {
    const input = document.getElementById('license-key-input') as HTMLInputElement;
    input.value = 'NETF-AILS-XXXX-YYYY';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sidepanel.evaluate(() => {
    document.getElementById('toast-container')!.innerHTML = '';
  });
  await sidepanel.evaluate(() => {
    document.getElementById('btn-activate-license')?.click();
  });

  // The catch branch (license-ui.ts L137-141) writes the network
  // error copy.
  await expect(sidepanel.locator('#license-error')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });
  await expect(sidepanel.locator('#license-error')).toContainText(
    'Network error. Please try again.'
  );

  // Button restored from disabled+'Activating...' (the finally
  // block at L143-146).
  await expect(sidepanel.locator('#btn-activate-license')).toBeEnabled({
    timeout: 2_000,
  });
});

test('deactivation: confirm dialog → DEACTIVATE_LICENSE → toast + isProUser flips back to false', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });

  // Pre-seed the synth license state to active so the deactivate
  // flow has something to undo. Pass initialStatus:'active' so the
  // first updateLicenseUI() from showSettings sees an active
  // license — otherwise the license-active section stays hidden
  // and the test races against a state mutation we can't observe.
  await installLicenseStub(sidepanel, {
    shouldActivateSucceed: false,
    initialStatus: 'active',
    initialLicenseKey: 'PROO-AAAA-BBBB-CCCC',
    initialPlan: 'lifetime',
  });

  await openSettings(sidepanel);

  // Manually flip the license sections to mirror what updateLicenseUI
  // *would* paint when GET_LICENSE_STATUS reports active. Going
  // through the real round-trip is unreliable here because:
  //   - settings.ts > showSettings calls updateLicenseUI via a chained
  //     dynamic import; the timing depends on whether ./license-ui
  //     was already lazy-loaded by an earlier test (it lives in the
  //     same browser-context module cache across our beforeAll
  //     extension launch).
  //   - chrome.runtime.sendMessage stub is per-page, but the
  //     applyProFeatureVisibility call during sidepanel boot fires
  //     BEFORE we install the stub, leaking real background state.
  // The deactivation contract we actually care about (button click →
  // confirm dialog → DEACTIVATE_LICENSE call → toast → isProUser
  // flips) is independent of how the section got rendered active.
  await sidepanel.evaluate(() => {
    document.getElementById('license-inactive')?.classList.add('hidden');
    document.getElementById('license-active')?.classList.remove('hidden');
  });
  await expect(sidepanel.locator('#license-active')).not.toHaveClass(/hidden/);

  // Click deactivate → confirm dialog opens.
  await sidepanel.evaluate(() => {
    document.getElementById('btn-deactivate-license')?.click();
  });
  await expect(sidepanel.locator('#confirm-dialog')).not.toHaveClass(/hidden/, {
    timeout: 3_000,
  });
  await expect(sidepanel.locator('#confirm-dialog-title')).toHaveText('Deactivate License');

  const callsBefore = await readLicenseCalls(sidepanel);
  const deactBefore = callsBefore.filter((c) => c.type === 'DEACTIVATE_LICENSE').length;

  await sidepanel.evaluate(() => {
    document.getElementById('toast-container')!.innerHTML = '';
  });

  // Confirm.
  await sidepanel.evaluate(() => {
    document.getElementById('confirm-dialog-confirm')?.click();
  });

  // DEACTIVATE_LICENSE call lands.
  await expect
    .poll(
      async () => {
        const calls = await readLicenseCalls(sidepanel);
        return calls.filter((c) => c.type === 'DEACTIVATE_LICENSE').length;
      },
      { timeout: 3_000 }
    )
    .toBe(deactBefore + 1);

  // Toast.
  await expect(sidepanel.locator('.toast').last()).toContainText('License deactivated', {
    timeout: 3_000,
  });

  // isProUser flipped back to false (applyProFeatureVisibility
  // re-queried GET_LICENSE_STATUS, which now returns isPro:false).
  await expect
    .poll(
      async () =>
        sidepanel.evaluate(() => {
          interface IH {
            store: { get: <T>(k: string) => T };
          }
          const w = window as unknown as { __IH__: IH };
          return w.__IH__.store.get<boolean>('isProUser');
        }),
      { timeout: 3_000 }
    )
    .toBe(false);
});

test('deactivation cancelled: confirm dialog Cancel → no DEACTIVATE_LICENSE, isProUser stays true', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId, {
    enablePro: true,
  });
  await installLicenseStub(sidepanel, {
    shouldActivateSucceed: false,
    initialStatus: 'active',
    initialLicenseKey: 'KEEP-AAAA-BBBB-CCCC',
    initialPlan: 'lifetime',
  });

  await openSettings(sidepanel);
  // Mirror what updateLicenseUI would paint — see the long comment
  // in the previous deactivation test for why we don't depend on
  // the real GET_LICENSE_STATUS round-trip here.
  await sidepanel.evaluate(() => {
    document.getElementById('license-inactive')?.classList.add('hidden');
    document.getElementById('license-active')?.classList.remove('hidden');
  });
  await expect(sidepanel.locator('#license-active')).not.toHaveClass(/hidden/);

  await sidepanel.evaluate(() => {
    document.getElementById('btn-deactivate-license')?.click();
  });
  await expect(sidepanel.locator('#confirm-dialog')).not.toHaveClass(/hidden/);

  const callsBefore = await readLicenseCalls(sidepanel);
  const deactBefore = callsBefore.filter((c) => c.type === 'DEACTIVATE_LICENSE').length;

  // Cancel.
  await sidepanel.evaluate(() => {
    document.getElementById('confirm-dialog-cancel')?.click();
  });
  await expect(sidepanel.locator('#confirm-dialog')).toHaveClass(/hidden/, {
    timeout: 2_000,
  });

  // Nothing fired.
  await sidepanel.waitForTimeout(300);
  const callsAfter = await readLicenseCalls(sidepanel);
  expect(callsAfter.filter((c) => c.type === 'DEACTIVATE_LICENSE').length).toBe(deactBefore);

  // Still pro.
  const isPro = await sidepanel.evaluate(() => {
    interface IH {
      store: { get: <T>(k: string) => T };
    }
    const w = window as unknown as { __IH__: IH };
    return w.__IH__.store.get<boolean>('isProUser');
  });
  expect(isPro).toBe(true);
});
