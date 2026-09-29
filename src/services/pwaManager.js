/**
 * PWA 生命週期與版本更新管理器 (PWA Lifecycle & Update Manager)
 * 負責 Service Worker 註冊、版本偵測、即時下載進度回報與手動檢查更新
 */

import { showToast } from '../ui/toast.js';

let registration = null;

/**
 * 初始化 PWA 管理器
 */
export async function initPwaManager() {
  if (!('serviceWorker' in navigator)) {
    console.log('[PWA] 當前瀏覽器環境不支援 Service Worker');
    const badge = document.getElementById('pwa-update-status-badge');
    if (badge) badge.textContent = '不支援';
    return;
  }

  const modal = document.getElementById('pwa-update-modal');
  const progressBar = document.getElementById('pwa-progress-bar');
  const percentText = document.getElementById('pwa-progress-percent');
  const fileText = document.getElementById('pwa-progress-file');
  const reloadBtn = document.getElementById('pwa-btn-reload');
  const descText = document.getElementById('pwa-update-desc');
  const titleText = document.getElementById('pwa-update-title');
  const badgeEl = document.getElementById('pwa-update-status-badge');

  function showUpdateModal() {
    if (modal) {
      modal.style.display = 'flex';
      if (progressBar) progressBar.style.width = '0%';
      if (percentText) percentText.textContent = '0%';
      if (fileText) fileText.textContent = '正在準備下載更新資源...';
      if (reloadBtn) reloadBtn.style.display = 'none';
      if (titleText) titleText.textContent = '發現新版本！';
      if (descText) descText.textContent = '正在為您下載最新功能與資源，請稍候...';
    }
  }

  try {
    // 註冊 Service Worker (使用相對路徑適配子路徑部署)
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    console.log('[PWA] Service Worker 註冊成功，範圍:', registration.scope);

    if (badgeEl) {
      badgeEl.textContent = '運作正常';
      badgeEl.style.color = '#38bdf8';
    }

    // 1. 若已經有待啟用的新 worker (例如上次已下載完成但使用者未刷新)
    if (registration.waiting && navigator.serviceWorker.controller) {
      showUpdateModal();
      if (progressBar) progressBar.style.width = '100%';
      if (percentText) percentText.textContent = '100%';
      if (descText) descText.textContent = '新版本已就緒，請重新載入以套用！';
      if (reloadBtn) {
        reloadBtn.style.display = 'block';
        reloadBtn.onclick = () => {
          registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
        };
      }
    }

    // 2. 監聽更新發現事件 (updatefound)
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      console.log('[PWA] 偵測到新版本 Service Worker，狀態:', newWorker.state);

      // 只有在既有使用者升級（已存在 controller）時才跳出更新畫面，初次造訪不打擾使用者
      if (navigator.serviceWorker.controller) {
        showUpdateModal();
      }

      newWorker.addEventListener('statechange', () => {
        console.log('[PWA] 新 Worker 狀態變更為:', newWorker.state);
        if (newWorker.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            // 新版本已成功快取全部資源
            if (progressBar) progressBar.style.width = '100%';
            if (percentText) percentText.textContent = '100%';
            if (descText) descText.textContent = '新版本下載完成！即將為您重新載入...';
            if (reloadBtn) {
              reloadBtn.style.display = 'block';
              reloadBtn.onclick = () => {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              };
            }

            // 1.5 秒後自動發送跳過等待，無縫重新載入
            setTimeout(() => {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }, 1500);
          }
        }
      });
    });

    // 3. 監聽來自 Service Worker 的即時進度廣播 (postMessage)
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'SW_UPDATE_START') {
        if (navigator.serviceWorker.controller) {
          showUpdateModal();
        }
      } else if (data.type === 'SW_UPDATE_PROGRESS') {
        if (navigator.serviceWorker.controller && modal && modal.style.display !== 'flex') {
          showUpdateModal();
        }
        const percent = Math.min(100, Math.max(0, data.percent || 0));
        if (progressBar) progressBar.style.width = `${percent}%`;
        if (percentText) percentText.textContent = `${percent}%`;
        if (fileText) {
          const rawFile = data.file || '';
          const fileName = rawFile.split('/').pop() || rawFile;
          fileText.textContent = `下載中 (${data.loaded}/${data.total}): ${fileName}`;
        }
      } else if (data.type === 'SW_UPDATE_COMPLETE') {
        if (progressBar) progressBar.style.width = '100%';
        if (percentText) percentText.textContent = '100%';
        if (fileText) fileText.textContent = '所有資源下載完成！';
      }
    });

    // 4. 當新 Service Worker 接管控制權 (controllerchange) 時，重新整理頁面載入最新代碼
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      console.log('[PWA] 新 Service Worker 已接管，正在重新載入應用程式...');
      window.location.reload();
    });

    // 5. 頁面喚醒時背景自動檢查更新 (例如從手機後台切回前景)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && registration) {
        registration.update().catch(() => {});
      }
    });

  } catch (err) {
    console.warn('[PWA] Service Worker 註冊或監聽異常:', err);
    if (badgeEl) {
      badgeEl.textContent = '異常';
      badgeEl.style.color = '#ef4444';
    }
  }
}

/**
 * 手動檢查更新（由設定頁面按鈕觸發）
 */
export async function checkForUpdates() {
  if (!navigator.serviceWorker || !registration) {
    showToast('目前瀏覽器環境未啟用 Service Worker 或不支援離線快取');
    return;
  }

  showToast('正在向伺服器檢查新版本...');
  try {
    const prevInstalling = registration.installing;
    const prevWaiting = registration.waiting;

    await registration.update();

    // 檢查是否有正在安裝或等待的新版本
    setTimeout(() => {
      if (!registration.installing && !registration.waiting && !prevInstalling && !prevWaiting) {
        showToast('✓ 目前已是最新版本，無需更新！');
      }
    }, 1200);
  } catch (err) {
    console.error('[PWA] 檢查更新失敗:', err);
    showToast('檢查更新失敗，請確認網路連線是否正常');
  }
}
