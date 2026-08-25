// Deep link-resolution hint bar (v1.1.0).
//
// Renders below the toolbar when the last scan found gallery-link candidates
// (visible thumbnail wrapped in a NON-image link — likely a detail page).
// One click asks the background to fetch every candidate and pull its
// og:image original. Free users draw from the linkResolve monthly soft
// quota; Pro is unlimited.
import { useState } from 'preact/hooks';
import { t } from '../../shared/i18n';
import { track } from '../../shared/telemetry';
import { EVENTS } from '../../shared/telemetry-events';
import { MESSAGE_TYPES } from '../../shared/constants';
import type { ImageItem } from '../../shared/types';
import { state } from '../state';
import { applyFilters } from '../filter';
import { processImageExtras } from '../scan';
import { persistInjectedItems } from '../injected-items';
import { showProUpgradeModal } from '../settings';
import { hideProgress, showToast, showProgress, updateProgress } from '../ui';
import { generateId, truncateUrl } from '../utils';
import { useStoreSelector } from './storeHook';

async function handleResolveClick(): Promise<void> {
  const urls = state.galleryLinks;
  if (urls.length === 0 || state.isResolvingGallery) return;

  // Pro soft-quota gate (free users): linkResolve is metered monthly.
  if (!state.isProUser) {
    const { checkFeatureQuota, quotaBlockedMessage } = await import('../../shared/feature-quota');
    const { allowed, limit } = await checkFeatureQuota('linkResolve');
    if (!allowed) {
      showToast(quotaBlockedMessage(t, 'feature_link_resolve', limit), 'warning');
      showProUpgradeModal();
      void track(EVENTS.PRO_FEATURE_BLOCKED, { feature: 'link_resolve' });
      return;
    }
  }

  state.isResolvingGallery = true;
  showProgress(t('gallery_resolve_progress'));
  updateProgress(0, urls.length);
  void track(EVENTS.GALLERY_RESOLVE_STARTED, { linkCount: urls.length });

  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.RESOLVE_LINK_IMAGES,
      urls,
    });

    if (response && response.success && Array.isArray(response.images)) {
      const newImages: ImageItem[] = response.images.map((img: ImageItem) => ({
        ...img,
        id: img.id || generateId(img.url),
        // Tag the owning tab so scan replaces never leak resolved originals
        // into another tab's result.
        tabId: img.tabId ?? state.currentTabId ?? undefined,
        colors: undefined,
        phash: null,
      }));
      const toAdd = newImages.filter((ni) => !state.allImages.some((img) => img.url === ni.url));
      if (toAdd.length > 0) {
        state.allImages = [...state.allImages, ...toAdd];
        applyFilters();
        processImageExtras(toAdd);
        // Resolved originals are user-injected (not on the page) — persist
        // so a panel reload or rescan can't drop what quota paid for.
        void persistInjectedItems();
      }

      // resolveLinkImages swallows per-link failures (security guard,
      // anti-bot 4xx, timeout) and still answers success:true — so a total
      // failure arrives as images:[] with failed > 0. Treat that as the
      // failure path: error toast, and don't burn the free monthly quota
      // on a resolve that produced nothing.
      if ((response.resolved ?? 0) === 0 && (response.failed ?? 0) > 0) {
        void track(EVENTS.GALLERY_RESOLVE_COMPLETED, {
          resolved: 0,
          failed: response.failed ?? urls.length,
        });
        showToast(t('toast_gallery_resolve_failed'), 'error');
        return;
      }

      void track(EVENTS.GALLERY_RESOLVE_COMPLETED, {
        resolved: response.resolved ?? 0,
        failed: response.failed ?? 0,
      });
      showToast(t('toast_gallery_resolved', { images: toAdd.length }), 'success');

      // Increment quota usage only after a successful resolve (free users).
      if (!state.isProUser) {
        void import('../../shared/feature-quota').then(({ incrementFeatureUsage }) =>
          incrementFeatureUsage('linkResolve')
        );
      }
    } else {
      void track(EVENTS.GALLERY_RESOLVE_COMPLETED, {
        resolved: 0,
        failed: urls.length,
      });
      showToast(t('toast_gallery_resolve_failed'), 'error');
    }
  } catch {
    void track(EVENTS.GALLERY_RESOLVE_COMPLETED, { resolved: 0, failed: urls.length });
    showToast(t('toast_gallery_resolve_failed'), 'error');
  } finally {
    state.isResolvingGallery = false;
    hideProgress();
  }
}

export function GalleryResolveBar() {
  const galleryCount = useStoreSelector((s) => s.galleryLinks.length);
  // Re-render on locale switch so t() picks up the new language.
  useStoreSelector((s) => s.localeTick);
  const [expanded, setExpanded] = useState(false);

  if (galleryCount === 0) return null;

  // Cap the rendered list: link-farm pages can collect hundreds of
  // candidates; the full set is still resolved, we just render the head.
  const MAX_LINKS_SHOWN = 20;
  const shownLinks = state.galleryLinks.slice(0, MAX_LINKS_SHOWN);
  const hiddenCount = galleryCount - shownLinks.length;

  return (
    <div id="gallery-resolve-bar" class="gallery-resolve-bar" role="region">
      <div class="gallery-resolve-bar-main">
        <button
          type="button"
          class="gallery-resolve-bar-toggle"
          aria-expanded={expanded}
          title={t('gallery_resolve_toggle_title')}
          onClick={() => setExpanded(!expanded)}
        >
          <span class="gallery-resolve-caret">{expanded ? '▾' : '▸'}</span>
          {t('gallery_resolve_bar_title', { count: galleryCount })}
        </button>
        <button
          id="btn-gallery-resolve"
          type="button"
          class="btn btn-primary btn-sm"
          disabled={state.isResolvingGallery}
          onClick={() => void handleResolveClick()}
        >
          {t('gallery_resolve_action')}
        </button>
      </div>
      <p class="gallery-resolve-hint">{t('gallery_resolve_bar_hint')}</p>
      {expanded && (
        <ul class="gallery-resolve-links">
          {shownLinks.map((url) => (
            <li key={url} title={url}>
              {truncateUrl(url, 72)}
            </li>
          ))}
          {hiddenCount > 0 && (
            <li class="gallery-resolve-links-more">
              {t('gallery_resolve_links_more', { count: hiddenCount })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
