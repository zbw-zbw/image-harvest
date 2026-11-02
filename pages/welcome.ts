// Welcome page script — minimal vanilla TS, no framework dependencies.
// Displays trial countdown and handles the CTAs.
//
// Onboarding A/B (Phase 2a, experiment `onboarding_flow_v1`):
//   bucket a (control) — legacy behaviour: "Start Exploring" closes the tab.
//     The 90-day funnel showed only ~2.6% of installs ever reached a first
//     download, so this is the baseline we're trying to beat.
//   bucket b (treatment) — the demo gallery below the CTA is revealed and the
//     primary action opens the side panel ON THIS PAGE. The gallery images are
//     bundled extension icons, so the very first scan cannot fail (no network,
//     no CSP, no lazy-loading) and the user reaches the download in seconds.

import { track, flushNow, setEnvelopeMeta } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';
import { EXPERIMENTS, getExperimentBucket, type AbBucket } from '../shared/ab-experiment';
import { startOnboarding } from '../shared/onboarding-state';
import { MESSAGE_TYPES } from '../shared/constants';

function applyI18n(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (!key) return;
    const msg = chrome.i18n.getMessage(key);
    if (msg) el.textContent = msg;
  });
}

/**
 * Ask the service worker to open the side panel on this tab. Routing through
 * sendMessage keeps the click's user-gesture context, which
 * chrome.sidePanel.open() requires (Chrome 116+).
 */
async function openSidePanelHere(): Promise<boolean> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.OPEN_SIDE_PANEL,
    })) as { success?: boolean } | undefined;
    return Boolean(res?.success);
  } catch {
    return false;
  }
}

function init(): void {
  // This context never called setEnvelopeMeta before v1.2.7, so every
  // welcome event shipped with the default version '0.0.0' — which made
  // cohort splits by version (see scripts/v124-verification.ts in the
  // backend repo) blind to the one page that was actually broken.
  setEnvelopeMeta({
    version: chrome.runtime.getManifest().version,
    lang: chrome.i18n.getUILanguage(),
  });

  window.scrollTo(0, 0);
  applyI18n();

  // Display version
  const versionEl = document.getElementById('version');
  if (versionEl) {
    versionEl.textContent = chrome.runtime.getManifest().version;
  }

  // Calculate trial days remaining from license data
  void updateCountdown();

  // CTA button — close this tab (user will use the extension from the toolbar)
  const btnExplore = document.getElementById('btn-explore');
  btnExplore?.addEventListener('click', () => {
    // v1.2.7: await track before flushing. The old `void track(); void
    // flushNow();` raced — track's first call awaits isOptedIn() (a
    // storage read), so the synchronous flushNow() ran on an empty queue
    // and the event fell to the 5s timer, which dies with the tab.
    void (async () => {
      await track(EVENTS.WELCOME_CTA_CLICKED, { action: 'explore' });
      await flushNow();
      // Small delay to allow the flush fetch to leave the page
      setTimeout(() => window.close(), 200);
    })();
  });

  // Track page view. v1.2.7 race fix: track() must resolve (event enqueued)
  // BEFORE flushNow() runs, otherwise the flush drains an empty queue and
  // the event lands on the 5s timer — dead the moment the tab closes.
  // Field data: 2,189+ installs, single-digit WELCOME_PAGE_VIEWED events.
  void (async () => {
    await track(EVENTS.WELCOME_PAGE_VIEWED, { source: 'install' });
    await flushNow();
  })();

  // Last-resort safety net: if the tab dies between track() and flushNow()
  // above (or anything else is still queued), pagehide fires one final
  // flush. fetch() with keepalive (telemetry's transport) survives the
  // page teardown that follows.
  window.addEventListener('pagehide', () => {
    void flushNow();
  });

  // Guided onboarding (bucket b only for the UI; the arm itself is
  // unconditional — see setupOnboarding)
  void setupOnboarding();
}

async function setupOnboarding(): Promise<void> {
  // v1.2.7: arm FIRST, unconditionally, before any awaited bucket lookup.
  // The bucket gate lives in the panel consumer (OnboardingCoach renders
  // only for bucket b), so arming here for bucket a is harmless — and the
  // arm is now a single storage round-trip that completes even when the
  // tab closes within seconds. The previous order (await
  // getExperimentBucket → startOnboarding) chained two storage round-trips
  // before the write, and field data showed it never survived fast closes.
  await startOnboarding();

  let bucket: AbBucket = 'a';
  try {
    bucket = await getExperimentBucket(EXPERIMENTS.ONBOARDING_FLOW);
  } catch {
    /* control on failure — legacy behaviour is always safe */
  }
  if (bucket !== 'b') return;

  const section = document.getElementById('demo-section');
  const btnTry = document.getElementById('btn-try-now');
  const hint = document.getElementById('demo-hint');
  if (!section || !btnTry) return;

  section.hidden = false;

  // v1.2.7: the install-time arm in background onInstalled stays as the
  // primary (it tests green, and ext_installed from the same handler
  // reports reliably). This page-level arm is the backfill for installs
  // where the service worker died early. startOnboarding() is idempotent
  // and fires no event by itself — onboarding_started is still reported
  // at the coach's first sighting in the panel.

  btnTry.addEventListener('click', () => {
    void (async () => {
      await track(EVENTS.WELCOME_CTA_CLICKED, { action: 'try_now' });
      await flushNow();
      const opened = await openSidePanelHere();
      if (opened && hint) {
        hint.hidden = false;
        (btnTry as HTMLButtonElement).disabled = true;
      }
    })();
  });
}

async function updateCountdown(): Promise<void> {
  try {
    const data = await chrome.storage.local.get('licenseData');
    const license = data.licenseData;
    if (license?.expiresAt) {
      const msRemaining = Math.max(0, license.expiresAt - Date.now());
      const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
      const countdownEl = document.getElementById('countdown-days');
      if (countdownEl) {
        countdownEl.textContent = String(daysRemaining);
      }
    }
  } catch {
    // Non-critical — default "7" is already in the HTML
  }
}

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
