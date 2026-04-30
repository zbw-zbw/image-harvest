// Pro Features: Reverse Search, Similar Detection, Collection, Color Extraction, Multi-Tab Extract

// ============================================
// Reverse Image Search (Pro)
// ============================================
function showReverseSearchMenu(imageUrl, anchor) {
  // Free tier: reverse search is available but limited to Google only
  // Menu still opens, but non-Google engines show Pro badge and are blocked
  if (!elements.reverseSearchMenu) return;
  const rect = anchor.getBoundingClientRect();
  const menuWidth = 180;
  const viewportWidth = window.innerWidth;

  let leftPos = rect.left;
  if (leftPos + menuWidth > viewportWidth - 8) {
    leftPos = rect.right - menuWidth;
  }
  if (leftPos < 4) leftPos = 4;

  elements.reverseSearchMenu.style.left = `${leftPos}px`;
  elements.reverseSearchMenu.style.top = `${rect.bottom + 4}px`;
  elements.reverseSearchMenu.dataset.imageUrl = imageUrl;
  elements.reverseSearchMenu.classList.remove('hidden');
}

function reverseSearch(imageUrl, engine) {
  const validEngines = ['google', 'tineye', 'baidu', 'yandex'];
  if (!validEngines.includes(engine)) return;

  // Open the intermediate page which downloads the image via background script
  // and submits it as a form upload to the search engine
  const searchPageUrl = chrome.runtime.getURL('pages/reverse-search.html')
    + `?engine=${encodeURIComponent(engine)}`
    + `&imageUrl=${encodeURIComponent(imageUrl)}`;
  chrome.tabs.create({ url: searchPageUrl, active: true });
}

// ============================================
// Similar Image Detection (Pro)
// ============================================
function detectSimilarImages() {
  const withHash = allImages.filter(img => img.phash);
  if (withHash.length < 2) return;

  const HASH_THRESHOLD = 0;
  const ASPECT_RATIO_TOLERANCE = 0.15;

  function getAspectRatio(img) {
    const width = img.naturalWidth || img.displayWidth || 0;
    const height = img.naturalHeight || img.displayHeight || 0;
    if (width <= 0 || height <= 0) return 0;
    return width / height;
  }

  function areAspectRatiosSimilar(ratioA, ratioB) {
    if (ratioA === 0 || ratioB === 0) return true;
    const diff = Math.abs(ratioA - ratioB) / Math.max(ratioA, ratioB);
    return diff <= ASPECT_RATIO_TOLERANCE;
  }

  similarGroups = [];
  const used = new Set();

  for (let i = 0; i < withHash.length; i++) {
    if (used.has(i)) continue;
    const group = [withHash[i]];
    const baseRatio = getAspectRatio(withHash[i]);

    for (let j = i + 1; j < withHash.length; j++) {
      if (used.has(j)) continue;
      if (typeof hammingDistance === 'function') {
        const candidateRatio = getAspectRatio(withHash[j]);
        const isSimilarToAll = group.every(member => {
          const dist = hammingDistance(member.phash, withHash[j].phash);
          return dist <= HASH_THRESHOLD;
        });
        if (isSimilarToAll && areAspectRatiosSimilar(baseRatio, candidateRatio)) {
          group.push(withHash[j]);
          used.add(j);
        }
      }
    }

    if (group.length > 1) {
      similarGroups.push(group);
      used.add(i);
    }
  }

  if (elements.similarCount) {
    elements.similarCount.textContent = similarGroups.length;
  }

  const similarEnabled = appSettings.enableSimilarDetection !== false;
  if (elements.btnDedup) {
    elements.btnDedup.style.display = (similarEnabled && similarGroups.length > 0) ? '' : 'none';
  }

  const dedupInfo = document.getElementById('dedup-info');
  if (dedupInfo) {
    dedupInfo.classList.toggle('hidden', !similarEnabled || similarGroups.length === 0);
  }
}

function showDedupModal() {
  if (!elements.dedupModal) return;
  elements.dedupModal.classList.remove('hidden');
  // Reset scroll position to top
  const modalBody = elements.dedupModal.querySelector('.modal-body');
  if (modalBody) modalBody.scrollTop = 0;

  if (elements.dedupBody) {
    if (similarGroups.length === 0) {
      elements.dedupBody.innerHTML = '<p class="empty-message">No similar images found</p>';
      return;
    }
    elements.dedupBody.innerHTML = `
      <p class="dedup-hint">Click images to mark them for removal</p>
      ${similarGroups.map((group, gi) => `
      <div class="dedup-group" data-group="${gi}">
        <div class="dedup-group-title">Group ${gi + 1} (${group.length} similar)</div>
        <div class="dedup-group-images">
          ${group.map((img, ii) => `
            <div class="dedup-image" data-group="${gi}" data-index="${ii}">
              <div class="dedup-image-thumb">
                <img src="${img.url}" alt="">
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('')}`;

    // Click image to toggle selection (mark for removal)
    elements.dedupBody.querySelectorAll('.dedup-image').forEach(el => {
      el.addEventListener('click', () => {
        el.classList.toggle('selected');
      });
    });
  }
}

function closeDedupModal() {
  if (elements.dedupModal) elements.dedupModal.classList.add('hidden');
}

async function removeDuplicates() {
  if (!_isProUser) {
    closeDedupModal();
    showToast('Removing duplicates is a Pro feature. Upgrade to unlock!', 'warning');
    showProUpgradeModal();
    return;
  }

  const toRemove = new Set();

  similarGroups.forEach((group, gi) => {
    group.forEach((img, ii) => {
      const el = document.querySelector(`.dedup-image[data-group="${gi}"][data-index="${ii}"]`);
      if (el && el.classList.contains('selected')) toRemove.add(img.id);
    });
  });

  // If no images were manually selected, default to removing all duplicates
  // in each similar group (keep the first image, remove the rest).
  if (toRemove.size === 0) {
    similarGroups.forEach(group => {
      for (let i = 1; i < group.length; i++) {
        toRemove.add(group[i].id);
      }
    });
  }

  if (toRemove.size === 0) {
    showToast('No duplicate images found', 'info');
    return;
  }

  const confirmed = await showConfirmDialog({
    title: 'Remove Duplicates',
    message: `Are you sure you want to remove ${toRemove.size} selected duplicate image${toRemove.size > 1 ? 's' : ''}?`,
    confirmText: 'Remove',
    cancelText: 'Cancel',
    type: 'danger'
  });
  if (!confirmed) return;

  allImages = allImages.filter(img => !toRemove.has(img.id));
  selectedImages = new Set([...selectedImages].filter(id => !toRemove.has(id)));

  closeDedupModal();
  applyFilters();
  detectSimilarImages();
  showToast(`Removed ${toRemove.size} duplicate images`, 'success');
}

function removeImageById(imageId) {
  // Free tier: image deletion requires Pro
  if (!_isProUser) {
    showToast('Image removal is a Pro feature. Upgrade to unlock!', 'warning');
    showProUpgradeModal();
    return;
  }
  allImages = allImages.filter(img => img.id !== imageId);
  selectedImages.delete(imageId);
  applyFilters();
  detectSimilarImages();
  showToast('Image removed', 'success');
}

// ============================================
// Collection / Favorites (Pro)
// ============================================
async function addToCollection(img) {
  try {
    // Get the actual page URL from the active tab (not the extension panel URL)
    let pageUrl = '';
    let pageTitle = '';
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab) {
        pageUrl = activeTab.url || '';
        pageTitle = activeTab.title || '';
      }
    } catch {
      // Fallback: use tab info from the image if available (multi-tab mode)
      pageUrl = img.tabUrl || '';
      pageTitle = img.tabTitle || '';
    }

    if (typeof collectionAdd === 'function') {
      await collectionAdd({
        id: img.id,
        url: img.url,
        width: img.naturalWidth || img.displayWidth,
        height: img.naturalHeight || img.displayHeight,
        format: img.format,
        fileSize: img.estimatedSize,
        colors: img.colors,
        sourceUrl: pageUrl,
        sourceTitle: pageTitle,
        tags: [],
        notes: '',
        createdAt: Date.now()
      });
    } else {
      // Fallback to chrome.storage
      const result = await chrome.storage.local.get(['collection']);
      const collection = result.collection || [];
      if (!collection.find(c => c.url === img.url)) {
        collection.push({ id: img.id, url: img.url, sourceUrl: pageUrl, sourceTitle: pageTitle, createdAt: Date.now() });
        await chrome.storage.local.set({ collection });
      }
    }
    showToast('Added to collection', 'success');
  } catch (error) {
    showToast('Failed to add to collection', 'error');
  }
}

async function isImageInCollection(imgUrl) {
  try {
    if (typeof collectionGetAll === 'function') {
      const all = await collectionGetAll();
      return all.some(c => c.url === imgUrl);
    } else {
      const result = await chrome.storage.local.get(['collection']);
      const collection = result.collection || [];
      return collection.some(c => c.url === imgUrl);
    }
  } catch {
    return false;
  }
}

async function removeFromCollection(imgId) {
  try {
    if (typeof collectionRemove === 'function') {
      await collectionRemove(imgId);
    } else {
      const result = await chrome.storage.local.get(['collection']);
      const collection = (result.collection || []).filter(c => c.id !== imgId);
      await chrome.storage.local.set({ collection });
    }
    showToast('Removed from collection', 'success');
  } catch (error) {
    showToast('Failed to remove', 'error');
  }
}

function showCollectionModal() {
  if (!elements.collectionModal) return;
  elements.collectionModal.classList.remove('hidden');
  // Reset scroll position to top
  const modalBody = elements.collectionModal.querySelector('.modal-body');
  if (modalBody) modalBody.scrollTop = 0;
  // Bind search
  if (elements.collectionSearch) {
    elements.collectionSearch.value = '';
    elements.collectionSearch.oninput = () => loadCollection(elements.collectionSearch.value.trim());
  }
  loadCollection();
}

function closeCollectionModal() {
  if (elements.collectionModal) elements.collectionModal.classList.add('hidden');
}

async function loadCollection(searchQuery = '') {
  if (!elements.collectionBody) return;

  try {
    let items;
    if (typeof collectionGetAll === 'function') {
      items = await collectionGetAll();
    } else {
      const result = await chrome.storage.local.get(['collection']);
      items = result.collection || [];
    }

    // Filter by search query
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      items = items.filter(item =>
        (item.url && item.url.toLowerCase().includes(lowerQuery)) ||
        (item.sourceTitle && item.sourceTitle.toLowerCase().includes(lowerQuery)) ||
        (item.sourceUrl && item.sourceUrl.toLowerCase().includes(lowerQuery)) ||
        (item.tags && item.tags.some(tag => tag.toLowerCase().includes(lowerQuery)))
      );
    }

    // Sort by newest first
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (items.length === 0) {
      elements.collectionBody.innerHTML = `
        <div class="collection-empty">
          <div class="collection-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
          <p>${searchQuery ? 'No matching images found' : 'No images in collection yet'}</p>
          <p style="font-size:11px;margin-top:4px;color:var(--text-tertiary)">${searchQuery ? 'Try a different search term' : 'Click the ★ button on any image to save it here'}</p>
        </div>`;
      return;
    }

    elements.collectionBody.innerHTML = `
      <div class="collection-grid">
        ${items.map(item => {
          const dims = (item.width && item.height) ? `${item.width}×${item.height}` : '';
          const format = (item.format || 'unknown').toUpperCase();
          const fileSize = item.fileSize ? formatBytes(item.fileSize) : '';
          return `
          <div class="image-card collection-card" data-id="${item.id}">
            <div class="card-thumb checkerboard">
              <img src="${item.url}" alt="" loading="lazy">
            </div>
            <div class="card-info-bar">
              <div class="card-tags">
                <span class="card-tag format">${format}</span>
                ${dims ? `<span class="card-tag dims">${dims}</span>` : ''}
                ${fileSize ? `<span class="card-tag filesize">${fileSize}</span>` : ''}
              </div>
              <div class="card-actions">
                <button class="card-action-btn btn-search-collection" title="Reverse search" data-url="${item.url}">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </button>
                <button class="card-action-btn btn-dl-collection" data-url="${item.url}" data-format="${item.format || ''}" title="Download">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button class="card-action-btn btn-remove-collection" data-id="${item.id}" title="Remove from collection">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
            <div class="card-url-row">
              <div class="card-url" title="${item.url}">${item.url}</div>
              <div class="card-url-actions">
                <button class="card-action-btn btn-copy-collection" data-url="${item.url}" title="Copy URL">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
                <button class="card-action-btn btn-open-collection" data-url="${item.url}" title="Open in new tab">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>`;

    // Bind action events
    elements.collectionBody.querySelectorAll('.btn-remove-collection').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeFromCollection(btn.dataset.id);
        // Also update favorite button state in main grid
        const mainCard = document.querySelector(`.image-card[data-id="${btn.dataset.id}"] .btn-favorite`);
        if (mainCard) {
          mainCard.classList.remove('favorited');
          mainCard.title = 'Add to collection';
        }
        loadCollection(elements.collectionSearch?.value?.trim() || '');
      });
    });

    elements.collectionBody.querySelectorAll('.btn-open-collection').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openInNewTab(btn.dataset.url);
      });
    });

    elements.collectionBody.querySelectorAll('.btn-copy-collection').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(btn.dataset.url);
          showToast('URL copied', 'success');
        } catch {
          showToast('Failed to copy URL', 'error');
        }
      });
    });

    elements.collectionBody.querySelectorAll('.btn-dl-collection').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const imgObj = { url: btn.dataset.url, format: btn.dataset.format || 'unknown' };
        downloadSingle(imgObj, null);
      });
    });

    elements.collectionBody.querySelectorAll('.btn-search-collection').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showReverseSearchMenu(btn.dataset.url, e.currentTarget);
      });
    });

    // Handle broken images
    elements.collectionBody.querySelectorAll('.card-thumb img').forEach(img => {
      img.addEventListener('load', () => {
        img.classList.add('loaded');
        img.parentElement.classList.add('loaded');
      });
      img.addEventListener('error', () => {
        img.style.display = 'none';
        img.parentElement.classList.add('loaded');
      });
    });
  } catch (error) {
    elements.collectionBody.innerHTML = `
      <div class="collection-empty">
        <div class="collection-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
        <p>Failed to load collection</p>
      </div>`;
  }
}

async function exportCollection() {
  try {
    let items;
    if (typeof collectionGetAll === 'function') {
      items = await collectionGetAll();
    } else {
      const result = await chrome.storage.local.get(['collection']);
      items = result.collection || [];
    }

    if (items.length === 0) { showToast('Collection is empty', 'info'); return; }

    let aborted = false;

    showProgress('Exporting collection...', () => {
      aborted = true;
      showToast('Export cancelled', 'info');
    });

    const zip = new JSZip();
    const pageInfo = await getActivePageInfo();
    const folder = zip.folder('collection');

    for (let i = 0; i < items.length; i++) {
      if (aborted) return;

      updateProgress(i + 1, items.length, truncateUrl(items[i].url, 40));
      try {
        const resp = await fetch(items[i].url, { mode: 'cors' });
        if (resp.ok) {
          const blob = await resp.blob();
          folder.file(generateFilename(items[i], i, null, pageInfo), blob);
        }
      } catch (e) { /* skip */ }
    }

    if (aborted) return;

    const content = await zip.generateAsync({ type: 'blob' });
    const blobUrl = URL.createObjectURL(content);
    const ts = formatTimestamp(new Date());
    await chrome.downloads.download({ url: blobUrl, filename: `collection-${ts}.zip`, saveAs: false });
    URL.revokeObjectURL(blobUrl);
    showToast('Collection exported', 'success');
  } catch (error) {
    if (!aborted) showToast('Export failed', 'error');
  } finally {
    hideProgress();
  }
}

// ============================================
// Color Extraction (Pro)
// ============================================
function renderColorBar(colors) {
  if (!colors || colors.length === 0) return renderTransparentBar();
  return `<div class="card-colors">${colors.map(c =>
    `<div class="card-color-bar" style="background:${c}" data-color="${c}" title="${_isProUser ? 'Click to copy ' + c : 'Upgrade to Pro to copy colors'}"></div>`
  ).join('')}</div>`;
}

function renderTransparentBar() {
  return `<div class="card-colors"><div class="card-color-bar card-color-bar-transparent" data-transparent="true" title="Transparent image"></div></div>`;
}

async function copyColor(hex) {
  try {
    await navigator.clipboard.writeText(hex);
    showToast(`Color ${hex} copied`, 'success');
  } catch (e) {
    showToast('Failed to copy color', 'error');
  }
}

// ============================================
// Multi-Tab Extract (Pro)
// ============================================
function showMultiTabModal() {
  if (!elements.multitabModal) return;
  elements.multitabModal.classList.remove('hidden');
  // Reset scroll position to top
  const modalBody = elements.multitabModal.querySelector('.modal-body');
  if (modalBody) modalBody.scrollTop = 0;
  loadTabList();
}

function closeMultiTabModal() {
  if (elements.multitabModal) elements.multitabModal.classList.add('hidden');
}

function getFallbackFaviconUrl(pageUrl) {
  try {
    const urlObj = new URL(pageUrl);
    return `${urlObj.origin}/favicon.ico`;
  } catch {
    return '';
  }
}

async function loadTabList() {
  if (!elements.multitabList) return;
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const validTabs = tabs.filter(tab => !isRestrictedUrl(tab.url));
    // Sort: current (active) tab first
    validTabs.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
    elements.multitabList.innerHTML = validTabs.map(tab => {
      const faviconUrl = tab.favIconUrl || getFallbackFaviconUrl(tab.url);
      return `
      <div class="tab-item${tab.active ? ' tab-current' : ''}" data-tab-id="${tab.id}">
        <label class="tab-checkbox" data-tab-id="${tab.id}">
          <input type="checkbox" value="${tab.id}">
          <span class="checkbox-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
        </label>
        <img src="${faviconUrl}" alt="" class="tab-favicon">
        <div class="tab-info">
          <div class="tab-title">${tab.title || 'Untitled'}${tab.active ? '<span class="tab-current-badge">Current</span>' : ''}</div>
          <div class="tab-url">${truncateUrl(tab.url, 50)}</div>
        </div>
      </div>
    `;
    }).join('');

    // Click entire tab-item row to toggle checkbox
    elements.multitabList.querySelectorAll('.tab-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.tab-checkbox')) return;
        const checkbox = item.querySelector('.tab-checkbox input');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          toggleTabCheckboxVisual(item);
          updateMultitabSelectAllState();
        }
      });
    });

    // Update select-all state when individual checkboxes change
    elements.multitabList.querySelectorAll('.tab-checkbox input').forEach(cb => {
      cb.addEventListener('change', () => {
        toggleTabCheckboxVisual(cb.closest('.tab-item'));
        updateMultitabSelectAllState();
      });
    });

    // When favicon fails to load, try resolving from the page's <link> tags
    elements.multitabList.querySelectorAll('.tab-favicon').forEach(favicon => {
      favicon.addEventListener('error', () => {
        favicon.style.visibility = 'hidden';
        const tabItem = favicon.closest('.tab-item');
        const tabId = tabItem ? Number(tabItem.dataset.tabId) : null;
        if (tabId) resolveTabFaviconById(tabId, favicon);
      });
    });

    // Async: try to resolve real favicon from page <link> for tabs missing favIconUrl
    resolveTabFavicons(validTabs);

    updateMultitabSelectAllState();
  } catch (error) {
    elements.multitabList.innerHTML = '<p class="empty-message">Failed to load tabs</p>';
  }
}

/**
 * For tabs missing favIconUrl, try to resolve the real favicon from the page's
 * <link rel="icon"> via chrome.scripting.executeScript, then update the img src.
 */
async function resolveTabFavicons(tabs) {
  const tabsMissingFavicon = tabs.filter(tab => !tab.favIconUrl);
  if (tabsMissingFavicon.length === 0) return;

  for (const tab of tabsMissingFavicon) {
    const tabItem = elements.multitabList?.querySelector(`[data-tab-id="${tab.id}"]`);
    const faviconImg = tabItem?.querySelector('.tab-favicon');
    if (!faviconImg) continue;

    let resolved = false;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const selectors = [
            'link[rel="icon"]',
            'link[rel="shortcut icon"]',
            'link[rel="apple-touch-icon"]',
            'link[rel="apple-touch-icon-precomposed"]',
          ];
          const linkEl = document.querySelector(selectors.join(','));
          return linkEl ? linkEl.href : null;
        }
      });
      const resolvedUrl = results?.[0]?.result;
      if (resolvedUrl) {
        faviconImg.addEventListener('error', () => {
          tryGoogleFaviconFallback(tab.id, faviconImg);
        }, { once: true });
        faviconImg.src = resolvedUrl;
        faviconImg.style.visibility = '';
        resolved = true;
      }
    } catch {
      // Tab may be restricted or discarded
    }

    // If page <link> resolution failed, try Google favicon service
    if (!resolved) {
      tryGoogleFaviconFallback(tab.id, faviconImg);
    }
  }
}

/**
 * Resolve favicon for a single tab by ID (used when an img fails to load).
 * Tries: 1) page's <link rel="icon">, 2) Google favicon service as fallback.
 */
async function resolveTabFaviconById(tabId, faviconImg) {
  const previousSrc = faviconImg.src;

  // Step 1: try to get real favicon from the page's <link> tags
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selectors = [
          'link[rel="icon"]',
          'link[rel="shortcut icon"]',
          'link[rel="apple-touch-icon"]',
          'link[rel="apple-touch-icon-precomposed"]',
        ];
        const linkEl = document.querySelector(selectors.join(','));
        return linkEl ? linkEl.href : null;
      }
    });
    const resolvedUrl = results?.[0]?.result;
    // Only try the resolved URL if it's different from what already failed
    if (resolvedUrl && resolvedUrl !== previousSrc && faviconImg) {
      faviconImg.addEventListener('error', () => {
        // Step 2: resolved URL also failed — fall back to Google favicon service
        tryGoogleFaviconFallback(tabId, faviconImg);
      }, { once: true });
      faviconImg.src = resolvedUrl;
      faviconImg.style.visibility = '';
      return;
    }
  } catch {
    // Tab may be restricted or discarded
  }

  // Step 2: fall back to Google favicon service
  tryGoogleFaviconFallback(tabId, faviconImg);
}

/**
 * Use Google's favicon service as the final fallback.
 */
async function tryGoogleFaviconFallback(tabId, faviconImg) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url) return;
    const origin = new URL(tab.url).origin;
    const googleFaviconUrl = `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(origin)}`;
    faviconImg.addEventListener('error', () => {
      faviconImg.style.visibility = 'hidden';
    }, { once: true });
    faviconImg.src = googleFaviconUrl;
    faviconImg.style.visibility = '';
  } catch {
    faviconImg.style.visibility = 'hidden';
  }
}

function toggleTabCheckboxVisual(tabItem) {
  const checkbox = tabItem.querySelector('.tab-checkbox input');
  const tabCheckbox = tabItem.querySelector('.tab-checkbox');
  if (!checkbox || !tabCheckbox) return;
  tabCheckbox.classList.toggle('checked', checkbox.checked);
}

function updateMultitabSelectAllState() {
  const selectAllBtn = document.getElementById('multitab-select-all');
  if (!selectAllBtn) return;
  const checkboxes = document.querySelectorAll('.tab-checkbox input');
  const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
  const totalCount = checkboxes.length;

  const textEl = selectAllBtn.querySelector('.select-all-text');

  selectAllBtn.classList.remove('checked', 'partial');
  const checkIcon = selectAllBtn.querySelector('.check-icon');

  if (checkedCount === totalCount && totalCount > 0) {
    selectAllBtn.classList.add('checked');
    if (checkIcon) checkIcon.classList.remove('hidden');
    if (textEl) textEl.textContent = `${checkedCount} selected`;
  } else if (checkedCount > 0) {
    selectAllBtn.classList.add('partial');
    if (checkIcon) checkIcon.classList.remove('hidden');
    if (textEl) textEl.textContent = `${checkedCount} selected`;
  } else {
    if (checkIcon) checkIcon.classList.add('hidden');
    if (textEl) textEl.textContent = 'Select all';
  }
}

function toggleMultitabSelectAll() {
  const checkboxes = document.querySelectorAll('.tab-checkbox input');
  const allChecked = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => { cb.checked = !allChecked; });
  document.querySelectorAll('.tab-item').forEach(item => toggleTabCheckboxVisual(item));
  updateMultitabSelectAllState();
}

async function startMultiTabExtract(tabIds) {
  let aborted = false;
  isMultiTabExtracting = true;

  showProgress('Extracting...', () => {
    aborted = true;
    isMultiTabExtracting = false;
    showToast('Extraction cancelled', 'info');
  });
  updateProgress(0, tabIds.length, 'Starting extraction...', 0);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'MULTI_TAB_EXTRACT',
      tabIds: tabIds
    });

    if (aborted) return;

    if (response && response.success && response.images) {
      const newImages = response.images.map(img => ({
        ...img,
        id: img.id || generateId(img.url),
        colors: null,
        phash: null
      }));

      newImages.forEach(newImg => {
        if (!allImages.find(img => img.url === newImg.url)) {
          allImages.push(newImg);
        }
      });

      currentGroupMode = 'tab';
      if (elements.groupMode) elements.groupMode.value = 'tab';
      document.querySelectorAll('[data-group-filter]').forEach(o => {
        o.classList.toggle('active', o.dataset.groupFilter === 'tab');
      });
      updateFilterButtonLabels();

      applyFilters();
      closeMultiTabModal();
      showToast(`Extracted ${newImages.length} images from ${response.tabCount || tabIds.length} tabs`, 'success');

      if (appSettings.enableSimilarDetection !== false || appSettings.enableColorExtraction !== false) {
        processImageExtras(newImages);
      }
    } else {
      showToast('Extraction failed: ' + (response?.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    if (!aborted) showToast('Multi-tab extraction failed', 'error');
  } finally {
    isMultiTabExtracting = false;
    hideProgress();
  }
}
