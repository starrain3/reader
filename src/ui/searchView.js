/**
 * 搜尋視圖控制器 (Search View Controller)
 * 負責跨書源線上搜尋、小說詳情查看、加入書架與立即閱讀
 */

import { searchBooks, getBookDetailAndChapters } from '../services/sourceEngine.js';
import { getAllSources, saveBook, getBook } from '../db/index.js';
import { readerView } from './readerView.js';
import { bookshelfView } from './bookshelfView.js';
import { showToast } from './toast.js';
import { convertToTraditional } from '../services/opencc.js';

class SearchViewController {
  constructor() {
    this.searchInput = null;
    this.searchBtn = null;
    this.sourceSelect = null;
    this.resultsContainer = null;
    this.isSearching = false;
  }

  init() {
    this.searchInput = document.getElementById('search-input');
    this.searchBtn = document.getElementById('search-btn');
    this.sourceSelect = document.getElementById('search-source-select');
    this.resultsContainer = document.getElementById('search-results-container');

    this.bindEvents();
    this.loadSourceOptions();
  }

  async loadSourceOptions() {
    if (!this.sourceSelect) return;
    const sources = await getAllSources();
    this.sourceSelect.innerHTML = `
      <option value="">全部啟用書源 (${sources.filter((s) => s.enabled).length})</option>
      ${sources
        .filter((s) => s.enabled)
        .map((s) => `<option value="${s.id}">${s.name}</option>`)
        .join('')}
    `;
  }

  bindEvents() {
    this.searchBtn?.addEventListener('click', () => this.handleSearch());
    this.searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleSearch();
    });
  }

  async handleSearch() {
    const keyword = this.searchInput?.value.trim();
    if (!keyword) {
      showToast('請輸入小說名稱或作者');
      return;
    }

    if (this.isSearching) return;
    this.isSearching = true;
    this.searchBtn.textContent = '搜尋中...';
    this.resultsContainer.innerHTML = `
      <div style="text-align:center; padding: 60px 20px; color:var(--text-muted);">
        <p style="margin-bottom:8px;">🔍 正在穿透各大書源搜尋《${keyword}》...</p>
        <p style="font-size:12px;">（若等待過久，可至「設定」確認網路代理設定）</p>
      </div>
    `;

    try {
      const selectedSourceId = this.sourceSelect?.value || null;
      const results = await searchBooks(keyword, selectedSourceId);

      if (results.length === 0) {
        this.resultsContainer.innerHTML = `
          <div style="text-align:center; padding: 60px 20px; color:var(--text-muted);">
            <p style="font-size:16px; margin-bottom:8px;">無相關搜尋結果</p>
            <p style="font-size:12px; line-height:1.6;">建議換個關鍵字搜尋，或在「設定」中檢查代理連線是否正常</p>
          </div>
        `;
        return;
      }

      this.renderResults(results);
    } catch (err) {
      this.resultsContainer.innerHTML = `
        <div style="text-align:center; padding: 40px 20px; color:#ef4444;">
          <p style="font-weight:bold; margin-bottom:8px;">搜尋失敗</p>
          <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px; line-height:1.5;">${err.message}</p>
          <div style="display:flex; justify-content:center; gap:8px;">
            <button id="btn-retry-search" class="btn-sm btn-primary">重新搜尋</button>
            <button id="btn-goto-settings" class="btn-sm btn-secondary">前往「設定」輸入金鑰</button>
          </div>
        </div>
      `;
      document.getElementById('btn-retry-search')?.addEventListener('click', () => {
        this.handleSearch();
      });
      document.getElementById('btn-goto-settings')?.addEventListener('click', () => {
        document.querySelector('.nav-item[data-view="settings"]')?.click();
      });
    } finally {
      this.isSearching = false;
      this.searchBtn.textContent = '搜尋';
    }
  }

  renderResults(results) {
    this.resultsContainer.innerHTML = `
      <div class="search-results">
        ${results
          .map((item) => {
            const title = convertToTraditional(item.title);
            const author = convertToTraditional(item.author);
            const intro = convertToTraditional(item.intro || '暫無簡介');
            const coverStyle = item.cover ? `background-image: url('${item.cover}');` : '';

            return `
            <div class="search-item" data-id="${item.id}">
              <div class="search-item-cover" style="${coverStyle}"></div>
              <div class="search-item-content">
                <div>
                  <div class="search-item-title">${title}</div>
                  <div class="search-item-author">${author} · <span style="color:#38bdf8;">${item.sourceName}</span></div>
                  <div class="search-item-intro">${intro}</div>
                </div>
                <div class="search-item-actions">
                  <button class="btn-sm btn-secondary btn-add-shelf" data-url="${encodeURIComponent(item.bookUrl)}" data-source="${item.sourceId}">
                    ＋加入書架
                  </button>
                  <button class="btn-sm btn-primary btn-read-now" data-url="${encodeURIComponent(item.bookUrl)}" data-source="${item.sourceId}">
                    立即閱讀
                  </button>
                </div>
              </div>
            </div>
          `;
          })
          .join('')}
      </div>
    `;

    // 綁定加入書架與立即閱讀按鈕
    this.resultsContainer.querySelectorAll('.btn-add-shelf').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const bookUrl = decodeURIComponent(btn.dataset.url);
        const sourceId = btn.dataset.source;
        btn.textContent = '加入中...';
        btn.disabled = true;
        try {
          await this.addBookToShelf(bookUrl, sourceId);
          btn.textContent = '✓ 已在書架';
          showToast('成功加入書架！');
        } catch (err) {
          btn.textContent = '＋加入書架';
          btn.disabled = false;
          showToast(`加入失敗: ${err.message}`);
        }
      });
    });

    this.resultsContainer.querySelectorAll('.btn-read-now').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const bookUrl = decodeURIComponent(btn.dataset.url);
        const sourceId = btn.dataset.source;
        btn.textContent = '載入中...';
        btn.disabled = true;
        try {
          const book = await this.addBookToShelf(bookUrl, sourceId);
          readerView.openBook(book.id, 0);
        } catch (err) {
          btn.textContent = '立即閱讀';
          btn.disabled = false;
          showToast(`開啟失敗: ${err.message}`);
        }
      });
    });
  }

  async addBookToShelf(bookUrl, sourceId) {
    const sources = await getAllSources();
    const source = sources.find((s) => s.id === sourceId);
    if (!source) throw new Error('書源不存在');

    showToast('正在解析小說目錄大綱...');
    const detail = await getBookDetailAndChapters(bookUrl, source);

    if (!detail.chapters || detail.chapters.length === 0) {
      throw new Error('未成功解析到章節目錄，請更換書源');
    }

    const bookId = `${source.id}_${btoa(encodeURIComponent(bookUrl)).substring(0, 16)}`;

    // 檢查若已存在
    const existing = await getBook(bookId);
    if (existing) {
      return existing;
    }

    // 取得書籍名稱
    const matchedItem = this.resultsContainer.querySelector(`[data-url="${encodeURIComponent(bookUrl)}"]`);
    const cardEl = matchedItem?.closest('.search-item');
    const title = cardEl?.querySelector('.search-item-title')?.textContent || '未知小說';
    const author = cardEl?.querySelector('.search-item-author')?.textContent.split('·')[0].trim() || '未知作者';

    const newBook = {
      id: bookId,
      title,
      author,
      cover: detail.cover,
      intro: detail.intro,
      sourceId: source.id,
      sourceName: source.name,
      bookUrl,
      lastChapterIndex: 0,
      lastParagraphIndex: 0,
      lastChapterTitle: detail.chapters[0]?.title || '',
      chapters: detail.chapters.map((c) => ({
        index: c.index,
        title: c.title,
        url: c.url
      }))
    };

    await saveBook(newBook);
    bookshelfView.render();
    return newBook;
  }
}

export const searchView = new SearchViewController();
