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
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="20 12 20 22 4 22 4 12" />
          <rect x="2" y="7" width="20" height="5" />
          <line x1="12" y1="22" x2="12" y2="7" />
          <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
          <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
        </svg>
      </span>
      <span class="referral-banner-text">{t('referral_banner_text')}</span>
      <button type="button" class="referral-banner-btn" onClick={handleCopy}>
        {copied ? (
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-label={t('referral_link_copied')}
            role="img"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          t('referral_banner_copy')
        )}
      </button>
      <button
        type="button"
        class="referral-banner-close"
        onClick={handleDismiss}
        aria-label="Close"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  );
}
