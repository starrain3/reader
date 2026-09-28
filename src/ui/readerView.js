/**
 * 閱讀器視圖控制器 (Reader View Controller)
 * 沉浸式排版、觸控翻頁、字體與主題調整、章節預加載、繁簡轉換與 TTS 整合
 */

import { getBook, saveBook, getChapter, saveChapter, getAllSources, getSetting, saveSetting, getCachedChapterIndices } from '../db/index.js';
import { getChapterContent } from '../services/sourceEngine.js';
import { convertToTraditional } from '../services/opencc.js';
import { tts } from '../services/tts.js';
import { showToast } from './toast.js';

class ReaderViewController {
  constructor() {
    this.currentBook = null;
    this.currentChapterIndex = 0;
    this.currentChapter = null;
    this.isMenuVisible = false;
    this.fontSize = 18;
    this.lineHeight = 1.8;
    this.theme = 'theme-parchment';
    this.openccEnabled = true;
    this.sourcesMap = new Map();

    // DOM 元素引用
    this.viewEl = null;
    this.contentBox = null;
    this.topBar = null;
    this.bottomBar = null;
    this.titleEl = null;
    this.drawerMask = null;
    this.drawerList = null;
    this.slider = null;
    this.statusChapterEl = null;
    this.ttsBar = null;
    this.downloadModal = null;
    this.isDownloading = false;
    this.cancelDownloadFlag = false;

    // 連續滾動章節狀態
    this.renderedChapters = new Map();
    this.lowestRenderedIndex = 0;
    this.highestRenderedIndex = 0;
    this.isLoadingNext = false;
    this.isLoadingPrev = false;
  }

  async init() {
    this.viewEl = document.getElementById('view-reader');
    this.contentBox = document.getElementById('reader-content-box');
    this.topBar = document.getElementById('reader-top-bar');
    this.bottomBar = document.getElementById('reader-bottom-bar');
    this.titleEl = document.getElementById('reader-bar-title');
    this.drawerMask = document.getElementById('reader-drawer-mask');
    this.drawerList = document.getElementById('reader-drawer-list');
    this.slider = document.getElementById('reader-chapter-slider');
    this.statusChapterEl = document.getElementById('status-chapter-name');
    this.statusTimeEl = document.getElementById('status-current-time');
    this.ttsBar = document.getElementById('reader-tts-bar');
    this.downloadModal = document.getElementById('reader-download-modal');

    // 載入偏好設定
    this.fontSize = await getSetting('reader_font_size', 18);
    this.lineHeight = await getSetting('reader_line_height', 1.8);
    this.theme = await getSetting('reader_theme', 'theme-parchment');
    this.openccEnabled = await getSetting('reader_opencc', true);

    this.applyTheme(this.theme);
    this.applyTypography();
    this.bindEvents();
    this.startClock();
  }

  bindEvents() {
    // 智能內容區點擊判定：左右 25% 翻頁，中間 50% 選單，自動排除按鈕點擊與文字選取
    this.contentBox?.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, select')) return;
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) return;

      const rect = this.contentBox.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;

      if (clickX < width * 0.25) {
        this.scrollPage(-1);
      } else if (clickX > width * 0.75) {
        this.scrollPage(1);
      } else {
        this.toggleMenu();
      }
    });

    // 連續滾動監聽：滑動接近底部時自動載入追加下一章，並動態偵測當前可見章節
    this.contentBox?.addEventListener('scroll', () => {
      this.handleContinuousScroll();
    });

    // 頂部返回按鈕
    document.getElementById('reader-btn-back')?.addEventListener('click', () => {
      this.closeReader();
    });

    // 下載 / 離線快取按鈕
    document.getElementById('reader-btn-download')?.addEventListener('click', () => {
      this.openDownloadModal();
    });

    // 關閉下載彈窗
    document.getElementById('download-modal-close')?.addEventListener('click', () => {
      this.closeDownloadModal();
    });
    this.downloadModal?.addEventListener('click', (e) => {
      if (e.target === this.downloadModal) this.closeDownloadModal();
    });

    // 下載選項按鈕
    document.getElementById('btn-cache-next-50')?.addEventListener('click', () => {
      this.startBatchDownload(50);
    });
    document.getElementById('btn-cache-next-100')?.addEventListener('click', () => {
      this.startBatchDownload(100);
    });
    document.getElementById('btn-cache-all')?.addEventListener('click', () => {
      this.startBatchDownload(Infinity);
    });
    document.getElementById('btn-cancel-download')?.addEventListener('click', () => {
      this.cancelDownload();
    });

    // 匯出 TXT 按鈕
    document.getElementById('btn-export-txt')?.addEventListener('click', () => {
      this.exportBookToTxt();
    });

    // 目錄按鈕
    document.getElementById('reader-btn-toc')?.addEventListener('click', () => {
      this.openDrawer();
    });

    // 目錄遮罩點擊關閉
    this.drawerMask?.addEventListener('click', (e) => {
      if (e.target === this.drawerMask) this.closeDrawer();
    });
    document.getElementById('drawer-btn-close')?.addEventListener('click', () => {
      this.closeDrawer();
    });

    // 上一章 / 下一章按鈕
    document.getElementById('btn-prev-chapter')?.addEventListener('click', () => {
      this.changeChapter(this.currentChapterIndex - 1);
    });
    document.getElementById('btn-next-chapter')?.addEventListener('click', () => {
      this.changeChapter(this.currentChapterIndex + 1);
    });

    // 章節進度滑桿
    this.slider?.addEventListener('change', (e) => {
      const targetIdx = parseInt(e.target.value, 10);
      this.changeChapter(targetIdx);
    });

    // 字體縮小 / 放大
    document.getElementById('btn-font-dec')?.addEventListener('click', () => {
      this.adjustFontSize(-2);
    });
    document.getElementById('btn-font-inc')?.addEventListener('click', () => {
      this.adjustFontSize(2);
    });

    // 繁簡切換
    const openccBtn = document.getElementById('btn-toggle-opencc');
    openccBtn?.addEventListener('click', async () => {
      this.openccEnabled = !this.openccEnabled;
      await saveSetting('reader_opencc', this.openccEnabled);
      openccBtn.classList.toggle('active', this.openccEnabled);
      this.renderAllRenderedChapters();
      showToast(this.openccEnabled ? '已切換為：繁體模式' : '已切換為：原始文字');
    });

    // 主題選擇按鈕
    document.querySelectorAll('.theme-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const theme = pill.dataset.theme;
        this.applyTheme(theme);
      });
    });

    // 語音朗讀 (TTS) 按鈕
    document.getElementById('reader-btn-tts')?.addEventListener('click', () => {
      this.toggleTTS();
    });

    // TTS 懸浮控制條按鈕
    document.getElementById('tts-btn-play')?.addEventListener('click', () => {
      tts.toggle();
      this.updateTTSUI();
    });
    document.getElementById('tts-btn-stop')?.addEventListener('click', () => {
      tts.stop();
      this.hideTTS();
    });
    document.getElementById('tts-btn-faster')?.addEventListener('click', () => {
      const newRate = tts.rate + 0.25;
      tts.setRate(newRate);
      showToast(`語速: ${newRate.toFixed(2)}x`);
    });

    // 目錄搜尋框
    document.getElementById('drawer-search-input')?.addEventListener('input', (e) => {
      this.filterDrawerList(e.target.value.trim());
    });
  }

  startClock() {
    const updateTime = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      if (this.statusTimeEl) this.statusTimeEl.textContent = `${hours}:${mins}`;
    };
    updateTime();
    setInterval(updateTime, 30000);
  }

  applyTheme(themeName) {
    this.theme = themeName;
    saveSetting('reader_theme', themeName);

    if (this.viewEl) {
      const isActive = this.currentBook !== null;
      this.viewEl.className = `${isActive ? 'active' : ''} ${themeName}`.trim();
    }

    document.querySelectorAll('.theme-pill').forEach((pill) => {
      pill.classList.toggle('selected', pill.dataset.theme === themeName);
    });
  }

  applyTypography() {
    if (this.contentBox) {
      this.contentBox.style.fontSize = `${this.fontSize}px`;
      this.contentBox.style.lineHeight = `${this.lineHeight}`;
    }
  }

  adjustFontSize(delta) {
    this.fontSize = Math.max(14, Math.min(32, this.fontSize + delta));
    saveSetting('reader_font_size', this.fontSize);
    this.applyTypography();
    showToast(`字體大小: ${this.fontSize}px`);
  }

  toggleMenu() {
    this.isMenuVisible = !this.isMenuVisible;
    this.topBar?.classList.toggle('show', this.isMenuVisible);
    this.bottomBar?.classList.toggle('show', this.isMenuVisible);
  }

  hideMenu() {
    this.isMenuVisible = false;
    this.topBar?.classList.remove('show');
    this.bottomBar?.classList.remove('show');
  }

  scrollPage(direction) {
    if (!this.contentBox) return;
    const clientHeight = this.contentBox.clientHeight;
    const scrollAmount = (clientHeight - 40) * direction;

    this.contentBox.scrollBy({
      top: scrollAmount,
      behavior: 'smooth'
    });
  }

  /**
   * 打開書籍開始閱讀
   * @param {string} bookId
   * @param {number} [startChapterIndex]
   */
  async openBook(bookId, startChapterIndex = null) {
    const book = await getBook(bookId);
    if (!book) {
      showToast('找不到該書籍');
      return;
    }

    this.currentBook = book;
    this.currentChapterIndex = startChapterIndex !== null ? startChapterIndex : (book.lastChapterIndex || 0);

    // 快取書源對照表
    const sources = await getAllSources();
    this.sourcesMap.clear();
    sources.forEach((s) => this.sourcesMap.set(s.id, s));

    // 顯示閱讀器
    this.viewEl?.classList.add('active');
    this.applyTheme(this.theme);
    this.hideMenu();

    // 更新進度條最大值
    if (this.slider && book.chapters) {
      this.slider.max = Math.max(0, book.chapters.length - 1);
      this.slider.value = this.currentChapterIndex;
    }

    await this.loadChapter(this.currentChapterIndex);
    this.renderDrawer();
  }

  closeReader() {
    this.cancelDownload();
    this.closeDownloadModal();
    this.currentBook = null;
    tts.stop();
    this.hideTTS();
    this.hideMenu();
    this.closeDrawer();
    this.viewEl?.classList.remove('active');

    // 觸發自定義事件通知外層刷新書架進度
    window.dispatchEvent(new CustomEvent('reader:closed'));
  }

  async changeChapter(newIndex) {
    if (!this.currentBook || !this.currentBook.chapters) return;
    if (newIndex < 0 || newIndex >= this.currentBook.chapters.length) return;

    this.currentChapterIndex = newIndex;
    if (this.slider) this.slider.value = newIndex;

    // 儲存進度至資料庫
    this.currentBook.lastChapterIndex = newIndex;
    this.currentBook.lastChapterTitle = this.currentBook.chapters[newIndex]?.title || '';
    await saveBook(this.currentBook);

    await this.loadChapter(newIndex);
  }

  async loadChapter(index) {
    const chapterMeta = this.currentBook?.chapters?.[index];
    if (!chapterMeta) return;

    this.contentBox.innerHTML = `
      <div style="display:flex; justify-content:center; align-items:center; height:60vh; color:var(--text-muted);">
        <span>正在載入章節內容...</span>
      </div>
    `;

    this.renderedChapters.clear();
    this.lowestRenderedIndex = index;
    this.highestRenderedIndex = index;
    this.currentChapterIndex = index;
    this.isLoadingNext = false;
    this.isLoadingPrev = false;

    // 嘗試取得章節內容
    const chapterData = await this.fetchChapterData(index);
    if (!chapterData) {
      this.contentBox.innerHTML = `
        <div style="text-align:center; padding: 40px 20px; color:#ef4444;">
          <p style="font-weight:bold; margin-bottom:12px;">載入章節失敗</p>
          <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">無法取得章節內文，請確認網路連線或稍後重試</p>
          <div style="display:flex; justify-content:center; gap:10px;">
            <button id="btn-retry-chapter" class="btn-sm btn-primary">重新嘗試載入</button>
            <button id="btn-chapter-error-back" class="btn-sm btn-secondary">← 返回書架</button>
          </div>
        </div>
      `;
      document.getElementById('btn-retry-chapter')?.addEventListener('click', () => {
        this.loadChapter(index);
      });
      document.getElementById('btn-chapter-error-back')?.addEventListener('click', () => {
        this.closeReader();
      });
      return;
    }

    this.renderedChapters.set(index, chapterData);
    this.currentChapter = chapterData;

    this.contentBox.innerHTML = this.buildChapterHTML(chapterData, true);
    this.contentBox.scrollTop = 0;

    await this.updateActiveChapterUI(index);

    // 背景智慧預加載下一章
    this.prefetchNextChapter(index + 1);
  }

  /**
   * 輔助抓取指定章節資料 (先快取後網路)
   */
  async fetchChapterData(index) {
    if (!this.currentBook || !this.currentBook.chapters) return null;
    const chapterMeta = this.currentBook.chapters[index];
    if (!chapterMeta) return null;

    let chapterData = await getChapter(this.currentBook.id, index);

    if (!chapterData || !chapterData.content) {
      if (this.currentBook.sourceId !== 'local' && chapterMeta.url) {
        let source = this.sourcesMap.get(this.currentBook.sourceId);
        if (!source) {
          const sources = await getAllSources();
          source = sources.find((s) => s.id === this.currentBook.sourceId);
        }

        if (source) {
          try {
            const content = await getChapterContent(chapterMeta.url, source);
            chapterData = {
              bookId: this.currentBook.id,
              index,
              title: chapterMeta.title,
              url: chapterMeta.url,
              content
            };
            await saveChapter(chapterData);
          } catch (err) {
            console.warn(`抓取章節出錯 #${index}:`, err);
            return null;
          }
        }
      } else {
        chapterData = chapterMeta;
      }
    }
    return chapterData;
  }

  /**
   * 產生單章 HTML
   */
  buildChapterHTML(chapterData, isFirst = false) {
    const titleText = convertToTraditional(chapterData.title, this.openccEnabled);
    const contentText = convertToTraditional(chapterData.content, this.openccEnabled);

    const paragraphs = contentText
      .replace(/\r\n/g, '\n')
      .split(/\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const dividerHtml = isFirst
      ? ''
      : `
        <div class="reader-chapter-divider">
          <span>─── 接續第 ${chapterData.index + 1} 章 ───</span>
        </div>
      `;

    return `
      <div class="reader-chapter-block" data-chapter-index="${chapterData.index}">
        ${dividerHtml}
        <div class="reader-chapter-title">${titleText}</div>
        <div class="reader-paragraphs">
          ${paragraphs.map((p, idx) => `<p class="reader-paragraph" data-idx="${idx}">${p}</p>`).join('')}
        </div>
      </div>
    `;
  }

  /**
   * 滑動向下無縫追加下一章
   */
  async appendNextChapter() {
    if (this.isLoadingNext) return;
    if (!this.currentBook || !this.currentBook.chapters) return;

    const nextIndex = this.highestRenderedIndex + 1;
    if (nextIndex >= this.currentBook.chapters.length) {
      if (!this.contentBox.querySelector('.reader-book-end')) {
        const endEl = document.createElement('div');
        endEl.className = 'reader-book-end';
        endEl.style.cssText = 'text-align:center; padding: 48px 0 24px; color:var(--text-muted); font-size:14px; letter-spacing:1px;';
        endEl.textContent = '─── 本書已完結 ───';
        this.contentBox.appendChild(endEl);
      }
      return;
    }

    this.isLoadingNext = true;

    // 插入加載動畫提示
    let loadingEl = this.contentBox.querySelector('#reader-next-loading');
    if (!loadingEl) {
      loadingEl = document.createElement('div');
      loadingEl.id = 'reader-next-loading';
      loadingEl.className = 'reader-next-loading';
      const nextTitle = convertToTraditional(this.currentBook.chapters[nextIndex]?.title || '', this.openccEnabled);
      loadingEl.innerHTML = `
        <div class="spinner-dot"></div>
        <span>正在載入下一章：${nextTitle}...</span>
      `;
      this.contentBox.appendChild(loadingEl);
    }

    const chapterData = await this.fetchChapterData(nextIndex);
    loadingEl.remove();

    if (chapterData) {
      this.renderedChapters.set(nextIndex, chapterData);
      this.highestRenderedIndex = nextIndex;

      const tempContainer = document.createElement('div');
      tempContainer.innerHTML = this.buildChapterHTML(chapterData, false);
      const newBlock = tempContainer.firstElementChild;
      this.contentBox.appendChild(newBlock);

      // 背景預加載下一章
      this.prefetchNextChapter(nextIndex + 1);
    } else {
      // 載入失敗時提示並提供重試按鈕
      const retryEl = document.createElement('div');
      retryEl.className = 'reader-next-loading';
      retryEl.innerHTML = `
        <span style="color:#ef4444;">下一章載入失敗</span>
        <button class="btn-sm btn-primary" style="margin-left:8px; padding:3px 10px;">點擊重試</button>
      `;
      retryEl.querySelector('button')?.addEventListener('click', () => {
        retryEl.remove();
        this.isLoadingNext = false;
        this.appendNextChapter();
      });
      this.contentBox.appendChild(retryEl);
    }

    this.isLoadingNext = false;
  }

  /**
   * 滑動向上無縫接續上一章 (Prepend Previous Chapter with Scroll Anchoring)
   */
  async prependPrevChapter() {
    if (this.isLoadingPrev) return;
    if (!this.currentBook || !this.currentBook.chapters) return;

    const prevIndex = this.lowestRenderedIndex - 1;
    if (prevIndex < 0) {
      if (!this.contentBox.querySelector('.reader-book-start')) {
        const startEl = document.createElement('div');
        startEl.className = 'reader-book-start';
        startEl.style.cssText = 'text-align:center; padding: 24px 0 16px; color:var(--text-muted); font-size:13px; letter-spacing:1px;';
        startEl.textContent = '─── 已到本書起始章節 ───';
        this.contentBox.prepend(startEl);
      }
      return;
    }

    this.isLoadingPrev = true;

    // 取得上一章資料
    const chapterData = await this.fetchChapterData(prevIndex);

    if (chapterData) {
      this.renderedChapters.set(prevIndex, chapterData);
      this.lowestRenderedIndex = prevIndex;

      // 產生上一章 HTML 區塊
      const tempContainer = document.createElement('div');
      tempContainer.innerHTML = this.buildChapterHTML(chapterData, false);
      const newBlock = tempContainer.firstElementChild;

      // 記錄插入前的滾動高度與位置 (關鍵滾動錨定)
      const prevScrollHeight = this.contentBox.scrollHeight;
      const prevScrollTop = this.contentBox.scrollTop;

      // 向上前置插入
      this.contentBox.prepend(newBlock);

      // 自動補償 scrollTop，讓使用者的視覺視野紋絲不動！
      const deltaHeight = this.contentBox.scrollHeight - prevScrollHeight;
      this.contentBox.scrollTop = prevScrollTop + deltaHeight;
    }

    this.isLoadingPrev = false;
  }

  /**
   * 滾動事件處理：雙向感應 (接近頂部追加上一章，接近底端追加下一章，並動態偵測當前可見章節同步進度)
   */
  handleContinuousScroll() {
    if (!this.contentBox || !this.currentBook) return;

    // 1. 檢查是否接近頂部 (小於 250px 且前方有章節，觸發向上接續上一章)
    if (this.contentBox.scrollTop < 250 && !this.isLoadingPrev && this.lowestRenderedIndex > 0) {
      this.prependPrevChapter();
    }

    // 2. 檢查是否接近底部 (小於 800px 觸發追加下一章)
    const scrollBottom = this.contentBox.scrollHeight - this.contentBox.scrollTop - this.contentBox.clientHeight;
    if (scrollBottom < 800 && !this.isLoadingNext) {
      this.appendNextChapter();
    }

    // 3. 判定目前視野頂部所在章節，即時更新常駐標題與進度
    const blocks = this.contentBox.querySelectorAll('.reader-chapter-block');
    const boxRect = this.contentBox.getBoundingClientRect();
    const thresholdY = boxRect.top + boxRect.height * 0.35;

    let activeIndex = this.currentChapterIndex;
    for (const block of blocks) {
      const bRect = block.getBoundingClientRect();
      if (bRect.top <= thresholdY && bRect.bottom > boxRect.top) {
        activeIndex = parseInt(block.dataset.chapterIndex, 10);
      }
    }

    if (activeIndex !== this.currentChapterIndex) {
      this.updateActiveChapterUI(activeIndex);
    }
  }

  /**
   * 更新當前可見章節 UI 與儲存閱讀進度
   */
  async updateActiveChapterUI(index) {
    this.currentChapterIndex = index;
    const chapMeta = this.currentBook.chapters[index];
    if (!chapMeta) return;

    const titleText = convertToTraditional(chapMeta.title, this.openccEnabled);
    if (this.titleEl) this.titleEl.textContent = titleText;
    if (this.statusChapterEl) this.statusChapterEl.textContent = titleText;
    if (this.slider) this.slider.value = index;

    // 儲存進度至資料庫
    this.currentBook.lastChapterIndex = index;
    this.currentBook.lastChapterTitle = chapMeta.title;
    await saveBook(this.currentBook);
  }

  /**
   * 繁簡切換時重新渲染當前所有已展示的章節
   */
  renderAllRenderedChapters() {
    if (!this.contentBox || this.renderedChapters.size === 0) return;
    const currentScroll = this.contentBox.scrollTop;
    let fullHtml = '';
    const sortedIndices = Array.from(this.renderedChapters.keys()).sort((a, b) => a - b);
    sortedIndices.forEach((idx, i) => {
      const data = this.renderedChapters.get(idx);
      fullHtml += this.buildChapterHTML(data, i === 0);
    });
    this.contentBox.innerHTML = fullHtml;
    this.contentBox.scrollTop = currentScroll;

    // 同步當前標題
    const currentMeta = this.currentBook?.chapters?.[this.currentChapterIndex];
    if (currentMeta) {
      const titleText = convertToTraditional(currentMeta.title, this.openccEnabled);
      if (this.titleEl) this.titleEl.textContent = titleText;
      if (this.statusChapterEl) this.statusChapterEl.textContent = titleText;
    }
  }

  /**
   * 背景靜默預加載下一章
   */
  async prefetchNextChapter(nextIndex) {
    if (!this.currentBook || !this.currentBook.chapters) return;
    if (nextIndex >= this.currentBook.chapters.length) return;
    if (this.currentBook.sourceId === 'local') return;

    const nextMeta = this.currentBook.chapters[nextIndex];
    if (!nextMeta || !nextMeta.url) return;

    const cached = await getChapter(this.currentBook.id, nextIndex);
    if (!cached) {
      const source = this.sourcesMap.get(this.currentBook.sourceId);
      if (source) {
        try {
          const content = await getChapterContent(nextMeta.url, source);
          await saveChapter({
            bookId: this.currentBook.id,
            index: nextIndex,
            title: nextMeta.title,
            url: nextMeta.url,
            content
          });
        } catch {
          // 靜默失敗，不干擾用戶
        }
      }
    }
  }

  // ----------------- 目錄抽屜 (TOC Drawer) -----------------

  openDrawer() {
    this.hideMenu();
    this.drawerMask?.classList.add('show');
    this.scrollToActiveDrawerItem();
  }

  closeDrawer() {
    this.drawerMask?.classList.remove('show');
  }

  renderDrawer() {
    if (!this.currentBook || !this.currentBook.chapters || !this.drawerList) return;

    const chapters = this.currentBook.chapters;
    this.drawerList.innerHTML = chapters
      .map(
        (chap, idx) => `
        <div class="drawer-item ${idx === this.currentChapterIndex ? 'active' : ''}" data-idx="${idx}">
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${convertToTraditional(chap.title, this.openccEnabled)}
          </span>
          <span style="font-size:11px; opacity:0.6;">#${idx + 1}</span>
        </div>
      `
      )
      .join('');

    this.drawerList.querySelectorAll('.drawer-item').forEach((item) => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.idx, 10);
        this.closeDrawer();
        this.changeChapter(idx);
      });
    });
  }

  scrollToActiveDrawerItem() {
    setTimeout(() => {
      const activeEl = this.drawerList?.querySelector('.drawer-item.active');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 100);
  }

  filterDrawerList(keyword) {
    if (!this.drawerList) return;
    const items = this.drawerList.querySelectorAll('.drawer-item');
    items.forEach((item) => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(keyword.toLowerCase()) ? 'flex' : 'none';
    });
  }

  // ----------------- 語音朗讀 (TTS) 整合 -----------------

  toggleTTS() {
    this.hideMenu();
    if (tts.isPlaying) {
      tts.stop();
      this.hideTTS();
    } else {
      this.startTTS();
    }
  }

  startTTS() {
    if (!this.currentChapter || !this.currentChapter.content) {
      showToast('目前章節無內容可朗讀');
      return;
    }

    const textToRead = convertToTraditional(this.currentChapter.content, this.openccEnabled);
    this.showTTS();

    tts.start(
      textToRead,
      (currentParagraphIndex) => {
        // 高亮當前朗讀段落並捲動
        this.highlightTTSParagraph(currentParagraphIndex);
      },
      () => {
        // 當前章節讀完，自動讀下一章
        if (this.currentChapterIndex < this.currentBook.chapters.length - 1) {
          showToast('章節朗讀完畢，即將接續朗讀下一章...');
          this.changeChapter(this.currentChapterIndex + 1).then(() => {
            setTimeout(() => this.startTTS(), 800);
          });
        } else {
          showToast('全書朗讀完畢');
          this.hideTTS();
        }
      }
    );

    this.updateTTSUI();
  }

  highlightTTSParagraph(pIdx) {
    if (!this.contentBox) return;
    this.contentBox.querySelectorAll('.reader-paragraph').forEach((p) => {
      p.style.backgroundColor = 'transparent';
      p.style.borderRadius = '0';
    });

    const targetP = this.contentBox.querySelector(`.reader-paragraph[data-idx="${pIdx}"]`);
    if (targetP) {
      targetP.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
      targetP.style.borderRadius = '4px';
      targetP.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  showTTS() {
    this.ttsBar?.style.setProperty('display', 'flex');
  }

  hideTTS() {
    if (this.ttsBar) this.ttsBar.style.display = 'none';
    if (this.contentBox) {
      this.contentBox.querySelectorAll('.reader-paragraph').forEach((p) => {
        p.style.backgroundColor = 'transparent';
      });
    }
  }

  updateTTSUI() {
    const playBtn = document.getElementById('tts-btn-play');
    if (playBtn) {
      playBtn.textContent = tts.isPaused ? '▶ 繼續' : '⏸ 暫停';
    }
  }

  // ==========================================================================
  // 離線快取與下載管理 (Offline Cache & Download)
  // ==========================================================================

  async openDownloadModal() {
    if (!this.currentBook) return;
    this.hideMenu();
    if (!this.downloadModal) return;

    this.downloadModal.style.display = 'flex';
    const titleEl = document.getElementById('download-book-title');
    if (titleEl) titleEl.textContent = `《${this.currentBook.title}》`;
    await this.updateCacheStats();
  }

  closeDownloadModal() {
    if (this.downloadModal) {
      this.downloadModal.style.display = 'none';
    }
  }

  async updateCacheStats() {
    if (!this.currentBook || !this.currentBook.chapters) return;
    const statsEl = document.getElementById('download-cache-stats');
    if (!statsEl) return;

    try {
      const cachedSet = await getCachedChapterIndices(this.currentBook.id);
      const total = this.currentBook.chapters.length;
      const count = cachedSet.size;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      statsEl.textContent = `已離線快取：${count} / ${total} 章 (${pct}%)`;
    } catch (e) {
      statsEl.textContent = '已離線快取：計算失敗';
    }
  }

  cancelDownload() {
    if (this.isDownloading) {
      this.cancelDownloadFlag = true;
      const statusText = document.getElementById('download-status-text');
      if (statusText) statusText.textContent = '正在中斷下載...';
    }
  }

  async startBatchDownload(amount) {
    if (!this.currentBook || !this.currentBook.chapters) return;
    if (this.isDownloading) {
      showToast('目前已有下載任務正在進行中');
      return;
    }

    const totalChapters = this.currentBook.chapters.length;
    if (totalChapters === 0) {
      showToast('本書無章節可下載');
      return;
    }

    // 取得書源設定
    let source = this.sourcesMap.get(this.currentBook.sourceId);
    if (!source && this.currentBook.sourceId !== 'local') {
      const sources = await getAllSources();
      source = sources.find((s) => s.id === this.currentBook.sourceId);
    }

    if (!source && this.currentBook.sourceId !== 'local') {
      showToast('找不到該書對應的書源，無法發起線上抓取');
      return;
    }

    // 決定要下載的章節範圍
    const cachedSet = await getCachedChapterIndices(this.currentBook.id);
    let targetIndices = [];

    if (amount === Infinity) {
      // 全本：下載所有尚未快取的章節
      for (let i = 0; i < totalChapters; i++) {
        if (!cachedSet.has(i)) {
          targetIndices.push(i);
        }
      }
    } else {
      // 後續 N 章：從當前閱讀章節往後算
      const startIdx = this.currentChapterIndex;
      const endIdx = Math.min(totalChapters, startIdx + amount);
      for (let i = startIdx; i < endIdx; i++) {
        if (!cachedSet.has(i)) {
          targetIndices.push(i);
        }
      }
    }

    if (targetIndices.length === 0) {
      showToast('選定範圍內的章節已全部快取完成！');
      await this.updateCacheStats();
      return;
    }

    this.isDownloading = true;
    this.cancelDownloadFlag = false;

    const progressBox = document.getElementById('download-progress-box');
    const progressBar = document.getElementById('download-progress-bar');
    const statusText = document.getElementById('download-status-text');
    const percentText = document.getElementById('download-percent-text');

    if (progressBox) progressBox.style.display = 'block';

    let successCount = 0;
    let failedCount = 0;
    const totalToDownload = targetIndices.length;

    for (let i = 0; i < targetIndices.length; i++) {
      if (this.cancelDownloadFlag) {
        showToast('已取消後續章節下載，已下載內容已保留');
        break;
      }

      const chapIndex = targetIndices[i];
      const chapMeta = this.currentBook.chapters[chapIndex];
      const progressPercent = Math.round(((i + 1) / totalToDownload) * 100);

      if (statusText) statusText.textContent = `(${i + 1}/${totalToDownload}) ${chapMeta.title}`;
      if (percentText) percentText.textContent = `${progressPercent}%`;
      if (progressBar) progressBar.style.width = `${progressPercent}%`;

      try {
        if (chapMeta.url && source) {
          const content = await getChapterContent(chapMeta.url, source);
          await saveChapter({
            bookId: this.currentBook.id,
            index: chapIndex,
            title: chapMeta.title,
            url: chapMeta.url,
            content
          });
          successCount++;
        }
      } catch (err) {
        console.warn(`下載章節失敗 #${chapIndex}:`, err);
        failedCount++;
      }

      // 適當防抖延遲 180ms，避免過於頻繁請求站點
      await new Promise((r) => setTimeout(r, 180));
    }

    this.isDownloading = false;
    this.cancelDownloadFlag = false;

    if (statusText) statusText.textContent = `下載結束：成功 ${successCount} 章，失敗 ${failedCount} 章`;
    await this.updateCacheStats();
    showToast(`離線快取完成 (成功 ${successCount} 章)`);

    setTimeout(() => {
      if (progressBox && !this.isDownloading) {
        progressBox.style.display = 'none';
      }
    }, 2500);
  }

  async exportBookToTxt() {
    if (!this.currentBook || !this.currentBook.chapters) return;
    const chapters = this.currentBook.chapters;
    const total = chapters.length;

    showToast('正在整合章節文字並打包為 TXT...');

    try {
      let fileContent = `《${this.currentBook.title}》\r\n作者：${this.currentBook.author || '未知'}\r\n來源：${this.currentBook.sourceName || '隨身小說閱讀器'}\r\n\r\n`;
      if (this.currentBook.intro) {
        fileContent += `【內容簡介】\r\n${this.currentBook.intro}\r\n\r\n========================================\r\n\r\n`;
      }

      let cachedCount = 0;
      for (let i = 0; i < total; i++) {
        const chap = chapters[i];
        fileContent += `\r\n\r\n${chap.title}\r\n\r\n`;
        const chapterData = await getChapter(this.currentBook.id, i);
        if (chapterData && chapterData.content) {
          fileContent += chapterData.content;
          cachedCount++;
        } else {
          fileContent += `[提示：該章節尚未進行離線快取下載]\r\n`;
        }
      }

      // 產生 Blob 與下載連結
      const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const filename = `${this.currentBook.title}_${this.currentBook.author || '全本'}.txt`;
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`已成功匯出《${this.currentBook.title}》！`);
    } catch (err) {
      console.error('匯出 TXT 失敗:', err);
      showToast(`匯出失敗: ${err.message}`);
    }
  }
}

export const readerView = new ReaderViewController();
