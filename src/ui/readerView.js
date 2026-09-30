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
    this.fontWeight = '500';
    this.theme = 'theme-parchment';
    this.openccEnabled = true;
    this.textColor = null;
    this.customColors = [];
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
    this.textPanel = null;
    this.isTextPanelVisible = false;
    this.fontSizeSlider = null;
    this.fontSizeValEl = null;
    this.fontWeightSlider = null;
    this.fontWeightValEl = null;
    this.customColorBtn = null;
    this.customColorContainer = null;
    this.inlineColorPicker = null;
    this.pickerHue = null;
    this.pickerLight = null;
    this.pickerPreviewBadge = null;
    this.pickerHexInput = null;
    this.pickerBtnSave = null;
    this.pickerBtnCancel = null;
    this.isInlinePickerVisible = false;
    this.pickerCurrentH = 0;
    this.pickerCurrentS = 60;
    this.pickerCurrentL = 50;
    this.isDownloading = false;
    this.cancelDownloadFlag = false;

    // 螢幕常亮 (Screen Wake Lock) 狀態
    this.wakeLockSentinel = null;
    this.wakeLockEnabled = true;

    // 連續滾動章節狀態
    this.renderedChapters = new Map();
    this.lowestRenderedIndex = 0;
    this.highestRenderedIndex = 0;
    this.isLoadingNext = false;
    this.isLoadingPrev = false;

    // 閱讀進度細部定位狀態 (段落與防抖保存)
    this.currentParagraphIndex = 0;
    this.saveProgressTimer = null;
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
    this.textPanel = document.getElementById('reader-text-panel');
    this.fontSizeSlider = document.getElementById('reader-font-size-slider');
    this.fontSizeValEl = document.getElementById('text-panel-font-size-val');
    this.fontWeightSlider = document.getElementById('reader-font-weight-slider');
    this.fontWeightValEl = document.getElementById('text-panel-font-weight-val');
    this.customColorBtn = document.getElementById('reader-custom-color-btn');
    this.customColorContainer = document.getElementById('custom-color-pills');
    this.inlineColorPicker = document.getElementById('inline-color-picker');
    this.pickerHue = document.getElementById('picker-hue');
    this.pickerLight = document.getElementById('picker-light');
    this.pickerPreviewBadge = document.getElementById('picker-preview-badge');
    this.pickerHexInput = document.getElementById('picker-hex-input');
    this.pickerBtnSave = document.getElementById('picker-btn-save');
    this.pickerBtnCancel = document.getElementById('picker-btn-cancel');

    // 載入偏好設定
    this.fontSize = await getSetting('reader_font_size', 18);
    this.lineHeight = await getSetting('reader_line_height', 1.8);
    this.fontWeight = await getSetting('reader_font_weight', '500');
    this.theme = await getSetting('reader_theme', 'theme-parchment');
    this.openccEnabled = await getSetting('reader_opencc', true);
    this.textColor = await getSetting('reader_font_color', null);
    this.customColors = await getSetting('reader_custom_text_colors', []);
    if (!Array.isArray(this.customColors)) {
      this.customColors = [];
    }
    this.wakeLockEnabled = await getSetting('reader_wake_lock', true);

    if (this.fontSizeSlider) this.fontSizeSlider.value = this.fontSize;
    if (this.fontSizeValEl) this.fontSizeValEl.textContent = `${this.fontSize}px`;
    if (this.fontWeightSlider) this.fontWeightSlider.value = this.fontWeight;

    this.renderCustomColorPills();
    this.applyTheme(this.theme);
    this.applyTypography();
    this.syncCustomColorInputValue();
    this.updateWakeLockUI();
    this.bindEvents();
    this.startClock();

    // 監聽頁面能見度 (Visibility Change)，切換回 App 時若處於閱讀介面則自動恢復螢幕常亮
    document.addEventListener('visibilitychange', () => {
      this.handleVisibilityChange();
    });
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

    // 視窗離開或重新整理前立即保存進度
    window.addEventListener('beforeunload', () => {
      this.persistReadingProgress();
    });
    window.addEventListener('pagehide', () => {
      this.persistReadingProgress();
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

    // 獨立文字設定面板開關按鈕
    document.getElementById('btn-text-settings')?.addEventListener('click', () => {
      this.toggleTextPanel();
    });

    // 關閉文字設定面板
    document.getElementById('text-panel-btn-close')?.addEventListener('click', () => {
      this.hideTextPanel();
    });

    // 文字面板內字體縮小 / 放大
    document.getElementById('btn-font-dec-panel')?.addEventListener('click', () => {
      this.adjustFontSize(-2);
    });
    document.getElementById('btn-font-inc-panel')?.addEventListener('click', () => {
      this.adjustFontSize(2);
    });

    // 字體大小滑桿即時調節
    this.fontSizeSlider?.addEventListener('input', (e) => {
      this.setFontSize(parseInt(e.target.value, 10));
    });

    // 字體粗細滑桿即時調節
    this.fontWeightSlider?.addEventListener('input', (e) => {
      this.setFontWeight(e.target.value, false);
    });

    // 字體粗細微調按鈕 (細- / 粗+)
    document.getElementById('btn-weight-dec')?.addEventListener('click', () => {
      const current = parseInt(this.fontWeight, 10) || 500;
      this.setFontWeight(Math.max(300, current - 100), true);
    });
    document.getElementById('btn-weight-inc')?.addEventListener('click', () => {
      const current = parseInt(this.fontWeight, 10) || 500;
      this.setFontWeight(Math.min(900, current + 100), true);
    });

    // 文字顏色預設色票點擊切換
    document.querySelectorAll('.text-color-palette > .color-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        if (pill.classList.contains('color-custom-btn')) return;
        const color = pill.dataset.color || null;
        this.setTextColor(color);
      });
    });

    // 恢復主題預設文字顏色
    document.getElementById('btn-reset-text-color')?.addEventListener('click', () => {
      this.setTextColor(null);
    });

    // 點擊 🎨 按鈕：直接就地展開/收合內建調色盤
    this.customColorBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      this.toggleInlineColorPicker();
    });

    // 內建調色盤滑桿滑動（色相、明暗）：即時計算 Hex 並套用至內文
    const handleSliderChange = () => {
      this.onInlinePickerSliderChange();
    };
    this.pickerHue?.addEventListener('input', handleSliderChange);
    this.pickerLight?.addEventListener('input', handleSliderChange);

    // 內建調色盤手動輸入 HEX 色碼
    this.pickerHexInput?.addEventListener('input', (e) => {
      this.onInlinePickerHexInput(e.target.value.trim());
    });

    // 內建調色盤「確定儲存」按鈕
    this.pickerBtnSave?.addEventListener('click', () => {
      const hex = this.pickerHexInput ? this.pickerHexInput.value.trim() : '';
      if (hex) {
        this.addCustomColor(hex);
      }
      this.hideInlineColorPicker();
    });

    // 內建調色盤「關閉」按鈕
    this.pickerBtnCancel?.addEventListener('click', () => {
      this.hideInlineColorPicker();
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

    // 螢幕常亮 (防止關閉) 開關按鈕 (底部控制列 & 頂部工具列)
    document.getElementById('btn-toggle-wakelock')?.addEventListener('click', () => {
      this.toggleWakeLock();
    });
    document.getElementById('reader-btn-wakelock')?.addEventListener('click', () => {
      this.toggleWakeLock();
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

    this.syncCustomColorInputValue();
  }

  applyTypography() {
    if (this.contentBox) {
      this.contentBox.style.fontSize = `${this.fontSize}px`;
      this.contentBox.style.lineHeight = `${this.lineHeight}`;
      this.contentBox.style.setProperty('--reader-font-weight', this.fontWeight);
    }

    if (this.viewEl) {
      if (this.textColor) {
        this.viewEl.style.setProperty('--reader-custom-color', this.textColor);
      } else {
        this.viewEl.style.removeProperty('--reader-custom-color');
      }
    }

    this.updateColorPaletteUI();
    this.updateFontWeightUI();
    this.syncCustomColorInputValue();
  }

  setFontSize(size) {
    this.fontSize = Math.max(12, Math.min(36, size));
    saveSetting('reader_font_size', this.fontSize);
    if (this.fontSizeSlider) this.fontSizeSlider.value = this.fontSize;
    if (this.fontSizeValEl) this.fontSizeValEl.textContent = `${this.fontSize}px`;
    this.applyTypography();
  }

  adjustFontSize(delta) {
    this.setFontSize(this.fontSize + delta);
    showToast(`字體大小: ${this.fontSize}px`);
  }

  setFontWeight(weight, notify = false) {
    this.fontWeight = String(weight);
    saveSetting('reader_font_weight', this.fontWeight);
    this.applyTypography();
    if (notify) {
      const labelMap = {
        '300': '纖細 (300)',
        '400': '標準 (400)',
        '500': '適中 (500)',
        '600': '半粗 (600)',
        '700': '加粗 (700)',
        '800': '特粗 (800)',
        '900': '黑體 (900)'
      };
      showToast(`字體粗細: ${labelMap[this.fontWeight] || this.fontWeight}`);
    }
  }

  updateFontWeightUI() {
    const labelMap = {
      '300': '纖細 (300)',
      '400': '標準 (400)',
      '500': '適中 (500)',
      '600': '半粗 (600)',
      '700': '加粗 (700)',
      '800': '特粗 (800)',
      '900': '黑體 (900)'
    };
    if (this.fontWeightSlider) {
      this.fontWeightSlider.value = this.fontWeight;
    }
    if (this.fontWeightValEl) {
      this.fontWeightValEl.textContent = labelMap[this.fontWeight] || `${this.fontWeight}`;
    }
  }

  getCurrentTextColorHex() {
    const themeDefaultMap = {
      'theme-white': '#2b2b2b',
      'theme-green': '#1e3522',
      'theme-parchment': '#382e25',
      'theme-dark': '#cbd5e1',
      'theme-black': '#94a3b8'
    };

    let color = this.textColor;
    if (!color) {
      color = themeDefaultMap[this.theme] || '#2b2b2b';
    }

    color = String(color).trim();

    // 6 碼 Hex (#rrggbb)
    if (/^#[0-9a-fA-F]{6}$/.test(color)) {
      return color.toLowerCase();
    }

    // 3 碼 Hex (#rgb -> #rrggbb)
    if (/^#[0-9a-fA-F]{3}$/.test(color)) {
      const r = color[1];
      const g = color[2];
      const b = color[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }

    // rgb(r, g, b) 或 rgba(r, g, b, a)
    const match = color.match(/\d+/g);
    if (match && match.length >= 3) {
      const r = Math.min(255, parseInt(match[0], 10)).toString(16).padStart(2, '0');
      const g = Math.min(255, parseInt(match[1], 10)).toString(16).padStart(2, '0');
      const b = Math.min(255, parseInt(match[2], 10)).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`.toLowerCase();
    }

    // 後備 DOM 計算樣式
    if (this.contentBox || this.viewEl) {
      const computed = window.getComputedStyle(this.contentBox || this.viewEl).color;
      const cMatch = computed ? computed.match(/\d+/g) : null;
      if (cMatch && cMatch.length >= 3) {
        const r = Math.min(255, parseInt(cMatch[0], 10)).toString(16).padStart(2, '0');
        const g = Math.min(255, parseInt(cMatch[1], 10)).toString(16).padStart(2, '0');
        const b = Math.min(255, parseInt(cMatch[2], 10)).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`.toLowerCase();
      }
    }

    return themeDefaultMap[this.theme] || '#2b2b2b';
  }

  hexToHsl(hex) {
    let r = 0, g = 0, b = 0;
    hex = String(hex || '').trim();
    if (hex.length === 4) {
      r = parseInt(hex[1] + hex[1], 16) / 255;
      g = parseInt(hex[2] + hex[2], 16) / 255;
      b = parseInt(hex[3] + hex[3], 16) / 255;
    } else if (hex.length >= 7) {
      r = parseInt(hex.slice(1, 3), 16) / 255;
      g = parseInt(hex.slice(3, 5), 16) / 255;
      b = parseInt(hex.slice(5, 7), 16) / 255;
    }
    if (isNaN(r) || isNaN(g) || isNaN(b)) {
      return { h: 0, s: 60, l: 50 };
    }

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h = Math.round(h * 60);
    }
    return {
      h: Math.round(h),
      s: Math.round(s * 100),
      l: Math.round(l * 100)
    };
  }

  hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;

    if (0 <= h && h < 60) {
      r = c; g = x; b = 0;
    } else if (60 <= h && h < 120) {
      r = x; g = c; b = 0;
    } else if (120 <= h && h < 180) {
      r = 0; g = c; b = x;
    } else if (180 <= h && h < 240) {
      r = 0; g = x; b = c;
    } else if (240 <= h && h < 300) {
      r = x; g = 0; b = c;
    } else if (300 <= h && h <= 360) {
      r = c; g = 0; b = x;
    }

    const toHex = (n) => {
      const hex = Math.round((n + m) * 255).toString(16);
      return hex.padStart(2, '0');
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toLowerCase();
  }

  toggleInlineColorPicker() {
    if (this.isInlinePickerVisible) {
      this.hideInlineColorPicker();
    } else {
      this.openInlineColorPicker();
    }
  }

  openInlineColorPicker() {
    if (!this.inlineColorPicker) return;
    this.syncInlineColorPicker();
    this.inlineColorPicker.style.display = 'flex';
    this.isInlinePickerVisible = true;
    this.customColorBtn?.classList.add('selected');
  }

  hideInlineColorPicker() {
    if (!this.inlineColorPicker) return;
    this.inlineColorPicker.style.display = 'none';
    this.isInlinePickerVisible = false;
    this.updateColorPaletteUI();
  }

  syncInlineColorPicker() {
    const currentHex = this.getCurrentTextColorHex();
    const hsl = this.hexToHsl(currentHex) || { h: 0, s: 60, l: 50 };
    this.pickerCurrentH = hsl.h;
    this.pickerCurrentS = hsl.s > 15 ? hsl.s : 60;
    this.pickerCurrentL = hsl.l;

    if (this.pickerHue) this.pickerHue.value = this.pickerCurrentH;
    if (this.pickerLight) {
      this.pickerLight.value = this.pickerCurrentL;
      this.pickerLight.style.background = `linear-gradient(to right, #000, hsl(${this.pickerCurrentH}, ${this.pickerCurrentS}%, 50%), #fff)`;
    }
    if (this.pickerHexInput) this.pickerHexInput.value = currentHex.toUpperCase();
    if (this.pickerPreviewBadge) this.pickerPreviewBadge.style.backgroundColor = currentHex;
  }

  onInlinePickerSliderChange() {
    if (this.pickerHue) {
      this.pickerCurrentH = parseInt(this.pickerHue.value, 10);
    }
    if (this.pickerLight) {
      this.pickerCurrentL = parseInt(this.pickerLight.value, 10);
    }
    if (this.pickerCurrentS < 20) {
      this.pickerCurrentS = 60;
    }
    const hex = this.hslToHex(this.pickerCurrentH, this.pickerCurrentS, this.pickerCurrentL);
    if (this.pickerHexInput) this.pickerHexInput.value = hex.toUpperCase();
    if (this.pickerPreviewBadge) this.pickerPreviewBadge.style.backgroundColor = hex;
    if (this.pickerLight) {
      this.pickerLight.style.background = `linear-gradient(to right, #000, hsl(${this.pickerCurrentH}, ${this.pickerCurrentS}%, 50%), #fff)`;
    }
    this.setTextColor(hex, false, false);
  }

  onInlinePickerHexInput(val) {
    if (!val) return;
    if (!val.startsWith('#')) val = '#' + val;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      const hex = val.toLowerCase();
      const hsl = this.hexToHsl(hex);
      this.pickerCurrentH = hsl.h;
      this.pickerCurrentS = hsl.s > 15 ? hsl.s : 60;
      this.pickerCurrentL = hsl.l;
      if (this.pickerHue) this.pickerHue.value = this.pickerCurrentH;
      if (this.pickerLight) {
        this.pickerLight.value = this.pickerCurrentL;
        this.pickerLight.style.background = `linear-gradient(to right, #000, hsl(${this.pickerCurrentH}, ${this.pickerCurrentS}%, 50%), #fff)`;
      }
      if (this.pickerPreviewBadge) this.pickerPreviewBadge.style.backgroundColor = hex;
      this.setTextColor(hex, false);
    }
  }

  syncCustomColorInputValue() {
    if (this.isInlinePickerVisible) {
      this.syncInlineColorPicker();
    }
  }

  prepareCustomColorPicker() {
    this.syncInlineColorPicker();
  }

  async addCustomColor(color) {
    if (!color) return;
    const hex = color.toLowerCase();
    this.customColors = [hex, ...this.customColors.filter((c) => c.toLowerCase() !== hex)].slice(0, 10);
    await saveSetting('reader_custom_text_colors', this.customColors);
    this.renderCustomColorPills();
    this.setTextColor(hex, true);
  }

  async removeCustomColor(color, event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    const hex = color.toLowerCase();
    this.customColors = this.customColors.filter((c) => c.toLowerCase() !== hex);
    await saveSetting('reader_custom_text_colors', this.customColors);
    this.renderCustomColorPills();
    this.updateColorPaletteUI();
    showToast('已刪除自訂顏色');
  }

  renderCustomColorPills() {
    if (!this.customColorContainer) return;
    this.customColorContainer.innerHTML = '';

    this.customColors.forEach((color) => {
      const pill = document.createElement('div');
      pill.className = 'color-pill color-pill-custom';
      pill.dataset.color = color;
      pill.title = `自訂顏色: ${color}`;
      pill.style.backgroundColor = color;

      // 右上角刪除按鈕徽章
      const delBtn = document.createElement('button');
      delBtn.className = 'color-pill-delete-btn';
      delBtn.type = 'button';
      delBtn.title = '刪除此顏色';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', (e) => this.removeCustomColor(color, e));

      pill.appendChild(delBtn);

      pill.addEventListener('click', (e) => {
        if (e.target === delBtn) return;
        this.setTextColor(color);
      });

      this.customColorContainer.appendChild(pill);
    });

    this.updateColorPaletteUI();
  }

  setTextColor(color, notify = true, syncPicker = true) {
    this.textColor = color;
    saveSetting('reader_font_color', color);
    this.applyTypography();
    if (this.isInlinePickerVisible && syncPicker) {
      this.syncInlineColorPicker();
    }
    if (notify) {
      if (color) {
        showToast('文字顏色已變更');
      } else {
        showToast('已恢復主題預設文字顏色');
      }
    }
  }

  toggleTextPanel() {
    this.isTextPanelVisible = !this.isTextPanelVisible;
    if (this.textPanel) {
      this.textPanel.style.display = this.isTextPanelVisible ? 'block' : 'none';
      if (!this.isTextPanelVisible) {
        this.hideInlineColorPicker();
      }
    }
    document.getElementById('btn-text-settings')?.classList.toggle('active', this.isTextPanelVisible);
  }

  hideTextPanel() {
    this.isTextPanelVisible = false;
    if (this.textPanel) {
      this.textPanel.style.display = 'none';
    }
    this.hideInlineColorPicker();
    document.getElementById('btn-text-settings')?.classList.remove('active');
  }

  updateColorPaletteUI() {
    const current = (this.textColor || '').toLowerCase();
    let matched = false;

    document.querySelectorAll('.text-color-palette .color-pill').forEach((pill) => {
      if (pill.classList.contains('color-custom-btn')) return;
      const color = (pill.dataset.color || '').toLowerCase();
      const isSelected = Boolean(color && color === current);
      const isDefaultThemePill = !current && pill.dataset.color === '';
      const selected = isSelected || isDefaultThemePill;
      pill.classList.toggle('selected', selected);
      if (selected) matched = true;
    });

    const customBtn = this.customColorBtn || document.getElementById('reader-custom-color-btn') || document.querySelector('.color-custom-btn');
    if (customBtn) {
      customBtn.classList.toggle('selected', Boolean(this.isInlinePickerVisible || (current && !matched)));
    }
  }

  toggleMenu() {
    this.isMenuVisible = !this.isMenuVisible;
    this.topBar?.classList.toggle('show', this.isMenuVisible);
    this.bottomBar?.classList.toggle('show', this.isMenuVisible);
    if (!this.isMenuVisible) {
      this.hideTextPanel();
    }
  }

  hideMenu() {
    this.isMenuVisible = false;
    this.topBar?.classList.remove('show');
    this.bottomBar?.classList.remove('show');
    this.hideTextPanel();
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
    const startParagraphIndex = startChapterIndex !== null ? 0 : (book.lastParagraphIndex || 0);

    // 快取書源對照表
    const sources = await getAllSources();
    this.sourcesMap.clear();
    sources.forEach((s) => this.sourcesMap.set(s.id, s));

    // 顯示閱讀器
    this.viewEl?.classList.add('active');
    this.applyTheme(this.theme);
    this.hideMenu();

    // 啟動螢幕常亮 (若使用者偏好設定為開啟)
    if (this.wakeLockEnabled) {
      this.requestWakeLock();
    }

    // 更新進度條最大值
    if (this.slider && book.chapters) {
      this.slider.max = Math.max(0, book.chapters.length - 1);
      this.slider.value = this.currentChapterIndex;
    }

    await this.loadChapter(this.currentChapterIndex, startParagraphIndex);
    this.renderDrawer();
  }

  closeReader() {
    this.persistReadingProgress();
    this.cancelDownload();
    this.closeDownloadModal();
    this.releaseWakeLock();
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
    this.currentParagraphIndex = 0;
    if (this.slider) this.slider.value = newIndex;

    // 儲存進度至資料庫
    this.currentBook.lastChapterIndex = newIndex;
    this.currentBook.lastChapterTitle = this.currentBook.chapters[newIndex]?.title || '';
    this.currentBook.lastParagraphIndex = 0;
    await saveBook(this.currentBook);

    await this.loadChapter(newIndex, 0);
  }

  async loadChapter(index, targetParagraphIndex = 0) {
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
    this.currentParagraphIndex = targetParagraphIndex;
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
        this.loadChapter(index, targetParagraphIndex);
      });
      document.getElementById('btn-chapter-error-back')?.addEventListener('click', () => {
        this.closeReader();
      });
      return;
    }

    this.renderedChapters.set(index, chapterData);
    this.currentChapter = chapterData;

    this.contentBox.innerHTML = this.buildChapterHTML(chapterData, true);

    if (targetParagraphIndex > 0) {
      this.scrollToParagraph(index, targetParagraphIndex);
    } else {
      this.contentBox.scrollTop = 0;
    }

    await this.updateActiveChapterUI(index, false);

    // 背景智慧預加載下一章
    this.prefetchNextChapter(index + 1);
  }

  /**
   * 瞬間精確捲動至指定章節與段落
   */
  scrollToParagraph(chapterIndex, paragraphIndex) {
    if (!this.contentBox) return;

    const applyScroll = () => {
      const targetP = this.contentBox.querySelector(
        `.reader-chapter-block[data-chapter-index="${chapterIndex}"] .reader-paragraph[data-idx="${paragraphIndex}"]`
      );
      if (targetP) {
        const boxRect = this.contentBox.getBoundingClientRect();
        const pRect = targetP.getBoundingClientRect();
        const offsetDiff = pRect.top - boxRect.top;
        this.contentBox.scrollTop = Math.max(0, this.contentBox.scrollTop + offsetDiff - 16);
      } else {
        this.contentBox.scrollTop = 0;
      }
    };

    applyScroll();
    requestAnimationFrame(applyScroll);
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
            try {
              await saveChapter(chapterData);
            } catch (dbErr) {
              console.warn(`[快取] 章節 #${index} 寫入本地資料庫失敗 (不影響即時閱讀):`, dbErr);
            }
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
   * 滾動事件處理：雙向感應 (接近頂部追加上一章，接近底端追加下一章，並動態偵測當前可見章節與段落同步進度)
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

    // 3. 判定目前視野頂部所在章節與段落
    this.detectCurrentReadingPosition();
  }

  /**
   * 偵測當前視野正處於哪一章節的哪一個段落，並排程防抖保存進度
   */
  detectCurrentReadingPosition() {
    if (!this.contentBox || !this.currentBook) return;

    const boxRect = this.contentBox.getBoundingClientRect();
    const probeY = boxRect.top + 60; // 頂部偏移探針
    const probeX = boxRect.left + Math.min(boxRect.width / 2, 80);

    let activeChapterIdx = this.currentChapterIndex;
    let activeParagraphIdx = this.currentParagraphIndex;

    // 1. 優先透過 elementFromPoint 高效率命中段落
    const hitEl = document.elementFromPoint(probeX, probeY);
    const pEl = hitEl?.closest('.reader-paragraph');
    const titleEl = hitEl?.closest('.reader-chapter-title');

    if (pEl) {
      const blockEl = pEl.closest('.reader-chapter-block');
      if (blockEl) {
        activeChapterIdx = parseInt(blockEl.dataset.chapterIndex, 10);
        activeParagraphIdx = parseInt(pEl.dataset.idx, 10);
      }
    } else if (titleEl) {
      const blockEl = titleEl.closest('.reader-chapter-block');
      if (blockEl) {
        activeChapterIdx = parseInt(blockEl.dataset.chapterIndex, 10);
        activeParagraphIdx = 0;
      }
    } else {
      // 2. 備用方案：區塊與段落幾何判定
      const blocks = this.contentBox.querySelectorAll('.reader-chapter-block');
      const thresholdY = boxRect.top + boxRect.height * 0.35;
      for (const block of blocks) {
        const bRect = block.getBoundingClientRect();
        if (bRect.top <= thresholdY && bRect.bottom > boxRect.top) {
          activeChapterIdx = parseInt(block.dataset.chapterIndex, 10);
          const paragraphs = block.querySelectorAll('.reader-paragraph');
          for (const p of paragraphs) {
            const pr = p.getBoundingClientRect();
            if (pr.bottom >= boxRect.top + 20) {
              activeParagraphIdx = parseInt(p.dataset.idx, 10);
              break;
            }
          }
        }
      }
    }

    if (activeChapterIdx !== this.currentChapterIndex) {
      this.updateActiveChapterUI(activeChapterIdx, false);
    }

    if (activeChapterIdx !== this.currentChapterIndex || activeParagraphIdx !== this.currentParagraphIndex) {
      this.currentChapterIndex = activeChapterIdx;
      this.currentParagraphIndex = activeParagraphIdx;
      this.scheduleSaveProgress();
    }
  }

  /**
   * 排程防抖保存進度 (400ms)
   */
  scheduleSaveProgress() {
    clearTimeout(this.saveProgressTimer);
    this.saveProgressTimer = setTimeout(() => {
      this.persistReadingProgress();
    }, 400);
  }

  /**
   * 立即儲存當前閱讀進度至資料庫
   */
  async persistReadingProgress() {
    clearTimeout(this.saveProgressTimer);
    if (!this.currentBook || !this.currentBook.chapters) return;

    const chapMeta = this.currentBook.chapters[this.currentChapterIndex];
    this.currentBook.lastChapterIndex = this.currentChapterIndex;
    this.currentBook.lastParagraphIndex = this.currentParagraphIndex || 0;
    if (chapMeta) {
      this.currentBook.lastChapterTitle = chapMeta.title;
    }
    try {
      await saveBook(this.currentBook);
    } catch (err) {
      console.warn('儲存閱讀進度失敗:', err);
    }
  }

  /**
   * 更新當前可見章節 UI (標題與目錄高亮)
   */
  async updateActiveChapterUI(index, shouldSave = true) {
    this.currentChapterIndex = index;
    const chapMeta = this.currentBook?.chapters?.[index];
    if (!chapMeta) return;

    const titleText = convertToTraditional(chapMeta.title, this.openccEnabled);
    if (this.titleEl) this.titleEl.textContent = titleText;
    if (this.statusChapterEl) this.statusChapterEl.textContent = titleText;
    if (this.slider) this.slider.value = index;

    // 同步更新目錄抽屜的高亮項
    this.updateDrawerActiveItem(index);

    if (shouldSave) {
      this.scheduleSaveProgress();
    }
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

    // 1. 若有搜尋關鍵字殘留，開啟時重設以完整顯示全部章節
    const searchInput = document.getElementById('drawer-search-input');
    if (searchInput && searchInput.value) {
      searchInput.value = '';
      this.filterDrawerList('');
    }

    // 2. 確保當前正在閱讀的章節標記為 active
    this.updateDrawerActiveItem(this.currentChapterIndex);

    // 3. 展開抽屜
    this.drawerMask?.classList.add('show');

    // 4. 直接定位到讀者正在閱讀的章節
    this.scrollToActiveDrawerItem();

    // 5. 背景同步已下載章節的圖示狀態
    this.updateDrawerCachedIcons();
  }

  closeDrawer() {
    this.drawerMask?.classList.remove('show');
  }

  async renderDrawer() {
    if (!this.currentBook || !this.currentBook.chapters || !this.drawerList) return;

    const chapters = this.currentBook.chapters;
    let cachedSet = new Set();
    try {
      cachedSet = await getCachedChapterIndices(this.currentBook.id);
    } catch (e) {
      console.warn('獲取快取章節狀態失敗:', e);
    }

    const downloadSvg = `
      <span class="drawer-cached-icon" title="已下載離線快取">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      </span>
    `;

    this.drawerList.innerHTML = chapters
      .map(
        (chap, idx) => `
        <div class="drawer-item ${idx === this.currentChapterIndex ? 'active' : ''}" data-idx="${idx}">
          <div class="drawer-item-title-wrap">
            <span class="drawer-item-title">${convertToTraditional(chap.title, this.openccEnabled)}</span>
          </div>
          <div class="drawer-item-meta">
            ${cachedSet.has(idx) ? downloadSvg : ''}
            <span class="drawer-item-num">#${idx + 1}</span>
          </div>
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

  updateDrawerActiveItem(targetIndex = this.currentChapterIndex) {
    if (!this.drawerList) return;
    const prevActive = this.drawerList.querySelector('.drawer-item.active');
    if (prevActive) {
      prevActive.classList.remove('active');
    }
    const currentItem = this.drawerList.querySelector(`.drawer-item[data-idx="${targetIndex}"]`);
    if (currentItem) {
      currentItem.classList.add('active');
    }
  }

  async updateDrawerCachedIcons() {
    if (!this.drawerList || !this.currentBook) return;
    try {
      const cachedSet = await getCachedChapterIndices(this.currentBook.id);
      const downloadSvg = `
        <span class="drawer-cached-icon" title="已下載離線快取">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </span>
      `;
      this.drawerList.querySelectorAll('.drawer-item').forEach((item) => {
        const idx = parseInt(item.dataset.idx, 10);
        const metaEl = item.querySelector('.drawer-item-meta');
        let iconEl = item.querySelector('.drawer-cached-icon');
        const isCached = cachedSet.has(idx);

        if (isCached && !iconEl && metaEl) {
          const temp = document.createElement('div');
          temp.innerHTML = downloadSvg.trim();
          metaEl.prepend(temp.firstElementChild);
        } else if (!isCached && iconEl) {
          iconEl.remove();
        }
      });
    } catch (e) {
      console.warn('同步目錄快取圖示失敗:', e);
    }
  }

  scrollToActiveDrawerItem() {
    if (!this.drawerList) return;

    const doScroll = () => {
      const activeEl =
        this.drawerList.querySelector(`.drawer-item[data-idx="${this.currentChapterIndex}"]`) ||
        this.drawerList.querySelector('.drawer-item.active');
      if (!activeEl) return;

      // 精確計算目標章節相對於 drawerList 頂部的位移並置中
      const itemTop = activeEl.offsetTop - this.drawerList.offsetTop;
      const targetScrollTop = itemTop - (this.drawerList.clientHeight / 2) + (activeEl.clientHeight / 2);
      this.drawerList.scrollTop = Math.max(0, targetScrollTop);

      // 相容性輔助調用
      if (typeof activeEl.scrollIntoView === 'function') {
        activeEl.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    };

    // 1. 立即同步定位（抽屜展開滑動時內部位置已正對當前章節）
    doScroll();

    // 2. 在渲染幀與抽屜滑入過渡動畫結束（320ms）時校準，防止 layout 尺寸變動影響
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 150);
    setTimeout(doScroll, 320);
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
    this.currentParagraphIndex = pIdx;
    this.scheduleSaveProgress();

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

    const CONCURRENCY = 4; // 並發下載通道數
    const ATTEMPTS_PER_ROUND = 3; // 每一輪最多嘗試 3 次 (初次 + 最多 2 次退避重試)
    const MAX_DEFERS = 3; // 失敗時最多後移 3 次 (共可經歷 4 輪下載)
    const DEFER_OFFSET = 5; // 每次失敗往後移 5 個 Priority 順位
    const TIMEOUT_MS = 5000; // 單章超時 5 秒

    // 建立動態下載佇列 (記錄章節索引與已後移次數)
    let queue = targetIndices.map((idx) => ({
      chapIndex: idx,
      deferCount: 0
    }));

    let activeWorkers = 0;
    let completedCount = 0;
    let successCount = 0;
    let failedCount = 0;
    const totalToDownload = targetIndices.length;

    // 喚醒佇列等待機制的輔助函數
    let wakeResolvers = [];
    const notifyWake = () => {
      while (wakeResolvers.length > 0) {
        const resolve = wakeResolvers.shift();
        resolve();
      }
    };
    const waitTask = () => {
      return new Promise((resolve) => {
        wakeResolvers.push(resolve);
        setTimeout(resolve, 250); // 安全兜底逾時
      });
    };

    const updateUI = (extraMsg = '') => {
      const progressPercent = totalToDownload > 0 ? Math.round((completedCount / totalToDownload) * 100) : 0;
      if (progressBar) progressBar.style.width = `${progressPercent}%`;
      if (percentText) percentText.textContent = `${progressPercent}%`;
      if (statusText) {
        if (extraMsg) {
          statusText.textContent = `(${completedCount}/${totalToDownload}) ${extraMsg}`;
        } else {
          statusText.textContent = `(${completedCount}/${totalToDownload}) 成功 ${successCount} / 失敗 ${failedCount} (4並發高速下載中...)`;
        }
      }
    };

    updateUI();

    const processItem = async (item) => {
      const { chapIndex, deferCount } = item;
      const chapMeta = this.currentBook.chapters[chapIndex];
      let downloaded = false;

      for (let attempt = 0; attempt < ATTEMPTS_PER_ROUND; attempt++) {
        if (this.cancelDownloadFlag) break;

        if (attempt > 0) {
          const deferInfo = deferCount > 0 ? ` [第 ${deferCount}/${MAX_DEFERS} 輪重排]` : '';
          updateUI(`[重試 ${attempt + 1}/${ATTEMPTS_PER_ROUND}] ${chapMeta.title}${deferInfo}...`);
          const backoffMs = attempt * 800;
          const waitStart = Date.now();
          while (Date.now() - waitStart < backoffMs) {
            if (this.cancelDownloadFlag) break;
            await new Promise((r) => setTimeout(r, 80));
          }
          if (this.cancelDownloadFlag) break;
        }

        try {
          if (chapMeta.url && source) {
            const content = await getChapterContent(chapMeta.url, source, { timeout: TIMEOUT_MS });
            await saveChapter({
              bookId: this.currentBook.id,
              index: chapIndex,
              title: chapMeta.title,
              url: chapMeta.url,
              content
            });
            downloaded = true;
            break;
          }
        } catch (err) {
          console.warn(`[並發下載] 章節 #${chapIndex} (${chapMeta.title}) 本輪第 ${attempt + 1} 次嘗試失敗:`, err);
        }
      }

      if (downloaded) {
        successCount++;
        completedCount++;
        updateUI();
      } else if (!this.cancelDownloadFlag) {
        // 本輪 3 次嘗試皆失敗
        if (deferCount < MAX_DEFERS) {
          // 往後移 5 個 Priority 順位，重新排隊
          item.deferCount += 1;
          const insertPos = Math.min(queue.length, DEFER_OFFSET);
          queue.splice(insertPos, 0, item);
          updateUI(`[暫緩] ${chapMeta.title} 連續失敗 3 次，後移 5 順位重試 (第 ${item.deferCount}/${MAX_DEFERS} 次重排)`);
        } else {
          // 已後移滿 3 次，第 4 輪仍失敗 -> 正式判定為失敗
          failedCount++;
          completedCount++;
          updateUI(`[失敗] ${chapMeta.title} 已達最大重試上限`);
        }
      }
    };

    // 啟動 4 個並發 Worker
    const worker = async () => {
      while (!this.cancelDownloadFlag) {
        if (queue.length === 0) {
          if (activeWorkers === 0) {
            // 所有 Worker 皆已閒置且隊列為空 -> 完成
            notifyWake();
            break;
          }
          // 等待其他 Worker 完成或回插暫緩任務
          await waitTask();
          continue;
        }

        const item = queue.shift();
        activeWorkers++;
        try {
          await processItem(item);
        } finally {
          activeWorkers--;
          notifyWake();
        }

        if (this.cancelDownloadFlag) break;
        // 微小間隔 60ms 平滑請求波峰
        await new Promise((r) => setTimeout(r, 60));
      }
    };

    const workers = [];
    const actualConcurrency = Math.min(CONCURRENCY, targetIndices.length);
    for (let w = 0; w < actualConcurrency; w++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    if (this.cancelDownloadFlag) {
      showToast('已取消後續章節下載，已下載內容已保留');
    }

    this.isDownloading = false;
    this.cancelDownloadFlag = false;

    if (statusText) {
      if (failedCount === 0) {
        statusText.textContent = `下載結束：全數 ${successCount} 章快取成功！`;
      } else {
        statusText.textContent = `下載結束：成功 ${successCount} 章，失敗 ${failedCount} 章`;
      }
    }
    await this.updateCacheStats();
    this.updateDrawerCachedIcons();
    if (failedCount === 0) {
      showToast(`離線快取完成 (全數 ${successCount} 章成功)`);
    } else {
      showToast(`離線快取完成 (成功 ${successCount} 章，失敗 ${failedCount} 章)`);
    }

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

  // ==========================================================================
  // 螢幕常亮 (Screen Wake Lock) 控制功能
  // ==========================================================================

  /**
   * 請求螢幕常亮鎖定 (Screen Wake Lock)
   * 確保在閱讀介面下，螢幕不會自動變暗或進入休眠
   */
  async requestWakeLock() {
    if (!('wakeLock' in navigator)) {
      this.updateWakeLockUI();
      return false;
    }

    if (this.wakeLockSentinel && !this.wakeLockSentinel.released) {
      this.updateWakeLockUI();
      return true;
    }

    try {
      this.wakeLockSentinel = await navigator.wakeLock.request('screen');
      this.wakeLockSentinel.addEventListener('release', () => {
        this.wakeLockSentinel = null;
        this.updateWakeLockUI();
      });
      this.updateWakeLockUI();
      return true;
    } catch (err) {
      console.warn('[WakeLock] 請求螢幕常亮失敗:', err);
      this.wakeLockSentinel = null;
      this.updateWakeLockUI();
      return false;
    }
  }

  /**
   * 釋放螢幕常亮鎖定
   */
  async releaseWakeLock() {
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch (err) {
        console.warn('[WakeLock] 釋放螢幕常亮失敗:', err);
      }
      this.wakeLockSentinel = null;
    }
    this.updateWakeLockUI();
  }

  /**
   * 切換螢幕常亮功能開關 (Toggle)
   */
  async toggleWakeLock() {
    if (!('wakeLock' in navigator)) {
      showToast('您的瀏覽器不支援螢幕常亮功能 (Wake Lock API)');
      return;
    }

    this.wakeLockEnabled = !this.wakeLockEnabled;
    await saveSetting('reader_wake_lock', this.wakeLockEnabled);

    if (this.wakeLockEnabled) {
      const success = await this.requestWakeLock();
      if (success) {
        showToast('已開啟螢幕常亮（閱讀中不關閉螢幕）');
      } else {
        showToast('無法取得螢幕常亮（可能處於系統省電模式）');
      }
    } else {
      await this.releaseWakeLock();
      showToast('已關閉螢幕常亮');
    }

    this.updateWakeLockUI();
  }

  /**
   * 更新螢幕常亮相關 UI 控制項狀態
   */
  updateWakeLockUI() {
    const bottomBtn = document.getElementById('btn-toggle-wakelock');
    const topBtn = document.getElementById('reader-btn-wakelock');
    const isSupported = 'wakeLock' in navigator;

    if (bottomBtn) {
      bottomBtn.classList.toggle('active', this.wakeLockEnabled);
      if (!isSupported) {
        bottomBtn.title = '此瀏覽器不支援螢幕常亮功能';
      } else {
        bottomBtn.title = this.wakeLockEnabled ? '螢幕常亮：已開啟（點擊關閉）' : '螢幕常亮：已關閉（點擊開啟）';
      }
    }

    if (topBtn) {
      topBtn.classList.toggle('active', this.wakeLockEnabled);
      if (!isSupported) {
        topBtn.title = '此瀏覽器不支援螢幕常亮功能';
      } else {
        topBtn.title = this.wakeLockEnabled ? '螢幕常亮：已開啟（點擊關閉）' : '螢幕常亮：已關閉（點擊開啟）';
      }
    }
  }

  /**
   * 處理瀏覽器可見度變動 (頁面切換或 App 回到前景)
   */
  async handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      // 若回到頁面、正在閱讀中且使用者開啟了螢幕常亮，重新申請鎖定
      if (this.currentBook && this.wakeLockEnabled) {
        await this.requestWakeLock();
      }
    } else {
      // 頁面進入背景時，瀏覽器會自動釋放，我們同步清理 reference
      if (this.wakeLockSentinel) {
        this.wakeLockSentinel = null;
        this.updateWakeLockUI();
      }
    }
  }
}

export const readerView = new ReaderViewController();
