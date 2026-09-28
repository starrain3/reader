/**
 * 繁簡中文轉換模組 (基於 opencc-js)
 * 支援將簡體網路小說一鍵轉換為台灣繁體慣用語
 */

import * as OpenCC from 'opencc-js';

let s2tConverter = null;

export function getS2TConverter() {
  if (!s2tConverter) {
    try {
      s2tConverter = OpenCC.Converter({ from: 'cn', to: 'tw' });
    } catch (e) {
      console.warn('OpenCC 初始化失敗，退回原始文字:', e);
      s2tConverter = (str) => str;
    }
  }
  return s2tConverter;
}

/**
 * 簡轉繁轉換函數
 * @param {string} text
 * @param {boolean} enabled - 是否啟用轉換
 */
export function convertToTraditional(text, enabled = true) {
  if (!enabled || !text) return text;
  const conv = getS2TConverter();
  return conv(text);
}
