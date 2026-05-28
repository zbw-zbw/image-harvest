import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shared/constants', () => ({
  EAGLE_API_BASE: 'http://localhost:41595',
  EAGLE_BATCH_SIZE: 3,
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { detectEagle, exportToEagle } from '../shared/export-eagle';
import type { EagleItem } from '../shared/export-eagle';

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('detectEagle', () => {
  it('returns running: true when Eagle responds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success', data: { version: '4.0.0' } }),
    });
    const result = await detectEagle();
    expect(result).toEqual({ running: true, version: '4.0.0' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:41595/api/application/info',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('returns running: false when fetch throws (Eagle not open)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
    const result = await detectEagle();
    expect(result).toEqual({ running: false });
  });

  it('returns running: false when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    const result = await detectEagle();
    expect(result).toEqual({ running: false });
  });

  it('returns running: false when status is not success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'error' }),
    });
    const result = await detectEagle();
    expect(result).toEqual({ running: false });
  });
});

describe('exportToEagle', () => {
  const items: EagleItem[] = [
    { url: 'https://example.com/1.png', name: '1.png' },
    { url: 'https://example.com/2.png', name: '2.png' },
    { url: 'https://example.com/3.png', name: '3.png' },
    { url: 'https://example.com/4.png', name: '4.png' },
    { url: 'https://example.com/5.png', name: '5.png' },
  ];

  it('returns error for empty items', async () => {
    const result = await exportToEagle([]);
    expect(result).toEqual({ success: false, added: 0, failed: 0, error: 'no_images' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('splits items into batches of EAGLE_BATCH_SIZE (3)', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const result = await exportToEagle(items);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const firstBatch = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(firstBatch.items).toHaveLength(3);

    const secondBatch = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(secondBatch.items).toHaveLength(2);

    expect(result).toEqual({ success: true, added: 5, failed: 0 });
  });

  it('counts failures correctly when one batch fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });

    const result = await exportToEagle(items);
    expect(result).toEqual({ success: true, added: 3, failed: 2 });
  });

  it('counts failures when a batch throws', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('Network error'));

    const result = await exportToEagle(items);
    expect(result).toEqual({ success: true, added: 3, failed: 2 });
  });

  it('returns success: false when all batches fail', async () => {
    mockFetch.mockResolvedValue({ ok: false });
    const result = await exportToEagle(items);
    expect(result).toEqual({ success: false, added: 0, failed: 5 });
  });

  it('exports single item without batching issue', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const result = await exportToEagle([items[0]]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, added: 1, failed: 0 });
  });
});
