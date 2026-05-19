// Collection (favorites) — IndexedDB persistence.
//   DB:    ImageSnatcherDB
//   Store: collections
//   Schema version: 1
import type { CollectionItem } from './types';

const DB_NAME = 'ImageSnatcherDB';
const STORE_NAME = 'collections';
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Open (or reuse) the IndexedDB connection. */
export function collectionInit(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        objectStore.createIndex('tags', 'tags', { multiEntry: true });
        objectStore.createIndex('sourceUrl', 'sourceUrl', { unique: false });
        objectStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

/** Insert a new collection entry. Returns the new ID. */
export async function collectionAdd(item: Partial<CollectionItem>): Promise<string> {
  const database = await collectionInit();
  const transaction = database.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  const newItem: CollectionItem = {
    ...(item as CollectionItem),
    id: item.id || generateId(),
    createdAt: item.createdAt || Date.now(),
  };

  await requestToPromise(store.add(newItem));
  return newItem.id;
}

export async function collectionRemove(id: string): Promise<boolean> {
  const database = await collectionInit();
  const transaction = database.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  await requestToPromise(store.delete(id));
  return true;
}

export async function collectionUpdate(
  id: string,
  updates: Partial<CollectionItem>
): Promise<boolean> {
  const database = await collectionInit();
  const transaction = database.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  const existingItem = (await requestToPromise(store.get(id))) as CollectionItem | undefined;
  if (!existingItem) return false;

  const updatedItem: CollectionItem = {
    ...existingItem,
    ...updates,
    id: existingItem.id,
  };

  await requestToPromise(store.put(updatedItem));
  return true;
}

export async function collectionGetAll(): Promise<CollectionItem[]> {
  const database = await collectionInit();
  const transaction = database.transaction([STORE_NAME], 'readonly');
  const store = transaction.objectStore(STORE_NAME);

  return ((await requestToPromise(store.getAll())) as CollectionItem[]) || [];
}

export async function collectionGetById(id: string): Promise<CollectionItem | null> {
  const database = await collectionInit();
  const transaction = database.transaction([STORE_NAME], 'readonly');
  const store = transaction.objectStore(STORE_NAME);

  return ((await requestToPromise(store.get(id))) as CollectionItem) || null;
}

/** Search across tags / sourceUrl / notes / sourceTitle (case-insensitive). */
export async function collectionSearch(query: string): Promise<CollectionItem[]> {
  const allItems = await collectionGetAll();
  const lowerQuery = query.toLowerCase();

  return allItems.filter((item) => {
    if (item.tags && item.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))) return true;
    if (item.sourceUrl && item.sourceUrl.toLowerCase().includes(lowerQuery)) return true;
    if (item.notes && item.notes.toLowerCase().includes(lowerQuery)) return true;
    if (item.sourceTitle && item.sourceTitle.toLowerCase().includes(lowerQuery)) return true;
    return false;
  });
}

/** Export all collection items as plain JSON (Blob fields stripped). */
export async function collectionExport(): Promise<
  Array<Omit<CollectionItem, 'thumbnail' | 'fullImage'>>
> {
  const allItems = await collectionGetAll();
  return allItems.map((item) => {
    const { thumbnail: _t, fullImage: _f, ...rest } = item;
    return rest;
  });
}

export async function collectionClear(): Promise<boolean> {
  const database = await collectionInit();
  const transaction = database.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  await requestToPromise(store.clear());
  return true;
}

/** Local fallback ID generator (used when caller doesn't supply one). */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}
