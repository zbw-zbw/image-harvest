// First-run privacy opt-in modal.
//
// Shown EXACTLY ONCE per install on the first sidepanel/popup open. The
// "decided" flag is persisted in chrome.storage.local under
// `_telemetry_opt_in_decided` so reopening the panel never re-prompts.
//
// Design notes:
//   - We default-stage opt-in (the primary CTA enables telemetry) because
//     funnel data is the most leveraged input we have. But the dismissal
//     path is explicit ("No thanks") and equally weighted visually — this
//     is NOT a dark pattern.
//   - The modal MUST be dismissable without a choice (overlay click /
//     Escape would close without persisting). To keep the flow clean we
//     do NOT bind those — the user must click one of the two buttons.
//   - Visibility is driven by state.privacyOptInModalState.open so
//     init.ts can flip it on after detecting first-run.
import { useStoreSelector } from './storeHook';
import { state } from '../state';
import { setOptIn } from '../../shared/telemetry';
import { t } from '../../shared/i18n';

const DECIDED_KEY = '_telemetry_opt_in_decided';

async function persistDecision(enabled: boolean): Promise<void> {
  // Two writes: SDK toggle + a sentinel so we never re-prompt.
  // If either fails we still close the modal — refusing to dismiss
  // would trap the user.
  try {
    await setOptIn(enabled);
  } catch {
    /* fall through */
  }
  try {
    await chrome.storage.local.set({ [DECIDED_KEY]: { at: Date.now(), enabled } });
  } catch {
    /* fall through */
  }
  state.privacyOptInModalState = { open: false };
}

function handleAccept(): void {
  void persistDecision(true);
}

function handleDecline(): void {
  void persistDecision(false);
}

export function PrivacyOptInModal() {
  const ms = useStoreSelector((s) => s.privacyOptInModalState);
  if (!ms.open) return null;
  return (
    <div id="privacy-opt-in-modal" class="modal">
      <div class="modal-overlay" />
      <div class="modal-content privacy-opt-in-content">
        <div class="modal-header">
          <h2>
            <svg
              class="modal-title-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {t('privacy_modal_title')}
          </h2>
        </div>
        <div class="modal-body">
          <p class="privacy-opt-in-desc">
            {t('privacy_desc_prefix')}<strong>{t('privacy_anonymous_data')}</strong>{t('privacy_desc_suffix')}
          </p>
          <ul class="privacy-opt-in-list">
            <li>
              <strong>{t('privacy_collect_title')}</strong> {t('privacy_collect_desc')}
            </li>
            <li>
              <strong>{t('privacy_never_collect_title')}</strong> {t('privacy_never_collect_desc')}
            </li>
            <li>
              <strong>{t('privacy_reversible_title')}</strong> {t('privacy_reversible_desc')}
            </li>
          </ul>
          <p class="privacy-opt-in-footnote">
            {t('privacy_footnote')}
          </p>
        </div>
        <div class="modal-footer privacy-opt-in-footer">
          <button
            id="btn-privacy-opt-in-decline"
            class="btn btn-secondary"
            onClick={handleDecline}
          >
            {t('privacy_decline')}
          </button>
          <button
            id="btn-privacy-opt-in-accept"
            class="btn btn-primary"
            onClick={handleAccept}
          >
            {t('privacy_accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
