// Batched image sender — buffers newly discovered images and flushes them
// in one IPC message to avoid per-image chrome.runtime.sendMessage storms.
//
// Usage:
//   batchSender.add(item);          // queue a single image
//   batchSender.addMany(items);     // queue multiple images
//   batchSender.flush();            // force immediate send
//   batchSender.destroy();          // tear down timers

import type { ImageItem } from '../shared/types';
import { sendDiscoveredImages } from './utils';

const FLUSH_INTERVAL_MS = 100;
const MAX_BATCH_SIZE = 50;

let buffer: ImageItem[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  sendDiscoveredImages(batch);
}

function scheduleFlush(): void {
  if (timer) return;
  timer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

/** Queue a single image for batched sending. */
export function addToBatch(item: ImageItem): void {
  buffer.push(item);
  if (buffer.length >= MAX_BATCH_SIZE) {
    flush();
  } else {
    scheduleFlush();
  }
}

/** Queue multiple images for batched sending. */
export function addManyToBatch(items: ImageItem[]): void {
  buffer.push(...items);
  if (buffer.length >= MAX_BATCH_SIZE) {
    flush();
  } else {
    scheduleFlush();
  }
}

/** Force-send any buffered images immediately. */
export function flushBatch(): void {
  flush();
}

/** Clean up timers (e.g. on extension context invalidation). */
export function destroyBatchSender(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  buffer = [];
}
