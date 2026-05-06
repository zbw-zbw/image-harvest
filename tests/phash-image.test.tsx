// Unit tests for the Image/Canvas-dependent paths in shared/phash.ts.
//
// Runs under jsdom. jsdom does NOT implement Canvas 2D context natively,
// so we stub HTMLCanvasElement.prototype.getContext + drawImage +
// getImageData, plus globalThis.Image with a synchronous onload trigger.
// The stubbed getImageData feeds controlled RGBA bytes into calculatePHash
// so every internal branch (dct2d full run, imageToGrayscale, the
// median-threshold bit string, DC coefficient skip) is reachable.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculatePHash, hammingDistance } from '../shared/phash';

// ─────────────────────────────────────────────────────────────────────
// Test-scoped stubs for Image + Canvas
// ─────────────────────────────────────────────────────────────────────

type ImageHandler = (this: HTMLImageElement) => void;

interface FakeImageConfig {
  fireError?: boolean;
  rgbaBytes?: Uint8ClampedArray; // 32x32x4 = 4096 bytes
  noContext?: boolean;
  throwInGetImageData?: boolean;
}

let currentConfig: FakeImageConfig = {};

function installImageAndCanvasStubs(): void {
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

  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement, type: string) {
    if (currentConfig.noContext) return null;
    if (type !== '2d') return null;
    return {
      drawImage: vi.fn(),
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => {
        if (currentConfig.throwInGetImageData) throw new Error('boom');
        return {
          data: currentConfig.rgbaBytes ?? new Uint8ClampedArray(w * h * 4).fill(128),
          width: w,
          height: h,
        };
      }),
    } as unknown as CanvasRenderingContext2D;
  }) as unknown as HTMLCanvasElement['getContext'];
}

function uninstallImageAndCanvasStubs(): void {
  delete (globalThis as unknown as { Image?: unknown }).Image;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — 32x32 RGBA pattern builders (phash down-scales to 32x32)
// ─────────────────────────────────────────────────────────────────────

function solid32x32(r: number, g: number, b: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
  }
  return buf;
}

/** Checker-board pattern (high-frequency input — exercises DCT fully). */
function checker32x32(): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const isWhite = (x + y) % 2 === 0;
      buf[i] = buf[i + 1] = buf[i + 2] = isWhite ? 255 : 0;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

/** Horizontal gradient (DCT should concentrate energy in low-u coeffs). */
function gradient32x32(): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const v = Math.round((x / 31) * 255);
      buf[i] = buf[i + 1] = buf[i + 2] = v;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

beforeEach(() => {
  currentConfig = {};
  installImageAndCanvasStubs();
});

afterEach(() => {
  uninstallImageAndCanvasStubs();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// calculatePHash — happy paths
// ─────────────────────────────────────────────────────────────────────

describe('calculatePHash — happy path', () => {
  it('solid color image → 64-char hash starting with "0" (DC bit is always 0)', async () => {
    currentConfig.rgbaBytes = solid32x32(128, 128, 128);
    const hash = await calculatePHash('https://example.com/solid.png');
    expect(hash).not.toBeNull();
    expect(hash).toHaveLength(64);
    // Pin: the explicit `if (i === 0) hash += '0'` branch — the DC
    // coefficient (top-left of the 8x8 block) is NEVER compared to the
    // median; it's always written as '0'. Any refactor that accidentally
    // includes DC in the median calc would flip this bit randomly.
    expect(hash![0]).toBe('0');
  });

  it('hash is deterministic — same input → same output', async () => {
    currentConfig.rgbaBytes = gradient32x32();
    const h1 = await calculatePHash('https://example.com/grad.png');
    currentConfig.rgbaBytes = gradient32x32();
    const h2 = await calculatePHash('https://example.com/grad.png');
    expect(h1).toBe(h2);
  });

  it('visually identical inputs → hamming distance = 0', async () => {
    currentConfig.rgbaBytes = checker32x32();
    const h1 = await calculatePHash('https://example.com/a.png');
    currentConfig.rgbaBytes = checker32x32();
    const h2 = await calculatePHash('https://example.com/b.png');
    expect(hammingDistance(h1, h2)).toBe(0);
  });

  it('different inputs → non-zero hamming distance', async () => {
    currentConfig.rgbaBytes = solid32x32(0, 0, 0);
    const hBlack = await calculatePHash('https://example.com/black.png');
    currentConfig.rgbaBytes = checker32x32();
    const hChecker = await calculatePHash('https://example.com/checker.png');
    // Pin: different patterns MUST produce different hashes — the whole
    // point of pHash. A distance of 0 here would mean DCT/median/bit-string
    // collapsed into a constant, which would silently break dedup.
    expect(hammingDistance(hBlack, hChecker)).toBeGreaterThan(0);
  });

  it('hash is a string of exactly 64 bits (0/1 chars only)', async () => {
    currentConfig.rgbaBytes = gradient32x32();
    const hash = await calculatePHash('https://example.com/x.png');
    expect(hash).toMatch(/^[01]{64}$/);
  });

  it('data: URLs skip crossOrigin (no CORS setup) and still hash correctly', async () => {
    currentConfig.rgbaBytes = solid32x32(10, 20, 30);
    const hash = await calculatePHash('data:image/png;base64,AAAA');
    expect(hash).toMatch(/^[01]{64}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// calculatePHash — failure modes
// ─────────────────────────────────────────────────────────────────────

describe('calculatePHash — failure / edge cases', () => {
  it('Image onerror → resolves to null', async () => {
    currentConfig.fireError = true;
    const hash = await calculatePHash('https://bad/url.png');
    expect(hash).toBeNull();
  });

  it('canvas.getContext returns null → resolves to null', async () => {
    currentConfig.noContext = true;
    const hash = await calculatePHash('https://example.com/x.png');
    expect(hash).toBeNull();
  });

  it('exception inside the onload try-block → caught, resolves to null', async () => {
    currentConfig.throwInGetImageData = true;
    const hash = await calculatePHash('https://example.com/x.png');
    // Pin: the try/catch around the whole DCT pipeline — must never
    // reject the Promise (callers use the null return as the "no hash
    // available" signal, not an Error they have to handle).
    expect(hash).toBeNull();
  });
});
