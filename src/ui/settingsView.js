/**
 * 設定視圖控制器 (Settings View Controller)
 * 負責網路代理 (CORS Proxy)、快取清理、PWA 安裝指引與 Cloudflare Worker 部署說明
 */

import { getSetting, saveSetting, openDB, getAllBooks } from '../db/index.js';
import { testCloudflareWorker } from '../services/network.js';
import { showToast } from './toast.js';

class SettingsViewController {
  constructor() {
    this.workerUrlInput = null;
    this.apiKeyInput = null;
    this.testBtn = null;
    this.clearCacheBtn = null;
  }

  async init() {
    this.workerUrlInput = document.getElementById('settings-worker-url');
    this.apiKeyInput = document.getElementById('settings-api-key');
    this.testBtn = document.getElementById('btn-test-proxy');
    this.clearCacheBtn = document.getElementById('btn-clear-cache');

    const savedWorkerUrl = await getSetting('cf_worker_url', '');
    const savedApiKey = await getSetting('cf_api_key', '');

    if (this.workerUrlInput) this.workerUrlInput.value = savedWorkerUrl;
    if (this.apiKeyInput) this.apiKeyInput.value = savedApiKey;

    this.bindEvents();
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
