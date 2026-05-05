// ImageCard — Preact replacement for renderImageCard() + bindCardEvents() in
// sidepanel/render.ts. The legacy implementation built HTML strings and
// re-bound 10+ click handlers per card on every renderImages() pass; this
// component does both in one declarative tree.
//
// Reactive subscriptions (via useStoreSelector):
//   - selectedImages.has(id) → toggles `.selected` and the checkbox icon
//   - isProUser              → guards Pro-only actions (favorite, color copy)
//   - appSettings.enableColorExtraction → shows color bar vs transparent bar
//
// The favorite button has its own async piece (isImageInCollection) that
// can't live in the store cheaply (one IndexedDB lookup per image), so we
// resolve it locally with useEffect and keep it in component state.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ImageItem } from '../../shared/types';
import {
  copyImageUrl,
  downloadSingle,
  openInNewTab,
  setupDragAndDrop,
  showReverseSearchMenu,
  toggleSelection,
} from '../actions';
import {
  addToCollection,
  copyColor,
  isImageInCollection,
  removeFromCollection,
  removeImageById,
} from '../pro-features';
import { showProUpgradeModal } from '../settings';
import { showConfirmDialog, showToast } from '../ui';
import { formatBytes } from '../utils';
import { useStoreSelector } from './storeHook';

interface Props {
  img: ImageItem;
  index: number;
}

// SVGs as small inline components keeps the JSX below readable. They have no
// state of their own, just match the legacy HTML markup verbatim so existing
// CSS selectors (e.g. .card-action-btn svg) keep applying.
const IconCheck = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="3"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconSearch = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IconDownload = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const IconStar = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);
const IconTrash = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
const IconCopy = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const IconOpen = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

export function ImageCard({ img, index }: Props) {
  const isSelected = useStoreSelector((s) => s.selectedImages.has(img.id));
  const isProUser = useStoreSelector((s) => s.isProUser);
  const colorExtractionEnabled = useStoreSelector(
    (s) => s.appSettings.enableColorExtraction !== false
  );

  // Favorite state lives outside the store: we'd need an IndexedDB lookup
  // per image to seed it eagerly, which would balloon initial render time.
  // Instead each card resolves its own favorite flag asynchronously.
  const [isFavorited, setIsFavorited] = useState(false);
  useEffect(() => {
    let cancelled = false;
    isImageInCollection(img.url).then((found) => {
      if (!cancelled) setIsFavorited(found);
    });
    return () => {
      cancelled = true;
    };
  }, [img.url]);

  // Drag-and-drop is imperatively wired in actions.ts > setupDragAndDrop:
  // it expects a real DOM node and registers native dragstart/dragend
  // listeners. We attach it once via ref after mount.
  const thumbRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (thumbRef.current) setupDragAndDrop(thumbRef.current, img);
  }, [img]);

  const w = img.naturalWidth || img.displayWidth || 0;
  const h = img.naturalHeight || img.displayHeight || 0;
  const dims = w && h ? `${w}×${h}` : '';
  const size = img.estimatedSize ? formatBytes(img.estimatedSize) : '';
  const format = (img.format || 'unknown').toUpperCase();
  const colors = img.colors || [];

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleCardClick = (e: MouseEvent) => {
    // Card click toggles selection unless the click originated inside an
    // action button or the checkbox label (matches legacy behavior).
    const target = e.target as HTMLElement;
    if (target.closest('.card-action-btn') || target.closest('.card-checkbox')) return;
    toggleSelection(img.id);
  };

  const handleCheckboxChange = () => toggleSelection(img.id);

  const handleSearch = (e: MouseEvent) => {
    e.stopPropagation();
    showReverseSearchMenu(img.url, e.currentTarget as HTMLElement);
  };

  const handleDownload = (e: MouseEvent) => {
    e.stopPropagation();
    downloadSingle(img, null);
  };

  const handleFavorite = async (e: MouseEvent) => {
    e.stopPropagation();
    if (!isProUser) {
      showToast('Collection is a Pro feature', 'warning');
      showProUpgradeModal();
      return;
    }
    if (isFavorited) {
      await removeFromCollection(img.id);
      setIsFavorited(false);
    } else {
      await addToCollection(img);
      setIsFavorited(true);
    }
  };

  const handleDelete = async (e: MouseEvent) => {
    e.stopPropagation();
    const confirmed = await showConfirmDialog({
      title: 'Remove Image',
      message: 'Are you sure you want to remove this image from the list?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      type: 'danger',
    });
    if (!confirmed) return;
    removeImageById(img.id);
  };

  const handleCopyUrl = (e: MouseEvent) => {
    e.stopPropagation();
    copyImageUrl(img.url);
  };

  const handleOpen = (e: MouseEvent) => {
    e.stopPropagation();
    openInNewTab(img.url);
  };

  const handleColorClick = (color: string) => (e: MouseEvent) => {
    e.stopPropagation();
    if (!isProUser) {
      showToast('Color copy is a Pro feature', 'warning');
      showProUpgradeModal();
      return;
    }
    copyColor(color);
  };

  // Image load handlers — keep the legacy `.loaded` class flow so existing
  // CSS transitions (fade-in, broken-image fallback) still work.
  const handleImgLoad = (e: Event) => {
    const t = e.currentTarget as HTMLImageElement;
    t.classList.add('loaded');
    t.parentElement?.classList.add('loaded');
  };
  const handleImgError = (e: Event) => {
    const t = e.currentTarget as HTMLImageElement;
    t.style.display = 'none';
    t.parentElement?.classList.add('loaded');
  };

  return (
    <div
      class={`image-card${isSelected ? ' selected' : ''}`}
      data-id={img.id}
      data-index={index}
      onClick={handleCardClick}
    >
      <div class="card-header">
        <label
          class={`card-checkbox${isSelected ? ' checked' : ''}`}
          data-id={img.id}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={isSelected}
            data-id={img.id}
            onChange={handleCheckboxChange}
          />
          <span class="checkbox-icon">{isSelected && <IconCheck />}</span>
        </label>
      </div>
      <div ref={thumbRef as preact.RefObject<HTMLDivElement>} class="card-thumb checkerboard">
        <img src={img.url} alt="" loading="lazy" onLoad={handleImgLoad} onError={handleImgError} />
      </div>
      {colorExtractionEnabled && <ColorBar colors={colors} onSwatchClick={handleColorClick} />}
      <div class="card-info-bar">
        <div class="card-tags">
          <span class="card-tag format">{format}</span>
          {dims && <span class="card-tag dims">{dims}</span>}
          {size && <span class="card-tag filesize">{size}</span>}
        </div>
        <div class="card-actions">
          <button
            class="card-action-btn btn-search"
            title="Reverse search"
            data-url={img.url}
            onClick={handleSearch}
          >
            <IconSearch />
          </button>
          <button
            class="card-action-btn btn-dl"
            title="Download"
            data-id={img.id}
            onClick={handleDownload}
          >
            <IconDownload />
          </button>
          <span class="icon-btn-wrapper">
            <button
              class={`card-action-btn btn-favorite${isFavorited ? ' favorited' : ''}`}
              title={isFavorited ? 'Remove from collection' : 'Add to collection'}
              data-id={img.id}
              onClick={handleFavorite}
            >
              <IconStar />
            </button>
            <span class="pro-badge pro-badge-mini">PRO</span>
          </span>
          <span class="icon-btn-wrapper">
            <button
              class="card-action-btn btn-delete"
              title="Remove image"
              data-id={img.id}
              onClick={handleDelete}
            >
              <IconTrash />
            </button>
            <span class="pro-badge pro-badge-mini">PRO</span>
          </span>
        </div>
      </div>
      <div class="card-url-row">
        <div class="card-url" title={img.url}>
          {img.url}
        </div>
        <div class="card-url-actions">
          <button
            class="card-action-btn btn-copy-url"
            title="Copy URL"
            data-url={img.url}
            onClick={handleCopyUrl}
          >
            <IconCopy />
          </button>
          <button
            class="card-action-btn btn-open"
            title="Open in new tab"
            data-url={img.url}
            onClick={handleOpen}
          >
            <IconOpen />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Color bar ──────────────────────────────────────────────────────────────
// Mirrors pro-features.ts > renderColorBar / renderTransparentBar. Keeping
// the markup consistent (same data-color attribute, same swatch class) means
// existing CSS continues to apply without changes.
interface ColorBarProps {
  colors: string[];
  onSwatchClick: (color: string) => (e: MouseEvent) => void;
}

function ColorBar({ colors, onSwatchClick }: ColorBarProps) {
  if (colors.length === 0) {
    // "Transparent" bar: just a flat strip; no swatches, no click target.
    return <div class="card-color-bar-row card-color-bar-empty" />;
  }
  return (
    <div class="card-color-bar-row">
      {colors.map((color) => (
        <span
          key={color}
          class="card-color-bar"
          data-color={color}
          style={`background-color:${color}`}
          onClick={onSwatchClick(color)}
          title={color}
        />
      ))}
    </div>
  );
}
