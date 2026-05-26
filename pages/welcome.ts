// Welcome page script — minimal vanilla TS, no framework dependencies.
// Displays trial countdown and handles the CTA button.

import { track, flushNow } from '../shared/telemetry';
import { EVENTS } from '../shared/telemetry-events';

function applyI18n(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (!key) return;
    const msg = chrome.i18n.getMessage(key);
    if (msg) el.textContent = msg;
  });
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
