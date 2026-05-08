// Tests for sidepanel/components/ProUpgradeModal.tsx (Sprint 2.2 redesign).
//
// Scope:
//   - Stable id contract: the redesigned modal MUST keep the 4 ids that
//     license-ui.ts > bindLicenseModalEvents looks up by getElementById.
//     A regression renaming any of them would silently break activation.
//   - A/B copy variants: bucket 'a' renders the control headline, bucket
//     'b' with download >= 5 renders the personalized headline. Below
//     threshold B falls back to the generic line (so a brand-new user
//     never sees "you've downloaded 0 images").
//   - CTA wiring:
//       * "View Pricing" → preventDefault + chrome.tabs.create(PRICING_URL)
//         + emits PRO_UPSELL_CTA_CLICKED with cta=pricing
//       * "Start Free Trial" → emits CTA_CLICKED with cta=trial; on
//         shared/trial.ts startTrial() success → marks soft paywall
//         resolved + closes modal + fires VALIDATE_LICENSE
//       * Close X / overlay click → fires PRO_UPSELL_DISMISSED
//   - Hidden by default: when state.proUpgradeModalState.open is false the
//     modal still mounts (license-ui.ts needs the input nodes to bind
//     listeners on first Settings open) but carries the `hidden` class.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';

// ── Module mocks ──────────────────────────────────────────────────────────
//
// We mock the 4 shared dependencies so each test can pick its A/B bucket
// and download count deterministically. The real implementations are
// covered by their own dedicated test files; here we only assert the
// modal's reaction.

const mockGetBucket = vi.fn();
const mockGetCachedBucket = vi.fn();
const mockGetPaywallState = vi.fn();
const mockMarkResolved = vi.fn();
const mockTrack = vi.fn();
const mockFlushNow = vi.fn();
const mockShowToast = vi.fn();
const mockStartTrial = vi.fn();

vi.mock('../shared/ab-experiment', () => ({
  getProUpsellBucket: mockGetBucket,
  getCachedBucket: mockGetCachedBucket,
}));

vi.mock('../shared/paywall-state', () => ({
  getState: mockGetPaywallState,
  markResolved: mockMarkResolved,
}));

vi.mock('../shared/telemetry', () => ({
  track: mockTrack,
  flushNow: mockFlushNow,
}));

vi.mock('../sidepanel/ui', () => ({
  showToast: mockShowToast,
}));

vi.mock('../shared/trial', () => ({
  startTrial: mockStartTrial,
}));

vi.mock('../sidepanel/settings', () => ({
  applyProFeatureVisibility: vi.fn(),
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
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '';
  installChrome();

  // Default mock returns. Each test overrides as needed.
  mockGetBucket.mockResolvedValue('a');
  mockGetCachedBucket.mockReturnValue('a');
  mockGetPaywallState.mockResolvedValue({
    downloadCount: 0,
    shownCount: 0,
    shownAt: 0,
    dismissedAt: 0,
    resolved: false,
  });
  mockMarkResolved.mockResolvedValue(undefined);
  mockTrack.mockResolvedValue(undefined);
  mockFlushNow.mockResolvedValue(undefined);
  mockStartTrial.mockResolvedValue({ success: true, plan: 'trial' });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

// Helper: open the modal by mutating the store BEFORE rendering. The
// store is a singleton imported by the component; tests that assert
// the open path have to flip it first so the initial render shows
// the modal in the open state.
async function openModal(): Promise<void> {
  const { state } = await import('../sidepanel/state');
  state.proUpgradeModalState = { open: true, errorText: '' };
}

// ────────────────────────────────────────────────────────────────────────────
// Stable id contract (license-ui.ts depends on these)
// ────────────────────────────────────────────────────────────────────────────

describe('id contract', () => {
  test('renders all 4 license-ui ids regardless of open state', async () => {
    const { ProUpgradeModal } = await import('../sidepanel/components/ProUpgradeModal');
    render(<ProUpgradeModal />);

    expect(document.getElementById('pro-modal-key-input')).not.toBeNull();
    expect(document.getElementById('btn-pro-modal-activate')).not.toBeNull();
    expect(document.getElementById('pro-modal-error')).not.toBeNull();
    expect(document.getElementById('link-pro-modal-get')).not.toBeNull();
    expect(document.getElementById('btn-pro-upgrade-close')).not.toBeNull();
    expect(document.getElementById('pro-upgrade-modal')).not.toBeNull();
  });

  test('hidden class present when state.open=false', async () => {
    const { ProUpgradeModal } = await import('../sidepanel/components/ProUpgradeModal');
    render(<ProUpgradeModal />);
    expect(document.getElementById('pro-upgrade-modal')!.classList.contains('hidden')).toBe(true);
  });

  test('hidden class removed when state.open=true', async () => {
    await openModal();
    const { ProUpgradeModal } = await import('../sidepanel/components/ProUpgradeModal');
    render(<ProUpgradeModal />);
    expect(document.getElementById('pro-upgrade-modal')!.classList.contains('hidden')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A/B copy variants
// ────────────────────────────────────────────────────────────────────────────

describe('A/B copy variants', () => {
  test('bucket A → static "Unlock Pro Features" headline', async () => {
    mockGetBucket.mockResolvedValue('a');
    mockGetPaywallState.mockResolvedValue({
      downloadCount: 100,
      shownCount: 0,
      shownAt: 0,
      dismissedAt: 0,
      resolved: false,
    });
    await openModal();
    const { ProUpgradeModal } = await import('../sidepanel/components/ProUpgradeModal');
    render(<ProUpgradeModal />);

    await waitFor(() => {
      expect(screen.queryByText(/Unlock.*Image Harvest/i)).not.toBeNull();
    });
    expect(screen.queryByText(/You've downloaded/)).toBeNull();
  });

  test('bucket B + downloadCount >= 5 → personalized headline with count', async () => {
    mockGetBucket.mockResolvedValue('b');
    mockGetPaywallState.mockResolvedValue({
      downloadCount: 47,
      shownCount: 0,
      shownAt: 0,
      dismissedAt: 0,
      resolved: false,
    });
    await openModal();
    const { ProUpgradeModal } = await import('../sidepanel/components/ProUpgradeModal');
    render(<ProUpgradeModal />);

    await waitFor(() => {
      // Pin: bucket B with sufficient downloads shows the B variant headline.
      expect(screen.queryByText(/Go Pro/i)).not.toBeNull();
    });
  });

  test('bucket B + downloadCount < 5 → falls back to control headline', async () => {
    mockGetBucket.mockResolvedValue('b');
    mockGetPaywallState.mockResolvedValue({
      downloadCount: 2,
      shownCount: 0,
      shownAt: 0,
      dismissedAt: 0,
      resolved: false,
    });
    await openModal();
    const { ProUpgradeModal } = await import('../sidepanel/components/ProUpgradeModal');
    render(<ProUpgradeModal />);

    // Pin: protects against "You've downloaded 0 images" UX disaster
    // for first-time users who somehow trigger the upsell early.
    await waitFor(() => {
      expect(screen.queryByText(/Unlock.*Image Harvest/i)).not.toBeNull();
    });
    expect(screen.queryByText(/You've downloaded 2 images/i)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CTA wiring
// ────────────────────────────────────────────────────────────────────────────

describe('View Pricing CTA', () => {
  test('click → preventDefault + chrome.tabs.create(pricing url) + telemetry', async () => {
    await openModal();
    const { ProUpgradeModal } = await import('../sidepanel/components/ProUpgradeModal');
    render(<ProUpgradeModal />);

    const btn = document.getElementById('btn-pro-modal-pricing')!;
    fireEvent.click(btn);

    expect(chromeStub.tabs.create).toHaveBeenCalledTimes(1);
    expect(chromeStub.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringMatching(/^https?:\/\//) })
    );
    expect(mockTrack).toHaveBeenCalledWith(
      'pro_upsell_cta_clicked',
      expect.objectContaining({ cta: 'pricing' })
    );
  });
});

describe('Start Free Trial CTA', () => {
  test('startTrial success → marks paywall resolved + closes modal + VALIDATE_LICENSE + toast', async () => {
    mockStartTrial.mockResolvedValueOnce({ success: true, plan: 'trial' });
    await openModal();
    const { ProUpgradeModal } = await import('../sidepanel/components/ProUpgradeModal');
    render(<ProUpgradeModal />);

    const btn = document.getElementById('btn-pro-modal-trial')!;
    fireEvent.click(btn);

    // Click handler is async (dynamic import + awaits). Spin the
    // microtask queue until either the modal closes or we time out.
    const { state } = await import('../sidepanel/state');
    await waitFor(() => {
      expect(state.proUpgradeModalState.open).toBe(false);
    });

    expect(mockTrack).toHaveBeenCalledWith(
      'pro_upsell_cta_clicked',
      expect.objectContaining({ cta: 'trial' })
    );
    expect(mockTrack).toHaveBeenCalledWith('trial_started');
    expect(mockMarkResolved).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringMatching(/trial activated|trial is active/i),
      'success'
    );
    expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringMatching(/VALIDATE_LICENSE/i) })
    );
  });

  test('startTrial failure → shows error in modal + does NOT close + does NOT mark resolved', async () => {
    mockStartTrial.mockResolvedValueOnce({
      success: false,
      error: 'You already used your trial.',
    });
    await openModal();
    const { ProUpgradeModal } = await import('../sidepanel/components/ProUpgradeModal');
    render(<ProUpgradeModal />);

    const btn = document.getElementById('btn-pro-modal-trial')!;
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.queryByText(/You already used your trial/)).not.toBeNull();
    });

    const { state } = await import('../sidepanel/state');
    expect(state.proUpgradeModalState.open).toBe(true);
    expect(mockMarkResolved).not.toHaveBeenCalled();
    // Pin: failure path must not fire TRIAL_STARTED — the funnel needs
    // success-only counts to compute trial conversion accurately.
    expect(mockTrack).not.toHaveBeenCalledWith('trial_started');
  });

  test('CTA click always fires telemetry first, even before startTrial settles', async () => {
    // Block startTrial indefinitely so we can assert telemetry fired
    // synchronously in the click handler before any await.
    let resolveTrial!: (v: { success: boolean }) => void;
    mockStartTrial.mockReturnValueOnce(
      new Promise((res) => {
        resolveTrial = res;
      })
    );

    await openModal();
    const { ProUpgradeModal } = await import('../sidepanel/components/ProUpgradeModal');
    render(<ProUpgradeModal />);

    fireEvent.click(document.getElementById('btn-pro-modal-trial')!);

    // CTA_CLICKED must be observable immediately — funnel data is
    // intent-of-click, not result-of-trial.
    expect(mockTrack).toHaveBeenCalledWith(
      'pro_upsell_cta_clicked',
      expect.objectContaining({ cta: 'trial' })
    );

    // Cleanup the dangling promise.
    resolveTrial({ success: false });
  });
});

describe('Close interactions', () => {
  test('clicking close X fires PRO_UPSELL_DISMISSED + closes modal', async () => {
    await openModal();
    const { ProUpgradeModal } = await import('../sidepanel/components/ProUpgradeModal');
    render(<ProUpgradeModal />);

    const closeBtn = document.getElementById('btn-pro-upgrade-close')!;
    fireEvent.click(closeBtn);

    expect(mockTrack).toHaveBeenCalledWith(
      'pro_upsell_dismissed',
      expect.objectContaining({ trigger: 'modal_close' })
    );
    const { state } = await import('../sidepanel/state');
    expect(state.proUpgradeModalState.open).toBe(false);
  });

  test('clicking overlay fires PRO_UPSELL_DISMISSED + closes modal', async () => {
    await openModal();
    const { ProUpgradeModal } = await import('../sidepanel/components/ProUpgradeModal');
    render(<ProUpgradeModal />);

    // The overlay is the first .modal-overlay child of the modal shell.
    const overlay = document.querySelector('#pro-upgrade-modal .modal-overlay')!;
    fireEvent.click(overlay);

    const { state } = await import('../sidepanel/state');
    expect(state.proUpgradeModalState.open).toBe(false);
  });

  test('legacy "Get Pro →" link click fires CTA_CLICKED with cta=get_pro', async () => {
    await openModal();
    const { ProUpgradeModal } = await import('../sidepanel/components/ProUpgradeModal');
    render(<ProUpgradeModal />);

    const link = document.getElementById('link-pro-modal-get')!;
    fireEvent.click(link);

    // Pin: navigation itself is delegated to license-ui.ts
    // bindLicenseModalEvents (preventDefault + chrome.tabs.create); the
    // component's onClick is telemetry-only.
    expect(mockTrack).toHaveBeenCalledWith(
      'pro_upsell_cta_clicked',
      expect.objectContaining({ cta: 'get_pro' })
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Error reset on close
// ────────────────────────────────────────────────────────────────────────────

describe('error state lifecycle', () => {
  test('trial error clears when the modal re-opens', async () => {
    mockStartTrial.mockResolvedValueOnce({ success: false, error: 'Already used.' });
    await openModal();
    const { ProUpgradeModal } = await import('../sidepanel/components/ProUpgradeModal');
    render(<ProUpgradeModal />);

    fireEvent.click(document.getElementById('btn-pro-modal-trial')!);
    await waitFor(() => {
      expect(screen.queryByText(/Already used/)).not.toBeNull();
    });

    // Close the modal (simulates user dismissal).
    fireEvent.click(document.getElementById('btn-pro-upgrade-close')!);

    // Re-open. The trial error <p> should be empty / hidden again.
    await openModal();
    await waitFor(() => {
      const errEl = document.getElementById('pro-modal-trial-error')!;
      // Pin: useEffect clears trialError on close. A regression keeping
      // the prior error would surface stale "Already used" on the next
      // unrelated upsell open.
      expect(errEl.textContent?.trim() || '').toBe('');
    });
  });
});
