/**
 * 原生環境整合服務 (Native Android Adapter)
 * 僅在 __IS_APK__ 模式下啟用，負責 Android 硬體返回鍵、App 退出與原生行為控制
 */

import { App } from '@capacitor/app';
import { readerView } from '../ui/readerView.js';
import { showToast } from '../ui/toast.js';

let lastBackTime = 0;

export function initNativeApp() {
  if (typeof window === 'undefined') return;

  // 監聽 Android 實體與手勢返回鍵
  App.addListener('backButton', () => {
    // 1. 如果有開啟的通用彈窗 (Modal)，優先關閉
    const openModals = Array.from(document.querySelectorAll('.modal')).filter(
      (m) => m.style.display === 'flex' || m.style.display === 'block'
    );
    if (openModals.length > 0) {
      openModals.forEach((m) => (m.style.display = 'none'));
      return;
    }

    // 2. 如果處於閱讀器畫面
    const readerContainer = document.getElementById('view-reader');
    if (readerContainer && readerContainer.classList.contains('active')) {
      // 2a. 若章節目錄側邊欄開啟，關閉目錄
      if (readerView.drawerMask?.classList.contains('show')) {
        readerView.closeDrawer();
        return;
      }
      // 2b. 若文字排版選單開啟，關閉排版選單
      if (readerView.isTextPanelVisible) {
        readerView.hideTextPanel();
        return;
      }
      // 2c. 若控制欄開啟，關閉控制欄
      if (readerView.isMenuVisible) {
        readerView.hideMenu();
        return;
      }
      // 2d. 否則退出閱讀器，返回書架
      readerView.closeReader();
      return;
    }

    // 3. 如果在搜尋或設定分頁，返回書架分頁
    const bookshelfNav = document.querySelector('.nav-item[data-view="bookshelf"]');
    const bookshelfViewEl = document.getElementById('view-bookshelf');
    if (bookshelfViewEl && !bookshelfViewEl.classList.contains('active')) {
      if (bookshelfNav) bookshelfNav.click();
      return;
    }

    // 4. 在書架首頁：2 秒內連按兩次返回鍵退出 App
    const now = Date.now();
    if (now - lastBackTime < 2000) {
      App.exitApp();
    } else {
      lastBackTime = now;
      showToast('再按一次退出隨身閱讀器');
    }
  });

  console.log('[Native] Android 實體返回鍵監聽已啟動');
}
