/**
 * Referral / Share-to-Earn module.
 *
 * Users can share a referral link. When a new user installs via that link,
 * both the referrer and the new user get a 3-day Pro trial extension.
 *
 * Flow:
 *   1. User clicks "Share & Get 3 Days Pro" — copies invite link.
 *   2. Invite link: `${INVITE_PAGE_URL}?ref={instanceId}` → official landing page.
 *   3. Landing page registers a pending referral (fingerprint + referrerInstanceId).
 *   4. New user installs from Chrome Web Store via the landing page CTA.
 *   5. On first open, the extension calls matchReferral() which sends
 *      a fingerprint to /api/referral/match to complete the referral.
 */

import { INVITE_PAGE_URL, PRICING_PAGE_URL } from './constants';
import { getOrCreateInstanceId } from './license';
import { track } from './telemetry';
import { EVENTS } from './telemetry-events';

const STORAGE_KEY_REFERRAL_COUNT = '_referral_claimed_count';
const REFERRAL_BONUS_DAYS = 3;
const API_BASE = PRICING_PAGE_URL.replace(/\/pricing$/, '');
/** Versioned API prefix (P2-1) — mirrors shared/constants.ts. */
const API_V1_BASE = `${API_BASE}/api/v1`;

export interface ReferralStatus {
  /** Number of successful referrals this user has made. */
  claimedCount: number;
  /** Total bonus days earned from referrals. */
  bonusDaysEarned: number;
  /** The user's shareable referral link. */
  referralLink: string;
}

/**
 * Get the user's referral link and stats.
 */
export async function getReferralStatus(): Promise<ReferralStatus> {
  const instanceId = await getOrCreateInstanceId();
  const referralLink = `${INVITE_PAGE_URL}?ref=${encodeURIComponent(instanceId)}`;

  let claimedCount = 0;
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_REFERRAL_COUNT);
    claimedCount = (result[STORAGE_KEY_REFERRAL_COUNT] as number) || 0;
  } catch {
    // storage unavailable
  }

  return {
    claimedCount,
    bonusDaysEarned: claimedCount * REFERRAL_BONUS_DAYS,
    referralLink,
  };
}

/**
 * Copy the referral link to clipboard and fire telemetry.
 * Returns the link text for UI feedback.
 */
export async function copyReferralLink(): Promise<string> {
  const { referralLink } = await getReferralStatus();

  try {
    await navigator.clipboard.writeText(referralLink);
  } catch {
    // Fallback: create a temporary textarea
    const textarea = document.createElement('textarea');
    textarea.value = referralLink;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  void track(EVENTS.REFERRAL_LINK_COPIED);
  return referralLink;
}

/**
 * Use the Web Share API if available, falling back to clipboard copy.
 * Returns true if share was initiated successfully.
 */
export async function shareReferralLink(): Promise<boolean> {
  const { referralLink } = await getReferralStatus();

  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Image Harvest Pro',
        text: 'Try Image Harvest — the best browser extension for extracting images from any webpage!',
        url: referralLink,
      });
      void track(EVENTS.REFERRAL_LINK_SHARED, { method: 'web_share' });
      return true;
    } catch {
      // User cancelled or share failed — fall through to clipboard
    }
  }

  await copyReferralLink();
  return true;
}

/**
 * Called during first-open flow if the install URL contains a `?ref=` param.
 * Claims the referral bonus for both parties via the backend.
 */
export async function claimReferralBonus(
  referrerInstanceId: string
): Promise<{ success: boolean; bonusDays?: number }> {
  const myInstanceId = await getOrCreateInstanceId();
  if (myInstanceId === referrerInstanceId) {
    return { success: false }; // Can't refer yourself
  }

  try {
    const resp = await fetch(`${API_V1_BASE}/referral/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referrerInstanceId,
        newUserInstanceId: myInstanceId,
      }),
    });

    if (!resp.ok) {
      return { success: false };
    }

    const data = (await resp.json()) as { success: boolean; bonusDays?: number };
    if (data.success) {
      void track(EVENTS.REFERRAL_CLAIMED, { bonusDays: data.bonusDays || REFERRAL_BONUS_DAYS });
    }
    return data;
  } catch {
    return { success: false };
  }
}

/**
 * Increment local referral count (called by background when the backend
 * notifies us that someone used our referral link).
 */
export async function incrementReferralCount(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_REFERRAL_COUNT);
    const current = (result[STORAGE_KEY_REFERRAL_COUNT] as number) || 0;
    await chrome.storage.local.set({ [STORAGE_KEY_REFERRAL_COUNT]: current + 1 });
  } catch {
    // non-fatal
  }
}

/**
 * Generate a lightweight browser fingerprint for referral matching.
 * Must produce the same hash as the invite landing page's fingerprint
 * so the backend can match the two.
 */
export async function generateFingerprint(): Promise<string> {
  const parts = [
    navigator.userAgent,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency?.toString() ?? '',
    navigator.platform ?? '',
  ];
  const raw = parts.join('|');
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Called on first install to match a pending referral via fingerprint.
 * Returns the bonus days granted, or null if no match was found.
 */
export async function matchReferral(): Promise<{ bonusDays: number } | null> {
  try {
    const [instanceId, fingerprint] = await Promise.all([
      getOrCreateInstanceId(),
      generateFingerprint(),
    ]);

    const resp = await fetch(`${API_V1_BASE}/referral/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newUserInstanceId: instanceId,
        fingerprint,
      }),
    });

    if (!resp.ok) return null;

    const result = (await resp.json()) as {
      success: boolean;
      bonusDays?: number;
      error?: string;
    };

    if (result.success && result.bonusDays) {
      void track(EVENTS.REFERRAL_CLAIMED, { bonusDays: result.bonusDays });
      return { bonusDays: result.bonusDays };
    }

    return null;
  } catch {
    return null;
  }
}
