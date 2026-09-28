/**
 * 書源管理視圖控制器 (Sources View Controller)
 * 支援書源開關、規則編輯、JSON 匯入/匯出與重置預設書源
 */

import { getAllSources, saveSource, deleteSource } from '../db/index.js';
import { DEFAULT_BOOK_SOURCES } from '../services/defaultSources.js';
import { showToast } from './toast.js';

class SourcesViewController {
  constructor() {
    this.listContainer = null;
    this.modalEl = null;
    this.jsonEditor = null;
    this.editingSource = null;
  }

  init() {
    this.listContainer = document.getElementById('sources-list-container');
    this.modalEl = document.getElementById('source-modal');
    this.jsonEditor = document.getElementById('source-json-editor');

    this.bindEvents();
    this.render();
  }

  bindEvents() {
    // 新增書源按鈕
    document.getElementById('btn-add-source')?.addEventListener('click', () => {
      const template = {
        id: `custom_${Date.now()}`,
        name: '自訂書源',
        baseUrl: 'https://example.com',
        enabled: true,
        charset: 'utf-8',
        searchUrl: 'https://example.com/search?q={keyword}',
        searchListSelector: '.book-item',
        titleSelector: '.title',
        authorSelector: '.author',
        bookUrlSelector: 'a',
        coverSelector: 'img',
        introSelector: '.intro',
        detailCoverSelector: '.cover img',
        detailIntroSelector: '.description',
        detailLatestChapterSelector: '.latest',
        chapterListSelector: '.chapter-list a',
        chapterTitleSelector: '',
        chapterUrlSelector: '',
        contentSelector: '.content',
        filterRegex: ''
      };
      this.openModal(template);
    });

    // 匯入書源 (JSON)
    document.getElementById('btn-import-sources')?.addEventListener('click', () => {
      const jsonStr = prompt('請貼上書源 JSON 規則 (支援單一物件或陣列):');
      if (!jsonStr) return;
      try {
        const parsed = JSON.parse(jsonStr);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        list.forEach(async (s) => {
          if (!s.id) s.id = `custom_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
          await saveSource(s);
        });
        showToast(`成功匯入 ${list.length} 個書源！`);
        this.render();
      } catch (e) {
        alert(`JSON 解析錯誤: ${e.message}`);
      }
    });

    // 匯出全部書源
    document.getElementById('btn-export-sources')?.addEventListener('click', async () => {
      const sources = await getAllSources();
      const json = JSON.stringify(sources, null, 2);
      navigator.clipboard.writeText(json).then(() => {
        showToast('已將所有書源複製至剪貼簿！');
      }).catch(() => {
        prompt('請手動複製以下書源 JSON:', json);
      });
    });

    // 重置為預設書源
    document.getElementById('btn-reset-sources')?.addEventListener('click', async () => {
      if (confirm('確定要還原為系統預設書源嗎？自訂的書源可能會被清除。')) {
        for (const s of DEFAULT_BOOK_SOURCES) {
          await saveSource(s);
        }
        showToast('已恢復預設書源！');
        this.render();
      }
    });

    // 彈窗儲存 / 取消
    document.getElementById('source-modal-save')?.addEventListener('click', async () => {
      try {
        const parsed = JSON.parse(this.jsonEditor.value);
        if (!parsed.id || !parsed.name || !parsed.baseUrl || !parsed.searchUrl) {
          throw new Error('缺少必要欄位 (id, name, baseUrl, searchUrl)');
        }
        await saveSource(parsed);
        this.closeModal();
        showToast(`已儲存書源: ${parsed.name}`);
        this.render();
      } catch (e) {
        alert(`儲存失敗: ${e.message}`);
      }
    });

    document.getElementById('source-modal-cancel')?.addEventListener('click', () => {
      this.closeModal();
    });
  }

  async render() {
    if (!this.listContainer) return;
    const sources = await getAllSources();

    this.listContainer.innerHTML = sources
      .map(
        (s) => `
      <div class="search-item" style="align-items:center; justify-content:space-between; padding: 12px 16px;">
        <div style="flex:1;">
          <div style="font-weight:700; font-size:15px; color:#fff; display:flex; align-items:center; gap:8px;">
            ${s.name}
            <span style="font-size:10px; background:#334155; padding:2px 6px; border-radius:4px; color:#94a3b8;">${s.charset || 'utf-8'}</span>
          </div>
          <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">${s.baseUrl}</div>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <label style="display:flex; align-items:center; cursor:pointer;">
            <input type="checkbox" class="source-toggle" data-id="${s.id}" ${s.enabled ? 'checked' : ''} style="width:18px; height:18px; accent-color:var(--primary-color);">
          </label>
          <button class="btn-sm btn-secondary btn-edit-source" data-id="${s.id}">編輯</button>
          <button class="btn-sm btn-secondary btn-del-source" data-id="${s.id}" style="color:#ef4444;">刪除</button>
        </div>
      </div>
    `
      )
      .join('');

    // 綁定事件
    this.listContainer.querySelectorAll('.source-toggle').forEach((chk) => {
      chk.addEventListener('change', async (e) => {
        const id = chk.dataset.id;
        const source = sources.find((s) => s.id === id);
        if (source) {
          source.enabled = e.target.checked;
          await saveSource(source);
          showToast(`已${source.enabled ? '啟用' : '停用'} ${source.name}`);
        }
      });
    });

    this.listContainer.querySelectorAll('.btn-edit-source').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const source = sources.find((s) => s.id === id);
        if (source) this.openModal(source);
      });
    });

    this.listContainer.querySelectorAll('.btn-del-source').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (confirm('確定刪除此書源？')) {
          await deleteSource(id);
          showToast('已刪除');
          this.render();
        }
      });
    });
  }

  openModal(source) {
    this.editingSource = source;
    if (this.jsonEditor) {
      this.jsonEditor.value = JSON.stringify(source, null, 2);
    }
    this.modalEl?.style.setProperty('display', 'flex');
  }

  closeModal() {
    this.modalEl?.style.setProperty('display', 'none');
  }
}

export const sourcesView = new SourcesViewController();
