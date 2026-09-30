/**
 * 設定視圖控制器 (Settings View Controller)
 * 負責網路代理 (CORS Proxy)、快取清理、PWA 安裝指引與 Cloudflare Worker 部署說明
 */

import { getSetting, saveSetting, openDB, getAllBooks } from '../db/index.js';
import { testCloudflareWorker } from '../services/network.js';
import { showToast } from './toast.js';
import { checkForUpdates, forceUpdateApp } from '../services/pwaManager.js';

class SettingsViewController {
  constructor() {
    this.workerUrlInput = null;
    this.apiKeyInput = null;
    this.testBtn = null;
    this.clearCacheBtn = null;
    this.deferredPrompt = null;
    this.installBtn = null;
  }

  async init() {
    this.workerUrlInput = document.getElementById('settings-worker-url');
    this.apiKeyInput = document.getElementById('settings-api-key');
    this.testBtn = document.getElementById('btn-test-proxy');
    this.clearCacheBtn = document.getElementById('btn-clear-cache');
    this.installBtn = document.getElementById('btn-pwa-install');

    const savedWorkerUrl = await getSetting('cf_worker_url', 'https://aged-night-c15f.jasonku50419.workers.dev/');
    const savedApiKey = await getSetting('cf_api_key', 'superku');

    if (this.workerUrlInput) this.workerUrlInput.value = savedWorkerUrl;
    if (this.apiKeyInput) this.apiKeyInput.value = savedApiKey;

    this.bindEvents();
    this.initPwaInstall();
    this.updateStorageStats();
  }

  bindEvents() {
    // 儲存代理與金鑰設定
    document.getElementById('btn-save-proxy')?.addEventListener('click', async () => {
      const workerUrl = this.workerUrlInput?.value.trim() || '';
      const apiKey = this.apiKeyInput?.value.trim() || '';

      await saveSetting('cf_worker_url', workerUrl);
      await saveSetting('cf_api_key', apiKey);
      showToast('已安全儲存 Worker 設定與金鑰至本機！');
    });

    // 測試連線與金鑰
    this.testBtn?.addEventListener('click', async () => {
      const workerUrl = this.workerUrlInput?.value.trim();
      const apiKey = this.apiKeyInput?.value.trim();

      if (!workerUrl) {
        showToast('請先填寫 Cloudflare Worker 網址！');
        return;
      }

      this.testBtn.textContent = '測試驗證中...';
      this.testBtn.disabled = true;
      const startTime = Date.now();

      try {
        const result = await testCloudflareWorker(workerUrl, apiKey);
        const latency = Date.now() - startTime;
        showToast(`✓ ${result.message || '連線成功！'} (${latency}ms)`);
      } catch (err) {
        alert(`連線測試失敗:\n${err.message}`);
      } finally {
        this.testBtn.textContent = '測試連線與金鑰';
        this.testBtn.disabled = false;
      }
    });

    // 清理章節快取
    this.clearCacheBtn?.addEventListener('click', async () => {
      if (confirm('確定要清空所有已下載的章節文字嗎？（書架與書籍進度仍會保留）')) {
        const db = await openDB();
        const tx = db.transaction('chapters', 'readwrite');
        tx.objectStore('chapters').clear();
        tx.oncomplete = () => {
          showToast('已成功釋放章節快取空間！');
          this.updateStorageStats();
        };
      }
    });

    // 複製 Cloudflare Worker 範本
    document.getElementById('btn-copy-cf-code')?.addEventListener('click', () => {
      const code = `// Cloudflare Worker CORS Proxy
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) return new Response("Missing url param", { status: 400 });

    const response = await fetch(targetUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });

    const newHeaders = new Headers(response.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
    newHeaders.set("Access-Control-Allow-Headers", "*");

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders
    });
  }
};`;
      navigator.clipboard.writeText(code).then(() => {
        showToast('已複製 Cloudflare Worker 程式碼！');
      });
    });

    // 手動檢查 PWA 更新
    document.getElementById('btn-check-update')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-check-update');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '正在檢查更新...';
      }
      try {
        await checkForUpdates();
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🔍 檢查線上更新';
        }
      }
    });

    // 強制清除快取並重整
    document.getElementById('btn-force-update')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-force-update');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '正在重整...';
      }
      try {
        await forceUpdateApp();
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🚀 強制更新重整';
        }
      }
    });
  }

  initPwaInstall() {
    // 檢查是否已在獨立應用程式模式中運行
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const guideEl = document.getElementById('pwa-install-manual-guide');

    if (isStandalone) {
      if (this.installBtn) {
        this.installBtn.style.display = 'block';
        this.installBtn.disabled = true;
        this.installBtn.textContent = '✓ 目前已在 Ku Reader 獨立應用程式中運行';
        this.installBtn.classList.replace('btn-primary', 'btn-secondary');
      }
      if (guideEl) guideEl.style.display = 'none';
      return;
    }

    // 監聽 PWA 安裝提示事件
    window.addEventListener('beforeinstallprompt', (e) => {
      // 阻止預設迷你橫幅
      e.preventDefault();
      // 保存事件以便後續手動喚起
      this.deferredPrompt = e;

      if (this.installBtn) {
        this.installBtn.style.display = 'block';
        this.installBtn.disabled = false;
        this.installBtn.textContent = '📲 立即安裝 Ku Reader 應用程式至主畫面';
      }
    });

    // 綁定安裝按鈕點擊
    this.installBtn?.addEventListener('click', async () => {
      if (!this.deferredPrompt) {
        showToast('請使用瀏覽器選單中的「加到主畫面」或「安裝應用程式」');
        return;
      }

      this.deferredPrompt.prompt();
      const choiceResult = await this.deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        showToast('正在安裝 Ku Reader...');
        if (this.installBtn) this.installBtn.style.display = 'none';
      }
      this.deferredPrompt = null;
    });

    // 監聽安裝完成事件
    window.addEventListener('appinstalled', () => {
      showToast('🎉 Ku Reader 安裝成功！');
      if (this.installBtn) {
        this.installBtn.style.display = 'block';
        this.installBtn.disabled = true;
        this.installBtn.textContent = '✓ 應用程式已成功安裝！';
        this.installBtn.classList.replace('btn-primary', 'btn-secondary');
      }
      if (guideEl) guideEl.style.display = 'none';
      this.deferredPrompt = null;
    });
  }

  async updateStorageStats() {
    try {
      const books = await getAllBooks();
      const statsEl = document.getElementById('settings-storage-stats');
      if (statsEl) {
        statsEl.textContent = `書架目前收錄: ${books.length} 本書籍`;
      }
    } catch {
      // 靜默
    }
  }
}

export const settingsView = new SettingsViewController();
