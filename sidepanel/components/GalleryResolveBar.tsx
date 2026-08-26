// Deep link-resolution hint bar (v1.1.0).
//
// Renders below the toolbar when the last scan found gallery-link candidates
// (visible thumbnail wrapped in a NON-image link — likely a detail page).
// One click asks the background to fetch every candidate and pull its
// og:image original. Free users draw from the linkResolve monthly soft
// quota; Pro is unlimited.
//
// v1.1.0 smoke round 3: the candidate list truncated URLs at a fixed 72
// chars (leaving the right half of the bar empty), links were dead text,
// and a failed resolve reported nothing about WHICH link failed or WHY.
// The list now renders full URLs (CSS ellipsis clips at the real edge),
// every entry is a real link, and each carries a per-link status dot fed
// by the background's per-link resolve outcomes.
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
import { generateId } from '../utils';
import { useStoreSelector } from './storeHook';

/** One entry of the background's per-link resolve outcome list. */
interface LinkOutcome {
  url: string;
  status: 'resolved' | 'failed';
  reason?: string;
}

/** Failure-reason → tooltip i18n key (reason values from link-resolver.ts). */
const FAILURE_TITLE_KEY: Record<string, string> = {
  blocked: 'gallery_resolve_link_failed_blocked',
  'http-error': 'gallery_resolve_link_failed_http_error',
  'non-html': 'gallery_resolve_link_failed_non_html',
  'no-meta-image': 'gallery_resolve_link_failed_no_meta_image',
  'network-error': 'gallery_resolve_link_failed_network_error',
};

export function GalleryResolveBar() {
  const galleryCount = useStoreSelector((s) => s.galleryLinks.length);
  // Re-render on locale switch so t() picks up the new language.
  useStoreSelector((s) => s.localeTick);
  const [expanded, setExpanded] = useState(false);
  /** Per-link outcomes from the LAST resolve click, keyed by link URL. */
  const [linkOutcomes, setLinkOutcomes] = useState<Record<string, LinkOutcome>>({});

  if (galleryCount === 0) return null;

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
      // The two awaits above open a double-fire window (rapid double-clicks:
      // both callers pass the guard before either sets the flag) — re-check
      // so a free user can't launch two batches / burn quota twice.
      if (state.isResolvingGallery) return;
    }

    state.isResolvingGallery = true;
    // Stale dots must not linger through a fresh resolve — everything is
    // pending again until the background answers.
    setLinkOutcomes({});
    showProgress(t('gallery_resolve_progress'));
    updateProgress(0, urls.length);
    void track(EVENTS.GALLERY_RESOLVE_STARTED, { linkCount: urls.length });

    try {
      // Cookie scoping (security review): tell the background which page the
      // user is browsing — only links on its site may carry the session
      // cookie. Fetched AFTER the busy flag so the await can't reopen the
      // double-fire window; a closed tab degrades to cookie-less resolving.
      let sourceUrl = '';
      let sourceTabTitle = '';
      let sourceTabIndex: number | undefined;
      try {
        const tab = state.currentTabId != null ? await chrome.tabs.get(state.currentTabId) : null;
        sourceUrl = tab?.url ?? '';
        sourceTabTitle = tab?.title ?? '';
        sourceTabIndex = tab?.index;
      } catch {
        /* tab gone — resolve without cookies */
      }

      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.RESOLVE_LINK_IMAGES,
        urls,
        sourceUrl,
      });

      if (response && response.success && Array.isArray(response.images)) {
        const newImages: ImageItem[] = response.images.map((img: ImageItem) => ({
          ...img,
          id: img.id || generateId(img.url),
          // Tag the owning tab so scan replaces never leak resolved originals
          // into another tab's result.
          tabId: img.tabId ?? state.currentTabId ?? undefined,
          // Owning-tab grouping metadata — the 'tab' group mode must show
          // resolved originals in the tab they were resolved from, not a
          // nameless fallback bucket.
          tabTitle: img.tabTitle || sourceTabTitle || state.currentTabTitle || undefined,
          tabIndex: img.tabIndex ?? sourceTabIndex,
          isCurrentTab: img.isCurrentTab ?? true,
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

        // Per-link outcomes (older backgrounds / e2e stubs may omit them):
        // index by URL so the rendered list can look each link up.
        if (Array.isArray(response.results)) {
          const byUrl: Record<string, LinkOutcome> = {};
          for (const entry of response.results as LinkOutcome[]) {
            if (entry && typeof entry.url === 'string') byUrl[entry.url] = entry;
          }
          setLinkOutcomes(byUrl);
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
          aria-controls="gallery-resolve-collapse"
          title={t('gallery_resolve_toggle_title')}
          onClick={() => setExpanded(!expanded)}
        >
          <span class={`gallery-resolve-caret${expanded ? ' open' : ''}`}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </span>
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
      {/* The list stays mounted inside a CSS-animated collapse wrapper
          (grid-template-rows 0fr↔1fr) so expanding/collapsing glides
          instead of popping. `inert` keeps collapsed links out of the tab
          order while they are visually hidden. */}
      <div
        id="gallery-resolve-collapse"
        class={`gallery-resolve-collapse${expanded ? ' open' : ''}`}
        inert={!expanded}
        aria-hidden={!expanded}
      >
        <ul class="gallery-resolve-links">
          {shownLinks.map((url) => {
            const outcome = linkOutcomes[url];
            const dotClass = outcome
              ? outcome.status === 'resolved'
                ? 'gallery-resolve-dot is-resolved'
                : 'gallery-resolve-dot is-failed'
              : 'gallery-resolve-dot';
            const dotTitle = outcome
              ? outcome.status === 'resolved'
                ? t('gallery_resolve_link_resolved')
                : t(
                    FAILURE_TITLE_KEY[outcome.reason ?? ''] ??
                      'gallery_resolve_link_failed_network_error'
                  )
              : t('gallery_resolve_link_pending');
            return (
              <li key={url}>
                <span class={dotClass} title={dotTitle} />
                {/* Full URL — the CSS clips with an ellipsis at the real right
                    edge (a fixed char-count cut left the right half empty).
                    Real anchor: "what IS this link" is one click away. */}
                <a href={url} target="_blank" rel="noopener noreferrer" title={url}>
                  {url}
                </a>
              </li>
            );
          })}
          {hiddenCount > 0 && (
            <li class="gallery-resolve-links-more">
              {t('gallery_resolve_links_more', { count: hiddenCount })}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
