// ============================================
// Utility Functions
// ============================================
// 工具函数模块：提供各种通用工具函数和设置存储功能

import { DEFAULT_FILTER_CONFIG } from '../shared/constants';
import { applyNamingTemplate } from '../shared/naming';
import type { FilterConfig, ImageItem } from '../shared/types';
import { state } from './state';

interface ImageMeta {
  size: number | null;
  contentType: string;
}

interface PageInfo {
  domain?: string;
  title?: string;
}

export async function fetchImageMeta(url: string): Promise<ImageMeta> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type') || '';
    return {
      size: contentLength ? parseInt(contentLength, 10) : null,
      contentType,
    };
  } catch {
    // HEAD request failed or timed out, skip
  }
  return { size: null, contentType: '' };
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function getAspectRatioCategory(w: number, h: number): string | null {
  if (!w || !h) return null;
  const ratio = w / h;
  if (ratio >= 0.9 && ratio <= 1.1) return 'square';
  if (ratio > 1.1 && ratio <= 2.5) return 'landscape';
  if (ratio >= 0.4 && ratio < 0.9) return 'portrait';
  if (ratio > 2.5) return 'panorama';
  return null;
}

export function getSizeCategory(w: number | undefined, h: number | undefined): string {
  if (!w || !h) return 'Unknown';
  const maxDim = Math.max(w, h);
  if (maxDim < 100) return 'Small (< 100px)';
  if (maxDim < 500) return 'Medium (100-500px)';
  if (maxDim < 1000) return 'Large (500-1000px)';
  return 'XL (> 1000px)';
}

export function truncateUrl(url: string, maxLen: number): string {
  if (!url) return '';
  if (url.length <= maxLen) return url;
  try {
    const u = new URL(url);
    const path = u.pathname;
    const remaining = maxLen - u.hostname.length - 3;
    if (remaining > 0) return u.hostname + path.substring(0, remaining) + '...';
  } catch {
    /* ignore */
  }
  return url.substring(0, maxLen) + '...';
}

export function generateId(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return 'img_' + Math.abs(hash).toString(36) + '_' + Date.now().toString(36);
}

export function generateFilename(
  img: ImageItem,
  index: number,
  format: string | null | undefined,
  pageInfo: PageInfo
): string {
  // Free tier: force default naming template
  const defaultTemplate = 'img_{index}_{original}.{format}';
  const template = state.isProUser
    ? (state.appSettings.filenameTemplate as string | undefined) || defaultTemplate
    : defaultTemplate;
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
      timestamp: String(Date.now()),
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

export function getFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split('/');
    const last = parts[parts.length - 1] || 'image';
    return (
      last
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .substring(0, 50) || 'image'
    );
  } catch {
    return 'image';
  }
}

export function getExtFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return function (this: unknown, ...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

export function throttle<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return function (this: unknown, ...args: Parameters<T>) {
    const now = Date.now();
    const remaining = wait - (now - lastCall);
    if (remaining <= 0) {
      lastCall = now;
      func.apply(this, args);
    } else {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        func.apply(this, args);
      }, remaining);
    }
  };
}

// ============================================
// Settings Storage
// ============================================
export async function loadSettings(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(['appSettings', 'filterConfig']);
    if (result.appSettings) {
      state.appSettings = {
        ...state.appSettings,
        ...(result.appSettings as Record<string, unknown>),
      };
    }
    if (result.filterConfig) {
      state.filterConfig = {
        ...DEFAULT_FILTER_CONFIG,
        ...(result.filterConfig as Record<string, unknown>),
      } as FilterConfig;
    } else {
      state.filterConfig = { ...DEFAULT_FILTER_CONFIG } as FilterConfig;
    }
  } catch (error) {
    console.error('Load settings error:', error);
    state.filterConfig = { ...DEFAULT_FILTER_CONFIG } as FilterConfig;
  }
}
