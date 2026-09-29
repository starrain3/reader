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
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('IndexedDB 打開失敗:', event.target.error);
      reject(event.target.error);
    };
  });
}

// 通用交易輔助函數
async function getStore(storeName, mode = 'readonly') {
  const db = await openDB();
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
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
  const store = await getStore('chapters', 'readwrite');
  if (!chapter.id) {
    chapter.id = `${chapter.bookId}_${chapter.index}`;
  }
  chapter.cachedAt = Date.now();
  const toSave = { ...chapter };
  if (toSave.content && typeof toSave.content === 'string') {
    toSave.content = await compressText(toSave.content);
    toSave.isCompressed = true;
  }
  return new Promise((resolve, reject) => {
    const request = store.put(toSave);
    request.onsuccess = () => resolve(chapter);
    request.onerror = () => reject(request.error);
  });
}

export async function saveChaptersBatch(chapters) {
  const store = await getStore('chapters', 'readwrite');
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

  return new Promise((resolve, reject) => {
    for (const chap of processed) {
      store.put(chap);
    }
    store.transaction.oncomplete = () => resolve(true);
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

export async function getCachedChapterIndices(bookId) {
  const store = await getStore('chapters');
  const index = store.index('bookId');
  return new Promise((resolve, reject) => {
    const request = index.getAll(bookId);
    request.onsuccess = () => {
      const list = request.result || [];
      const set = new Set(list.map((c) => c.index));
      resolve(set);
    };
    request.onerror = () => reject(request.error);
  });
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
