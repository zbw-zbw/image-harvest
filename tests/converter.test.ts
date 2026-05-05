// Unit tests for the pure helpers in shared/converter.
// The Canvas/Image-dependent main loop of convertImageFormat /
// convertBlobFormat is not unit-tested, but their synchronous front
// guard (the `if (!canConvert(targetFormat)) reject(...)` at the top
// of each function) IS pure JS and worth pinning — it's the contract
// every caller relies on to bail out early before touching <img>.
import { describe, it, expect } from 'vitest';
import {
  getMimeType,
  canConvert,
  convertImageFormat,
  convertBlobFormat,
} from '../shared/converter';

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

describe('convertImageFormat front guard', () => {
  // The unsupported-format reject lands synchronously on the
  // microtask queue — no <img>, no Canvas. Awaiting the rejection
  // exercises just the front guard.
  it('rejects with an "Unsupported target format" Error for unknown formats', async () => {
    await expect(convertImageFormat('https://example.com/x.png', 'gif')).rejects.toThrow(
      /Unsupported target format: gif/
    );
  });

  it('rejects for empty / whitespace target formats', async () => {
    await expect(convertImageFormat('https://x', '')).rejects.toThrow(/Unsupported target format/);
  });

  it('does NOT throw the front-guard error for canonical formats (load failure surfaces a different message)', async () => {
    // For supported formats the front guard yields and we fall into
    // the Image() pipeline. Without a real Image stub the load
    // ultimately fails, but with a different message — proving we
    // got past the guard.
    await expect(convertImageFormat('not-a-real-url-so-load-will-fail', 'png')).rejects.not.toThrow(
      /Unsupported target format/
    );
  });
});

describe('convertBlobFormat front guard', () => {
  it('rejects with an "Unsupported target format" Error for unknown formats', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    await expect(convertBlobFormat(blob, 'gif')).rejects.toThrow(/Unsupported target format: gif/);
  });

  it('rejects for empty / whitespace target formats', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    await expect(convertBlobFormat(blob, '')).rejects.toThrow(/Unsupported target format/);
  });
});
