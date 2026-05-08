// State screens — empty / loading / error / restricted.
//
// Each screen used to be its own static `<div>` in the HTML, hidden/shown by
// `classList.toggle('hidden')` from sidepanel/ui.ts. Migrating them into one
// Preact component lets us drive the entire main-area state with a single
// `state.uiScreen` discriminator: setting it to 'error' shows the error
// screen and hides the others, no manual coordination required.
//
// The "loading" screen is intentionally NOT included here because the
// existing UX renders skeleton cards directly into the image grid (see
// ui.ts > showLoading) instead of swapping to a separate placeholder. The
// scan overlay is a separate component (ScanProgressOverlay).
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../../shared/i18n';
import { useStoreSelector } from './storeHook';

/**
 * Renders whichever of the three "screens" matches `state.uiScreen`.
 * The image grid itself is left alone — it's a heavy DOM that we don't
 * want to tear down on every screen flip.
 *
 * The mount container created by mountStateScreens() has `flex: 1 1 auto`
 * so empty/error/restricted screens fill the remaining vertical space.
 * When `uiScreen === 'images'` none of the screens are visible, but the
 * mount container's flex still claims space from `#app`'s flex layout,
 * leaving `.image-grid-wrapper` with only ~50% of the available height.
 * We fix this by toggling the mount container's display to 'none' when
 * no screen is active.
 */
export function StateScreens() {
  const screen = useStoreSelector((s) => s.uiScreen);
  const rootRef = useRef<HTMLDivElement>(null);

  // Toggle the mount container's display so it doesn't claim flex space
  // when all screens are hidden (uiScreen === 'images').
  useEffect(() => {
    const mountContainer = rootRef.current?.parentElement;
    if (!mountContainer) return;
    if (screen === 'images') {
      mountContainer.style.display = 'none';
    } else {
      mountContainer.style.display = 'flex';
    }
  }, [screen]);

  return (
    <div ref={rootRef}>
      <EmptyScreen visible={screen === 'empty'} />
      <ErrorScreen visible={screen === 'error'} />
      <RestrictedScreen visible={screen === 'restricted'} />
    </div>
  );
}

interface ScreenProps {
  visible: boolean;
}

function EmptyScreen({ visible }: ScreenProps) {
  const info = useStoreSelector((s) => s.emptyInfo);
  // Two textual variants distinguish "filtered to nothing" from "page has
  // zero images". The button label shifts accordingly so users can tell
  // whether clicking will reset filters or rescan from scratch.
  const desc = info.isNoResults ? t('empty_no_results_desc') : t('empty_no_images_desc');
  const buttonLabel = info.isNoResults ? t('empty_reset_filters') : t('empty_rescan_images');
  return (
    <div id="empty-state" class={`empty-state${visible ? '' : ' hidden'}`}>
      <div class="empty-state-visual">
        <svg class="empty-state-svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
          <rect
            x="8"
            y="12"
            width="48"
            height="36"
            rx="6"
            fill="var(--bg-tertiary)"
            stroke="var(--border-color)"
            stroke-width="1.2"
          />
          <circle cx="24" cy="26" r="5" fill="var(--primary-color)" opacity="0.25" />
          <path
            d="M8 40 L22 30 L32 37 L44 24 L56 34 L56 44 C56 46.2 54.2 48 52 48 L12 48 C9.8 48 8 46.2 8 44 Z"
            fill="var(--primary-color)"
            opacity="0.15"
          />
          <path
            d="M22 40 L32 33 L44 24 L56 34 L56 44 C56 46.2 54.2 48 52 48 L12 48 C9.8 48 8 46.2 8 44 L8 42 Z"
            fill="var(--primary-color)"
            opacity="0.3"
          />
        </svg>
      </div>
      <h3 class="empty-state-title">{t('empty_title')}</h3>
      <p class="empty-state-desc">{desc}</p>
      <button id="btn-reset-filters" class="rescan-btn rescan-btn-lg">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <path d="M23 4v6h-6" />
          <path d="M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
        </svg>
        <span>{buttonLabel}</span>
      </button>
    </div>
  );
}

function ErrorScreen({ visible }: ScreenProps) {
  const info = useStoreSelector((s) => s.errorInfo);
  // When no error has been pushed yet (initial load or after a recovery)
  // we still render the shell — the visibility flag dictates whether it's
  // shown — but with the original placeholder copy.
  const code = info?.code || t('error_default_code');
  const message = info?.message || t('error_default_message');
  const workaround = info?.workaround || '';
  return (
    <div id="error-state" class={`error-state${visible ? '' : ' hidden'}`}>
      <div class="error-icon">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <h3 id="error-title" class="error-title">
        {code}
      </h3>
      <p id="error-message" class="error-message">
        {message}
      </p>
      <div id="error-workaround" class="error-workaround" style={workaround ? '' : 'display:none'}>
        {workaround}
      </div>
    </div>
  );
}

function RestrictedScreen({ visible }: ScreenProps) {
  // The restricted screen is a pure marketing card — no per-instance data —
  // so it just toggles visibility. The original markup lived in
  // _shared-body.html; we mirror it here. Auxiliary copy & buttons (Open
  // Settings, etc.) are kept in the static markup outside this component so
  // the scope of the migration stays small.
  return (
    <div id="restricted-state" class={`restricted-state${visible ? '' : ' hidden'}`}>
      <div class="restricted-hero">
        <div class="restricted-hero-bg" />
        <div class="restricted-hero-content">
          <div class="restricted-logo-ring">
            <span class="restricted-logo">
              <img src="../icons/icon128.png" alt="Image Harvest" />
            </span>
          </div>
          <h2 class="restricted-title">
            Image Harvest <span class="restricted-version">v1.0.0</span>
          </h2>
          <p class="restricted-subtitle">{t('restricted_subtitle')}</p>
        </div>
      </div>
    </div>
  );
}
