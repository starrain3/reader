/**
 * 智慧網路請求層 (Smart Network Adapter)
 * 支援 Capacitor 原生無 CORS 請求、專屬 Cloudflare Worker (含 API Key 認證)
 * 支援 GBK / Big5 / UTF-8 自動轉碼
 */

import { getSetting } from '../db/index.js';

// 預備公開代理 (備援用)
export const DEFAULT_PROXIES = [
  'https://api.allorigins.win/raw?url='
];

/**
 * 檢查是否運行於 Capacitor 原生環境 (APK)
 */
export function isCapacitorNative() {
  return typeof window !== 'undefined' && 
         window.Capacitor && 
         window.Capacitor.isNativePlatform && 
         window.Capacitor.isNativePlatform();
}

/**
 * 取得當前配置的代理伺服器網址與金鑰
 */
export async function getProxyConfig() {
  const workerUrl = (await getSetting('cf_worker_url', '')).trim();
  const apiKey = (await getSetting('cf_api_key', '')).trim();
  const legacyProxy = (await getSetting('custom_proxy', '')).trim();

  return {
    workerUrl: workerUrl || legacyProxy,
    apiKey
  };
}

/**
 * 測試 Cloudflare Worker 連線與金鑰是否正確
 */
export async function testCloudflareWorker(workerUrl, apiKey = '') {
  if (!workerUrl) throw new Error('請輸入 Cloudflare Worker 網址');

  let baseUrl = workerUrl.trim();
  if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

  const testUrl = `${baseUrl}?ping=1${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ''}`;

  const res = await fetch(testUrl, {
    headers: {
      'x-api-key': apiKey
    },
    signal: AbortSignal.timeout(8000)
  });

  if (res.status === 401) {
    throw new Error('金鑰驗證失敗 (401 Unauthorized)：請確認 Worker 設定的 API Key 與輸入的是否完全一致！');
  }

  if (!res.ok) {
    throw new Error(`Worker 回應錯誤: HTTP ${res.status}`);
  }

  const data = await res.json();
  return data;
}

/**
 * 發送 HTTP 請求並自動解碼文字 (支援 UTF-8, GBK, GB2312, Big5)
 * @param {string} url - 目標網址
 * @param {object} options - fetch 選項
 * @param {string} expectedCharset - 指定編碼 (若為 auto 則自動偵測 meta charset)
 */
export async function fetchText(url, options = {}, expectedCharset = 'auto') {
  // 1. 【APK 原生直連分支】：透過 Compile Option 切換，完全繞過 CORS，直連目標小說站
  if (__IS_APK__) {
    try {
      const { CapacitorHttp } = await import('@capacitor/core');
      const response = await CapacitorHttp.get({
        url,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
          ...options.headers
        },
        responseType: 'arraybuffer',
        connectTimeout: options.timeout || 15000,
        readTimeout: options.timeout || 15000
      });

      return decodeBuffer(response.data, expectedCharset);
    } catch (err) {
      console.error('[APK 原生網路請求失敗]:', err);
      throw new Error(`原生網路連線失敗: ${err.message || err}`);
    }
  }

  // 2. 【PWA 主線分支】：使用專屬 Cloudflare Worker 代理或自訂代理
  const { workerUrl, apiKey } = await getProxyConfig();

  let targetFetchUrl = '';
  const requestHeaders = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    ...options.headers
  };

  if (workerUrl) {
    let cleanUrl = workerUrl;
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);
    
    // 如果使用者填入的是已經帶有 ?url= 的完整前綴，或標準 worker 網址
    if (cleanUrl.includes('?url=')) {
      targetFetchUrl = `${cleanUrl}${encodeURIComponent(url)}${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ''}`;
    } else {
      targetFetchUrl = `${cleanUrl}?url=${encodeURIComponent(url)}${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ''}`;
    }

    if (apiKey) {
      requestHeaders['x-api-key'] = apiKey;
    }
  } else {
    // 未設定 Worker 代理時，提示使用者
    throw new Error('未設定專屬 Cloudflare Worker 代理與 API Key，請先前往「設定」分頁填入！');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);

  try {
    const res = await fetch(targetFetchUrl, {
      ...options,
      signal: controller.signal,
      headers: requestHeaders
    });

    clearTimeout(timeoutId);

    if (res.status === 401) {
      throw new Error('金鑰驗證失敗 (401 Unauthorized)：Worker 安全金鑰不相符，請至「設定」確認 API Key！');
    }

    if (!res.ok) {
      throw new Error(`HTTP 錯誤: ${res.status} ${res.statusText}`);
    }

    const buffer = await res.arrayBuffer();
    return decodeBuffer(buffer, expectedCharset);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('請求超時 (15秒)，請檢查網路或 Cloudflare Worker 狀態');
    }
    throw error;
  }
}

/**
 * 智慧解碼 ArrayBuffer / Base64 / Uint8Array
 */
function decodeBuffer(buffer, charset) {
  let bytes;
  if (buffer instanceof Uint8Array) {
    bytes = buffer;
  } else if (buffer instanceof ArrayBuffer) {
    bytes = new Uint8Array(buffer);
  } else if (typeof buffer === 'string') {
    // 支援 Base64 (Capacitor 原生 arraybuffer 回傳型態)
    try {
      const binaryString = atob(buffer);
      bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
    } catch {
      bytes = new TextEncoder().encode(buffer);
    }
  } else {
    bytes = new Uint8Array();
  }

  if (charset && charset !== 'auto') {
    try {
      const decoder = new TextDecoder(charset);
      return decoder.decode(bytes);
    } catch (e) {
      console.warn(`指定的編碼 ${charset} 不支援，嘗試自動辨識`);
    }
  }

  // 先以 utf-8 解碼前 2000 字元嘗試抓取 meta charset
  const previewText = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 2048));

  let detectedCharset = 'utf-8';
  const match = previewText.match(/charset=["']?([a-zA-Z0-9_-]+)/i);
  if (match && match[1]) {
    detectedCharset = match[1].toLowerCase();
    if (detectedCharset === 'gb2312') detectedCharset = 'gbk';
  }

  try {
    const decoder = new TextDecoder(detectedCharset);
    return decoder.decode(bytes);
  } catch (err) {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
