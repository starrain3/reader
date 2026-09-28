/**
 * 書源爬蟲與規則解析引擎 (Book Source Parsing Engine)
 * 支援 DOM 選擇器動態解析、相對路徑補全與內文清理
 */

import { fetchText } from './network.js';
import { getAllSources, saveSource } from '../db/index.js';
import { DEFAULT_BOOK_SOURCES } from './defaultSources.js';

/**
 * 初始化預設書源至 IndexedDB
 */
export async function initDefaultSources() {
  const existing = await getAllSources();
  if (!existing || existing.length === 0) {
    for (const source of DEFAULT_BOOK_SOURCES) {
      await saveSource(source);
    }
    return DEFAULT_BOOK_SOURCES;
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
      const searchUrl = source.searchUrl.replace('{keyword}', encodeURIComponent(keyword));
      const html = await fetchText(searchUrl, {}, source.charset || 'auto');
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

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
  const chapterEls = doc.querySelectorAll(source.chapterListSelector);
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
