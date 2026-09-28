/**
 * 設定視圖控制器 (Settings View Controller)
 * 負責網路代理 (CORS Proxy)、快取清理、PWA 安裝指引與 Cloudflare Worker 部署說明
 */

import { getSetting, saveSetting, openDB, getAllBooks } from '../db/index.js';
import { DEFAULT_PROXIES, fetchText } from '../services/network.js';
import { showToast } from './toast.js';

class SettingsViewController {
  constructor() {
    this.proxyInput = null;
    this.testBtn = null;
    this.clearCacheBtn = null;
  }

  async init() {
    this.proxyInput = document.getElementById('settings-proxy-input');
    this.testBtn = document.getElementById('btn-test-proxy');
    this.clearCacheBtn = document.getElementById('btn-clear-cache');

    const currentProxy = await getSetting('custom_proxy', DEFAULT_PROXIES[0]);
    if (this.proxyInput) {
      this.proxyInput.value = currentProxy;
    }

    this.bindEvents();
    this.updateStorageStats();
  }

  bindEvents() {
    // 儲存代理設定
    document.getElementById('btn-save-proxy')?.addEventListener('click', async () => {
      const val = this.proxyInput?.value.trim();
      await saveSetting('custom_proxy', val);
      showToast('已更新代理設定！');
    });

    // 測試代理連線
    this.testBtn?.addEventListener('click', async () => {
      this.testBtn.textContent = '連線測試中...';
      this.testBtn.disabled = true;
      const startTime = Date.now();
      try {
        // 測試抓取輕量目標網址
        const testUrl = 'https://httpbin.org/get';
        const res = await fetchText(testUrl, { timeout: 8000 });
        const latency = Date.now() - startTime;
        showToast(`✓ 連線正常！延遲: ${latency}ms`);
      } catch (err) {
        alert(`代理連線失敗: ${err.message}\n建議檢查 URL 前綴或使用 Cloudflare Worker。`);
      } finally {
        this.testBtn.textContent = '測試連線';
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
