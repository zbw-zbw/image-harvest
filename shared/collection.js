// 收藏夹 IndexedDB 管理模块
// 数据库名: ImageSnatcherDB
// 对象存储名: collections
// 版本: 1

const DB_NAME = 'ImageSnatcherDB';
const STORE_NAME = 'collections';
const DB_VERSION = 1;

let db = null;

/**
 * 初始化/打开 IndexedDB
 * @returns {Promise<IDBDatabase>}
 */
function collectionInit() {
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
      const database = event.target.result;
      
      // 创建对象存储
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        
        // 创建索引
        objectStore.createIndex('tags', 'tags', { multiEntry: true });
        objectStore.createIndex('sourceUrl', 'sourceUrl', { unique: false });
        objectStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

/**
 * 添加收藏
 * @param {Object} item - 收藏项数据
 * @returns {Promise<string>} 返回收藏 ID
 */
function collectionAdd(item) {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await collectionInit();
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const newItem = {
        ...item,
        id: item.id || generateId(),
        createdAt: item.createdAt || Date.now()
      };

      const request = store.add(newItem);

      request.onsuccess = () => {
        resolve(newItem.id);
      };

      request.onerror = () => {
        reject(new Error('Failed to add collection item'));
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 删除收藏
 * @param {string} id - 收藏 ID
 * @returns {Promise<boolean>}
 */
function collectionRemove(id) {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await collectionInit();
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.delete(id);

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        reject(new Error('Failed to remove collection item'));
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 更新收藏
 * @param {string} id - 收藏 ID
 * @param {Object} updates - 更新的字段
 * @returns {Promise<boolean>}
 */
function collectionUpdate(id, updates) {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await collectionInit();
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const existingItem = getRequest.result;
        if (!existingItem) {
          resolve(false);
          return;
        }

        const updatedItem = {
          ...existingItem,
          ...updates,
          id: existingItem.id // 确保 ID 不被覆盖
        };

        const putRequest = store.put(updatedItem);

        putRequest.onsuccess = () => {
          resolve(true);
        };

        putRequest.onerror = () => {
          reject(new Error('Failed to update collection item'));
        };
      };

      getRequest.onerror = () => {
        reject(new Error('Failed to get collection item'));
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 获取所有收藏
 * @returns {Promise<Array>}
 */
function collectionGetAll() {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await collectionInit();
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(new Error('Failed to get all collections'));
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 按 ID 获取收藏
 * @param {string} id - 收藏 ID
 * @returns {Promise<Object|null>}
 */
function collectionGetById(id) {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await collectionInit();
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(new Error('Failed to get collection item by ID'));
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 搜索收藏
 * @param {string} query - 搜索关键词
 * @returns {Promise<Array>}
 */
function collectionSearch(query) {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await collectionInit();
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.getAll();

      request.onsuccess = () => {
        const allItems = request.result || [];
        const lowerQuery = query.toLowerCase();

        const results = allItems.filter(item => {
          // 搜索标签
          if (item.tags && item.tags.some(tag => 
            tag.toLowerCase().includes(lowerQuery)
          )) {
            return true;
          }

          // 搜索来源 URL
          if (item.sourceUrl && 
            item.sourceUrl.toLowerCase().includes(lowerQuery)
          ) {
            return true;
          }

          // 搜索备注
          if (item.notes && 
            item.notes.toLowerCase().includes(lowerQuery)
          ) {
            return true;
          }

          // 搜索来源标题
          if (item.sourceTitle && 
            item.sourceTitle.toLowerCase().includes(lowerQuery)
          ) {
            return true;
          }

          return false;
        });

        resolve(results);
      };

      request.onerror = () => {
        reject(new Error('Failed to search collections'));
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 导出所有收藏为 JSON（不含 Blob）
 * @returns {Promise<Object[]>}
 */
function collectionExport() {
  return new Promise(async (resolve, reject) => {
    try {
      const allItems = await collectionGetAll();

      const exportedItems = allItems.map(item => {
        const { thumbnail, fullImage, ...rest } = item;
        return rest;
      });

      resolve(exportedItems);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 清空所有收藏
 * @returns {Promise<boolean>}
 */
function collectionClear() {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await collectionInit();
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.clear();

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        reject(new Error('Failed to clear collections'));
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 生成唯一 ID
 * @returns {string}
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}
