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

import { track, flushNow } from '../shared/telemetry';
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
    void track(EVENTS.WELCOME_CTA_CLICKED, { action: 'explore' });
    void flushNow();
    // Small delay to allow telemetry to flush
    setTimeout(() => window.close(), 200);
  });

  // Track page view
  void track(EVENTS.WELCOME_PAGE_VIEWED, { source: 'install' });

  // Guided onboarding (bucket b only)
  void setupOnboarding();
}

async function setupOnboarding(): Promise<void> {
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

  btnTry.addEventListener('click', () => {
    void (async () => {
      // Arm the side panel's coach marks BEFORE opening it, so the panel sees
      // the flag on its very first read.
      await startOnboarding();
      void track(EVENTS.ONBOARDING_STARTED, { bucket });
      void flushNow();
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
