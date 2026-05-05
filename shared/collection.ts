// Collection (favorites) — IndexedDB persistence.
//   DB:    ImageSnatcherDB
//   Store: collections
//   Schema version: 1
import type { CollectionItem } from './types';

const DB_NAME = 'ImageSnatcherDB';
const STORE_NAME = 'collections';
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

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
export function collectionAdd(item: Partial<CollectionItem>): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await collectionInit();
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const newItem: CollectionItem = {
        ...(item as CollectionItem),
        id: item.id || generateId(),
        createdAt: item.createdAt || Date.now(),
      };

      const request = store.add(newItem);

      request.onsuccess = () => resolve(newItem.id);
      request.onerror = () => reject(new Error('Failed to add collection item'));
    } catch (error) {
      reject(error);
    }
  });
}

export function collectionRemove(id: string): Promise<boolean> {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await collectionInit();
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(new Error('Failed to remove collection item'));
    } catch (error) {
      reject(error);
    }
  });
}

export function collectionUpdate(id: string, updates: Partial<CollectionItem>): Promise<boolean> {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await collectionInit();
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const existingItem = getRequest.result as CollectionItem | undefined;
        if (!existingItem) {
          resolve(false);
          return;
        }

        const updatedItem: CollectionItem = {
          ...existingItem,
          ...updates,
          id: existingItem.id, // Never let updates clobber the ID.
        };

        const putRequest = store.put(updatedItem);
        putRequest.onsuccess = () => resolve(true);
        putRequest.onerror = () => reject(new Error('Failed to update collection item'));
      };

      getRequest.onerror = () => reject(new Error('Failed to get collection item'));
    } catch (error) {
      reject(error);
    }
  });
}

export function collectionGetAll(): Promise<CollectionItem[]> {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await collectionInit();
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.getAll();
      request.onsuccess = () => resolve((request.result as CollectionItem[]) || []);
      request.onerror = () => reject(new Error('Failed to get all collections'));
    } catch (error) {
      reject(error);
    }
  });
}

export function collectionGetById(id: string): Promise<CollectionItem | null> {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await collectionInit();
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.get(id);
      request.onsuccess = () => resolve((request.result as CollectionItem) || null);
      request.onerror = () => reject(new Error('Failed to get collection item by ID'));
    } catch (error) {
      reject(error);
    }
  });
}

/** Search across tags / sourceUrl / notes / sourceTitle (case-insensitive). */
export function collectionSearch(query: string): Promise<CollectionItem[]> {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await collectionInit();
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.getAll();

      request.onsuccess = () => {
        const allItems = (request.result as CollectionItem[]) || [];
        const lowerQuery = query.toLowerCase();

        const results = allItems.filter((item) => {
          if (item.tags && item.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))) {
            return true;
          }
          if (item.sourceUrl && item.sourceUrl.toLowerCase().includes(lowerQuery)) {
            return true;
          }
          if (item.notes && item.notes.toLowerCase().includes(lowerQuery)) {
            return true;
          }
          if (item.sourceTitle && item.sourceTitle.toLowerCase().includes(lowerQuery)) {
            return true;
          }
          return false;
        });

        resolve(results);
      };

      request.onerror = () => reject(new Error('Failed to search collections'));
    } catch (error) {
      reject(error);
    }
  });
}

/** Export all collection items as plain JSON (Blob fields stripped). */
export function collectionExport(): Promise<
  Array<Omit<CollectionItem, 'thumbnail' | 'fullImage'>>
> {
  return new Promise(async (resolve, reject) => {
    try {
      const allItems = await collectionGetAll();
      const exportedItems = allItems.map((item) => {
        const { thumbnail: _t, fullImage: _f, ...rest } = item;
        return rest;
      });
      resolve(exportedItems);
    } catch (error) {
      reject(error);
    }
  });
}

export function collectionClear(): Promise<boolean> {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await collectionInit();
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(new Error('Failed to clear collections'));
    } catch (error) {
      reject(error);
    }
  });
}

/** Local fallback ID generator (used when caller doesn't supply one). */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}
