// ImageGrid — Preact container that owns the entire #image-grid subtree.
// Replaces renderImages() / renderGroupedImages() / renderProgressiveImages()
// in sidepanel/render.ts (those still exist as thin wrappers that nudge the
// store + post-render bookkeeping like skeleton fill and counts).
//
// Two display modes:
//   - flat:    state.currentGroupMode === 'none'
//              → render filteredImages as a single sequence of <ImageCard>s
//   - grouped: any other groupMode
//              → group via groupImages() and render with collapsible headers
//
// Virtualization (stage 4):
//   - Active only in flat + list-view + images.length > VIRTUAL_THRESHOLD.
//   - List view is a single column with regular row height, which is the
//     ideal case for virtua's row-based Virtualizer. Grid view (2 columns,
//     density-dependent heights) and grouped mode keep the simple full
//     render path — they're rarely paired with thousands of cards anyway.
//   - We use <Virtualizer> (not <VList>) so the existing .image-grid CSS
//     (overflow-y: auto, padding, gap via grid-template) keeps owning the
//     scroll container. virtua only manages which children are mounted.
import { Virtualizer } from 'virtua';
import type { ImageItem } from '../../shared/types';
import { groupImages, toggleGroupCollapse } from '../render';
import { state } from '../state';
import { ImageCard } from './ImageCard';
import { SkeletonCard } from './SkeletonCard';
import { useStoreSelector } from './storeHook';

/** Threshold above which list-view switches to virtualized rendering. */
const VIRTUAL_THRESHOLD = 50;

const IconChevron = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export function ImageGrid() {
  // We deliberately subscribe to the full filteredImages array (reference,
  // not derived value): renderImages() in render.ts replaces the array on
  // every filter/sort pass, so reference equality is the natural change
  // signal and avoids per-card diffing on the selector level.
  const images = useStoreSelector((s) => s.filteredImages);
  const groupMode = useStoreSelector((s) => s.currentGroupMode);
  // Subscribe to view mode + collapsed groups so layout / chevron flips
  // re-render automatically when toggled.
  const viewMode = useStoreSelector((s) => s.currentViewMode);
  const collapsedRef = useStoreSelector((s) => s.collapsedGroups);
  // Trailing skeleton placeholders shown during scanning. ui.ts > showLoading
  // sets this to N (= calcSkeletonCount) and incremental real cards push it
  // back down toward 0; renderImages() clears it after the final pass.
  const skeletonsToShow = useStoreSelector((s) => s.scanSkeletonsToShow);

  // Trailing skeletons make sense for both flat and grouped modes — render
  // them after the cards so they fill the remaining viewport space.
  const trailingSkeletons = Array.from({ length: skeletonsToShow }, (_, i) => (
    <SkeletonCard key={`skeleton-${i}`} />
  ));

  if (groupMode === 'none') {
    return (
      <FlatList
        images={images}
        listView={viewMode !== 'grid'}
        trailingSkeletons={trailingSkeletons}
      />
    );
  }

  const groups = groupImages(images, groupMode);
  return (
    <>
      {groups.map((group) => (
        <GroupBlock
          key={group.name}
          name={group.name}
          images={group.images}
          isCurrentTab={group.isCurrentTab}
          collapsed={collapsedRef.has(group.name)}
          listView={viewMode !== 'grid'}
          showCurrentBadge={state.currentGroupMode === 'tab' && group.isCurrentTab}
        />
      ))}
      {trailingSkeletons}
    </>
  );
}

interface FlatListProps {
  images: ImageItem[];
  listView: boolean;
  trailingSkeletons: preact.JSX.Element[];
}

/**
 * Flat (non-grouped) renderer. Switches to virtua's <Virtualizer> only when
 * we're in single-column list view AND have enough cards to make the
 * mount/unmount overhead worthwhile. Below the threshold we render the
 * plain DOM so small lists pay zero virtualization cost.
 */
function FlatList({ images, listView, trailingSkeletons }: FlatListProps) {
  const shouldVirtualize = listView && images.length > VIRTUAL_THRESHOLD;
  if (!shouldVirtualize) {
    return (
      <>
        {images.map((img, i) => (
          <ImageCard key={img.id} img={img} index={i} />
        ))}
        {trailingSkeletons}
      </>
    );
  }
  return (
    <Virtualizer>
      {images.map((img, i) => (
        <ImageCard key={img.id} img={img} index={i} />
      ))}
      {trailingSkeletons}
    </Virtualizer>
  );
}

interface GroupBlockProps {
  name: string;
  images: ImageItem[];
  isCurrentTab: boolean;
  collapsed: boolean;
  listView: boolean;
  showCurrentBadge: boolean;
}

function GroupBlock({ name, images, collapsed, listView, showCurrentBadge }: GroupBlockProps) {
  const handleHeaderClick = () => toggleGroupCollapse(name);
  return (
    <div class="image-group">
      <div
        class={`group-header${collapsed ? ' collapsed' : ''}`}
        data-group={name}
        onClick={handleHeaderClick}
      >
        <span class="group-arrow">
          <IconChevron />
        </span>
        <span class="group-name">
          {name}
          {showCurrentBadge && <span class="tab-current-badge">Current</span>}
        </span>
        <span class="group-count">{images.length}</span>
      </div>
      <div class={`group-content${collapsed ? ' collapsed' : ''}${listView ? ' list-view' : ''}`}>
        {images.map((img, i) => (
          <ImageCard key={img.id} img={img} index={i} />
        ))}
      </div>
    </div>
  );
}
