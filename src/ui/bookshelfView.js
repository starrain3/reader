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
    this.isManaging = false;
    this.pendingDeleteBookId = null;
    this.deleteModal = null;
  }

  init() {
    this.container = document.getElementById('bookshelf-container');
    this.txtInput = document.getElementById('file-input-txt');
    this.epubInput = document.getElementById('file-input-epub');
    this.deleteModal = document.getElementById('book-delete-modal');

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

    // 刪除彈窗按鈕事件
    document.getElementById('btn-cancel-delete-book')?.addEventListener('click', () => {
      this.closeDeleteModal();
    });

    document.getElementById('btn-confirm-delete-book')?.addEventListener('click', () => {
      this.confirmDeleteBook();
    });

    this.deleteModal?.addEventListener('click', (e) => {
      if (e.target === this.deleteModal) {
        this.closeDeleteModal();
      }
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
      lastParagraphIndex: 0,
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
      this.isManaging = false;
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
      <div class="bookshelf-toolbar">
        <span style="font-size:13px; color:var(--text-muted);">共 ${books.length} 本書籍</span>
        <button id="btn-toggle-manage" class="btn-sm ${this.isManaging ? 'btn-primary' : 'btn-secondary'}" style="font-size:12px; padding:4px 10px;">
          ${this.isManaging ? '✓ 完成' : '⚙️ 管理書籍'}
        </button>
      </div>
      <div class="bookshelf-grid">
        ${books.map((b) => this.renderBookCard(b)).join('')}
      </div>
    `;

    // 綁定管理模式切換按鈕
    document.getElementById('btn-toggle-manage')?.addEventListener('click', () => {
      this.isManaging = !this.isManaging;
      this.render();
    });

    // 綁定卡片點擊與長按事件
    this.container.querySelectorAll('.book-card').forEach((card) => {
      const bookId = card.dataset.id;
      let longPressTimer = null;
      let isLongPressTriggered = false;

      // 長按事件支援 (行動裝置與滑鼠長按 500ms 喚起刪除)
      const startLongPress = () => {
        isLongPressTriggered = false;
        longPressTimer = setTimeout(() => {
          isLongPressTriggered = true;
          this.showDeleteModal(bookId);
        }, 500);
      };

      const cancelLongPress = () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      };

      card.addEventListener('touchstart', startLongPress, { passive: true });
      card.addEventListener('touchend', cancelLongPress);
      card.addEventListener('touchmove', cancelLongPress);
      card.addEventListener('mousedown', startLongPress);
      card.addEventListener('mouseup', cancelLongPress);
      card.addEventListener('mouseleave', cancelLongPress);

      card.addEventListener('click', (e) => {
        if (isLongPressTriggered) {
          isLongPressTriggered = false;
          return;
        }
        // 若點擊的是刪除徽章或刪除按鈕
        if (e.target.closest('.btn-card-delete-badge') || e.target.closest('.btn-book-delete')) {
          return;
        }
        // 在管理模式下點擊卡片直接開啟刪除確認
        if (this.isManaging) {
          this.showDeleteModal(bookId);
          return;
        }
        readerView.openBook(bookId);
      });

      // 管理模式下的紅色刪除徽章
      card.querySelector('.btn-card-delete-badge')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showDeleteModal(bookId);
      });

      // 卡片右下角的垃圾桶刪除按鈕
      card.querySelector('.btn-book-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showDeleteModal(bookId);
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

    const badgeHtml = this.isManaging
      ? `<button class="btn-card-delete-badge" title="刪除此書" data-id="${book.id}">✕</button>`
      : `<span class="book-badge">${book.sourceName || '本地'}</span>`;

    return `
      <div class="book-card ${this.isManaging ? 'is-managing' : ''}" data-id="${book.id}">
        ${coverHtml}
        ${badgeHtml}
        <div class="book-info">
          <div class="book-name">${title}</div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div class="book-progress">${progress}% · ${author}</div>
            <button class="btn-book-delete" title="刪除書籍" data-id="${book.id}">
              🗑️
            </button>
          </div>
        </div>
      </div>
    `;
  }

  async showDeleteModal(bookId) {
    const book = await getBook(bookId);
    if (!book) return;

    this.pendingDeleteBookId = bookId;
    const titleEl = document.getElementById('delete-modal-book-title');
    if (titleEl) {
      titleEl.textContent = `《${convertToTraditional(book.title)}》`;
    }
    if (this.deleteModal) {
      this.deleteModal.style.display = 'flex';
    }
  }

  closeDeleteModal() {
    this.pendingDeleteBookId = null;
    if (this.deleteModal) {
      this.deleteModal.style.display = 'none';
    }
  }

  async confirmDeleteBook() {
    if (!this.pendingDeleteBookId) return;
    const bookId = this.pendingDeleteBookId;
    const book = await getBook(bookId);
    const title = book ? book.title : '';
    this.closeDeleteModal();

    try {
      await deleteBook(bookId);
      showToast(`已將《${convertToTraditional(title)}》從書架移除`);
      await this.render();
    } catch (err) {
      showToast(`刪除失敗: ${err.message}`);
    }
  }
}

export const bookshelfView = new BookshelfViewController();
