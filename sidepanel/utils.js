// ============================================
// Utility Functions
// ============================================
// 工具函数模块：提供各种通用工具函数和设置存储功能

async function fetchImageMeta(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type') || '';
    return {
      size: contentLength ? parseInt(contentLength, 10) : null,
      contentType
    };
  } catch {
    // HEAD request failed or timed out, skip
  }
  return { size: null, contentType: '' };
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getAspectRatioCategory(w, h) {
  if (!w || !h) return null;
  const ratio = w / h;
  if (ratio >= 0.9 && ratio <= 1.1) return 'square';
  if (ratio > 1.1 && ratio <= 2.5) return 'landscape';
  if (ratio >= 0.4 && ratio < 0.9) return 'portrait';
  if (ratio > 2.5) return 'panorama';
  return null;
}

function getSizeCategory(w, h) {
  if (!w || !h) return 'Unknown';
  const maxDim = Math.max(w, h);
  if (maxDim < 100) return 'Small (< 100px)';
  if (maxDim < 500) return 'Medium (100-500px)';
  if (maxDim < 1000) return 'Large (500-1000px)';
  return 'XL (> 1000px)';
}

function truncateUrl(url, maxLen) {
  if (!url) return '';
  if (url.length <= maxLen) return url;
  try {
    const u = new URL(url);
    const path = u.pathname;
    const remaining = maxLen - u.hostname.length - 3;
    if (remaining > 0) return u.hostname + path.substring(0, remaining) + '...';
  } catch (e) { /* ignore */ }
  return url.substring(0, maxLen) + '...';
}

function generateId(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return 'img_' + Math.abs(hash).toString(36) + '_' + Date.now().toString(36);
}

function generateFilename(img, index, format, pageInfo) {
  // Free tier: force default naming template
  const defaultTemplate = 'img_{index}_{original}.{format}';
  const template = _isProUser ? (appSettings.filenameTemplate || defaultTemplate) : defaultTemplate;
  const originalName = getFilenameFromUrl(img.url || '');
  const ext = format || img.format || getExtFromUrl(img.url || '') || 'png';
  const w = img.naturalWidth || img.displayWidth || 0;
  const h = img.naturalHeight || img.displayHeight || 0;
  const domain = (pageInfo && pageInfo.domain) || 'unknown';
  const title = (pageInfo && pageInfo.title) || 'untitled';

  if (typeof applyNamingTemplate === 'function') {
    return applyNamingTemplate(template, {
      index: String(index + 1).padStart(3, '0'),
      number: String(index + 1),
      original: originalName,
      title: title,
      domain: domain,
      width: String(w),
      height: String(h),
      format: ext,
      date: new Date().toISOString().slice(0, 10),
      timestamp: String(Date.now())
    });
  }

  return template
    .replace('{index}', String(index + 1).padStart(3, '0'))
    .replace('{number}', String(index + 1))
    .replace('{original}', originalName)
    .replace('{title}', title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50))
    .replace('{domain}', domain)
    .replace('{width}', String(w))
    .replace('{height}', String(h))
    .replace('{format}', ext)
    .replace('{date}', new Date().toISOString().slice(0, 10))
    .replace('{timestamp}', String(Date.now()));
}

function getFilenameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split('/');
    const last = parts[parts.length - 1] || 'image';
    return last.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50) || 'image';
  } catch (e) {
    return 'image';
  }
}

function getExtFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
    return match ? match[1].toLowerCase() : null;
  } catch (e) {
    return null;
  }
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// ============================================
// Settings Storage
// ============================================
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(['appSettings', 'filterConfig']);
    if (result.appSettings) appSettings = { ...appSettings, ...result.appSettings };
    if (result.filterConfig) filterConfig = { ...DEFAULT_FILTER_CONFIG, ...result.filterConfig };
    else filterConfig = { ...DEFAULT_FILTER_CONFIG };
  } catch (error) {
    console.error('Load settings error:', error);
    filterConfig = { ...DEFAULT_FILTER_CONFIG };
  }
}