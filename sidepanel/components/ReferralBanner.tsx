/**
 * ReferralBanner — A compact, dismissible banner at the top of the sidepanel
 * that encourages non-Pro users to share their referral link.
 *
 * - Only visible to free users (non-Pro).
 * - Once dismissed, stays hidden for 30 days (stored in localStorage).
 * - Clicking "Copy Link" copies the referral URL directly to clipboard.
 */
import { useState, useCallback } from 'preact/hooks';
import { t } from '../../shared/i18n';
import { showToast } from '../ui';
import { useStoreSelector } from './storeHook';

const DISMISS_KEY = 'referral_banner_dismissed_at';
const DISMISS_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const dismissedAt = parseInt(raw, 10);
    return Date.now() - dismissedAt < DISMISS_DURATION_MS;
  } catch {
    return false;
  }
}

export function ReferralBanner() {
  const isPro = useStoreSelector((s) => s.isProUser);
  // Subscribe to locale changes so text re-renders after i18n loads
  useStoreSelector((s) => s.localeTick);
  const [dismissed, setDismissed] = useState(isDismissed);
  const [copied, setCopied] = useState(false);

  const handleDismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // non-fatal
    }
    setDismissed(true);
  }, []);

  const handleCopy = useCallback(async () => {
    const { copyReferralLink } = await import('../../shared/referral');
    await copyReferralLink();
    setCopied(true);
    showToast(t('referral_link_copied'), 'success');
    setTimeout(() => setCopied(false), 2500);
  }, []);

  if (isPro || dismissed) return null;

  return (
    <div class="referral-banner">
      <span class="referral-banner-icon" aria-hidden="true">
        🎁
      </span>
      <span class="referral-banner-text">{t('referral_banner_text')}</span>
      <button type="button" class="referral-banner-btn" onClick={handleCopy}>
        {copied ? '✓' : t('referral_banner_copy')}
      </button>
      <button
        type="button"
        class="referral-banner-close"
        onClick={handleDismiss}
        aria-label="Close"
      >
        ×
      </button>
    </div>
  );
}
