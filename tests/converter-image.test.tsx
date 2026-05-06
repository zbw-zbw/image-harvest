// Unit tests for the Image/Canvas-dependent paths in shared/converter.ts.
//
// Runs under jsdom. Stubs globalThis.Image + HTMLCanvasElement.prototype
// .{getContext, toDataURL, toBlob}, plus URL.createObjectURL / revokeObjectURL
// for the convertBlobFormat path. The canonical front-guard tests live in
// tests/converter.test.ts; this file covers the success + inner-failure
// paths that require a DOM.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertImageFormat, convertBlobFormat } from '../shared/converter';

type ImageHandler = (this: HTMLImageElement) => void;

interface FakeImageConfig {
  fireError?: boolean;
  noContext?: boolean;
  nullBlob?: boolean;
  throwInDraw?: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
}

let currentConfig: FakeImageConfig = {};

function installImageAndCanvasStubs(): void {
  class FakeImage {
    onload: ImageHandler | null = null;
    onerror: ImageHandler | null = null;
    crossOrigin: string | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    private _src = '';
    get src(): string {
      return this._src;
    }
    set src(value: string) {
      this._src = value;
      this.naturalWidth = currentConfig.naturalWidth ?? 10;
      this.naturalHeight = currentConfig.naturalHeight ?? 10;
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
      drawImage: vi.fn(() => {
        if (currentConfig.throwInDraw) throw new Error('draw-boom');
      }),
    } as unknown as CanvasRenderingContext2D;
  }) as unknown as HTMLCanvasElement['getContext'];

  HTMLCanvasElement.prototype.toDataURL = vi.fn(function (
    this: HTMLCanvasElement,
    mimeType?: string
  ) {
    return `data:${mimeType ?? 'image/png'};base64,AAAA`;
  }) as unknown as HTMLCanvasElement['toDataURL'];

  HTMLCanvasElement.prototype.toBlob = vi.fn(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    mimeType?: string
  ) {
    queueMicrotask(() => {
      if (currentConfig.nullBlob) {
        callback(null);
      } else {
        callback(new Blob(['stub'], { type: mimeType ?? 'image/png' }));
      }
    });
  }) as unknown as HTMLCanvasElement['toBlob'];

  // URL.createObjectURL / revokeObjectURL are not implemented in jsdom by
  // default. Track calls so we can assert revoke() always fires on every
  // exit path (leak-free contract).
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:fake-object-url'),
    revokeObjectURL: vi.fn(),
  });
}

function uninstallImageAndCanvasStubs(): void {
  delete (globalThis as unknown as { Image?: unknown }).Image;
}

beforeEach(() => {
  currentConfig = {};
  installImageAndCanvasStubs();
});

afterEach(() => {
  uninstallImageAndCanvasStubs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────
// convertImageFormat — success path + inner failures
// ─────────────────────────────────────────────────────────────────────

describe('convertImageFormat — success path', () => {
  it('png → ConversionResult { dataUrl, blob, format }', async () => {
    const result = await convertImageFormat('https://example.com/x.jpg', 'png');
    expect(result.format).toBe('png');
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe('image/png');
  });

  it('jpg target → MIME image/jpeg + format stored as "jpg" (not "jpeg")', async () => {
    const result = await convertImageFormat('https://example.com/x.png', 'jpg');
    // Pin: format is stored as the CALLER'S lowercased string, not the
    // canonical MIME alias. Downstream uses `format` as the file extension
    // — if we silently normalized jpg→jpeg users would see .jpeg files.
    expect(result.format).toBe('jpg');
    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(result.blob.type).toBe('image/jpeg');
  });

  it('uppercase format is lowercased in the result', async () => {
    const result = await convertImageFormat('https://example.com/x.png', 'WebP');
    // Pin: format is .toLowerCase()'d on the way out. A downstream
    // `filename.${format}` template would otherwise produce "foo.WebP".
    expect(result.format).toBe('webp');
  });

  it('canvas dims match the loaded Image naturalWidth/Height', async () => {
    currentConfig.naturalWidth = 123;
    currentConfig.naturalHeight = 456;
    // We can't directly inspect canvas.width from here, but the pipeline
    // MUST not throw with non-default dims — pin the end-to-end contract.
    const result = await convertImageFormat('https://example.com/big.png', 'png');
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it('custom quality parameter is forwarded to toDataURL + toBlob', async () => {
    const toDataURLSpy = HTMLCanvasElement.prototype.toDataURL as unknown as ReturnType<
      typeof vi.fn
    >;
    const toBlobSpy = HTMLCanvasElement.prototype.toBlob as unknown as ReturnType<typeof vi.fn>;
    await convertImageFormat('https://example.com/x.png', 'jpeg', 0.5);
    // Pin: the `quality` param threads through to BOTH encoding calls.
    // If only one gets it, dataUrl vs blob would encode at different
    // qualities — invisible to tests but visible to users as a size/
    // quality mismatch.
    expect(toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.5);
    expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.5);
  });
});

describe('convertImageFormat — inner failure paths', () => {
  it('Image onerror → rejects with "Failed to load image"', async () => {
    currentConfig.fireError = true;
    await expect(convertImageFormat('https://bad/url.png', 'png')).rejects.toThrow(
      /Failed to load image/
    );
  });

  it('canvas.getContext returns null → rejects with "Failed to get canvas context"', async () => {
    currentConfig.noContext = true;
    await expect(convertImageFormat('https://example.com/x.png', 'png')).rejects.toThrow(
      /Failed to get canvas context/
    );
  });

  it('toBlob callback receives null → rejects with "Failed to create blob"', async () => {
    currentConfig.nullBlob = true;
    await expect(convertImageFormat('https://example.com/x.png', 'png')).rejects.toThrow(
      /Failed to create blob/
    );
  });

  it('exception inside onload (drawImage throws) → rejects with the underlying Error', async () => {
    currentConfig.throwInDraw = true;
    await expect(convertImageFormat('https://example.com/x.png', 'png')).rejects.toThrow(
      /draw-boom/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// convertBlobFormat — success + leak-free contract + inner failures
// ─────────────────────────────────────────────────────────────────────

describe('convertBlobFormat — success path', () => {
  it('png → ConversionResult with matching blob MIME', async () => {
    const input = new Blob(['in'], { type: 'image/jpeg' });
    const result = await convertBlobFormat(input, 'png');
    expect(result.format).toBe('png');
    expect(result.blob.type).toBe('image/png');
  });

  it('revokes the created object URL on success (no leak)', async () => {
    const revokeSpy = URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>;
    const input = new Blob(['in'], { type: 'image/png' });
    await convertBlobFormat(input, 'webp');
    // Pin: every exit path MUST revoke. A forgotten revoke leaks memory
    // for the lifetime of the sidepanel/popup — invisible in tests but
    // accumulates across batch jobs.
    expect(revokeSpy).toHaveBeenCalledWith('blob:fake-object-url');
  });

  it('custom quality parameter forwards to toDataURL + toBlob', async () => {
    const toDataURLSpy = HTMLCanvasElement.prototype.toDataURL as unknown as ReturnType<
      typeof vi.fn
    >;
    const toBlobSpy = HTMLCanvasElement.prototype.toBlob as unknown as ReturnType<typeof vi.fn>;
    const input = new Blob(['in'], { type: 'image/png' });
    await convertBlobFormat(input, 'jpeg', 0.3);
    expect(toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.3);
    expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.3);
  });
});

describe('convertBlobFormat — inner failure paths (all revoke URL)', () => {
  it('Image onerror → rejects with "Failed to load image from blob" AND revokes URL', async () => {
    currentConfig.fireError = true;
    const revokeSpy = URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>;
    const input = new Blob(['bad'], { type: 'image/png' });
    await expect(convertBlobFormat(input, 'png')).rejects.toThrow(/Failed to load image from blob/);
    expect(revokeSpy).toHaveBeenCalled();
  });

  it('canvas.getContext null → rejects "Failed to get canvas context" AND revokes URL', async () => {
    currentConfig.noContext = true;
    const revokeSpy = URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>;
    const input = new Blob(['x'], { type: 'image/png' });
    await expect(convertBlobFormat(input, 'png')).rejects.toThrow(/Failed to get canvas context/);
    expect(revokeSpy).toHaveBeenCalled();
  });

  it('toBlob null callback → rejects "Failed to create blob" AND revokes URL', async () => {
    currentConfig.nullBlob = true;
    const revokeSpy = URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>;
    const input = new Blob(['x'], { type: 'image/png' });
    await expect(convertBlobFormat(input, 'png')).rejects.toThrow(/Failed to create blob/);
    expect(revokeSpy).toHaveBeenCalled();
  });

  it('drawImage throws → rejects with underlying Error AND revokes URL', async () => {
    currentConfig.throwInDraw = true;
    const revokeSpy = URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>;
    const input = new Blob(['x'], { type: 'image/png' });
    await expect(convertBlobFormat(input, 'png')).rejects.toThrow(/draw-boom/);
    expect(revokeSpy).toHaveBeenCalled();
  });
});
