// ============================================
// Selection
// ============================================
// 选择、高亮、下载等操作模块

async function toggleSelection(imageId) {
  const img = allImages.find(i => i.id === imageId);

  if (selectedImages.has(imageId)) {
    selectedImages.delete(imageId);
    if (img) unhighlightImageOnPage(img.url);
  } else {
    selectedImages.add(imageId);
    // Free tier: only one image highlighted at a time
    if (!_isProUser && img) {
      // Remove all existing highlights first, then highlight only this one
      removeAllHighlightsOnPage();
      await highlightImageOnPage(img.url);
    } else if (img) {
      await highlightImageOnPage(img.url);
    }
  }

  updateCardSelectionState(imageId);
  updateSelectionUI();
}

function updateCardSelectionState(imageId) {
  const card = document.querySelector(`.image-card[data-id="${imageId}"]`);
  if (card) {
    const isSelected = selectedImages.has(imageId);
    card.classList.toggle('selected', isSelected);
    const cbLabel = card.querySelector('.card-checkbox');
    if (cbLabel) cbLabel.classList.toggle('checked', isSelected);
    const cb = card.querySelector('.card-checkbox input');
    if (cb) cb.checked = isSelected;
    const iconEl = card.querySelector('.checkbox-icon');
    if (iconEl) {
      iconEl.innerHTML = isSelected
        ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
        : '';
    }
  }
}

function selectAll() {
  filteredImages.forEach(img => selectedImages.add(img.id));
  renderImages();
  updateSelectionUI();
}

function clearSelection() {
  selectedImages.clear();
  removeAllHighlightsOnPage();
  renderImages();
  updateSelectionUI();
}

function updateSelectionUI() {
  const hasSelection = selectedImages.size > 0;
  const isAllSelected = filteredImages.length > 0 && filteredImages.every(img => selectedImages.has(img.id));

  // Found info is always visible
  if (elements.foundActionCount) {
    elements.foundActionCount.textContent = filteredImages.length;
  }

  // Download button label: show "Download All" when nothing selected, "Download (N)" when selected
  if (elements.downloadLabel) {
    if (hasSelection) {
      elements.downloadLabel.textContent = `Download (${selectedImages.size})`;
    } else {
      elements.downloadLabel.textContent = 'Download All';
    }
  }

  // Disable download buttons when no images available
  const noImages = filteredImages.length === 0;
  if (elements.btnDownload) {
    elements.btnDownload.disabled = noImages;
  }
  if (elements.btnDownloadToggle) {
    elements.btnDownloadToggle.disabled = noImages;
  }

  // Select all button: checkbox style with checked/partial states
  if (elements.btnSelectAll) {
    const textEl = elements.btnSelectAll.querySelector('.select-all-text');
    const checkIcon = elements.btnSelectAll.querySelector('.check-icon');

    if (isAllSelected) {
      elements.btnSelectAll.classList.add('checked');
      elements.btnSelectAll.classList.remove('partial');
      elements.btnSelectAll.title = 'Deselect all';
      if (textEl) textEl.textContent = 'Deselect all';
      if (checkIcon) checkIcon.classList.remove('hidden');
    } else if (hasSelection) {
      elements.btnSelectAll.classList.remove('checked');
      elements.btnSelectAll.classList.add('partial');
      elements.btnSelectAll.title = 'Click to select all';
      if (textEl) textEl.textContent = `${selectedImages.size} selected`;
      if (checkIcon) checkIcon.classList.remove('hidden');
    } else {
      elements.btnSelectAll.classList.remove('checked', 'partial');
      elements.btnSelectAll.title = 'Select all';
      if (textEl) textEl.textContent = 'Select all';
      if (checkIcon) checkIcon.classList.add('hidden');
    }
  }
}

// ============================================
// Page Highlight (multi-image support)
// ============================================

function safeSendMessageToTab(message) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || isRestrictedUrl(tab.url)) {
        resolve(null);
        return;
      }
      chrome.tabs.sendMessage(tab.id, message)
        .then(resolve)
        .catch(() => resolve(null));
    });
  });
}

async function highlightImageOnPage(imageUrl) {
  const response = await safeSendMessageToTab({ type: 'HIGHLIGHT_IMAGE', imageUrl });
  return response?.found ?? false;
}

function unhighlightImageOnPage(imageUrl) {
  safeSendMessageToTab({ type: 'UNHIGHLIGHT_IMAGE', imageUrl });
}

function syncHighlightsWithSelection() {
  const selectedUrls = [];
  for (const imgId of selectedImages) {
    const img = allImages.find(i => i.id === imgId);
    if (img) selectedUrls.push(img.url);
  }
  // Free tier: only highlight the first selected image
  if (!_isProUser) {
    safeSendMessageToTab({ type: 'HIGHLIGHT_IMAGES', imageUrls: selectedUrls.slice(0, 1) });
    return;
  }
  safeSendMessageToTab({ type: 'HIGHLIGHT_IMAGES', imageUrls: selectedUrls });
}

function removeAllHighlightsOnPage() {
  safeSendMessageToTab({ type: 'REMOVE_HIGHLIGHT' });
}

// ============================================
// Download Functions
// ============================================

/**
 * Get active page info (domain, title) from the real webpage tab,
 * not the extension's sidepanel/popup page.
 */
async function getActivePageInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const tabUrl = new URL(tab.url);
      if (tabUrl.protocol === 'http:' || tabUrl.protocol === 'https:') {
        return {
          domain: tabUrl.hostname,
          title: tab.title || 'untitled'
        };
      }
    }
  } catch (e) { /* ignore */ }
  return { domain: 'images', title: 'untitled' };
}

/**
 * Format a Date to compact timestamp string: YYYYMMDD-HHmmss
 */
function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function getOriginalFilename(img) {
  try {
    const urlPath = new URL(img.url).pathname;
    const name = urlPath.split('/').pop() || 'image';
    return name.includes('.') ? name : name + '.' + (img.format || 'png');
  } catch {
    return 'image.' + (img.format || 'png');
  }
}

async function downloadSingle(img, format) {
  // Pro check: format conversion requires Pro
  if (format && !_isProUser) {
    showToast('Format conversion is a Pro feature. Upgrade to unlock!', 'warning');
    showProUpgradeModal();
    return;
  }

  let downloadUrl = img.url;
  const pageInfo = await getActivePageInfo();
  let filename = appSettings.specifyDownload !== false ? generateFilename(img, 0, format, pageInfo) : getOriginalFilename(img);

  if (format && format !== img.format && typeof convertImageFormat === 'function') {
    try {
      const result = await convertImageFormat(img.url, format);
      downloadUrl = result.dataUrl;
      filename = filename.replace(/\.[^.]+$/, '.' + format);
    } catch (err) {
      console.error('Conversion failed:', err);
    }
  }

  try {
    await chrome.downloads.download({ url: downloadUrl, filename: filename, saveAs: false });
    showToast('Download started', 'success');
  } catch (error) {
    console.error('Download error:', error);
    showToast('Download failed', 'error');
  }
}

async function downloadSelectedAsZip(targetFormat) {
  const selected = filteredImages.filter(img => selectedImages.has(img.id));
  if (selected.length === 0) { showToast('No images selected', 'error'); return; }

  // Pro check: format conversion requires Pro
  if (targetFormat && !_isProUser) {
    showToast('Format conversion is a Pro feature. Upgrade to unlock!', 'warning');
    showProUpgradeModal();
    return;
  }

  // Free tier: limit ZIP to FREE_LIMITS.MAX_ZIP_IMAGES images
  if (!_isProUser && selected.length > FREE_LIMITS.MAX_ZIP_IMAGES) {
    showToast(`Free plan allows up to ${FREE_LIMITS.MAX_ZIP_IMAGES} images per ZIP. Upgrade to Pro for unlimited!`, 'warning');
    showProUpgradeModal();
    return;
  }

  if (selected.length > 100 && !appSettings.noManyFilesWarning) {
    const confirmed = await showConfirmDialog({
      title: 'Download Many Images',
      message: `You are about to download ${selected.length} images. Continue?`,
      confirmText: 'Download',
      cancelText: 'Cancel',
      type: 'info'
    });
    if (!confirmed) return;
  }

  let aborted = false;

  showProgress('Downloading...', () => {
    aborted = true;
    showToast('Download cancelled', 'info');
  });

  try {
    const zip = new JSZip();
    const pageInfo = await getActivePageInfo();
    const now = new Date();
    const ts = formatTimestamp(now);

    // Resolve subfolder template variables
    const rawSubfolder = appSettings.subfolder || '';
    const subfolder = rawSubfolder
      .replace('{domain}', pageInfo.domain)
      .replace('{date}', now.toISOString().slice(0, 10))
      .replace('{title}', pageInfo.title.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 50));
    const folder = subfolder ? zip.folder(subfolder) : zip;
    const failed = [];

    for (let i = 0; i < selected.length; i++) {
      if (aborted) return;

      const img = selected[i];
      updateProgress(i + 1, selected.length, truncateUrl(img.url, 50));

      try {
        let blob;
        if (targetFormat && targetFormat !== img.format && typeof convertImageFormat === 'function') {
          const result = await convertImageFormat(img.url, targetFormat);
          blob = await fetch(result.dataUrl).then(r => r.blob());
        } else {
          const resp = await fetch(img.url, { mode: 'cors' });
          if (!resp.ok) throw new Error('Fetch failed');
          blob = await resp.blob();
        }

        const filename = generateFilename(img, i, targetFormat, pageInfo);
        folder.file(filename, blob);
      } catch (err) {
        failed.push(img.url);
      }
    }

    if (aborted) return;

    if (failed.length > 0) {
      zip.file('_failed.txt', 'Failed to download:\n' + failed.join('\n'));
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const blobUrl = URL.createObjectURL(content);

    await chrome.downloads.download({
      url: blobUrl,
      filename: `${pageInfo.domain}-${ts}.zip`,
      saveAs: false
    });

    URL.revokeObjectURL(blobUrl);
    showToast(`Downloaded ${selected.length - failed.length} images`, 'success');
    clearSelection();
  } catch (error) {
    if (!aborted) {
      console.error('ZIP download error:', error);
      showToast('Download failed: ' + error.message, 'error');
    }
  } finally {
    hideProgress();
  }
}

function toggleDownloadDropdown() {
  if (!elements.downloadDropdown) return;
  const wasHidden = elements.downloadDropdown.classList.contains('hidden');
  elements.downloadDropdown.classList.toggle('hidden');

  // Auto-adjust horizontal position when showing
  if (wasHidden && !elements.downloadDropdown.classList.contains('hidden')) {
    const dropdown = elements.downloadDropdown;
    const viewportWidth = document.documentElement.clientWidth;

    // Reset position to measure
    dropdown.style.left = 'auto';
    dropdown.style.right = '0';

    const dropdownRect = dropdown.getBoundingClientRect();

    // Check if overflows left side of viewport
    if (dropdownRect.left < 4) {
      // Switch to left-aligned
      dropdown.style.right = 'auto';
      dropdown.style.left = '0';

      // Re-check if it now overflows right
      const newRect = dropdown.getBoundingClientRect();
      if (newRect.right > viewportWidth - 4) {
        // Constrain to viewport with padding
        const parentRect = dropdown.parentElement.getBoundingClientRect();
        dropdown.style.left = (4 - parentRect.left) + 'px';
        dropdown.style.right = 'auto';
      }
    }
    // Check if overflows right side of viewport
    else if (dropdownRect.right > viewportWidth - 4) {
      const parentRect = dropdown.parentElement.getBoundingClientRect();
      const rightOffset = parentRect.right - (viewportWidth - 4);
      dropdown.style.right = -rightOffset + 'px';
    }
  }
}

function showDownloadDropdown() {
  if (elements.downloadDropdown) elements.downloadDropdown.classList.remove('hidden');
}

function hideDownloadDropdown() {
  if (elements.downloadDropdown) elements.downloadDropdown.classList.add('hidden');
}

// ============================================
// Copy URL
// ============================================
async function copyImageUrl(url) {
  try {
    await navigator.clipboard.writeText(url);
    showToast('URL copied!', 'success');
  } catch (error) {
    showToast('Failed to copy URL', 'error');
  }
}

// ============================================
// Drag & Drop
// ============================================
function setupDragAndDrop(element, img) {
  element.setAttribute('draggable', 'true');
  element.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/uri-list', img.url);
    e.dataTransfer.setData('text/plain', img.url);
    e.dataTransfer.effectAllowed = 'copy';
  });
}

// ============================================
// Open in New Tab
// ============================================
async function openInNewTab(url) {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const createOptions = { url, active: true };
    if (activeTab) {
      createOptions.index = activeTab.index + 1;
    }
    chrome.tabs.create(createOptions);
  } catch {
    chrome.tabs.create({ url, active: true });
  }
}

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