// Image format conversion via Canvas.
import type { ConversionResult, ConvertibleFormat } from './types';

const SUPPORTED: readonly string[] = ['png', 'jpg', 'jpeg', 'webp'];

/** Get the MIME type for a format string. Defaults to `image/png`. */
export function getMimeType(format: string): string {
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp'
  };
  return mimeTypes[format.toLowerCase()] || 'image/png';
}

/** Whether a target format is supported by the canvas-based converter. */
export function canConvert(format: string): format is ConvertibleFormat {
  return SUPPORTED.includes(format.toLowerCase());
}

/**
 * Convert an image URL to the target format. Resolves to `{dataUrl, blob, format}`,
 * rejects on load/decode/unsupported-format errors.
 */
export function convertImageFormat(
  imageUrl: string,
  targetFormat: string,
  quality: number = 0.92
): Promise<ConversionResult> {
  return new Promise((resolve, reject) => {
    if (!canConvert(targetFormat)) {
      reject(new Error(`Unsupported target format: ${targetFormat}`));
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0);

        const mimeType = getMimeType(targetFormat);
        const dataUrl = canvas.toDataURL(mimeType, quality);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to create blob'));
              return;
            }
            resolve({
              dataUrl,
              blob,
              format: targetFormat.toLowerCase()
            });
          },
          mimeType,
          quality
        );
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });
}

/** Convert a Blob to the target format. */
export function convertBlobFormat(
  blob: Blob,
  targetFormat: string,
  quality: number = 0.92
): Promise<ConversionResult> {
  return new Promise((resolve, reject) => {
    if (!canConvert(targetFormat)) {
      reject(new Error(`Unsupported target format: ${targetFormat}`));
      return;
    }

    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0);

        const mimeType = getMimeType(targetFormat);
        const dataUrl = canvas.toDataURL(mimeType, quality);

        canvas.toBlob(
          (newBlob) => {
            URL.revokeObjectURL(url);
            if (!newBlob) {
              reject(new Error('Failed to create blob'));
              return;
            }
            resolve({
              dataUrl,
              blob: newBlob,
              format: targetFormat.toLowerCase()
            });
          },
          mimeType,
          quality
        );
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image from blob'));
    };

    img.src = url;
  });
}
