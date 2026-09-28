/**
 * 智慧網路請求層 (Smart Network Adapter)
 * 支援 Capacitor 原生無 CORS 請求、Cloudflare Worker 代理與公開代理切換
 * 支援 GBK / Big5 / UTF-8 自動轉碼
 */

import { getSetting } from '../db/index.js';

// 預設備用代理列表
export const DEFAULT_PROXIES = [
  'https://corsproxy.io/?url=',
  'https://api.allorigins.win/raw?url='
];

/**
 * 取得當前配置的代理前綴
 */
export async function getActiveProxy() {
  const customProxy = await getSetting('custom_proxy', '');
  if (customProxy && customProxy.trim()) {
    return customProxy.trim();
  }
  return DEFAULT_PROXIES[0];
}

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
 * 發送 HTTP 請求並自動解碼文字 (支援 UTF-8, GBK, GB2312, Big5)
 * @param {string} url - 目標網址
 * @param {object} options - fetch 選項
 * @param {string} expectedCharset - 指定編碼 (若為 auto 則自動偵測 meta charset)
 */
export async function fetchText(url, options = {}, expectedCharset = 'auto') {
  // 1. 如果在 Capacitor 原生環境，使用原生 HTTP 插件繞過所有 CORS
  if (isCapacitorNative() && window.Capacitor.Plugins?.CapacitorHttp) {
    try {
      const response = await window.Capacitor.Plugins.CapacitorHttp.get({
        url,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 Chrome/116.0.0.0 Mobile Safari/537.36',
          ...options.headers
        },
        responseType: 'arraybuffer'
      });
      return decodeBuffer(response.data, expectedCharset);
    } catch (err) {
      console.warn('CapacitorHttp 請求失敗，退回代理模式:', err);
    }
  }

  // 2. 瀏覽器 / PWA 環境：使用 Proxy 轉發
  const proxy = await getActiveProxy();
  const targetUrl = proxy ? `${proxy}${encodeURIComponent(url)}` : url;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);

  try {
    const res = await fetch(targetUrl, {
      ...options,
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...options.headers
      }
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`HTTP 錯誤: ${res.status} ${res.statusText}`);
    }

    const buffer = await res.arrayBuffer();
    return decodeBuffer(buffer, expectedCharset);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('請求超時 (15秒)，請檢查網路或更換代理伺服器');
    }
    throw error;
  }
}

/**
 * 智慧解碼 ArrayBuffer
 */
function decodeBuffer(buffer, charset) {
  const bytes = new Uint8Array(buffer);

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
  const match = previewText.match(/<meta[^>]+charset=["']?([a-zA-Z0-9_-]+)/i) || 
                previewText.match(/charset=([a-zA-Z0-9_-]+)/i);

  let detectedCharset = 'utf-8';
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
