/**
 * 書架視圖控制器 (Bookshelf View Controller)
 * 負責書籍展示、閱讀進度同步、本機 TXT/EPUB 匯入與整本離線快取
 */

import { getAllBooks, saveBook, deleteBook, saveChaptersBatch, getCachedChapterIndices } from '../db/index.js';
import { parseTxtFile, parseEpubFile } from '../services/fileParser.js';
import { readerView } from './readerView.js';
import { showToast } from './toast.js';
import { convertToTraditional } from '../services/opencc.js';

class BookshelfViewController {
  constructor() {
    this.container = null;
    this.txtInput = null;
    this.epubInput = null;
  }

  init() {
    this.container = document.getElementById('bookshelf-container');
    this.txtInput = document.getElementById('file-input-txt');
    this.epubInput = document.getElementById('file-input-epub');

    this.bindEvents();
    this.render();

    // 監聽閱讀器關閉事件，及時更新進度條
    window.addEventListener('reader:closed', () => {
      this.render();
    });
  }

  bindEvents() {
    // 匯入本地檔案選單
    document.getElementById('fab-import-txt')?.addEventListener('click', () => {
      this.txtInput?.click();
    });
    document.getElementById('fab-import-epub')?.addEventListener('click', () => {
      this.epubInput?.click();
    });

    this.txtInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      showToast('正在解析 TXT 檔案並劃分章節...');
      try {
        const bookData = await parseTxtFile(file);
        await this.importLocalBook(bookData);
        showToast(`成功匯入書籍: 《${bookData.title}》`);
        this.render();
      } catch (err) {
        showToast(`匯入失敗: ${err.message}`);
      }
      this.txtInput.value = '';
    });

    this.epubInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      showToast('正在解壓並解析 EPUB 檔案...');
      try {
        const bookData = await parseEpubFile(file);
        await this.importLocalBook(bookData);
        showToast(`成功匯入書籍: 《${bookData.title}》`);
        this.render();
      } catch (err) {
        showToast(`匯入失敗: ${err.message}`);
      }
      this.epubInput.value = '';
    });
  }

  async importLocalBook(bookData) {
    const chapters = bookData.chapters;
    // 書籍物件只保留章節元資訊以節省主表大小
    const bookToSave = {
      id: bookData.id,
      title: bookData.title,
      author: bookData.author,
      cover: bookData.cover,
      intro: bookData.intro,
      sourceId: bookData.sourceId,
      sourceName: bookData.sourceName,
      lastChapterIndex: 0,
      lastChapterTitle: chapters[0]?.title || '',
      chapters: chapters.map((c) => ({ index: c.index, title: c.title }))
    };

    await saveBook(bookToSave);

    // 批次快取內文至章節表
    const chapterRecords = chapters.map((c) => ({
      bookId: bookData.id,
      index: c.index,
      title: c.title,
      content: c.content
    }));
    await saveChaptersBatch(chapterRecords);
  }

  async render() {
    if (!this.container) return;
    const books = await getAllBooks();

    if (books.length === 0) {
      this.container.innerHTML = `
        <div style="text-align:center; padding: 80px 20px; color:var(--text-muted);">
          <div style="font-size: 48px; margin-bottom: 16px;">📖</div>
          <p style="font-size:16px; font-weight:600; color:#fff; margin-bottom:8px;">書架空空如也</p>
          <p style="font-size:13px; line-height: 1.6;">點擊右下角按鈕匯入本地 TXT / EPUB 書籍<br>或前往「發現」搜尋線上小說加入書架！</p>
        </div>
      `;
      return;
    }

    this.container.innerHTML = `
      <div class="bookshelf-grid">
        ${books.map((b) => this.renderBookCard(b)).join('')}
      </div>
    `;

    // 綁定點擊事件
    this.container.querySelectorAll('.book-card').forEach((card) => {
      const bookId = card.dataset.id;
      
      card.addEventListener('click', (e) => {
        // 若點擊的是更多選單按鈕則不觸發閱讀
        if (e.target.closest('.btn-book-more')) return;
        readerView.openBook(bookId);
      });

      card.querySelector('.btn-book-more')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showBookActionModal(bookId);
      });
    });
  }

  renderBookCard(book) {
    const totalChapters = book.chapters?.length || 1;
    const readIndex = (book.lastChapterIndex || 0) + 1;
    const progress = Math.min(100, Math.round((readIndex / totalChapters) * 100));
    const title = convertToTraditional(book.title);
    const author = convertToTraditional(book.author || '未知');

    const coverHtml = book.cover
      ? `<div class="book-cover" style="background-image: url('${book.cover}')"></div>`
      : `<div class="book-cover"><span style="font-weight:700;">${title.substring(0, 8)}</span></div>`;

    return `
      <div class="book-card" data-id="${book.id}">
        ${coverHtml}
        <span class="book-badge">${book.sourceName || '本地'}</span>
        <div class="book-info">
          <div class="book-name">${title}</div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div class="book-progress">${progress}% · ${author}</div>
            <button class="btn-book-more" style="background:none; border:none; color:var(--text-muted); padding:4px; cursor:pointer;">
              ⋮
            </button>
          </div>
        </div>
      </div>
    `;
  }

  async showBookActionModal(bookId) {
    const book = await getBook(bookId);
    if (!book) return;

    const action = confirm(
      `《${book.title}》\n\n- 按「確定」：刪除此書籍與離線內容\n- 按「取消」：返回`
    );

    if (action) {
      await deleteBook(bookId);
      showToast(`已刪除《${book.title}》`);
      this.render();
    }
  }
}

export const bookshelfView = new BookshelfViewController();
