// Shared test fixtures for Preact component tests.
// Keeps individual test files free of boilerplate when constructing
// ImageItem-shaped objects.
import type { ImageItem } from '../../shared/types';

export function makeImage(overrides: Partial<ImageItem> = {}): ImageItem {
  return {
    id: 'img-1',
    url: 'https://example.com/photo.png',
    naturalWidth: 800,
    naturalHeight: 600,
    displayWidth: 400,
    displayHeight: 300,
    estimatedSize: 12345,
    format: 'png',
    colors: ['#ff0000', '#00ff00'],
    phash: null,
    ...overrides,
  } as ImageItem;
}

export function makeImages(count: number): ImageItem[] {
  return Array.from({ length: count }, (_, i) =>
    makeImage({
      id: `img-${i}`,
      url: `https://example.com/photo-${i}.png`,
    })
  );
}
