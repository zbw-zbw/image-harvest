// Settings modal — shell-only Preact migration.
//
// The settings body is ~440 lines of static HTML containing 20+ toggles,
// selects, number inputs, license sections, etc. Migrating them all to
// Preact in one go would require reworking the 47 imperative
// `getElementById('setting-xxx')` call sites in settings.ts. To keep this
// step low-risk we only Preactify the SHELL (overlay + header + close
// button + visibility) and physically move the original `.modal-body` DOM
// subtree into our render output via a ref + useEffect.
//
// After mount the DOM looks identical to the legacy markup, so:
//   - All getElementById('setting-xxx') calls keep working.
//   - All addEventListener bindings done in init.ts keep working.
//   - openSettings/closeSettings now just flip state.settingsModalState.open.
import { useEffect, useRef } from 'preact/hooks';
import { useStoreSelector } from './storeHook';
import { state } from '../state';

function close(): void {
  state.settingsModalState = { open: false };
}

/**
 * Module-level holder for the legacy `.modal-body` node. We snapshot it
 * BEFORE Preact renders the new shell (see mount.tsx > mountSettingsModal)
 * and re-attach it from useEffect once the placeholder slot is in the DOM.
 *
 * Using a module-level variable avoids prop drilling through the component
 * (we can't easily pass DOM nodes through Preact's typed props in a clean
 * way) and matches the "rendered exactly once" lifecycle of this modal.
 */
let savedBody: HTMLElement | null = null;

export function setSavedSettingsBody(node: HTMLElement | null): void {
  savedBody = node;
}

export function SettingsModal() {
  const open = useStoreSelector((s) => s.settingsModalState.open);
  const slotRef = useRef<HTMLDivElement | null>(null);

  // After the first render, plant the legacy body subtree into the slot.
  // Subsequent re-renders (when `open` flips) leave the slot's children
  // alone — Preact never re-mounts the slot div because its key is stable.
  useEffect(() => {
    if (slotRef.current && savedBody && !slotRef.current.contains(savedBody)) {
      slotRef.current.appendChild(savedBody);
    }
  }, []);

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
            Settings
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
        {/* Slot for the legacy body. Plain ref-mounted div — Preact never
            touches its children after the initial appendChild because we
            don't render any JSX children here. Must flex:1 + overflow:hidden
            so the inner .modal-body's overflow-y:auto works correctly. */}
        <div
          ref={slotRef as preact.RefObject<HTMLDivElement>}
          style={{ flex: '1 1 auto', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}
        />
      </div>
    </div>
  );
}
