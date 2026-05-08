// Settings modal — shell-only Preact migration.
//
// The settings body is ~440 lines of static HTML containing 20+ toggles,
// selects, number inputs, license sections, etc. Migrating them all to
// Preact in one go would require reworking the 47 imperative
// `getElementById('setting-xxx')` call sites in settings.ts. To keep this
// step low-risk we only Preactify the SHELL (overlay + header + close
// button + visibility) and physically move the original `.modal-body` and
// `.modal-footer` DOM subtrees into our render output via data-slot divs.
//
// The legacy subtrees are planted SYNCHRONOUSLY by mountSettingsModal() in
// mount.tsx immediately after render(), so cacheElements() and bindEvents()
// in init.ts always find the correct DOM nodes. No useEffect is needed.
//
// After mount the DOM looks identical to the legacy markup, so:
//   - All getElementById('setting-xxx') calls keep working.
//   - All addEventListener bindings done in init.ts keep working.
//   - openSettings/closeSettings now just flip state.settingsModalState.open.
import { useStoreSelector } from './storeHook';
import { state } from '../state';
import { t } from '../../shared/i18n';

function close(): void {
  state.settingsModalState = { open: false };
}

export function SettingsModal() {
  const open = useStoreSelector((s) => s.settingsModalState.open);

  return (
    <div id="settings-modal" class={`modal${open ? '' : ' hidden'}`}>
      <div class="modal-overlay" onClick={close} />
      <div class="modal-content settings-content">
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
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {t('settings_title')}
          </h2>
          <button id="btn-settings-close" class="icon-btn" onClick={close}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Slot for the legacy body. mountSettingsModal() in mount.tsx
            synchronously appends the detached .modal-body subtree here
            after render(). Preact never touches slot children because we
            don't render any JSX children. flex:1 + overflow:hidden so the
            inner .modal-body's overflow-y:auto works correctly. */}
        <div
          data-slot="settings-body"
          style={{
            flex: '1 1 auto',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        />
        {/* Slot for the legacy footer (Reset / Save buttons). Planted
            synchronously by mountSettingsModal() alongside the body. */}
        <div data-slot="settings-footer" />
      </div>
    </div>
  );
}
