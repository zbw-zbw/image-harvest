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
import { DownloadLabel, FoundActionCount, SimilarCount } from './StatusCounts';
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
import { SettingsModal, setSavedSettingsBody } from './SettingsModal';
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
 * Settings modal needs special handling: the legacy `.modal-body` subtree
 * is ~440 lines of static HTML containing 20+ controls bound by 47
 * imperative `getElementById` call sites in settings.ts. Recreating the
 * markup in Preact would require rewriting all those bindings.
 *
 * Instead we:
 *   1. Detach the legacy `.modal-body` from the DOM (no children removed —
 *      the subtree's identity, ids, attached event listeners are all
 *      preserved).
 *   2. Hand the saved node to <SettingsModal> via a module-level setter so
 *      the component's useEffect can re-attach it inside its slot div.
 *   3. Replace the legacy `#settings-modal` shell with a Preact mount point
 *      and render <SettingsModal>.
 */
function mountSettingsModal(): void {
  const legacy = document.getElementById('settings-modal');
  if (!legacy) return;
  const body = legacy.querySelector<HTMLElement>('.modal-body');
  if (body) {
    body.remove();
    setSavedSettingsBody(body);
  }
  const mount = document.createElement('div');
  mount.dataset.preactMount = 'settings-modal';
  legacy.replaceWith(mount);
  render(<SettingsModal />, mount);
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
  mountAt('similar-count', SimilarCount);
  mountAt('download-label', DownloadLabel);
  // Block-level overlays / badges
  mountAt('scan-overlay', ScanProgressOverlay, 'div');
  mountAt('progress-modal', DownloadProgressModal, 'div');
  mountAt('pro-status-area', ProStatusBadge, 'div');
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
}
