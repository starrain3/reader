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
  const store = await getStore('books');
  return new Promise((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
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
  const db = await openDB();
  const tx = db.transaction(['books', 'chapters'], 'readwrite');
  
  // 刪除書籍本體
  tx.objectStore('books').delete(id);
  
  // 刪除該書籍的所有章節快取
  const chapterStore = tx.objectStore('chapters');
  const index = chapterStore.index('bookId');
  const request = index.getAllKeys(id);
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const keys = request.result || [];
      keys.forEach((key) => chapterStore.delete(key));
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
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
