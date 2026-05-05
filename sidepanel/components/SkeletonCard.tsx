// Skeleton placeholder card. Mirrors the markup that ui.ts > buildSkeletonCard
// used to emit as an HTML string. Now that <ImageGrid> owns the entire grid
// subtree via Preact, the skeletons need to live in JSX too — otherwise
// imperative `imageGrid.innerHTML = ...` writes (the old approach) would be
// blown away on the next reactive re-render.
//
// Pure stateless presentational component — no props, no store reads.
export function SkeletonCard() {
  return (
    <div class="skeleton-card">
      <div class="skeleton-thumb" />
      <div class="skeleton-info-bar">
        <div class="skeleton-tags">
          <span class="skeleton-tag" />
          <span class="skeleton-tag" />
          <span class="skeleton-tag" />
        </div>
        <div class="skeleton-actions">
          <span class="skeleton-action" />
          <span class="skeleton-action" />
          <span class="skeleton-action" />
        </div>
      </div>
      <div class="skeleton-url-row">
        <div class="skeleton-url-bar" />
        <div class="skeleton-url-actions">
          <span class="skeleton-action small" />
          <span class="skeleton-action small" />
        </div>
      </div>
    </div>
  );
}
