/**
 * 書源爬蟲與規則解析引擎 (Book Source Parsing Engine)
 * 支援 DOM 選擇器動態解析、相對路徑補全與內文清理
 */

import { fetchText } from './network.js';
import { getAllSources, saveSource } from '../db/index.js';
import { DEFAULT_BOOK_SOURCES } from './defaultSources.js';
import GBK from 'fast-gbk';

/**
 * 輔助：依書源編碼需求對關鍵字進行網址百分比編碼
 */
export function encodeKeyword(keyword, charset = 'utf-8') {
  if (charset && (charset.toLowerCase() === 'gbk' || charset.toLowerCase() === 'gb2312')) {
    try {
      const bytes = GBK.encode(keyword);
      return Array.from(bytes)
        .map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0'))
        .join('');
    } catch (e) {
      console.warn('GBK 編碼轉換失敗，退回 UTF-8:', e);
    }
  }
  return encodeURIComponent(keyword);
}

/**
 * 初始化預設書源至 IndexedDB (具備版本更新與既有規則同步機制)
 */
export async function initDefaultSources() {
  const existing = await getAllSources();
  if (!existing || existing.length === 0) {
    for (const source of DEFAULT_BOOK_SOURCES) {
      await saveSource(source);
    }
    return DEFAULT_BOOK_SOURCES;
  }

  // 自動同步預設書源的新增與修復規則
  for (const defSource of DEFAULT_BOOK_SOURCES) {
    const matchIndex = existing.findIndex((s) => s.id === defSource.id);
    if (matchIndex === -1) {
      await saveSource(defSource);
      existing.push(defSource);
    } else {
      const updated = { ...existing[matchIndex], ...defSource };
      await saveSource(updated);
      existing[matchIndex] = updated;
    }
  }

  // 停用已知失效的舊預設書源 (如 biqu5200, shuba69)
  for (const old of existing) {
    if (['biqu5200', 'shuba69'].includes(old.id)) {
      old.enabled = false;
      await saveSource(old);
    }
  }

  return existing;
}

/**
 * 輔助：安全將相對網址轉為完整網址
 */
function resolveUrl(href, base) {
  if (!href) return '';
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/**
 * 依關鍵字搜尋書籍
 * @param {string} keyword
 * @param {string} [specificSourceId] - 若指定則只搜該源，否則搜所有啟用的書源
 */
export async function searchBooks(keyword, specificSourceId = null) {
  const sources = await getAllSources();
  const targetSources = sources.filter(
    (s) => s.enabled && (!specificSourceId || s.id === specificSourceId)
  );

  if (targetSources.length === 0) {
    throw new Error('未啟用任何書源，請先在書源管理中啟用');
  }

  const results = [];

  // 平行發起搜尋請求
  const promises = targetSources.map(async (source) => {
    try {
      const encodedKw = encodeKeyword(keyword, source.charset || 'utf-8');
      const searchUrl = source.searchUrl.replace('{keyword}', encodedKw);
      const html = await fetchText(searchUrl, {}, source.charset || 'auto');
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // 1. 常規列表搜尋結果解析
      const items = doc.querySelectorAll(source.searchListSelector);
      items.forEach((item) => {
        const titleEl = source.titleSelector ? item.querySelector(source.titleSelector) : item;
        const authorEl = source.authorSelector ? item.querySelector(source.authorSelector) : null;
        const linkEl = source.bookUrlSelector ? item.querySelector(source.bookUrlSelector) : item.querySelector('a');
        const coverEl = source.coverSelector ? item.querySelector(source.coverSelector) : null;
        const introEl = source.introSelector ? item.querySelector(source.introSelector) : null;

        const title = titleEl ? titleEl.textContent.trim() : '';
        const author = authorEl ? authorEl.textContent.replace(/(作\s*者[:：]|著)/g, '').trim() : '未知';
        const rawLink = linkEl ? linkEl.getAttribute('href') : '';
        const bookUrl = resolveUrl(rawLink, source.baseUrl);
        const cover = coverEl ? resolveUrl(coverEl.getAttribute('src') || coverEl.getAttribute('data-src'), source.baseUrl) : '';
        const intro = introEl ? introEl.textContent.trim() : '';

        if (title && bookUrl) {
          results.push({
            id: `${source.id}_${btoa(encodeURIComponent(bookUrl)).substring(0, 16)}`,
            title,
            author,
            cover,
            intro,
            sourceId: source.id,
            sourceName: source.name,
            bookUrl,
            charset: source.charset || 'auto'
          });
        }
      });

      // 2. 特殊情況：若搜尋結果精確命中跳轉至小說書籍詳情頁 (如飄天文學/杰奇系統)
      if (items.length === 0 && doc.querySelector('h1')) {
        const h1 = doc.querySelector('h1').textContent.trim();
        if (h1 && (h1.includes(keyword) || keyword.includes(h1))) {
          const detailCoverEl = source.detailCoverSelector ? doc.querySelector(source.detailCoverSelector) : null;
          const cover = detailCoverEl ? resolveUrl(detailCoverEl.getAttribute('src') || detailCoverEl.getAttribute('data-src'), source.baseUrl) : '';
          
          results.push({
            id: `${source.id}_${btoa(encodeURIComponent(searchUrl)).substring(0, 16)}`,
            title: h1,
            author: '熱門作者',
            cover,
            intro: '點擊查看小說章節目錄與閱讀',
            sourceId: source.id,
            sourceName: source.name,
            bookUrl: searchUrl,
            charset: source.charset || 'auto'
          });
        }
      }
    } catch (err) {
      console.warn(`[書源 ${source.name}] 搜尋出錯:`, err.message);
    }
  });

  await Promise.allSettled(promises);
  return results;
}

/**
 * 取得書籍完整詳情與目錄章節清單
 */
export async function getBookDetailAndChapters(bookUrl, source) {
  const html = await fetchText(bookUrl, {}, source.charset || 'auto');
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // 解析封面、簡介與最新章節
  const coverEl = source.detailCoverSelector ? doc.querySelector(source.detailCoverSelector) : null;
  const introEl = source.detailIntroSelector ? doc.querySelector(source.detailIntroSelector) : null;
  const latestEl = source.detailLatestChapterSelector ? doc.querySelector(source.detailLatestChapterSelector) : null;

  const cover = coverEl ? resolveUrl(coverEl.getAttribute('src') || coverEl.getAttribute('data-src'), bookUrl) : '';
  const intro = introEl ? introEl.textContent.trim() : '';
  const latestChapter = latestEl ? latestEl.textContent.trim() : '';

  // 解析章節列表
  let chapterEls = doc.querySelectorAll(source.chapterListSelector);

  // 如果在詳情頁未直接找到章節列表，自動尋找「點擊閱讀」或目錄分頁連結
  if (chapterEls.length === 0) {
    const catalogLinkEl = doc.querySelector('a[title*="点击阅读"], a[title*="點擊閱讀"], a[href*="/html/"]');
    if (catalogLinkEl) {
      const catalogUrl = resolveUrl(catalogLinkEl.getAttribute('href'), bookUrl);
      if (catalogUrl && catalogUrl !== bookUrl) {
        try {
          const catHtml = await fetchText(catalogUrl, {}, source.charset || 'auto');
          const catDoc = new DOMParser().parseFromString(catHtml, 'text/html');
          chapterEls = catDoc.querySelectorAll(source.chapterListSelector);
          bookUrl = catalogUrl;
        } catch (e) {
          console.warn('載入章節目錄子頁面出錯:', e);
        }
      }
    }
  }

  const chapters = [];
  const seenUrls = new Set();

  chapterEls.forEach((el) => {
    const title = el.textContent.trim();
    const rawHref = el.getAttribute('href');
    const url = resolveUrl(rawHref, bookUrl);

    if (title && url && !seenUrls.has(url)) {
      seenUrls.add(url);
      chapters.push({
        index: chapters.length,
        title,
        url
      });
    }
  });

  return {
    cover,
    intro,
    latestChapter,
    chapters
  };
}

/**
 * 抓取並解析單一章節的內文
 */
export async function getChapterContent(chapterUrl, source) {
  const html = await fetchText(chapterUrl, {}, source.charset || 'auto');
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const contentEl = doc.querySelector(source.contentSelector);
  if (!contentEl) {
    throw new Error('未找到章節內文，可能章節選擇器失效或網頁結構變更');
  }

  // 移除常見的腳本與隱藏元素
  contentEl.querySelectorAll('script, style, ins, .ads, iframe, header, footer').forEach((el) => el.remove());

  // 替換 <br> 為換行
  contentEl.innerHTML = contentEl.innerHTML.replace(/<br\s*[\/]?>/gi, '\n');

  let text = contentEl.textContent || '';

  // 過濾正則規則 (廣告與宣傳語)
  if (source.filterRegex) {
    try {
      const reg = new RegExp(source.filterRegex, 'gi');
      text = text.replace(reg, '');
    } catch (e) {
      console.warn('正則過濾表達式錯誤:', e);
    }
  }

  // 整理段落：將多餘空格修整，保留標準兩字縮排
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.join('\n\n');
}
