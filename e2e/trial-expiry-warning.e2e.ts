// e2e: the trial's last-3-days amber warning (ProStatusBadge > .trial-expiry-warning).
//
// Production data contract this spec protects (2026-11-23 forensics):
//   trial_expiry_warning_shown has ZERO rows in 90 days while 163 of 1034
//   auto-started trials had panel activity inside their final 3 days. The
//   warning is the only pre-expiry conversion touchpoint, so "it never
//   renders" silently disables a whole funnel step.
//
// Three layers, deliberately split so a failure points at the right half:
//   1. render layer  — store carries the trial countdown → banner appears.
//      Includes the regression pin for the fix: the countdown alone (no
//      proLicenseInfo) must be enough, because the warning used to depend
//      on a second GET_LICENSE_STATUS round-trip.
//   2. data layer    — the real panel-init chain (VALIDATE_LICENSE →
//      applyProFeatureVisibility) must populate that countdown and the
//      banner's daily impression must be claimed.
//   3. grace window  — a just-expired trial must show the GRACE banner,
//      never the pre-expiry one.
import { test, expect } from '@playwright/test';
import {
  extensionUrl,
  launchExtension,
  openSidepanelWithImages,
  startFixtureServer,
  type FixtureServer,
  type LaunchedExtension,
} from './_helpers/launchExtension';

const DAY_MS = 86_400_000;
const WARNING_DAY_KEY = '_trial_expiry_warning_day';

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

test('render layer: the trial countdown alone shows the amber warning', async () => {
  const { sidepanel } = await openSidepanelWithImages(ext.context, fixtureServer, ext.extensionId);

  // Deliberately set ONLY trialDaysLeft: that is the field written by
  // applyProFeatureVisibility from VALIDATE_LICENSE. proLicenseInfo stays
  // null, which is exactly the production shape that used to hide the
  // banner for an entire trial.
  await sidepanel.evaluate(() => {
    const w = window as unknown as {
      __IH__: { store: { set: (k: string, v: unknown) => void } };
    };
    w.__IH__.store.set('isProUser', true);
    w.__IH__.store.set('trialDaysLeft', 2);
  });

  await expect(sidepanel.locator('.trial-expiry-warning')).toBeVisible({ timeout: 5_000 });
  await expect(sidepanel.locator('.trial-expiry-text')).toContainText(/2/);
});

test('data layer: panel init populates the countdown and claims the daily impression', async () => {
  const page = await ext.context.newPage();
  // Stub the license messages BEFORE the panel's modules run — this is the
  // real init path with a deterministic license, not a store injection.
  await page.addInitScript(() => {
    const DAY = 86_400_000;
    const expiresAt = Date.now() + 2 * DAY - 3_600_000;
    (window as unknown as { __IH_E2E__?: boolean }).__IH_E2E__ = true;
    interface Runtime {
      sendMessage?: (...args: unknown[]) => Promise<unknown>;
    }
    const c = (window as unknown as { chrome?: { runtime?: Runtime } }).chrome;
    const install = (): boolean => {
      const runtime = c?.runtime;
      if (!runtime?.sendMessage) return false;
      const original = runtime.sendMessage.bind(runtime);
      runtime.sendMessage = ((msg: unknown, ...rest: unknown[]) => {
        const type = (msg as { type?: string })?.type;
        if (type === 'VALIDATE_LICENSE') {
          return Promise.resolve({ isPro: true, plan: 'trial', status: 'active', expiresAt });
        }
        if (type === 'GET_LICENSE_STATUS') {
          // Empty on purpose: the warning must not need this round-trip.
          return Promise.resolve({ hasLicense: false });
        }
        return original(msg, ...rest);
      }) as Runtime['sendMessage'];
      return true;
    };
    if (!install()) {
      const timer = setInterval(() => {
        if (install()) clearInterval(timer);
      }, 10);
      setTimeout(() => clearInterval(timer), 2_000);
    }
  });
  await page.goto(extensionUrl(ext.extensionId, 'pages/sidepanel.html'));

  await expect(page.locator('.trial-expiry-warning')).toBeVisible({ timeout: 15_000 });

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = window as unknown as {
            __IH__?: { store: { get: (k: string) => unknown } };
          };
          return w.__IH__?.store.get('trialDaysLeft') ?? null;
        }),
      { timeout: 15_000 }
    )
    .toBe(2);

  // The impression is claimed (key written) before track() is called, so
  // this pins the whole maybeReportTrialExpiryWarning path in the real
  // init chain. Telemetry itself is a no-op in e2e builds by design.
  await expect
    .poll(
      () =>
        page.evaluate(async (key) => {
          const r = await chrome.storage.local.get(key);
          return (r[key] as string | undefined) ?? null;
        }, WARNING_DAY_KEY),
      { timeout: 10_000 }
    )
    .toBe(new Date().toISOString().slice(0, 10));
});

test('grace window: an already-expired trial shows the grace banner, not the warning', async () => {
  const page = await ext.context.newPage();
  await page.addInitScript(() => {
    const DAY = 86_400_000;
    const expiresAt = Date.now() - DAY; // 1 day into the 3-day grace window
    (window as unknown as { __IH_E2E__?: boolean }).__IH_E2E__ = true;
    interface Runtime {
      sendMessage?: (...args: unknown[]) => Promise<unknown>;
    }
    const c = (window as unknown as { chrome?: { runtime?: Runtime } }).chrome;
    const origInstall = (): boolean => {
      const runtime = c?.runtime;
      if (!runtime?.sendMessage) return false;
      const original = runtime.sendMessage.bind(runtime);
      runtime.sendMessage = ((msg: unknown, ...rest: unknown[]) => {
        const type = (msg as { type?: string })?.type;
        if (type === 'VALIDATE_LICENSE') {
          return Promise.resolve({
            isPro: true,
            plan: 'trial',
            status: 'expired',
            expiresAt,
            inGracePeriod: true,
          });
        }
        if (type === 'GET_LICENSE_STATUS') {
          return Promise.resolve({ hasLicense: true, plan: 'trial', status: 'expired', expiresAt });
        }
        return original(msg, ...rest);
      }) as Runtime['sendMessage'];
      return true;
    };
    if (!origInstall()) {
      const timer = setInterval(() => {
        if (origInstall()) clearInterval(timer);
      }, 10);
      setTimeout(() => clearInterval(timer), 2_000);
    }
  });
  await page.goto(extensionUrl(ext.extensionId, 'pages/sidepanel.html'));

  await expect(page.locator('.trial-grace-banner')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.trial-expiry-warning')).toHaveCount(0);
});
