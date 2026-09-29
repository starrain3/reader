/**
 * 文字壓縮與解壓縮服務模組 (Compression Service)
 * 使用 Web 原生 CompressionStream / DecompressionStream (gzip)
 * 專為小說大量章節內文儲存瘦身設計，零第三方依賴，支援向後相容。
 */

/**
 * 將字串進行 Gzip 壓縮為 Uint8Array
 * @param {string} text - 原始純文字
 * @returns {Promise<Uint8Array|string>} - 壓縮後的 Uint8Array (若不支援或失敗則回傳原字串)
 */
export async function compressText(text) {
  if (!text || typeof text !== 'string') return text;
  if (typeof CompressionStream === 'undefined') {
    return text;
  }

  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch (err) {
    console.warn('[Compression] 章節壓縮失敗，降級儲存原始文字:', err);
    return text;
  }
}

/**
 * 將 Gzip 壓縮的 Uint8Array / ArrayBuffer 解壓縮為純文字字串
 * @param {Uint8Array|ArrayBuffer|string} data - 壓縮資料或歷史純文字
 * @returns {Promise<string>} - 解壓還原後的純文字字串
 */
export async function decompressText(data) {
  if (!data) return '';
  // 1. 若本身已是字串（向後相容未壓縮的歷史快取）
  if (typeof data === 'string') return data;

  const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);

  // 2. 檢查 Gzip Magic Bytes (0x1f, 0x8b)
  const isGzip = uint8.length >= 2 && uint8[0] === 0x1f && uint8[1] === 0x8b;
  if (!isGzip || typeof DecompressionStream === 'undefined') {
    try {
      return new TextDecoder('utf-8').decode(uint8);
    } catch (e) {
      return '';
    }
  }

  try {
    const stream = new Blob([uint8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch (err) {
    console.warn('[Compression] 章節解壓失敗，嘗試降級解碼:', err);
    try {
      return new TextDecoder('utf-8').decode(uint8);
    } catch (e) {
      return '';
    }
  }
}
