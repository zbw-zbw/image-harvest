// ============================================
// Filtering & Sorting
// ============================================
// 过滤和排序模块：提供图片过滤、排序、颜色过滤等功能

function applyFilters() {
  filteredImages = allImages.filter(img => {
    return filterBySize(img) && filterByType(img) && filterByLayout(img) && filterByUrl(img)
      && filterByColor(img) && filterBySettingsMinSize(img) && filterBySettingsMaxSize(img);
  });

  sortImages();

  // Skip DOM re-render if the filtered image list is identical to the last render.
  // This avoids unnecessary innerHTML rebuilds that cause image flicker (grey
  // placeholder → real image) when switching between cached tabs.
  const currentFilteredIds = filteredImages.map(img => img.id).join(',');
  if (currentFilteredIds === lastRenderedFilteredIds) {
    // Still update selection UI in case selection state changed
    updateSelectionUI();
    return;
  }
  lastRenderedFilteredIds = currentFilteredIds;

  renderImages();
  updateSelectionUI();
}

function sortImages() {
  filteredImages.sort((a, b) => {
    const aW = a.naturalWidth || a.displayWidth || 0;
    const aH = a.naturalHeight || a.displayHeight || 0;
    const bW = b.naturalWidth || b.displayWidth || 0;
    const bH = b.naturalHeight || b.displayHeight || 0;
    const aPixels = aW * aH;
    const bPixels = bW * bH;

    switch (currentSortMode) {
      case 'size-asc': return aPixels - bPixels;
      case 'filesize-desc': return (b.estimatedSize || 0) - (a.estimatedSize || 0);
      case 'filesize-asc': return (a.estimatedSize || 0) - (b.estimatedSize || 0);
      case 'type': return (a.format || '').localeCompare(b.format || '');
      case 'natural': return 0;
      case 'size-desc':
      default: return bPixels - aPixels;
    }
  });
}

function filterBySize(img) {
  if (activeFilters.size === 'all') return true;
  const w = img.naturalWidth || img.displayWidth || 0;
  const h = img.naturalHeight || img.displayHeight || 0;
  const maxDim = Math.max(w, h);
  return maxDim >= activeFilters.sizeMin && maxDim <= activeFilters.sizeMax;
}

function filterByType(img) {
  if (activeFilters.types.length === 0) return true;
  return activeFilters.types.includes((img.format || 'unknown').toLowerCase());
}

function filterByLayout(img) {
  if (activeFilters.layout === 'all') return true;
  const w = img.naturalWidth || img.displayWidth || 0;
  const h = img.naturalHeight || img.displayHeight || 0;
  if (!w || !h) return true;
  return getAspectRatioCategory(w, h) === activeFilters.layout;
}

function filterByUrl(img) {
  if (!activeFilters.urlKeyword) return true;
  return (img.url || '').toLowerCase().includes(activeFilters.urlKeyword);
}

function filterByColor(img) {
  if (!activeFilters.color) return true;
  if (!img.colors || img.colors.length === 0) return false;
  // Check if any of the image's colors is close to the selected color
  return img.colors.some(c => colorDistance(c, activeFilters.color) < 60);
}

function colorDistance(hex1, hex2) {
  const r1 = parseInt(hex1.slice(1, 3), 16), g1 = parseInt(hex1.slice(3, 5), 16), b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16), g2 = parseInt(hex2.slice(3, 5), 16), b2 = parseInt(hex2.slice(5, 7), 16);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function renderColorSwatches() {
  const container = document.getElementById('color-swatches');
  if (!container) return;

  // Collect all unique colors from images
  const colorMap = new Map();
  allImages.forEach(img => {
    if (img.colors && img.colors.length > 0) {
      img.colors.forEach(c => {
        const hex = c.toLowerCase();
        colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
      });
    }
  });

  // Sort by frequency (matching image list color order) and take top colors
  const sortedColors = [...colorMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([hex]) => hex);

  if (sortedColors.length === 0) {
    container.innerHTML = '<p style="font-size:11px;color:var(--text-tertiary);padding:4px 0;">No colors extracted yet</p>';
    return;
  }

  container.innerHTML = sortedColors.map(hex =>
    `<div class="color-swatch${activeFilters.color === hex ? ' active' : ''}" style="background:${hex}" data-color-value="${hex}" title="${hex}"></div>`
  ).join('');

  // Bind click events
  container.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_isProUser) {
        showToast('Color filtering is a Pro feature. Upgrade to filter by color!', 'warning');
        showProUpgradeModal();
        return;
      }
      const color = swatch.dataset.colorValue;
      if (activeFilters.color === color) {
        // Deselect
        activeFilters.color = null;
        swatch.classList.remove('active');
      } else {
        activeFilters.color = color;
        container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
      }
      // Update "All Colors" option state
      const allOption = document.querySelector('[data-color-filter="all"]');
      if (allOption) allOption.classList.toggle('active', !activeFilters.color);
      updateFilterButtonLabels();
      applyFilters();
      closeAllFilterDropdowns();
    });
  });
}

function filterBySettingsMinSize(img) {
  if (!appSettings.enableMinSize) return true;
  const w = img.naturalWidth || img.displayWidth || 0;
  const h = img.naturalHeight || img.displayHeight || 0;
  return w >= (appSettings.minWidth || 0) && h >= (appSettings.minHeight || 0);
}

function filterBySettingsMaxSize(img) {
  if (!appSettings.enableMaxSize) return true;
  const w = img.naturalWidth || img.displayWidth || 0;
  const h = img.naturalHeight || img.displayHeight || 0;
  return w <= (appSettings.maxWidth || Infinity) && h <= (appSettings.maxHeight || Infinity);
}

// Custom size inputs helpers
function clearCustomSizeInputs() {
  ['filter-min-width', 'filter-min-height', 'filter-max-width', 'filter-max-height'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
}

function applyCustomSizeInputs() {
  const minW = parseInt(document.getElementById('filter-min-width')?.value) || 0;
  const minH = parseInt(document.getElementById('filter-min-height')?.value) || 0;
  const maxW = parseInt(document.getElementById('filter-max-width')?.value) || 0;
  const maxH = parseInt(document.getElementById('filter-max-height')?.value) || 0;

  const hasMin = minW > 0 || minH > 0;
  const hasMax = maxW > 0 || maxH > 0;

  appSettings.enableMinSize = hasMin;
  appSettings.minWidth = minW || 0;
  appSettings.minHeight = minH || 0;
  appSettings.enableMaxSize = hasMax;
  appSettings.maxWidth = maxW || Infinity;
  appSettings.maxHeight = maxH || Infinity;

  // Deselect preset options when custom values are entered
  if (hasMin || hasMax) {
    activeFilters.size = 'all';
    activeFilters.sizeMin = 0;
    activeFilters.sizeMax = Infinity;
    document.querySelectorAll('[data-size-filter]').forEach(o => o.classList.remove('active'));
  }

  updateFilterButtonLabels();
  applyFilters();

  // Persist to storage
  chrome.storage.local.set({ appSettings }).catch(() => {});
}

function syncCustomSizeInputsFromSettings() {
  const minWInput = document.getElementById('filter-min-width');
  const minHInput = document.getElementById('filter-min-height');
  const maxWInput = document.getElementById('filter-max-width');
  const maxHInput = document.getElementById('filter-max-height');

  if (appSettings.enableMinSize) {
    if (minWInput && appSettings.minWidth) minWInput.value = appSettings.minWidth;
    if (minHInput && appSettings.minHeight) minHInput.value = appSettings.minHeight;
  }
  if (appSettings.enableMaxSize) {
    if (maxWInput && appSettings.maxWidth && appSettings.maxWidth < Infinity) maxWInput.value = appSettings.maxWidth;
    if (maxHInput && appSettings.maxHeight && appSettings.maxHeight < Infinity) maxHInput.value = appSettings.maxHeight;
  }
}