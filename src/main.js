/**
 * 應用程式進入點 (Application Main Entry)
 * 初始化資料庫、書源、各視圖控制器與底部導航分頁切換
 */

import { initDefaultSources } from './services/sourceEngine.js';
import { bookshelfView } from './ui/bookshelfView.js';
import { searchView } from './ui/searchView.js';
import { sourcesView } from './ui/sourcesView.js';
import { settingsView } from './ui/settingsView.js';
import { readerView } from './ui/readerView.js';
import { initPwaManager } from './services/pwaManager.js';

async function initApp() {
  console.log('正在啟動隨身小說閱讀器...');

  // 初始化 PWA 離線快取與更新進度管理器
  initPwaManager();

  // 1. 初始化預設書源
  await initDefaultSources();

  // 2. 初始化各視圖模組
  await readerView.init();
  bookshelfView.init();
  searchView.init();
  sourcesView.init();
  await settingsView.init();

  // 3. 綁定底部導航分頁切換
  const navItems = document.querySelectorAll('.nav-item');
  const views = {
    bookshelf: document.getElementById('view-bookshelf'),
    search: document.getElementById('view-search'),
    sources: document.getElementById('view-sources'),
    settings: document.getElementById('view-settings')
  };

  const headerTitle = document.getElementById('header-title-text');
  const titles = {
    bookshelf: '隨身書架',
    search: '線上搜尋',
    sources: '書源管理',
    settings: '偏好設定'
  };

  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const targetViewName = item.dataset.view;
      if (!views[targetViewName]) return;

      // 切換導航欄選中狀態
      navItems.forEach((nav) => nav.classList.remove('active'));
      item.classList.add('active');

      // 切換視圖容器顯示
      Object.keys(views).forEach((name) => {
        views[name].classList.toggle('active', name === targetViewName);
      });

      // 更新頂部標題
      if (headerTitle) {
        headerTitle.textContent = titles[targetViewName] || '隨身閱讀';
      }

      // 切換觸發對應視圖更新
      if (targetViewName === 'bookshelf') {
        bookshelfView.render();
      } else if (targetViewName === 'search') {
        searchView.loadSourceOptions();
      } else if (targetViewName === 'sources') {
        sourcesView.render();
      } else if (targetViewName === 'settings') {
        settingsView.updateStorageStats();
      }
    });
  });

  console.log('隨身小說閱讀器啟動完成！');
}

// 頁面載入完成後啟動
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
