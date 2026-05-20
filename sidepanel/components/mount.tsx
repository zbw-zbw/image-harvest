// Mount points for incrementally migrated Preact components. Called once
// from sidepanel/init.ts after the static HTML is in place. Each helper
// looks up the legacy DOM node, replaces it with a fresh container, and
// renders the corresponding Preact component into it.
//
// We replace rather than augment because the legacy markup may carry
// imperative class toggles (`hidden`, etc.) that would conflict with
// Preact's reconciliation.
import { render, type ComponentType } from 'preact';
import { LiveIndicator } from './LiveIndicator';
import { DownloadLabel, FoundActionCount, SimilarInline } from './StatusCounts';
import { StateScreens } from './StateScreens';
import { ScanProgressOverlay } from './ScanProgressOverlay';
import { DownloadProgressModal } from './DownloadProgressModal';
import { ProStatusBadge } from './ProStatusBadge';
import { ToastContainer } from './ToastContainer';
import { ConfirmDialog } from './ConfirmDialog';
import { DedupModal } from './DedupModal';
import { CollectionModal } from './CollectionModal';
import { MultitabModal } from './MultitabModal';
import { ProUpgradeModal } from './ProUpgradeModal';
import { PrivacyOptInModal } from './PrivacyOptInModal';
import { SoftPaywallBanner } from './SoftPaywallBanner';
import { TrialGraceBanner } from './TrialGraceBanner';
import { BatchUrlCopyButton } from './BatchUrlCopyButton';
import { RatingPromptModal } from './RatingPromptModal';
import { SettingsModal } from './SettingsModal';
import { ImageGrid } from './ImageGrid';

/**
 * Replace a legacy DOM element with an empty `<tag>` mount point.
 * Returns null if the legacy id can't be found (e.g. element absent in the
 * popup-mode HTML variant) so the caller can no-op gracefully.
 */
function replaceWithMountPoint(legacyId: string, tag: 'span' | 'div' = 'span'): HTMLElement | null {
  const legacy = document.getElementById(legacyId);
  if (!legacy) return null;
  const mount = document.createElement(tag);
  mount.dataset.preactMount = legacyId;
  legacy.replaceWith(mount);
  return mount;
}

/**
 * Render `Component` into the slot previously occupied by `<* id="legacyId">`.
 * `tag` controls whether the mount point is `<span>` (inline, default) or
 * `<div>` (block — needed for state-screen containers and modals).
 */
function mountAt(legacyId: string, Component: ComponentType, tag: 'span' | 'div' = 'span'): void {
  const mount = replaceWithMountPoint(legacyId, tag);
  if (!mount) return;
  render(<Component />, mount);
}

/**
 * Settings modal needs special handling: the legacy `.modal-body` and
 * `.modal-footer` subtrees contain 20+ controls bound by 47 imperative
 * `getElementById` call sites in settings.ts. Recreating the markup in
 * Preact would require rewriting all those bindings.
 *
 * Instead we:
 *   1. Detach `.modal-body` and `.modal-footer` from the legacy DOM.
 *   2. Replace the legacy `#settings-modal` shell with a Preact mount
 *      point and render `<SettingsModal>`.
 *   3. **Synchronously** re-attach the detached subtrees into the
 *      data-slot containers rendered by `<SettingsModal>`, guaranteeing
 *      they are back in the live DOM before `cacheElements()` and
 *      `bindEvents()` run later in `init()`.
 */
function mountSettingsModal(): void {
  const legacy = document.getElementById('settings-modal');
  if (!legacy) return;
  const body = legacy.querySelector<HTMLElement>('.modal-body');
  const footer = legacy.querySelector<HTMLElement>('.modal-footer');
  if (body) body.remove();
  if (footer) footer.remove();
  const mount = document.createElement('div');
  mount.dataset.preactMount = 'settings-modal';
  legacy.replaceWith(mount);
  render(<SettingsModal />, mount);

  // Synchronously plant the legacy body and footer into the Preact-rendered
  // slot containers AFTER render() returns. This guarantees the subtrees
  // (and their ids / event listeners) are back in the live DOM before
  // cacheElements() and bindEvents() run later in init().
  // We use data-slot attributes to locate the containers rendered by
  // <SettingsModal> rather than relying on useEffect (which is async).
  const bodySlot = mount.querySelector<HTMLElement>('[data-slot="settings-body"]');
  const footerSlot = mount.querySelector<HTMLElement>('[data-slot="settings-footer"]');
  if (bodySlot && body) bodySlot.appendChild(body);
  if (footerSlot && footer) footerSlot.appendChild(footer);
}

/**
 * Image grid mount: we render <ImageGrid> INTO the existing `#image-grid`
 * element (rather than replacing it) because ui.ts and render.ts still
 * imperatively manipulate the grid node itself — toggling `.hidden`,
 * `style.visibility`, scrolling it, reading its classList for view-mode,
 * etc. Preserving the host node identity keeps all those call sites valid;
 * Preact owns only the children.
 */
function mountImageGrid(): void {
  const grid = document.getElementById('image-grid');
  if (!grid) return;
  // Clear any pre-existing static children (none in current HTML, but
  // defensive in case of future markup changes).
  grid.innerHTML = '';
  render(<ImageGrid />, grid);
}

/**
 * The state-screens component owns three sibling `<div>`s, so it can't
 * simply replace one of them. Instead we use the first screen's id as the
 * mount point and ensure the others are removed first to avoid duplicates.
 */
function mountStateScreens(): void {
  const empty = document.getElementById('empty-state');
  const error = document.getElementById('error-state');
  const restricted = document.getElementById('restricted-state');
  if (!empty) return;
  // Remove the legacy siblings so the Preact-rendered ones don't collide
  // by id. The component re-creates equivalent markup with the same ids.
  error?.remove();
  restricted?.remove();
  const mount = document.createElement('div');
  mount.dataset.preactMount = 'state-screens';
  // The mount container must participate in the flex layout so that
  // empty/error/restricted screens can fill the remaining vertical space
  // between the toolbar and status bar. Without this, the empty-state
  // cannot center vertically when image-grid-wrapper is hidden.
  mount.style.display = 'flex';
  mount.style.flexDirection = 'column';
  mount.style.flex = '1 1 auto';
  mount.style.minHeight = '0';
  empty.replaceWith(mount);
  render(<StateScreens />, mount);
}

/**
 * Mount every Preact-backed component. Safe to call multiple times: each
 * mount helper short-circuits when its legacy node is missing.
 */
export function mountPreactComponents(): void {
  // Inline counters
  mountAt('live-indicator', LiveIndicator);
  mountAt('found-action-count', FoundActionCount);
  mountAt('similar-inline-mount', SimilarInline);
  mountAt('download-label', DownloadLabel);
  // Block-level overlays / badges
  mountAt('scan-overlay', ScanProgressOverlay, 'div');
  mountAt('progress-modal', DownloadProgressModal, 'div');
  // Pro badge mount needs margin-right:auto so it pushes the right-side
  // buttons (Live, Collection, Multi-Tab, Settings) to the end of the
  // toolbar. The original #pro-status-area had this via .pro-status-area
  // CSS, but mountAt replaces the element with a bare <div>.
  {
    const proMount = replaceWithMountPoint('pro-status-area', 'div');
    if (proMount) {
      proMount.style.marginRight = 'auto';
      render(<ProStatusBadge />, proMount);
    }
  }
  mountAt('toast-container', ToastContainer, 'div');
  mountAt('confirm-dialog', ConfirmDialog, 'div');
  // Independent modals (shells only — body content stays imperative).
  mountAt('dedup-modal', DedupModal, 'div');
  mountAt('collection-modal', CollectionModal, 'div');
  mountAt('multitab-modal', MultitabModal, 'div');
  mountAt('pro-upgrade-modal', ProUpgradeModal, 'div');
  mountSettingsModal();
  mountImageGrid();
  mountStateScreens();
  // Privacy opt-in modal has no legacy slot — it's a brand-new component
  // added in Sprint 1.4. Append a fresh container to <body> and render
  // there. The modal short-circuits to null when state.open is false, so
  // the cost of always-mounting it is one render of a hidden subtree.
  mountFreshComponent('privacy-opt-in-modal-mount', PrivacyOptInModal);

  // Soft paywall banner (Sprint 2.1). Has a legacy slot in
  // pages/_shared-body.html (#soft-paywall-banner-mount) sitting just
  // above the toolbar so the banner renders ABOVE the action row when
  // it pops in, not below it. Falls back to a body append if the slot
  // is missing (popup variant or hot-reload race).
  mountSoftPaywallBanner();
  mountTrialGraceBanner();

  // Batch URL copy button (Sprint 3.4). Renders into the
  // `#batch-url-copy-mount` slot in toolbar row 2. The slot is a
  // permanent layout anchor; the component handles its own
  // enabled/disabled state via store subscriptions.
  mountAt('batch-url-copy-mount', BatchUrlCopyButton);

  // Rating prompt modal (Sprint 3.6). Has no legacy slot — append a
  // fresh container to <body>. The component decides visibility via
  // shouldShowRatingPrompt() at mount time and short-circuits to null
  // for users below the threshold or in the cooldown window.
  mountFreshComponent('rating-prompt-modal-mount', RatingPromptModal);
}

/**
 * Soft paywall banner mount. The legacy slot is an empty `<div>` because
 * the banner needs block layout (its own row), not the inline span the
 * generic mountAt() helper provides. Renders the component into the slot
 * directly without replacing it — the slot is a permanent layout anchor
 * even when the banner short-circuits to null.
 */
function mountSoftPaywallBanner(): void {
  const slot = document.getElementById('soft-paywall-banner-mount');
  if (slot) {
    render(<SoftPaywallBanner />, slot);
    return;
  }
  // Fallback: no slot in this HTML variant. Stitch one onto the top of
  // #app so the banner still appears above the toolbar.
  const app = document.getElementById('app');
  if (!app) return;
  const mount = document.createElement('div');
  mount.id = 'soft-paywall-banner-mount';
  mount.dataset.preactMount = 'soft-paywall-banner-mount';
  app.insertBefore(mount, app.firstChild);
  render(<SoftPaywallBanner />, mount);
}

function mountTrialGraceBanner(): void {
  const slot = document.getElementById('trial-grace-banner-mount');
  if (slot) {
    render(<TrialGraceBanner />, slot);
    return;
  }
  const app = document.getElementById('app');
  if (!app) return;
  const mount = document.createElement('div');
  mount.id = 'trial-grace-banner-mount';
  mount.dataset.preactMount = 'trial-grace-banner-mount';
  app.insertBefore(mount, app.firstChild);
  render(<TrialGraceBanner />, mount);
}

/**
 * Mount a brand-new Preact component that has no legacy DOM slot. Idempotent:
 * if a previous mount with the same id exists (hot reload, popup re-init)
 * we replace its contents rather than stacking duplicates.
 */
function mountFreshComponent(mountId: string, Component: ComponentType): void {
  let mount = document.getElementById(mountId);
  if (!mount) {
    mount = document.createElement('div');
    mount.id = mountId;
    mount.dataset.preactMount = mountId;
    document.body.appendChild(mount);
  }
  render(<Component />, mount);
}
