// Unit tests for the pure helpers in shared/converter.
// Conversion functions themselves require Canvas + Image and are not unit-tested.

import { describe, it, expect } from 'vitest';
import { getMimeType, canConvert } from '../shared/converter';

describe('getMimeType', () => {
  it('maps known formats to MIME types', () => {
    expect(getMimeType('jpg')).toBe('image/jpeg');
    expect(getMimeType('jpeg')).toBe('image/jpeg');
    expect(getMimeType('png')).toBe('image/png');
    expect(getMimeType('webp')).toBe('image/webp');
  });

  it('is case-insensitive', () => {
    expect(getMimeType('PNG')).toBe('image/png');
    expect(getMimeType('WebP')).toBe('image/webp');
  });

  it('falls back to image/png for unknown formats', () => {
    expect(getMimeType('gif')).toBe('image/png');
    expect(getMimeType('xyz')).toBe('image/png');
  });
});

describe('canConvert', () => {
  it('accepts the canonical convertible formats', () => {
    for (const fmt of ['png', 'jpg', 'jpeg', 'webp']) {
      expect(canConvert(fmt)).toBe(true);
      expect(canConvert(fmt.toUpperCase())).toBe(true);
    }
  });

  it('rejects non-convertible formats', () => {
    expect(canConvert('gif')).toBe(false);
    expect(canConvert('svg')).toBe(false);
    expect(canConvert('')).toBe(false);
  });
});
