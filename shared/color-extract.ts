// Color extraction (Median Cut) — Canvas-based dominant color extraction.
import type { RGB } from './types';

/**
 * Extract up to `colorCount` dominant colors from an image, returned as
 * `#RRGGBB` strings sorted by hue for visually pleasing palettes.
 */
export function extractColors(imageUrl: string, colorCount: number = 5): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    if (!imageUrl.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve([]);
          return;
        }

        // Down-scale to 100x100 to bound the work.
        canvas.width = 100;
        canvas.height = 100;
        ctx.drawImage(img, 0, 0, 100, 100);

        const imageData = ctx.getImageData(0, 0, 100, 100);
        const pixels: RGB[] = [];

        for (let i = 0; i < imageData.data.length; i += 4) {
          const r = imageData.data[i];
          const g = imageData.data[i + 1];
          const b = imageData.data[i + 2];
          const a = imageData.data[i + 3];
          if (a >= 128) {
            pixels.push({ r, g, b });
          }
        }

        if (pixels.length === 0) {
          resolve([]);
          return;
        }

        const maxDepth = Math.ceil(Math.log2(colorCount));
        const colorBuckets = medianCut(pixels, 0, maxDepth);

        const colorEntries = colorBuckets
          .map((bucket) => {
            const avg = getAverageColor(bucket);
            return {
              color: rgbToHex(avg.r, avg.g, avg.b),
              count: bucket.length,
            };
          })
          .sort((a, b) => b.count - a.count);

        const seen = new Set<string>();
        const uniqueColors: string[] = [];
        for (const entry of colorEntries) {
          if (!seen.has(entry.color)) {
            seen.add(entry.color);
            uniqueColors.push(entry.color);
          }
          if (uniqueColors.length >= colorCount) break;
        }

        resolve(sortByHue(uniqueColors));
      } catch {
        resolve([]);
      }
    };

    img.onerror = () => resolve([]);
    img.src = imageUrl;
  });
}

function medianCut(pixels: RGB[], depth: number, maxDepth: number): RGB[][] {
  if (depth >= maxDepth || pixels.length <= 1) {
    return [pixels];
  }

  let rMin = 255,
    rMax = 0;
  let gMin = 255,
    gMax = 0;
  let bMin = 255,
    bMax = 0;

  for (const pixel of pixels) {
    rMin = Math.min(rMin, pixel.r);
    rMax = Math.max(rMax, pixel.r);
    gMin = Math.min(gMin, pixel.g);
    gMax = Math.max(gMax, pixel.g);
    bMin = Math.min(bMin, pixel.b);
    bMax = Math.max(bMax, pixel.b);
  }

  const rRange = rMax - rMin;
  const gRange = gMax - gMin;
  const bRange = bMax - bMin;

  let channel: 'r' | 'g' | 'b' = 'r';
  let maxRange = rRange;

  if (gRange > maxRange) {
    channel = 'g';
    maxRange = gRange;
  }
  if (bRange > maxRange) {
    channel = 'b';
    maxRange = bRange;
  }

  pixels.sort((a, b) => a[channel] - b[channel]);

  const medianIndex = Math.floor(pixels.length / 2);
  const leftPixels = pixels.slice(0, medianIndex);
  const rightPixels = pixels.slice(medianIndex);

  const leftBuckets = medianCut(leftPixels, depth + 1, maxDepth);
  const rightBuckets = medianCut(rightPixels, depth + 1, maxDepth);

  return [...leftBuckets, ...rightBuckets];
}

/** RGB → `#RRGGBB`. */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number): string => {
    const hex = Math.round(value).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/** `#RRGGBB` → RGB. Returns black on parse failure. */
export function hexToRgb(hex: string): RGB {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

function getAverageColor(pixels: RGB[]): RGB {
  if (pixels.length === 0) return { r: 0, g: 0, b: 0 };

  let rSum = 0,
    gSum = 0,
    bSum = 0;
  for (const pixel of pixels) {
    rSum += pixel.r;
    gSum += pixel.g;
    bSum += pixel.b;
  }

  return {
    r: Math.round(rSum / pixels.length),
    g: Math.round(gSum / pixels.length),
    b: Math.round(bSum / pixels.length),
  };
}

interface HSL {
  h: number;
  s: number;
  l: number;
}

function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;

  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s, l };
}

/**
 * Sort colors so visually similar hues cluster together. Achromatic colors
 * (very low saturation) move to the end and are sorted by lightness desc.
 */
function sortByHue(hexColors: string[]): string[] {
  if (hexColors.length <= 1) return hexColors;

  const achromaticThreshold = 0.08;

  const withHsl = hexColors.map((hex) => {
    const rgb = hexToRgb(hex);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    return { hex, hsl, isAchromatic: hsl.s < achromaticThreshold };
  });

  const chromatic = withHsl.filter((c) => !c.isAchromatic);
  const achromatic = withHsl.filter((c) => c.isAchromatic);

  chromatic.sort((a, b) => a.hsl.h - b.hsl.h);
  achromatic.sort((a, b) => b.hsl.l - a.hsl.l);

  return [...chromatic, ...achromatic].map((c) => c.hex);
}

/** Alias kept for backwards compatibility with the `.mjs` API. */
export const extractColorsFromUrl = extractColors;
