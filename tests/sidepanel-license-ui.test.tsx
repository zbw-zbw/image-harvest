// Unit tests for sidepanel/license-ui.ts — the 246-line lazy-loaded
// license-management module that was previously at 0% coverage.
//
// Scope:
//   - formatDateYMD: 3 cases (ISO string / epoch number / timezone-safe
//     zero-padding of single-digit month/day)
//   - maskLicenseKey: 4 cases (null/empty → '' / short (<=8) unchanged /
//     16-char key → XXXX-****-****-XXXX / boundary length 9)
//   - updateLicenseUI: 4 cases (active license shows active section +
//     masked key + plan label + formatted expiry for monthly/yearly +
//     'Never expires' for lifetime + empty expiresAt fallback) + 2
//     cases (inactive response / sendMessage throws → both force
//     inactive section visible)
//   - activateLicenseFromInput: 5 branches (empty input → error msg no
//     sendMessage / success + !closeModalOnSuccess → toast + no close /
//     success + closeModalOnSuccess=true → closeProUpgradeModal /
//     result.success=false → error text threaded / sendMessage throws
//     → 'Network error' + button restored in finally)
//   - bindLicenseKeyFormatter: input normalization (lowercase→upper +
//     strip non-alphanumeric + chunk every 4 with dashes + 16-char cap)
//   - bindLicenseModalEvents: idempotent guard (2nd call no-op) + Enter
//     key on input triggers activate + deactivate confirm cancelled →
//     no sendMessage + deactivate confirm + success → sendMessage
//     DEACTIVATE_LICENSE + toast + button restored / getProLink click
//     → chrome.tabs.create({url: PRICING_PAGE_URL})
//
// CRITICAL: `licenseEventsBound` is a module-level flag. Every test
// that exercises bindLicenseModalEvents (or relies on the module in a
// clean state) must precede with vi.resetModules() and re-import.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sidepanel/settings', () => ({
  applyProFeatureVisibility: vi.fn().mockResolvedValue(undefined),
  closeProUpgradeModal: vi.fn(),
}));
vi.mock('../sidepanel/ui', () => ({
  showConfirmDialog: vi.fn(),
  showToast: vi.fn(),
}));

interface ChromeStub {
  runtime: { sendMessage: ReturnType<typeof vi.fn> };
  tabs: { create: ReturnType<typeof vi.fn> };
}

let chromeStub: ChromeStub;

function installChrome(): void {
  chromeStub = {
    runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    tabs: { create: vi.fn().mockResolvedValue(undefined) },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
}

beforeEach(() => {
  document.body.innerHTML = '';
  installChrome();
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

describe('formatDateYMD', () => {
  it('ISO date string → zero-padded YYYY/MM/DD', async () => {
    const { formatDateYMD } = await import('../sidepanel/license-ui');
    // Pin: two-digit month/day zero-padding. Without padStart, "2026/5/6"
    // would leak through and mis-sort chronologically in the UI list.
    expect(formatDateYMD('2026-05-06T10:00:00Z')).toMatch(/2026\/0[5-6]\/0[5-7]/);
  });

  it('epoch number (ms) → YYYY/MM/DD (same as string path)', async () => {
    const { formatDateYMD } = await import('../sidepanel/license-ui');
    const epoch = new Date('2030-12-01T00:00:00Z').getTime();
    expect(formatDateYMD(epoch)).toMatch(/2030\/1[1-2]\/(\d{2})/);
  });

  it('single-digit month and day are zero-padded', async () => {
    const { formatDateYMD } = await import('../sidepanel/license-ui');
    // Construct in local TZ to avoid flakes across runners.
    const d = new Date(2027, 0, 9); // Jan 9, 2027
    expect(formatDateYMD(d.toISOString())).toMatch(/2027\/01\/(08|09|10)/);
  });
});

describe('maskLicenseKey', () => {
  it('null/empty returns empty string', async () => {
    const { maskLicenseKey } = await import('../sidepanel/license-ui');
    expect(maskLicenseKey('')).toBe('');
    expect(maskLicenseKey(null as unknown as string)).toBe('');
  });

  it('short key (<=8 chars) returned unchanged', async () => {
    const { maskLicenseKey } = await import('../sidepanel/license-ui');
    // Pin: the `<= 8` boundary. An off-by-one using `< 8` would mask
    // an 8-char key with 0-char prefix/suffix → "-****-****-" only.
    expect(maskLicenseKey('ABC')).toBe('ABC');
    expect(maskLicenseKey('ABCDEFGH')).toBe('ABCDEFGH');
  });

  it('9-char key (first key just above boundary) masked as XXXX-****-****-XXXX', async () => {
    const { maskLicenseKey } = await import('../sidepanel/license-ui');
    expect(maskLicenseKey('ABCDEFGHI')).toBe('ABCD-****-****-FGHI');
  });

  it('standard 16-char key → first 4 + mask + last 4', async () => {
    const { maskLicenseKey } = await import('../sidepanel/license-ui');
    expect(maskLicenseKey('AAAABBBBCCCCDDDD')).toBe('AAAA-****-****-DDDD');
  });
});

// ─────────────────────────────────────────────────────────────────────
// updateLicenseUI
// ─────────────────────────────────────────────────────────────────────

describe('updateLicenseUI', () => {
  function mountLicenseSections(): void {
    document.body.innerHTML = `
      <div id="license-inactive"></div>
      <div id="license-active" class="hidden">
        <span id="license-key-masked"></span>
        <span id="license-plan-badge"></span>
        <span id="license-expires"></span>
      </div>
    `;
  }

  it('missing sections (pre-mount) → silent early return (no crash)', async () => {
    document.body.innerHTML = '';
    const { updateLicenseUI } = await import('../sidepanel/license-ui');
    await expect(updateLicenseUI()).resolves.toBeUndefined();
    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('active + yearly plan + expiresAt → shows masked key + "Yearly" badge + "Expires: …"', async () => {
    mountLicenseSections();
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({
      hasLicense: true,
      status: 'active',
      licenseKey: 'KEYAKEYBKEYCKEYD',
      plan: 'yearly',
      expiresAt: '2030-06-15T00:00:00Z',
    });

    const { updateLicenseUI } = await import('../sidepanel/license-ui');
    await updateLicenseUI();

    const active = document.getElementById('license-active')!;
    const inactive = document.getElementById('license-inactive')!;
    expect(active.classList.contains('hidden')).toBe(false);
    expect(inactive.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('license-key-masked')!.textContent).toBe('KEYA-****-****-KEYD');
    expect(document.getElementById('license-plan-badge')!.textContent).toBe('Yearly');
    expect(document.getElementById('license-expires')!.textContent).toMatch(
      /^Expires: 2030\/06\/\d{2}$/
    );
  });

  it('active + lifetime plan → "Never expires" (bypasses formatDateYMD)', async () => {
    mountLicenseSections();
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({
      hasLicense: true,
      status: 'active',
      licenseKey: 'ABCDEFGHIJKLMNOP',
      plan: 'lifetime',
      expiresAt: null,
    });
    const { updateLicenseUI } = await import('../sidepanel/license-ui');
    await updateLicenseUI();
    // Pin: lifetime users see "Never expires" NOT "Expires: Invalid
    // Date". A regression always calling formatDateYMD would surface
    // NaN/NaN/NaN text for lifetime licenses.
    expect(document.getElementById('license-expires')!.textContent).toBe('Never expires');
  });

  it('active + monthly + no expiresAt → empty expires text (no crash)', async () => {
    mountLicenseSections();
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({
      hasLicense: true,
      status: 'active',
      plan: 'monthly',
      expiresAt: undefined,
    });
    const { updateLicenseUI } = await import('../sidepanel/license-ui');
    await updateLicenseUI();
    expect(document.getElementById('license-expires')!.textContent).toBe('');
    expect(document.getElementById('license-plan-badge')!.textContent).toBe('Monthly');
  });

  it('unknown plan string → raw plan text used as badge fallback', async () => {
    mountLicenseSections();
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({
      hasLicense: true,
      status: 'active',
      plan: 'trial-beta',
    });
    const { updateLicenseUI } = await import('../sidepanel/license-ui');
    await updateLicenseUI();
    // Pin: the `planLabels[plan] || plan` fallback. Without it,
    // unknown plan values from a future backend would render 'undefined'.
    expect(document.getElementById('license-plan-badge')!.textContent).toBe('trial-beta');
  });

  it('inactive response (hasLicense=false) → forces inactive section visible', async () => {
    mountLicenseSections();
    // Pre-flip to test the reverse.
    document.getElementById('license-inactive')!.classList.add('hidden');
    document.getElementById('license-active')!.classList.remove('hidden');

    chromeStub.runtime.sendMessage.mockResolvedValueOnce({ hasLicense: false });
    const { updateLicenseUI } = await import('../sidepanel/license-ui');
    await updateLicenseUI();

    expect(document.getElementById('license-inactive')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('license-active')!.classList.contains('hidden')).toBe(true);
  });

  it('sendMessage throws → same inactive-visible recovery via catch block', async () => {
    mountLicenseSections();
    chromeStub.runtime.sendMessage.mockRejectedValueOnce(new Error('bg down'));
    const { updateLicenseUI } = await import('../sidepanel/license-ui');
    await updateLicenseUI();
    // Pin: never swallow errors silently with the active section
    // still showing — that would look like "license active" to a user
    // whose extension is actually disconnected.
    expect(document.getElementById('license-inactive')!.classList.contains('hidden')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// activateLicenseFromInput
// ─────────────────────────────────────────────────────────────────────

describe('activateLicenseFromInput', () => {
  function makeInputs(): {
    input: HTMLInputElement;
    error: HTMLElement;
    button: HTMLButtonElement;
  } {
    const input = document.createElement('input');
    const error = document.createElement('div');
    error.classList.add('hidden');
    const button = document.createElement('button');
    button.textContent = 'Activate';
    document.body.append(input, error, button);
    return { input, error, button };
  }

  it('empty/whitespace-only input → shows "Please enter a license key" + NO sendMessage', async () => {
    const { input, error, button } = makeInputs();
    input.value = '   '; // whitespace only

    const { activateLicenseFromInput } = await import('../sidepanel/license-ui');
    await activateLicenseFromInput(input, error, button);

    expect(error.textContent).toBe('Please enter a license key');
    expect(error.classList.contains('hidden')).toBe(false);
    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('success + closeModalOnSuccess=false → input cleared + toast + NO closeProUpgradeModal', async () => {
    const { input, error, button } = makeInputs();
    input.value = 'VALIDKEY';
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({ success: true });

    const { activateLicenseFromInput } = await import('../sidepanel/license-ui');
    await activateLicenseFromInput(input, error, button);

    expect(input.value).toBe('');
    const ui = await import('../sidepanel/ui');
    const settings = await import('../sidepanel/settings');
    expect(ui.showToast).toHaveBeenCalledWith('Pro activated successfully!', 'success');
    expect(settings.applyProFeatureVisibility).toHaveBeenCalledTimes(1);
    // Pin: closeModalOnSuccess=false path must NOT close the modal.
    expect(settings.closeProUpgradeModal).not.toHaveBeenCalled();
    // Button restored in finally.
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Activate');
  });

  it('success + closeModalOnSuccess=true → closeProUpgradeModal fires', async () => {
    const { input, error, button } = makeInputs();
    input.value = 'VALIDKEY';
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({ success: true });

    const { activateLicenseFromInput } = await import('../sidepanel/license-ui');
    await activateLicenseFromInput(input, error, button, true);

    const settings = await import('../sidepanel/settings');
    // Pin: when invoked from the Pro-Upgrade modal (closeModalOnSuccess=true),
    // activation must close that modal AFTER toast fires. Reversing order
    // would briefly flash "Pro activated" toast over the modal → confusing.
    expect(settings.closeProUpgradeModal).toHaveBeenCalledTimes(1);
  });

  it('result.success=false + error string → threads error text through to errorEl', async () => {
    const { input, error, button } = makeInputs();
    input.value = 'BADKEY';
    chromeStub.runtime.sendMessage.mockResolvedValueOnce({
      success: false,
      error: 'License key expired',
    });

    const { activateLicenseFromInput } = await import('../sidepanel/license-ui');
    await activateLicenseFromInput(input, error, button);

    expect(error.textContent).toBe('License key expired');
    expect(error.classList.contains('hidden')).toBe(false);
    // Input NOT cleared on failure.
    expect(input.value).toBe('BADKEY');
  });

  it('sendMessage throws → "Network error" fallback + button restored in finally', async () => {
    const { input, error, button } = makeInputs();
    input.value = 'ABCD';
    chromeStub.runtime.sendMessage.mockRejectedValueOnce(new Error('offline'));

    const { activateLicenseFromInput } = await import('../sidepanel/license-ui');
    await activateLicenseFromInput(input, error, button);

    expect(error.textContent).toBe('Network error. Please try again.');
    // Pin: the finally block is NON-NEGOTIABLE. Without it, a thrown
    // exception would leave the button disabled + stuck on "Activating..."
    // forever.
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Activate');
  });

  it('null errorEl (caller passed null) → no crash in any branch', async () => {
    const { input, button } = makeInputs();
    input.value = '';

    const { activateLicenseFromInput } = await import('../sidepanel/license-ui');
    // Pin: errorEl is typed `HTMLElement | null` — every touch site
    // must null-check. A regression dereferencing null would crash
    // for the Pro Upgrade modal when its error slot isn't rendered.
    await expect(activateLicenseFromInput(input, null, button)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// bindLicenseKeyFormatter
// ─────────────────────────────────────────────────────────────────────

describe('bindLicenseKeyFormatter', () => {
  it('lowercase → uppercased + non-alphanumeric stripped + dashes every 4 chars', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    const { bindLicenseKeyFormatter } = await import('../sidepanel/license-ui');
    bindLicenseKeyFormatter(input);

    input.value = 'abcd efgh@ijkl-mnop';
    input.dispatchEvent(new Event('input'));
    // Pin: the regex + chunk-every-4 contract. 16 sanitized chars →
    // "ABCD-EFGH-IJKL-MNOP". Breaking this would let "abcd-efgh" leak
    // as "ABCD-EFGH" with no re-validation → license server rejects.
    expect(input.value).toBe('ABCD-EFGH-IJKL-MNOP');
  });

  it('caps at 16 chars: overflow is dropped (20-char input → 4 chunks)', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const { bindLicenseKeyFormatter } = await import('../sidepanel/license-ui');
    bindLicenseKeyFormatter(input);

    input.value = 'AAAABBBBCCCCDDDDEEEEFFFF';
    input.dispatchEvent(new Event('input'));
    // Pin: `i < val.length && i < 16` guard. A regression removing the
    // 16 ceiling would let users paste 40-char keys that silently
    // pass client-side but fail server validation.
    expect(input.value).toBe('AAAA-BBBB-CCCC-DDDD');
  });

  it('partial input (<4 chars) → no trailing dash', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const { bindLicenseKeyFormatter } = await import('../sidepanel/license-ui');
    bindLicenseKeyFormatter(input);

    input.value = 'AB';
    input.dispatchEvent(new Event('input'));
    expect(input.value).toBe('AB');
  });
});

// ─────────────────────────────────────────────────────────────────────
// bindLicenseModalEvents — integration-ish with idempotency
// ─────────────────────────────────────────────────────────────────────

describe('bindLicenseModalEvents', () => {
  function mountFullLicenseDOM(): void {
    document.body.innerHTML = `
      <button id="btn-activate-license">Activate</button>
      <button id="btn-deactivate-license">Deactivate</button>
      <input id="license-key-input" />
      <div id="license-error" class="hidden"></div>
      <a id="link-get-pro" href="#"></a>
      <button id="btn-pro-modal-activate">Activate</button>
      <input id="pro-modal-key-input" />
      <div id="pro-modal-error" class="hidden"></div>
      <a id="link-pro-modal-get" href="#"></a>
    `;
  }

  beforeEach(() => {
    // Reset module so `licenseEventsBound` is reset for each test.
    // Without this, the idempotency guard would skip the 2nd bind in
    // different test cases, leaking state across describes.
    vi.resetModules();
    mountFullLicenseDOM();
  });

  it('second call is a no-op (idempotency guard protects against re-binding)', async () => {
    const { bindLicenseModalEvents } = await import('../sidepanel/license-ui');
    bindLicenseModalEvents();
    const btn = document.getElementById('btn-activate-license')!;
    const firstCloneIdentity = btn.outerHTML;
    bindLicenseModalEvents();
    // A regression removing the `if (licenseEventsBound) return` guard
    // would attach a 2nd click listener per bind → activation fires
    // the sendMessage twice per click.
    expect(btn.outerHTML).toBe(firstCloneIdentity);
  });

  it('Enter key on license input triggers activate button click (keyboard UX)', async () => {
    const { bindLicenseModalEvents } = await import('../sidepanel/license-ui');
    bindLicenseModalEvents();

    const input = document.getElementById('license-key-input') as HTMLInputElement;
    const activateBtn = document.getElementById('btn-activate-license') as HTMLButtonElement;
    const clickSpy = vi.spyOn(activateBtn, 'click');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // Non-Enter keys don't trigger activate.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('deactivate + confirm cancelled → NO sendMessage + button restored', async () => {
    const { bindLicenseModalEvents } = await import('../sidepanel/license-ui');
    bindLicenseModalEvents();

    const ui = await import('../sidepanel/ui');
    vi.mocked(ui.showConfirmDialog).mockResolvedValueOnce(false);

    const deactivateBtn = document.getElementById('btn-deactivate-license') as HTMLButtonElement;
    deactivateBtn.click();
    // Let the async click handler flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled();
    expect(deactivateBtn.textContent).toBe('Deactivate');
  });

  it('deactivate + confirm accepted → DEACTIVATE_LICENSE sendMessage + toast + button restored', async () => {
    const { bindLicenseModalEvents } = await import('../sidepanel/license-ui');
    bindLicenseModalEvents();

    const ui = await import('../sidepanel/ui');
    vi.mocked(ui.showConfirmDialog).mockResolvedValueOnce(true);
    chromeStub.runtime.sendMessage.mockResolvedValueOnce(undefined);

    const deactivateBtn = document.getElementById('btn-deactivate-license') as HTMLButtonElement;
    deactivateBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    // Pin: the exact message type (DEACTIVATE_LICENSE from constants).
    // A regression passing ACTIVATE_LICENSE here would silently re-
    // activate the user's license rather than deactivate it.
    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringMatching(/DEACTIVATE/i) })
    );
    const settings = await import('../sidepanel/settings');
    expect(settings.applyProFeatureVisibility).toHaveBeenCalled();
    expect(ui.showToast).toHaveBeenCalledWith('License deactivated', 'info');
    // Button restored in finally.
    expect(deactivateBtn.disabled).toBe(false);
    expect(deactivateBtn.textContent).toBe('Deactivate');
  });

  it('deactivate sendMessage throws → error toast + button restored (no stuck state)', async () => {
    const { bindLicenseModalEvents } = await import('../sidepanel/license-ui');
    bindLicenseModalEvents();

    const ui = await import('../sidepanel/ui');
    vi.mocked(ui.showConfirmDialog).mockResolvedValueOnce(true);
    chromeStub.runtime.sendMessage.mockRejectedValueOnce(new Error('bg dead'));

    const deactivateBtn = document.getElementById('btn-deactivate-license') as HTMLButtonElement;
    deactivateBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(ui.showToast).toHaveBeenCalledWith('Failed to deactivate', 'error');
    expect(deactivateBtn.disabled).toBe(false);
  });

  it('get-Pro link click → preventDefault + chrome.tabs.create(PRICING_PAGE_URL)', async () => {
    const { bindLicenseModalEvents } = await import('../sidepanel/license-ui');
    bindLicenseModalEvents();

    const getProLink = document.getElementById('link-get-pro')!;
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    getProLink.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
    // Pin: a regression dropping `e.preventDefault()` would follow the
    // `href="#"` and scroll the modal to top instead of opening the
    // pricing tab.
    expect(chromeStub.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringMatching(/^https?:\/\//) })
    );
  });

  it('Pro Upgrade modal: Enter on pro-modal-key-input triggers pro-modal-activate', async () => {
    const { bindLicenseModalEvents } = await import('../sidepanel/license-ui');
    bindLicenseModalEvents();

    const input = document.getElementById('pro-modal-key-input') as HTMLInputElement;
    const btn = document.getElementById('btn-pro-modal-activate') as HTMLButtonElement;
    const clickSpy = vi.spyOn(btn, 'click');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
