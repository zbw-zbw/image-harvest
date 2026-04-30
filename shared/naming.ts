// Filename template engine.
import type { NamingVariableInput, NamingVariables } from './types';

/** Pull the original (extension-less) filename out of a URL. */
export function getOriginalName(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();
    if (!filename) return 'image';
    const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
    return nameWithoutExt || 'image';
  } catch {
    return 'image';
  }
}

/** Strip path-unsafe characters and clamp length. */
export function sanitizeFilename(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return 'image';

  let cleaned = name;
  cleaned = cleaned.replace(/[/\\:*?"<>|]/g, '_');
  cleaned = cleaned.trim();
  cleaned = cleaned.replace(/^\.+|\.+$/g, '');

  if (cleaned.length > 200) {
    cleaned = cleaned.substring(0, 200);
  }

  return cleaned || 'image';
}

/** Build the variables map consumed by `applyNamingTemplate`. */
export function buildVariables(options: NamingVariableInput): NamingVariables {
  const {
    url = '',
    index = 0,
    pageTitle = '',
    pageDomain = '',
    width = 0,
    height = 0,
    format = '',
    date = '',
    timestamp = 0
  } = options;

  const originalName = getOriginalName(url);

  return {
    index: String(index),
    original: sanitizeFilename(originalName),
    pageTitle: sanitizeFilename(pageTitle),
    pageDomain: pageDomain.replace(/^[^.]+\./, ''),
    width: String(width),
    height: String(height),
    format: format || 'png',
    date,
    timestamp: String(timestamp),
    year: date ? date.substring(0, 4) : '',
    month: date ? date.substring(5, 7) : '',
    day: date ? date.substring(8, 10) : ''
  };
}

/**
 * Substitute `{var}` placeholders in `template` using `variables`. Always
 * returns a value with an extension (defaults to `.png`).
 */
export function applyNamingTemplate(template: string, variables: NamingVariables): string {
  if (!template || typeof template !== 'string') return 'image.png';

  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{${key}}`;
    const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g');
    result = result.replace(regex, String(value || ''));
  }

  result = sanitizeFilename(result);

  if (!result) return 'image.png';
  if (!result.includes('.')) result += '.png';
  return result;
}
