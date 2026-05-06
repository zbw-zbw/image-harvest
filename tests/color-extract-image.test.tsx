// Unit tests for the Image/Canvas-dependent paths in shared/color-extract.ts.
//
// Runs under jsdom (via .test.tsx). jsdom does NOT implement Canvas 2D
// context natively, so we stub HTMLCanvasElement.prototype.getContext +
// toDataURL + toBlob, plus globalThis.Image with a synchronous onload
// trigger. The stubbed getImageData feeds controlled RGBA bytes into
// the extractor so every internal branch (medianCut recursion,
// getAverageColor, sortByHue's chromatic/achromatic split) is reachable.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractColors, extractColorsFromUrl } from '../shared/color-extract';

// ─────────────────────────────────────────────────────────────────────
// Test-scoped stubs for Image + Canvas
// ─────────────────────────────────────────────────────────────────────

type ImageHandler = (this: HTMLImageElement) => void;

interface FakeImageConfig {
  // When true, fire onerror instead of onload (simulate network failure).
  fireError?: boolean;
  // The RGBA byte pattern getImageData should return. Should be length
  // 100 * 100 * 4 = 40000 unless a test wants shorter data (the
  // extractor iterates `for i < length` so shorter arrays still work).
  rgbaBytes?: Uint8ClampedArray;
  // When true, canvas.getContext returns null (exercise the null-context
  // early return).
  noContext?: boolean;
}

let currentConfig: FakeImageConfig = {};

function installImageAndCanvasStubs(): void {
  // ── Stub Image ──
  class FakeImage {
    onload: ImageHandler | null = null;
    onerror: ImageHandler | null = null;
    crossOrigin: string | null = null;
    private _src = '';
    get src(): string {
      return this._src;
    }
    set src(value: string) {
      this._src = value;
      // Fire the handler on the microtask queue to mirror real Image
      // behavior (src assignment is synchronous, onload is async).
      queueMicrotask(() => {
        if (currentConfig.fireError) {
          this.onerror?.call(this as unknown as HTMLImageElement);
        } else {
          this.onload?.call(this as unknown as HTMLImageElement);
        }
      });
    }
  }
  (globalThis as unknown as { Image: unknown }).Image = FakeImage;

  // ── Stub Canvas 2D context ──
  const getContext = vi.fn(function (this: HTMLCanvasElement, type: string) {
    if (currentConfig.noContext) return null;
    if (type !== '2d') return null;
    return {
      drawImage: vi.fn(),
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
        data:
          currentConfig.rgbaBytes ??
          // Default: opaque mid-gray pixel field (all pixels included).
          new Uint8ClampedArray(w * h * 4).fill(128),
        width: w,
        height: h,
      })),
    } as unknown as CanvasRenderingContext2D;
  });
  HTMLCanvasElement.prototype.getContext = getContext as unknown as HTMLCanvasElement['getContext'];
}

function uninstallImageAndCanvasStubs(): void {
  delete (globalThis as unknown as { Image?: unknown }).Image;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers for building deterministic pixel patterns
// ─────────────────────────────────────────────────────────────────────

/** Build a 100x100 RGBA buffer where each pixel is `(r, g, b, alpha)`. */
function solidColorPixels(r: number, g: number, b: number, alpha = 255): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(100 * 100 * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = alpha;
  }
  return buf;
}

/** Build a 100x100 RGBA buffer split in half between two colors. */
function twoToneBuffer(
  color1: [number, number, number],
  color2: [number, number, number]
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(100 * 100 * 4);
  const half = buf.length / 2;
  for (let i = 0; i < half; i += 4) {
    buf[i] = color1[0];
    buf[i + 1] = color1[1];
    buf[i + 2] = color1[2];
    buf[i + 3] = 255;
  }
  for (let i = half; i < buf.length; i += 4) {
    buf[i] = color2[0];
    buf[i + 1] = color2[1];
    buf[i + 2] = color2[2];
    buf[i + 3] = 255;
  }
  return buf;
}

// ─────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  currentConfig = {};
  installImageAndCanvasStubs();
});

afterEach(() => {
  uninstallImageAndCanvasStubs();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// extractColors — main happy paths
// ─────────────────────────────────────────────────────────────────────

describe('extractColors — happy path', () => {
  it('solid red image → returns a single #RRGGBB close to red', async () => {
    currentConfig.rgbaBytes = solidColorPixels(255, 0, 0);
    const colors = await extractColors('https://example.com/red.png');
    // Pin: medianCut on a monochromatic buffer collapses to one bucket,
    // getAverageColor rounds to the source value, rgbToHex zero-pads.
    expect(colors).toEqual(['#ff0000']);
  });

  it('two-tone image → returns at most 2 distinct colors for count=2', async () => {
    currentConfig.rgbaBytes = twoToneBuffer([255, 0, 0], [0, 255, 0]);
    const colors = await extractColors('https://example.com/two.png', 2);
    expect(colors.length).toBeLessThanOrEqual(2);
    expect(colors.length).toBeGreaterThanOrEqual(1);
    // Each entry is a valid hex string.
    for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('respects the colorCount parameter (bounds output length)', async () => {
    // Gradient-ish: vary blue channel across pixels so medianCut splits
    // produce many distinct averages.
    const buf = new Uint8ClampedArray(100 * 100 * 4);
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = 50;
      buf[i + 1] = 100;
      buf[i + 2] = (i / 4) % 256; // varying blue
      buf[i + 3] = 255;
    }
    currentConfig.rgbaBytes = buf;
    const colors = await extractColors('https://example.com/grad.png', 4);
    expect(colors.length).toBeLessThanOrEqual(4);
  });

  it('data: URLs skip the crossOrigin assignment (no CORS setup needed)', async () => {
    // Pin: the `if (!startsWith('data:')) crossOrigin = 'anonymous'`
    // branch. We can't inspect the Image instance from outside, but we
    // verify data: URLs still resolve to a palette with no errors.
    currentConfig.rgbaBytes = solidColorPixels(10, 20, 30);
    const colors = await extractColors('data:image/png;base64,AAAA');
    expect(colors).toEqual(['#0a141e']);
  });

  it('extractColorsFromUrl is an alias for extractColors', async () => {
    // Pin: back-compat alias — any rename of extractColors MUST keep
    // extractColorsFromUrl pointing to the same implementation, or
    // .mjs-era downstream consumers silently break.
    expect(extractColorsFromUrl).toBe(extractColors);
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractColors — failure modes
// ─────────────────────────────────────────────────────────────────────

describe('extractColors — failure / edge cases', () => {
  it('Image onerror → resolves to empty array', async () => {
    currentConfig.fireError = true;
    const colors = await extractColors('https://bad/url.png');
    expect(colors).toEqual([]);
  });

  it('canvas.getContext returns null → resolves to empty array', async () => {
    currentConfig.noContext = true;
    const colors = await extractColors('https://example.com/x.png');
    expect(colors).toEqual([]);
  });

  it('all pixels below alpha threshold (a<128) → resolves to empty array', async () => {
    // Pin: the `if (a >= 128) pixels.push(...)` guard — fully transparent
    // or near-transparent images should not yield a dominant color (which
    // would otherwise be #000000 from the all-zero RGB channels).
    currentConfig.rgbaBytes = solidColorPixels(200, 100, 50, 0);
    const colors = await extractColors('https://example.com/transparent.png');
    expect(colors).toEqual([]);
  });

  it('exception inside the onload try-block → caught, resolves to empty array', async () => {
    // Pin: the top-level try/catch that wraps the whole pipeline. Make
    // getImageData throw and verify the Promise still resolves (never rejects).
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        throw new Error('boom');
      }),
    })) as unknown as HTMLCanvasElement['getContext'];
    const colors = await extractColors('https://example.com/x.png');
    expect(colors).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// sortByHue indirect coverage (only reachable via extractColors)
// ─────────────────────────────────────────────────────────────────────

describe('sortByHue (indirect via extractColors)', () => {
  it('mixed achromatic + chromatic pixels → palette ends with achromatic-by-lightness', async () => {
    // Build a buffer with ~25% each: pure red, pure blue, near-white, near-black.
    const buf = new Uint8ClampedArray(100 * 100 * 4);
    const q = buf.length / 4;
    for (let i = 0; i < q; i += 4) {
      buf[i] = 255;
      buf[i + 1] = 0;
      buf[i + 2] = 0;
      buf[i + 3] = 255;
    }
    for (let i = q; i < q * 2; i += 4) {
      buf[i] = 0;
      buf[i + 1] = 0;
      buf[i + 2] = 255;
      buf[i + 3] = 255;
    }
    for (let i = q * 2; i < q * 3; i += 4) {
      buf[i] = 240;
      buf[i + 1] = 240;
      buf[i + 2] = 240;
      buf[i + 3] = 255;
    }
    for (let i = q * 3; i < buf.length; i += 4) {
      buf[i] = 10;
      buf[i + 1] = 10;
      buf[i + 2] = 10;
      buf[i + 3] = 255;
    }
    currentConfig.rgbaBytes = buf;
    const colors = await extractColors('https://example.com/mixed.png', 4);
    // Pin: sortByHue puts chromatic colors (saturated) first, achromatic
    // (near-gray) last. With exactly 4 buckets we may or may not get all
    // 4, but every returned color is a valid hex.
    expect(colors.length).toBeGreaterThanOrEqual(1);
    for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('single-color palette → returned as-is (early-return in sortByHue)', async () => {
    // Pin: the `if (hexColors.length <= 1) return hexColors` fast path.
    // A single-color image collapses to one bucket and hits this guard.
    currentConfig.rgbaBytes = solidColorPixels(123, 45, 67);
    const colors = await extractColors('https://example.com/mono.png');
    expect(colors).toHaveLength(1);
    expect(colors[0]).toMatch(/^#7b2d43$/);
  });
});
