// License UI module — split out of settings.ts so the heavy
// license-management code path only lands in the bundle when the user
// actually opens the Settings modal or the Pro Upgrade modal.
//
// What stays in settings.ts (must remain synchronous, used at init/event
// time across the rest of the app):
//   - showProUpgradeModal / closeProUpgradeModal — referenced by 6+ call
//     sites including the Pro click guard
//   - updateTopProStatus — invoked synchronously from
//     applyProFeatureVisibility during init
//   - bindProGuards — registers the capture-phase Pro click interceptors
//     on #btn-collection / #btn-multitab / setting-* toggles, must run
//     during bindEvents
//
// What lives here (lazy):
//   - updateLicenseUI / activateLicenseFromInput / bindLicenseKeyFormatter
//   - bindLicenseModalEvents (the License section + ProUpgradeModal
//     activation form bindings)
//   - formatDateYMD / maskLicenseKey (pure helpers, only consumed by the
//     functions above)
//
// Called from settings.ts > showSettings() via dynamic import.
import { MESSAGE_TYPES, PRICING_PAGE_URL } from '../shared/constants';
import { applyProFeatureVisibility, closeProUpgradeModal } from './settings';
import { showConfirmDialog, showToast } from './ui';

export function formatDateYMD(dateStr: string | number): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

export function maskLicenseKey(key: string): string {
  if (!key || key.length <= 8) return key || '';
  return key.substring(0, 4) + '-****-****-' + key.substring(key.length - 4);
}

/**
 * Update the License section UI in settings modal.
 */
export async function updateLicenseUI(): Promise<void> {
  const inactiveSection = document.getElementById('license-inactive');
  const activeSection = document.getElementById('license-active');
  if (!inactiveSection || !activeSection) return;

  try {
    const info = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_LICENSE_STATUS });

    if (info?.hasLicense && info.status === 'active') {
      inactiveSection.classList.add('hidden');
      activeSection.classList.remove('hidden');

      const keyMasked = document.getElementById('license-key-masked');
      if (keyMasked && info.licenseKey) {
        keyMasked.textContent = maskLicenseKey(info.licenseKey);
      }

      const planBadge = document.getElementById('license-plan-badge');
      if (planBadge && info.plan) {
        const planLabels: Record<string, string> = {
          monthly: 'Monthly',
          yearly: 'Yearly',
          lifetime: 'Lifetime',
        };
        planBadge.textContent = planLabels[info.plan] || info.plan;
      }

      const expiresEl = document.getElementById('license-expires');
      if (expiresEl) {
        if (info.plan === 'lifetime') {
          expiresEl.textContent = 'Never expires';
        } else if (info.expiresAt) {
          expiresEl.textContent = 'Expires: ' + formatDateYMD(info.expiresAt);
        } else {
          expiresEl.textContent = '';
        }
      }
    } else {
      inactiveSection.classList.remove('hidden');
      activeSection.classList.add('hidden');
    }
  } catch {
    inactiveSection.classList.remove('hidden');
    activeSection.classList.add('hidden');
  }
}

/**
 * Shared license activation logic for both the settings panel input and
 * the Pro Upgrade modal input.
 */
export async function activateLicenseFromInput(
  inputEl: HTMLInputElement,
  errorEl: HTMLElement | null,
  buttonEl: HTMLButtonElement,
  closeModalOnSuccess = false
): Promise<void> {
  const key = inputEl.value.trim();
  if (!key) {
    if (errorEl) {
      errorEl.textContent = 'Please enter a license key';
      errorEl.classList.remove('hidden');
    }
    return;
  }

  const originalText = buttonEl.textContent;
  buttonEl.disabled = true;
  buttonEl.textContent = 'Activating...';
  if (errorEl) errorEl.classList.add('hidden');

  try {
    const result = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.ACTIVATE_LICENSE,
      licenseKey: key,
    });

    if (result?.success) {
      inputEl.value = '';
      if (closeModalOnSuccess) closeProUpgradeModal();
      await applyProFeatureVisibility();
      showToast('Pro activated successfully!', 'success');
    } else {
      if (errorEl) {
        errorEl.textContent = result?.error || 'Activation failed';
        errorEl.classList.remove('hidden');
      }
    }
  } catch {
    if (errorEl) {
      errorEl.textContent = 'Network error. Please try again.';
      errorEl.classList.remove('hidden');
    }
  } finally {
    buttonEl.disabled = false;
    buttonEl.textContent = originalText;
  }
}

/**
 * Auto-format license key input (add dashes every 4 chars).
 */
export function bindLicenseKeyFormatter(inputEl: HTMLInputElement): void {
  inputEl.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    const val = target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const parts: string[] = [];
    for (let i = 0; i < val.length && i < 16; i += 4) {
      parts.push(val.substring(i, i + 4));
    }
    target.value = parts.join('-');
  });
}

// One-time bind guard. Settings modal can be opened repeatedly; we only
// want to attach the license listeners on the first open.
let licenseEventsBound = false;

/**
 * Bind License UI events for the Settings modal's License section AND
 * the Pro Upgrade modal's activation form. Idempotent — safe to call on
 * every Settings modal open.
 */
export function bindLicenseModalEvents(): void {
  if (licenseEventsBound) return;
  licenseEventsBound = true;

  // ---- Settings modal: License activation ----
  const activateBtn = document.getElementById('btn-activate-license') as HTMLButtonElement | null;
  const deactivateBtn = document.getElementById(
    'btn-deactivate-license'
  ) as HTMLButtonElement | null;
  const licenseInput = document.getElementById('license-key-input') as HTMLInputElement | null;
  const licenseError = document.getElementById('license-error');
  const getProLink = document.getElementById('link-get-pro');

  if (activateBtn && licenseInput) {
    activateBtn.addEventListener('click', () =>
      activateLicenseFromInput(licenseInput, licenseError, activateBtn)
    );
    bindLicenseKeyFormatter(licenseInput);
    licenseInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') activateBtn.click();
    });
  }

  if (deactivateBtn) {
    deactivateBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmDialog({
        title: 'Deactivate License',
        message:
          'Are you sure you want to deactivate your license on this device? You can reactivate it later.',
        confirmText: 'Deactivate',
        cancelText: 'Cancel',
        type: 'danger',
      });
      if (!confirmed) return;
      deactivateBtn.disabled = true;
      deactivateBtn.textContent = 'Deactivating...';
      try {
        await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.DEACTIVATE_LICENSE });
        await applyProFeatureVisibility();
        showToast('License deactivated', 'info');
      } catch {
        showToast('Failed to deactivate', 'error');
      } finally {
        deactivateBtn.disabled = false;
        deactivateBtn.textContent = 'Deactivate';
      }
    });
  }

  if (getProLink) {
    getProLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: PRICING_PAGE_URL });
    });
  }

  // ---- Pro Upgrade Modal: activation form ----
  const proModalActivateBtn = document.getElementById(
    'btn-pro-modal-activate'
  ) as HTMLButtonElement | null;
  const proModalInput = document.getElementById('pro-modal-key-input') as HTMLInputElement | null;
  const proModalError = document.getElementById('pro-modal-error');
  const proModalGetLink = document.getElementById('link-pro-modal-get');

  if (proModalActivateBtn && proModalInput) {
    proModalActivateBtn.addEventListener('click', () =>
      activateLicenseFromInput(proModalInput, proModalError, proModalActivateBtn, true)
    );
    bindLicenseKeyFormatter(proModalInput);
    proModalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') proModalActivateBtn.click();
    });
  }

  if (proModalGetLink) {
    proModalGetLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: PRICING_PAGE_URL });
    });
  }
}
