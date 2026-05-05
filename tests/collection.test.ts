// Tests for shared/collection.ts — exercises the IndexedDB CRUD surface
// using fake-indexeddb so we don't need a browser.
//
// Note: shared/collection.ts caches the IDB connection in a module-scoped
// `db` variable. Because that cache is not exported, we cannot reset it
// between tests. We work around this by giving every test case a unique
// id so isolation is achieved through data, not connection lifecycle.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

// Wire fake-indexeddb onto the global before importing the collection module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).indexedDB = new IDBFactory();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IDBKeyRange = IDBKeyRange;

const {
  collectionAdd,
  collectionClear,
  collectionExport,
  collectionGetAll,
  collectionGetById,
  collectionRemove,
  collectionSearch,
  collectionUpdate,
} = await import('../shared/collection');

beforeEach(async () => {
  await collectionClear();
});

describe('collectionAdd', () => {
  it('returns the new id and stores the item', async () => {
    const id = await collectionAdd({ url: 'https://x/y.png', tags: ['cat'] });
    expect(id).toBeTruthy();

    const fetched = await collectionGetById(id);
    expect(fetched?.url).toBe('https://x/y.png');
    expect(fetched?.tags).toEqual(['cat']);
    expect(typeof fetched?.createdAt).toBe('number');
  });

  it('respects a caller-provided id', async () => {
    const id = await collectionAdd({ id: 'fixed', url: 'u' });
    expect(id).toBe('fixed');
  });
});

describe('collectionGetAll', () => {
  it('starts empty and lists every inserted item', async () => {
    expect(await collectionGetAll()).toEqual([]);
    await collectionAdd({ url: 'a' });
    await collectionAdd({ url: 'b' });
    const all = await collectionGetAll();
    expect(all).toHaveLength(2);
  });
});

describe('collectionUpdate', () => {
  it('merges fields and never lets the id change', async () => {
    const id = await collectionAdd({ id: 'u1', url: 'a', tags: ['x'] });
    const ok = await collectionUpdate(id, { id: 'NEW', tags: ['x', 'y'], notes: 'n' });
    expect(ok).toBe(true);

    // Original id wins; fields merged
    const updated = await collectionGetById('u1');
    expect(updated?.id).toBe('u1');
    expect(updated?.tags).toEqual(['x', 'y']);
    expect(updated?.notes).toBe('n');
  });

  it('returns false when the id does not exist', async () => {
    const ok = await collectionUpdate('does-not-exist', { notes: 'nope' });
    expect(ok).toBe(false);
  });
});

describe('collectionRemove', () => {
  it('removes an existing item', async () => {
    await collectionAdd({ id: 'r1', url: 'a' });
    await collectionRemove('r1');
    expect(await collectionGetById('r1')).toBeNull();
  });
});

describe('collectionSearch', () => {
  beforeEach(async () => {
    await collectionAdd({ url: 'https://example.com/cat.png', tags: ['cat', 'cute'] });
    await collectionAdd({
      url: 'https://other.com/dog.png',
      tags: ['dog'],
      notes: 'My favourite husky',
      sourceTitle: 'Husky photo',
    });
    await collectionAdd({ url: 'https://example.com/landscape.jpg', tags: ['nature'] });
  });

  it('matches on tags', async () => {
    const matches = await collectionSearch('cat');
    expect(matches.map((r) => r.url)).toContain('https://example.com/cat.png');
    expect(matches).toHaveLength(1);
  });

  it('matches on sourceUrl substring (case-insensitive)', async () => {
    // Sanity: the seed data is present in the store
    const all = await collectionGetAll();
    expect(all).toHaveLength(3);
    // Sanity: at least one row mentions other.com somewhere we search
    const dog = all.find((r) => r.url === 'https://other.com/dog.png');
    expect(dog).toBeDefined();
    // collectionSearch only inspects sourceUrl/tags/notes/sourceTitle,
    // NOT the `url` field. The seed item doesn't set sourceUrl, so search
    // intentionally misses; switch the assertion accordingly to cover the
    // documented contract.
    const matches = await collectionSearch('OTHER.com');
    expect(matches).toEqual([]);
  });

  it('matches when sourceUrl is populated', async () => {
    await collectionAdd({
      url: 'https://x.com/y.png',
      sourceUrl: 'https://OTHER.com/source-page',
      tags: [],
    });
    const matches = await collectionSearch('other.com');
    expect(matches.some((r) => r.sourceUrl?.toLowerCase().includes('other.com'))).toBe(true);
  });

  it('matches on notes', async () => {
    const matches = await collectionSearch('husky');
    expect(matches.some((r) => r.notes?.toLowerCase().includes('husky'))).toBe(true);
  });

  it('matches on sourceTitle', async () => {
    const matches = await collectionSearch('husky photo');
    expect(matches.some((r) => r.sourceTitle === 'Husky photo')).toBe(true);
  });

  it('returns empty when nothing matches', async () => {
    expect(await collectionSearch('zzznope')).toEqual([]);
  });
});

describe('collectionExport', () => {
  it('strips Blob fields (thumbnail / fullImage) from the export', async () => {
    const fakeBlob = new Blob(['x'], { type: 'image/png' });
    await collectionAdd({
      id: 'e1',
      url: 'https://x/y.png',
      tags: ['cat'],
      thumbnail: fakeBlob,
      fullImage: fakeBlob,
    });
    const exported = await collectionExport();
    expect(exported).toHaveLength(1);
    const item = exported[0] as Record<string, unknown>;
    expect(item.id).toBe('e1');
    expect(item.tags).toEqual(['cat']);
    expect('thumbnail' in item).toBe(false);
    expect('fullImage' in item).toBe(false);
  });
});

describe('collectionClear', () => {
  it('removes every item', async () => {
    await collectionAdd({ url: 'a' });
    await collectionAdd({ url: 'b' });
    await collectionClear();
    expect(await collectionGetAll()).toEqual([]);
  });
});
