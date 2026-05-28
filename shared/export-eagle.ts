import { EAGLE_API_BASE, EAGLE_BATCH_SIZE } from './constants';

export interface EagleItem {
  url: string;
  name: string;
  tags?: string[];
  website?: string;
}

export interface EagleDetectResult {
  running: boolean;
  version?: string;
}

export interface EagleExportResult {
  success: boolean;
  added: number;
  failed: number;
  error?: string;
}

export async function detectEagle(): Promise<EagleDetectResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${EAGLE_API_BASE}/api/application/info`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return { running: false };
    const data = (await res.json()) as { status?: string; data?: { version?: string } };
    if (data.status === 'success') {
      return { running: true, version: data.data?.version };
    }
    return { running: false };
  } catch {
    return { running: false };
  }
}

export async function exportToEagle(items: EagleItem[]): Promise<EagleExportResult> {
  if (items.length === 0) {
    return { success: false, added: 0, failed: 0, error: 'no_images' };
  }

  let added = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i += EAGLE_BATCH_SIZE) {
    const batch = items.slice(i, i + EAGLE_BATCH_SIZE);
    try {
      const res = await fetch(`${EAGLE_API_BASE}/api/item/addFromURLs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: batch }),
      });
      if (res.ok) {
        added += batch.length;
      } else {
        failed += batch.length;
      }
    } catch {
      failed += batch.length;
    }
  }

  return { success: added > 0, added, failed };
}
