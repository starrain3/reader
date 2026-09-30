// Service Worker for 隨身小說閱讀器 (Ku Reader)
const CACHE_NAME = 'ku-reader-cache-v2.7';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon.ico'
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
      const cache = await caches.open(CACHE_NAME);
      const assetsToCache = new Set(CORE_ASSETS);

      // 動態分析 index.html 中的打包資產（如 Vite 編譯出的 CSS / JS 檔案路徑）
      try {
        const indexResp = await fetch('./index.html', { cache: 'reload' });
        if (indexResp.ok) {
          const htmlText = await indexResp.text();
          // 將最新 index.html 寫入快取
          await cache.put('./index.html', new Response(htmlText, {
            headers: indexResp.headers,
            status: indexResp.status,
            statusText: indexResp.statusText
          }));

          // 抓取 HTML 中的 script src 和 link href
          const srcMatches = [...htmlText.matchAll(/src=["'](\.\/assets\/[^"']+)["']/g)];
          const hrefMatches = [...htmlText.matchAll(/href=["'](\.\/assets\/[^"']+)["']/g)];

          srcMatches.forEach((m) => assetsToCache.add(m[1]));
          hrefMatches.forEach((m) => assetsToCache.add(m[1]));
        }
      } catch (err) {
        console.warn('[SW] 動態解析 index.html 資產失敗，將使用預設靜態清單:', err);
      }

      const assetList = Array.from(assetsToCache);
      const total = assetList.length;
      let loaded = 0;

      // 1. 廣播更新開始
      await broadcastToClients({
        type: 'SW_UPDATE_START',
        total
      });

      // 2. 逐一下載快取資源，並即時廣播進度
      for (const asset of assetList) {
        try {
          if (asset !== './index.html') {
            const resp = await fetch(asset, { cache: 'reload' });
            if (resp.ok) {
              await cache.put(asset, resp);
            }
          }
        } catch (err) {
          console.warn('[SW] 快取靜態資源警告:', asset, err);
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

      // 3. 廣播更新下載完成
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
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
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

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // 快取優先，同時背景請求更新快取 (Stale-While-Revalidate)
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
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
          caches.open(CACHE_NAME).then((cache) => {
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
