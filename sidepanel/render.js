// ============================================
// Rendering
// ============================================
// 渲染模块：提供图片卡片渲染、分组渲染等功能

/**
 * Render real image cards followed by remaining skeleton placeholders.
 * Called during scanning to progressively replace skeletons with real images.
 */
function renderProgressiveImages() {
  if (!elements.imageGrid) return;

  // Apply filters and sort (reuses the same logic as applyFilters)
  filteredImages = allImages.filter(img => {
    return filterBySize(img) && filterByType(img) && filterByLayout(img) && filterByUrl(img)
      && filterByColor(img) && filterBySettingsMinSize(img) && filterBySettingsMaxSize(img);
  });
  sortImages();

  const realCards = filteredImages.map((img, i) => renderImageCard(img, i)).join('');

  // Calculate how many skeletons to keep (fill remaining space)
  const isListView = elements.imageGrid.classList.contains('list-view');
  const gridWrapper = document.querySelector('.image-grid-wrapper');
  const containerHeight = gridWrapper?.clientHeight || 600;
  const totalSlots = calcSkeletonCount(containerHeight, isListView);
  const remainingSkeletons = Math.max(0, totalSlots - filteredImages.length);

  elements.imageGrid.innerHTML = realCards + Array(remainingSkeletons).fill(buildSkeletonCard()).join('');
  elements.imageGrid.classList.remove('hidden');
  if (elements.emptyState) elements.emptyState.classList.add('hidden');

  // Scroll to top so the user always sees images from the beginning
  elements.imageGrid.scrollTop = 0;

  bindCardEvents();
  checkNarrowMode();

  // Update counts
  if (elements.foundCount) {
    elements.foundCount.textContent = filteredImages.length;
  }
  if (elements.foundActionCount) {
    elements.foundActionCount.textContent = filteredImages.length;
  }
  updateSelectionUI();
}

function renderImages() {
  if (!elements.imageGrid) return;

  if (filteredImages.length === 0) {
    elements.imageGrid.innerHTML = '';
    // Don't show empty state while scan overlay is active (still scanning/analyzing)
    if (!elements.scanOverlay || elements.scanOverlay.classList.contains('hidden')) {
      elements.imageGrid.classList.add('hidden');
      showEmpty(allImages.length > 0);
    }
    return;
  }

  // Ensure the grid wrapper is visible (showEmpty hides it to let the
  // empty-state placeholder take full flex space for vertical centering)
  const gridWrapper = document.querySelector('.image-grid-wrapper');
  if (gridWrapper) gridWrapper.classList.remove('hidden');

  elements.imageGrid.classList.remove('hidden');
  if (elements.emptyState) elements.emptyState.classList.add('hidden');

  if (currentGroupMode !== 'none') {
    const groups = groupImages(filteredImages, currentGroupMode);
    renderGroupedImages(groups);
  } else {
    elements.imageGrid.innerHTML = filteredImages.map((img, i) => renderImageCard(img, i)).join('');
  }

  // Always scroll to top on re-render so the user sees images from the beginning
  elements.imageGrid.scrollTop = 0;

  bindCardEvents();

  // Re-check narrow mode after grid becomes visible (important for popup mode
  // where initial check may see clientWidth=0 when grid was hidden)
  checkNarrowMode();

  // Update counts
  if (elements.foundCount) {
    elements.foundCount.textContent = filteredImages.length;
  }
  if (elements.foundActionCount) {
    elements.foundActionCount.textContent = filteredImages.length;
  }
  updateSelectionUI();
}

function renderImageCard(img, index) {
  const w = img.naturalWidth || img.displayWidth || 0;
  const h = img.naturalHeight || img.displayHeight || 0;
  const dims = (w && h) ? `${w}×${h}` : '';
  const size = img.estimatedSize ? formatBytes(img.estimatedSize) : '';
  const format = (img.format || 'unknown').toUpperCase();
  const isSelected = selectedImages.has(img.id);
  const colorExtractionEnabled = appSettings.enableColorExtraction !== false;
  const colorBar = colorExtractionEnabled
    ? ((img.colors && img.colors.length > 0) ? renderColorBar(img.colors) : renderTransparentBar())
    : '';

  return `
    <div class="image-card${isSelected ? ' selected' : ''}" data-id="${img.id}" data-index="${index}">
      <div class="card-header">
        <label class="card-checkbox${isSelected ? ' checked' : ''}" data-id="${img.id}">
          <input type="checkbox" ${isSelected ? 'checked' : ''} data-id="${img.id}">
          <span class="checkbox-icon">
            ${isSelected
              ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
              : ''}
          </span>
        </label>
      </div>
      <div class="card-thumb checkerboard">
        <img src="${img.url}" alt="" loading="lazy">
      </div>
      ${colorBar}
      <div class="card-info-bar">
        <div class="card-tags">
          <span class="card-tag format">${format}</span>
          ${dims ? `<span class="card-tag dims">${dims}</span>` : ''}
          ${size ? `<span class="card-tag filesize">${size}</span>` : ''}
        </div>
        <div class="card-actions">
          <button class="card-action-btn btn-search" title="Reverse search" data-url="${img.url}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          <button class="card-action-btn btn-dl" title="Download" data-id="${img.id}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <span class="icon-btn-wrapper">
            <button class="card-action-btn btn-favorite" title="Add to collection" data-id="${img.id}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </button>
            <span class="pro-badge pro-badge-mini">PRO</span>
          </span>
          <span class="icon-btn-wrapper">
            <button class="card-action-btn btn-delete" title="Remove image" data-id="${img.id}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            <span class="pro-badge pro-badge-mini">PRO</span>
          </span>
        </div>
      </div>
      <div class="card-url-row">
        <div class="card-url" title="${img.url}">${img.url}</div>
        <div class="card-url-actions">
          <button class="card-action-btn btn-copy-url" title="Copy URL" data-url="${img.url}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="card-action-btn btn-open" title="Open in new tab" data-url="${img.url}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}

function renderGroupedImages(groups) {
  elements.imageGrid.innerHTML = groups.map(group => {
    const isCollapsed = collapsedGroups.has(group.name);
    const currentBadge = (currentGroupMode === 'tab' && group.isCurrentTab)
      ? '<span class="tab-current-badge">Current</span>'
      : '';
    return `
      <div class="image-group">
        <div class="group-header${isCollapsed ? ' collapsed' : ''}" data-group="${group.name}">
          <span class="group-arrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
          <span class="group-name">${group.name}${currentBadge}</span>
          <span class="group-count">${group.images.length}</span>
        </div>
        <div class="group-content${isCollapsed ? ' collapsed' : ''}${currentViewMode === 'grid' ? '' : ' list-view'}">
          ${group.images.map((img, i) => renderImageCard(img, i)).join('')}
        </div>
      </div>`;
  }).join('');

  document.querySelectorAll('.group-header').forEach(header => {
    header.addEventListener('click', () => toggleGroupCollapse(header.dataset.group));
  });
}

function bindCardEvents() {
  document.querySelectorAll('.image-card').forEach(card => {
    const imgId = card.dataset.id;
    const img = allImages.find(i => i.id === imgId);
    if (!img) return;

    // Checkbox – stop propagation on the label to prevent card click
    const cbLabel = card.querySelector('.card-checkbox');
    if (cbLabel) {
      cbLabel.addEventListener('click', (e) => e.stopPropagation());
    }
    const cb = card.querySelector('.card-checkbox input');
    if (cb) {
      cb.addEventListener('change', () => toggleSelection(imgId));
    }

    // Image load transition & broken image handling
    const thumbImg = card.querySelector('.card-thumb img');
    if (thumbImg) {
      thumbImg.addEventListener('load', () => {
        thumbImg.classList.add('loaded');
        thumbImg.parentElement.classList.add('loaded');
      });
      thumbImg.addEventListener('error', () => {
        thumbImg.style.display = 'none';
        thumbImg.parentElement.classList.add('loaded');
      });
      // Handle already-cached images (load event may not fire).
      // Use requestAnimationFrame to give the browser a paint cycle to
      // resolve cached resources before checking .complete.
      if (thumbImg.complete && thumbImg.naturalWidth > 0) {
        thumbImg.classList.add('loaded');
        thumbImg.parentElement.classList.add('loaded');
      } else {
        requestAnimationFrame(() => {
          if (thumbImg.complete && thumbImg.naturalWidth > 0) {
            thumbImg.classList.add('loaded');
            thumbImg.parentElement.classList.add('loaded');
          }
        });
      }
    }

    // Drag on thumbnail
    const thumb = card.querySelector('.card-thumb');
    if (thumb) {
      setupDragAndDrop(thumb, img);
    }

    // Overlay action buttons
    card.querySelector('.btn-open')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openInNewTab(img.url);
    });
    card.querySelector('.btn-copy-url')?.addEventListener('click', (e) => {
      e.stopPropagation();
      copyImageUrl(img.url);
    });
    card.querySelector('.btn-dl')?.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadSingle(img, null);
    });
    card.querySelector('.btn-delete')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = await showConfirmDialog({
        title: 'Remove Image',
        message: 'Are you sure you want to remove this image from the list?',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        type: 'danger'
      });
      if (!confirmed) return;
      removeImageById(imgId);
    });
    card.querySelector('.btn-search')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showReverseSearchMenu(img.url, e.currentTarget);
    });
    const favoriteBtn = card.querySelector('.btn-favorite');
    if (favoriteBtn) {
      favoriteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!_isProUser) {
          showToast('Collection is a Pro feature', 'warning');
          showProUpgradeModal();
          return;
        }
        const btn = e.currentTarget;
        const isCollected = btn.classList.contains('favorited');
        if (isCollected) {
          await removeFromCollection(img.id);
          btn.classList.remove('favorited');
          btn.title = 'Add to collection';
        } else {
          await addToCollection(img);
          btn.classList.add('favorited');
          btn.title = 'Remove from collection';
        }
      });
      // Initialize favorite state
      isImageInCollection(img.url).then(inCollection => {
        if (inCollection) {
          favoriteBtn.classList.add('favorited');
          favoriteBtn.title = 'Remove from collection';
        }
      });
    }

    // Color bar swatch click → copy HEX value (skip transparent bars)
    card.querySelectorAll('.card-color-bar').forEach(swatch => {
      if (swatch.dataset.transparent) return;
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!_isProUser) {
          showToast('Color copy is a Pro feature', 'warning');
          showProUpgradeModal();
          return;
        }
        copyColor(swatch.dataset.color);
      });
    });

    // Card click → toggle selection (highlight is handled inside toggleSelection)
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-action-btn') || e.target.closest('.card-checkbox')) return;
      toggleSelection(imgId);
    });
  });
}

// ============================================
// Grouping
// ============================================
function groupImages(images, mode) {
  const groups = new Map();

  images.forEach(img => {
    let key = 'Other';
    switch (mode) {
      case 'domain':
        try {
          const parsedUrl = new URL(img.url);
          key = parsedUrl.hostname || 'Other';
          // data: URLs and blob: URLs have no meaningful hostname
          if (!key || key === '' || parsedUrl.protocol === 'data:' || parsedUrl.protocol === 'blob:') {
            key = 'Other';
          }
        } catch { key = 'Other'; }
        break;
      case 'format':
        key = (img.format || 'unknown').toUpperCase();
        break;
      case 'size':
        key = getSizeCategory(img.naturalWidth || img.displayWidth, img.naturalHeight || img.displayHeight);
        break;
      case 'tab':
        key = img.tabTitle || img.sourceTabTitle || 'Current Tab';
        break;
    }
    if (!groups.has(key)) {
      groups.set(key, { images: [], tabIndex: img.tabIndex ?? Infinity, isCurrentTab: !!img.isCurrentTab });
    }
    groups.get(key).images.push(img);
  });

  const result = Array.from(groups.entries())
    .map(([name, data]) => ({ name, images: data.images, tabIndex: data.tabIndex, isCurrentTab: data.isCurrentTab }));

  if (mode === 'tab') {
    return result.sort((a, b) => a.tabIndex - b.tabIndex);
  }
  // Sort by image count descending, but always put "Other" / "Unknown" at the end
  return result.sort((a, b) => {
    const aIsOther = a.name === 'Other' || a.name === 'Unknown';
    const bIsOther = b.name === 'Other' || b.name === 'Unknown';
    if (aIsOther && !bIsOther) return 1;
    if (!aIsOther && bIsOther) return -1;
    return b.images.length - a.images.length;
  });
}

function toggleGroupCollapse(groupName) {
  if (collapsedGroups.has(groupName)) {
    collapsedGroups.delete(groupName);
  } else {
    collapsedGroups.add(groupName);
  }
  renderImages();
}