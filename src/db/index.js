/**
 * IndexedDB 本地資料庫封裝模組
 * 用於儲存書籍、離線快取章節、自訂書源與使用者設定
 */

import { compressText, decompressText } from '../services/compression.js';

const DB_NAME = 'KuNovelReaderDB';
const DB_VERSION = 1;

let dbInstance = null;

export function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. 書籍表 (books)
      if (!db.objectStoreNames.contains('books')) {
        const bookStore = db.createObjectStore('books', { keyPath: 'id' });
        bookStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // 2. 章節表 (chapters) - 快取離線章節內文
      if (!db.objectStoreNames.contains('chapters')) {
        const chapterStore = db.createObjectStore('chapters', { keyPath: 'id' });
        chapterStore.createIndex('bookId', 'bookId', { unique: false });
        chapterStore.createIndex('bookId_index', ['bookId', 'index'], { unique: true });
      }

      // 3. 書源表 (sources)
      if (!db.objectStoreNames.contains('sources')) {
        db.createObjectStore('sources', { keyPath: 'id' });
      }

      // 4. 設定表 (settings)
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      dbInstance.onversionchange = () => {
        try {
          dbInstance.close();
        } catch (_) {}
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('IndexedDB 打開失敗:', event.target.error);
      dbInstance = null;
      reject(event.target.error);
    };
  });
}

// 通用交易輔助函數 (具備自動重連機制)
async function getStore(storeName, mode = 'readonly') {
  let db = await openDB();
  try {
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  } catch (err) {
    console.warn('[DB] getStore 交易建立失敗，重置連線後重試:', err);
    try {
      if (dbInstance) {
        dbInstance.close();
      }
    } catch (_) {}
    dbInstance = null;
    db = await openDB();
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }
}

// ----------------- 書籍相關 (Books) -----------------

export async function getAllBooks() {
  const store = await getStore('books');
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      // 依最後閱讀/更新時間排序 (新在先)
      const books = (request.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(books);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getBook(id) {
  if (id === null || id === undefined || id === '') {
    return Promise.resolve(null);
  }

  const store = await getStore('books');
  return new Promise((resolve, reject) => {
    // 1. 第一步：嘗試以傳入之原始 id 查詢
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result) return resolve(request.result);

      // 2. 第二步：若未找到，嘗試字串與數值型別互轉查詢
      const isNum = !isNaN(Number(id)) && String(id).trim() !== '';
      const altId = isNum ? Number(id) : String(id);

      if (altId !== id) {
        const reqAlt = store.get(altId);
        reqAlt.onsuccess = () => {
          if (reqAlt.result) return resolve(reqAlt.result);
          // 3. 第三步：兜底遍歷查詢 (保證任何特殊格式或舊版資料 100% 命中)
          fallbackScan();
        };
        reqAlt.onerror = () => fallbackScan();
      } else {
        fallbackScan();
      }
    };
    request.onerror = () => reject(request.error);

    // 兜底掃描輔助函數
    function fallbackScan() {
      const allReq = store.getAll();
      allReq.onsuccess = () => {
        const books = allReq.result || [];
        const found = books.find((b) => b && (b.id == id || String(b.id) === String(id)));
        resolve(found || null);
      };
      allReq.onerror = () => resolve(null);
    }
  });
}

export async function saveBook(book) {
  const store = await getStore('books', 'readwrite');
  book.updatedAt = Date.now();
  return new Promise((resolve, reject) => {
    const request = store.put(book);
    request.onsuccess = () => resolve(book);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteBook(id) {
  if (id === null || id === undefined || id === '') {
    return Promise.resolve(false);
  }

  const db = await openDB();
  const tx = db.transaction(['books', 'chapters'], 'readwrite');
  const bookStore = tx.objectStore('books');
  const chapterStore = tx.objectStore('chapters');

  // 1. 刪除書籍主表記錄 (同時嘗試原始 ID、字串型別與數值型別)
  bookStore.delete(id);
  const isNum = !isNaN(Number(id)) && String(id).trim() !== '';
  if (isNum) {
    bookStore.delete(Number(id));
  }
  bookStore.delete(String(id));

  // 2. 收集需要清理的章節 bookId 鍵值
  const targetIds = [id];
  if (isNum && Number(id) !== id) targetIds.push(Number(id));
  if (String(id) !== id) targetIds.push(String(id));

  return new Promise((resolve, reject) => {
    // 檢查章節表是否存在 'bookId' 索引 (相容舊版或異常 Schema)
    if (chapterStore.indexNames.contains('bookId')) {
      const index = chapterStore.index('bookId');
      let pendingQueries = targetIds.length;
      const allKeysToDelete = new Set();

      targetIds.forEach((queryId) => {
        const req = index.getAllKeys(queryId);
        req.onsuccess = () => {
          (req.result || []).forEach((k) => allKeysToDelete.add(k));
          pendingQueries--;
          if (pendingQueries === 0) {
            for (const key of allKeysToDelete) {
              chapterStore.delete(key);
            }
          }
        };
        req.onerror = () => {
          pendingQueries--;
          if (pendingQueries === 0) {
            for (const key of allKeysToDelete) {
              chapterStore.delete(key);
            }
          }
        };
      });
    } else {
      // 若無 bookId 索引，透過 Cursor 兜底遍歷比對刪除
      const cursorReq = chapterStore.openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const rec = cursor.value;
          const keyStr = String(cursor.key);
          const isMatch = (rec && (rec.bookId == id || String(rec.bookId) === String(id))) ||
                          keyStr.startsWith(`${id}_`);
          if (isMatch) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      cursorReq.onerror = () => {};
    }

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

// ----------------- 章節快取 (Chapters) -----------------

export async function getChapter(bookId, index) {
  const id = `${bookId}_${index}`;
  const store = await getStore('chapters');
  return new Promise((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = async () => {
      const record = request.result;
      if (!record) return resolve(null);
      if (record.content && (record.isCompressed || typeof record.content !== 'string')) {
        try {
          record.content = await decompressText(record.content);
        } catch (e) {
          console.warn(`[DB] 解壓章節 #${index} 失敗:`, e);
        }
      }
      resolve(record);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveChapter(chapter) {
  if (!chapter.id) {
    chapter.id = `${chapter.bookId}_${chapter.index}`;
  }
  chapter.cachedAt = Date.now();
  const toSave = { ...chapter };
  if (toSave.content && typeof toSave.content === 'string') {
    toSave.content = await compressText(toSave.content);
    toSave.isCompressed = true;
  }
  const store = await getStore('chapters', 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.put(toSave);
    request.onsuccess = () => resolve(chapter);
    request.onerror = () => reject(request.error);
  });
}

export async function saveChaptersBatch(chapters) {
  const now = Date.now();

  const processed = await Promise.all(
    chapters.map(async (chap) => {
      const toSave = { ...chap };
      if (!toSave.id) toSave.id = `${toSave.bookId}_${toSave.index}`;
      toSave.cachedAt = now;
      if (toSave.content && typeof toSave.content === 'string') {
        toSave.content = await compressText(toSave.content);
        toSave.isCompressed = true;
      }
      return toSave;
    })
  );

  const store = await getStore('chapters', 'readwrite');
  return new Promise((resolve, reject) => {
    for (const chap of processed) {
      store.put(chap);
    }
    store.transaction.oncomplete = () => resolve(true);
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

/**
 * 格式化位元組大小為易讀字串 (B, KB, MB, GB)
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(size >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * 取得本地資料庫與儲存空間詳細統計資訊
 * 包含 IndexedDB 實體統計（書籍數、快取章節數、自訂書源數）與瀏覽器儲存空間 (Storage API)
 * @returns {Promise<{
 *   bookCount: number,
 *   chapterCount: number,
 *   sourceCount: number,
 *   totalUsage: number,
 *   quota: number,
 *   indexedDBUsage: number | null,
 *   cacheUsage: number | null,
 *   percent: number,
 *   formattedTotal: string,
 *   formattedQuota: string,
 *   formattedIndexedDB: string | null,
 *   formattedCache: string | null
 * }>}
 */
export async function getStorageDetailedStats() {
  const db = await openDB();

  // 1. 快速統計 IndexedDB 各 Object Store 記錄總數
  const getCount = (storeName) => new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(storeName)) return resolve(0);
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });

  const [bookCount, chapterCount, sourceCount] = await Promise.all([
    getCount('books'),
    getCount('chapters'),
    getCount('sources')
  ]);

  // 2. 透過標準 Storage Quota API 取得瀏覽器實際硬碟空間佔用
  let totalUsage = 0;
  let quota = 0;
  let indexedDBUsage = null;
  let cacheUsage = null;

  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const estimate = await navigator.storage.estimate();
      totalUsage = estimate.usage || 0;
      quota = estimate.quota || 0;

      if (estimate.usageDetails) {
        if (typeof estimate.usageDetails.indexedDB === 'number') {
          indexedDBUsage = estimate.usageDetails.indexedDB;
        }
        if (typeof estimate.usageDetails.caches === 'number') {
          cacheUsage = estimate.usageDetails.caches;
        }
      }
    } catch (err) {
      console.warn('[DB] 查詢 navigator.storage.estimate 失敗:', err);
    }
  }

  const percent = quota > 0 ? Math.min(100, (totalUsage / quota) * 100) : 0;

  return {
    bookCount,
    chapterCount,
    sourceCount,
    totalUsage,
    quota,
    indexedDBUsage,
    cacheUsage,
    percent,
    formattedTotal: formatBytes(totalUsage),
    formattedQuota: quota > 0 ? formatBytes(quota) : '',
    formattedIndexedDB: indexedDBUsage !== null ? formatBytes(indexedDBUsage) : null,
    formattedCache: cacheUsage !== null ? formatBytes(cacheUsage) : null
  };
}


async function getBookChaptersFromDB(bookId) {
  if (bookId === null || bookId === undefined || bookId === '') {
    return [];
  }

  try {
    const store = await getStore('chapters');
    return new Promise((resolve) => {
      // 逾時安全保護，避免 Promise 永久掛起
      const timer = setTimeout(() => {
        console.warn('[DB] getBookChaptersFromDB 查詢逾時，安全降級回傳空陣列');
        resolve([]);
      }, 5000);

      const safeResolve = (res) => {
        clearTimeout(timer);
        resolve(res || []);
      };

      if (store.indexNames.contains('bookId')) {
        const index = store.index('bookId');
        const req = index.getAll(bookId);
        req.onsuccess = () => {
          let list = req.result || [];
          if (list.length === 0) {
            const isNum = !isNaN(Number(bookId)) && String(bookId).trim() !== '';
            const altId = isNum ? Number(bookId) : String(bookId);
            if (altId !== bookId) {
              const altReq = index.getAll(altId);
              altReq.onsuccess = () => safeResolve(altReq.result || []);
              altReq.onerror = () => safeResolve([]);
              return;
            }
          }
          safeResolve(list);
        };
        req.onerror = () => safeResolve([]);
      } else {
        const allReq = store.getAll();
        allReq.onsuccess = () => {
          const all = allReq.result || [];
          const matched = all.filter((c) => c && (c.bookId == bookId || String(c.bookId) === String(bookId)));
          safeResolve(matched);
        };
        allReq.onerror = () => safeResolve([]);
      }
    });
  } catch (err) {
    console.warn('[DB] getBookChaptersFromDB 發生例外:', err);
    return [];
  }
}

/**
 * 取得指定書籍的離線快取統計資訊 (已快取章節 Set、檔案總位元組數與未壓縮章節數)
 * @param {string|number} bookId 
 * @returns {Promise<{ indices: Set<number>, totalBytes: number, uncompressedCount: number }>}
 */
export async function getBookCacheDetails(bookId) {
  try {
    const list = await getBookChaptersFromDB(bookId);
    return calculateStats(list);
  } catch (err) {
    console.warn('[DB] getBookCacheDetails 出錯，降級回傳空統計:', err);
    return { indices: new Set(), totalBytes: 0, uncompressedCount: 0 };
  }
}

function calculateStats(list) {
  const indices = new Set();
  let totalBytes = 0;
  let uncompressedCount = 0;
  for (const item of list) {
    if (!item) continue;
    if (typeof item.index === 'number') {
      indices.add(item.index);
    }
    if (item.content) {
      if (item.content instanceof Uint8Array || item.content instanceof ArrayBuffer) {
        totalBytes += item.content.byteLength || 0;
      } else if (typeof item.content === 'string') {
        totalBytes += item.content.length * 3;
        // 未設定 isCompressed 或是純字串皆計為可壓縮
        if (!item.isCompressed) {
          uncompressedCount++;
        }
      }
    }
  }
  return { indices, totalBytes, uncompressedCount };
}

/**
 * 原地無損壓縮指定書籍所有歷史未壓縮快取章節 (Gzip 瘦身)
 * @param {string|number} bookId
 * @param {Function} [onProgress] - 進度回調 ({ current, total, percent, savedBytes })
 * @returns {Promise<{ success: boolean, compressedCount: number, totalCount: number, savedBytes: number, originalBytes: number, finalBytes: number }>}
 */
export async function compressBookCachedChapters(bookId, onProgress) {
  const list = await getBookChaptersFromDB(bookId);
  // 篩選出純字串且未壓縮的章節記錄
  const toCompress = list.filter((item) => item && typeof item.content === 'string' && !item.isCompressed);

  if (toCompress.length === 0) {
    return {
      success: true,
      compressedCount: 0,
      totalCount: list.length,
      savedBytes: 0,
      originalBytes: 0,
      finalBytes: 0
    };
  }

  let originalBytes = 0;
  let finalBytes = 0;
  let processedCount = 0;
  const total = toCompress.length;

  const BATCH_SIZE = 40; // 每批 40 章，兼顧性能與 IndexedDB 記憶體負擔
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const chunk = toCompress.slice(i, i + BATCH_SIZE);

    // 1. 在外部並行進行 Gzip 壓縮，避免佔用活躍交易
    const compressedChunk = await Promise.all(
      chunk.map(async (chap) => {
        const origLen = (chap.content || '').length * 3;
        originalBytes += origLen;

        const compressedData = await compressText(chap.content);
        const compLen = compressedData.byteLength || compressedData.length || origLen;
        finalBytes += compLen;

        return {
          ...chap,
          content: compressedData,
          isCompressed: true
        };
      })
    );

    // 2. 開啟 readwrite 交易迅速批次寫回
    const store = await getStore('chapters', 'readwrite');
    await new Promise((resolve, reject) => {
      for (const item of compressedChunk) {
        store.put(item);
      }
      store.transaction.oncomplete = () => resolve(true);
      store.transaction.onerror = () => reject(store.transaction.error);
      store.transaction.onabort = () => reject(store.transaction.error || new Error('Transaction aborted'));
    });

    processedCount += chunk.length;
    if (typeof onProgress === 'function') {
      const percent = Math.min(100, Math.round((processedCount / total) * 100));
      onProgress({
        current: processedCount,
        total,
        percent,
        savedBytes: Math.max(0, originalBytes - finalBytes)
      });
    }
  }

  const savedBytes = Math.max(0, originalBytes - finalBytes);
  return {
    success: true,
    compressedCount: total,
    totalCount: list.length,
    savedBytes,
    originalBytes,
    finalBytes
  };
}

export async function getCachedChapterIndices(bookId) {
  const { indices } = await getBookCacheDetails(bookId);
  return indices;
}

// ----------------- 書源設定 (Sources) -----------------

export async function getAllSources() {
  const store = await getStore('sources');
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSource(source) {
  const store = await getStore('sources', 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.put(source);
    request.onsuccess = () => resolve(source);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteSource(id) {
  const store = await getStore('sources', 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

// ----------------- 使用者設定 (Settings) -----------------

export async function getSetting(key, defaultValue = null) {
  const store = await getStore('settings');
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => {
      resolve(request.result ? request.result.value : defaultValue);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveSetting(key, value) {
  const store = await getStore('settings', 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.put({ key, value });
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}
