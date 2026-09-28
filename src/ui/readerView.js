/**
 * 閱讀器視圖控制器 (Reader View Controller)
 * 沉浸式排版、觸控翻頁、字體與主題調整、章節預加載、繁簡轉換與 TTS 整合
 */

import { getBook, saveBook, getChapter, saveChapter, getAllSources, getSetting, saveSetting } from '../db/index.js';
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
    this.statusTimeEl = null;
    this.ttsBar = null;
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
    // 觸控熱區操作 (左側上一頁/滾動，右側下一頁/滾動，中央喚出/收合選單)
    document.getElementById('touch-zone-prev')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.scrollPage(-1);
    });

    document.getElementById('touch-zone-next')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.scrollPage(1);
    });

    document.getElementById('touch-zone-menu')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });

    // 頂部返回按鈕
    document.getElementById('reader-btn-back')?.addEventListener('click', () => {
      this.closeReader();
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
      this.renderCurrentChapter();
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
      this.viewEl.className = `active ${themeName}`;
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

    // 檢查是否已觸頂或觸底，若到底則提示翻下一章
    const isAtBottom = this.contentBox.scrollTop + clientHeight >= this.contentBox.scrollHeight - 10;
    const isAtTop = this.contentBox.scrollTop <= 5;

    if (direction > 0 && isAtBottom) {
      if (this.currentChapterIndex < this.currentBook.chapters.length - 1) {
        showToast('即將進入下一章...');
        this.changeChapter(this.currentChapterIndex + 1);
      } else {
        showToast('已是最後一章！');
      }
      return;
    }

    if (direction < 0 && isAtTop) {
      if (this.currentChapterIndex > 0) {
        this.changeChapter(this.currentChapterIndex - 1);
      } else {
        showToast('已是第一章！');
      }
      return;
    }

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
    const chapterMeta = this.currentBook.chapters[index];
    if (!chapterMeta) return;

    this.contentBox.innerHTML = `
      <div style="display:flex; justify-content:center; align-items:center; height:60vh; color:var(--text-muted);">
        <span>正在載入章節內容...</span>
      </div>
    `;

    // 嘗試從本地快取讀取
    let chapterData = await getChapter(this.currentBook.id, index);

    if (!chapterData || !chapterData.content) {
      // 本地無快取，若是網路書源則發起網路爬蟲
      if (this.currentBook.sourceId !== 'local' && chapterMeta.url) {
        const source = this.sourcesMap.get(this.currentBook.sourceId);
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
            this.contentBox.innerHTML = `
              <div style="text-align:center; padding: 40px 20px; color:#ef4444;">
                <p style="font-weight:bold; margin-bottom:12px;">載入章節失敗</p>
                <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">${err.message}</p>
                <button id="btn-retry-chapter" class="btn-sm btn-primary">重新嘗試載入</button>
              </div>
            `;
            document.getElementById('btn-retry-chapter')?.addEventListener('click', () => {
              this.loadChapter(index);
            });
            return;
          }
        }
      } else {
        // 本地書籍直接使用章節內的 content
        chapterData = chapterMeta;
      }
    }

    this.currentChapter = chapterData;
    this.renderCurrentChapter();

    // 背景智慧預加載下一章 (Prefetch Next Chapter)
    this.prefetchNextChapter(index + 1);
  }

  renderCurrentChapter() {
    if (!this.currentChapter) return;

    const titleText = convertToTraditional(this.currentChapter.title, this.openccEnabled);
    const contentText = convertToTraditional(this.currentChapter.content, this.openccEnabled);

    if (this.titleEl) this.titleEl.textContent = titleText;
    if (this.statusChapterEl) this.statusChapterEl.textContent = titleText;

    const paragraphs = contentText.split('\n\n').filter((p) => p.trim().length > 0);
    const html = `
      <div class="reader-chapter-title">${titleText}</div>
      <div class="reader-paragraphs">
        ${paragraphs.map((p, idx) => `<p class="reader-paragraph" data-idx="${idx}">${p}</p>`).join('')}
      </div>
      <div style="text-align:center; padding: 40px 0 20px;">
        <button id="btn-chapter-end-next" class="btn-sm btn-secondary" style="padding: 10px 24px; font-size:14px; border-radius: 20px;">
          ${this.currentChapterIndex < this.currentBook.chapters.length - 1 ? '進入下一章 →' : '本書已完結'}
        </button>
      </div>
    `;

    this.contentBox.innerHTML = html;
    this.contentBox.scrollTop = 0;

    document.getElementById('btn-chapter-end-next')?.addEventListener('click', () => {
      this.changeChapter(this.currentChapterIndex + 1);
    });

    // 繁簡切換按鈕狀態同步
    const openccBtn = document.getElementById('btn-toggle-opencc');
    if (openccBtn) openccBtn.classList.toggle('active', this.openccEnabled);
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
}

export const readerView = new ReaderViewController();
