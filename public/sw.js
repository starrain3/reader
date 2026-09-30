// Service Worker for 隨身小說閱讀器 (Ku Reader)
// 快取分層架構：應用程式代碼與靜態資源分開管理
const APP_CACHE_NAME = 'ku-reader-app-v3.2';
const STATIC_CACHE_NAME = 'ku-reader-static-v1.0';

// 幾乎不變更的靜態圖示與外觀資源（獨立快取庫，版本不變即永久重用）
const STATIC_ASSETS = [
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon.ico'
];

// 每次隨版本更新的核心進入點與設定清單
const CORE_APP_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

/**
 * 向所有當前活躍的客戶端 (Window Clients) 廣播訊息
 */
async function broadcastToClients(data) {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage(data);
    }
  } catch (err) {
    console.warn('[SW] broadcastToClients 發生錯誤:', err);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const appCache = await caches.open(APP_CACHE_NAME);
      const staticCache = await caches.open(STATIC_CACHE_NAME);

      // 1. 處理靜態圖示資源：優先從現有快取（包括舊版快取）遷移，已存在則零網路請求
      const missingStaticAssets = [];
      for (const asset of STATIC_ASSETS) {
        const existing = await caches.match(asset);
        if (existing) {
          // 直接轉存入新靜態快取庫，不走網路
          await staticCache.put(asset, existing);
        } else {
          missingStaticAssets.push(asset);
        }
      }

      // 若有缺失的圖示資源，再以一般 fetch 下載補齊
      for (const asset of missingStaticAssets) {
        try {
          const resp = await fetch(asset);
          if (resp.ok) {
            await staticCache.put(asset, resp);
          }
        } catch (err) {
          console.warn('[SW] 補充靜態資源失敗:', asset, err);
        }
      }

      // 2. 動態分析 index.html 中的打包資產（如 Vite 編譯出的 CSS / JS 檔案路徑）
      const appAssetsToCache = new Set(CORE_APP_ASSETS);
      try {
        const indexResp = await fetch('./index.html', { cache: 'reload' });
        if (indexResp.ok) {
          const htmlText = await indexResp.text();
          // 將最新 index.html 寫入快取
          await appCache.put('./index.html', new Response(htmlText, {
            headers: indexResp.headers,
            status: indexResp.status,
            statusText: indexResp.statusText
          }));

          // 抓取 HTML 中的 script src 和 link href
          const srcMatches = [...htmlText.matchAll(/src=["'](\.\/assets\/[^"']+)["']/g)];
          const hrefMatches = [...htmlText.matchAll(/href=["'](\.\/assets\/[^"']+)["']/g)];

          srcMatches.forEach((m) => appAssetsToCache.add(m[1]));
          hrefMatches.forEach((m) => appAssetsToCache.add(m[1]));
        }
      } catch (err) {
        console.warn('[SW] 動態解析 index.html 資產失敗，將使用預設靜態清單:', err);
      }

      // 3. 準備需要下載更新的應用程式資產（排除了已寫入快取的 index.html）
      const appAssetList = Array.from(appAssetsToCache).filter((asset) => asset !== './index.html');
      const total = appAssetList.length;
      let loaded = 0;

      // 廣播更新開始
      await broadcastToClients({
        type: 'SW_UPDATE_START',
        total
      });

      // 逐一下載應用程式代碼，並即時廣播進度（此時進度條只會顯示真正更新的 JS / CSS）
      for (const asset of appAssetList) {
        try {
          const resp = await fetch(asset, { cache: 'reload' });
          if (resp.ok) {
            await appCache.put(asset, resp);
          }
        } catch (err) {
          console.warn('[SW] 快取應用程式資源警告:', asset, err);
        }
        loaded++;

        await broadcastToClients({
          type: 'SW_UPDATE_PROGRESS',
          loaded,
          total,
          percent: Math.round((loaded / total) * 100),
          file: asset
        });
      }

      // 廣播更新下載完成
      await broadcastToClients({
        type: 'SW_UPDATE_COMPLETE'
      });
    })()
  );
});

// 監聽前端發送的控制指令 (例如 SKIP_WAITING)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  const expectedCaches = new Set([APP_CACHE_NAME, STATIC_CACHE_NAME]);
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          // 只清除過期的舊版本快取，完整保留 STATIC_CACHE
          if (!expectedCaches.has(key)) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // 僅處理 GET 請求
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 跳過外部代理及跨域書源請求，避免快取膨脹
  if (url.origin !== self.location.origin) {
    return;
  }

  // 判斷是否為靜態圖示資源：圖示採用 Cache-First 策略，不需每次發送背景請求重新驗證
  const isStaticAsset = STATIC_ASSETS.some((asset) => {
    return url.pathname.endsWith(asset.replace('./', ''));
  });

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // 如果是靜態圖示資源，直接返回快取，避免不必要的背景網路請求
        if (isStaticAsset) {
          return cachedResponse;
        }

        // 一般應用程式代碼：快取優先，同時背景請求更新快取 (Stale-While-Revalidate)
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(APP_CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse);
              });
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          const targetCacheName = isStaticAsset ? STATIC_CACHE_NAME : APP_CACHE_NAME;
          caches.open(targetCacheName).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    }).catch(() => {
      // 離線備用退路
      return caches.match('./index.html') || caches.match('./');
    })
  );
});
