/**
 * 本地檔案解析器 (TXT & EPUB)
 * 支援編碼自動辨識、正則目錄智慧切割與 EPUB 容器解構
 */

import JSZip from 'jszip';

// 常用章節正規劃分規則
const CHAPTER_REGEX = /^[ \t]*(?:第[0-9一二三四五六七八九十百千两]+[章回節卷部篇集]|Chapter\s+[0-9]+|[0-9]{1,4}[、. ][^\n]{1,30})[ \t]*[^\n]*/gim;

/**
 * 解析本地 TXT 檔案
 * @param {File} file
 */
export async function parseTxtFile(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // 1. 自動辨識編碼 (UTF-8, Big5, GBK)
  let text = '';
  let encodingUsed = 'utf-8';
  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    text = utf8Decoder.decode(bytes);
  } catch {
    // UTF-8 失敗，嘗試 Big5 (繁體常用) 與 GBK (簡體常用)
    try {
      const big5Decoder = new TextDecoder('big5', { fatal: true });
      text = big5Decoder.decode(bytes);
      encodingUsed = 'big5';
    } catch {
      const gbkDecoder = new TextDecoder('gbk', { fatal: false });
      text = gbkDecoder.decode(bytes);
      encodingUsed = 'gbk';
    }
  }

  // 2. 智慧切割章節
  const bookTitle = file.name.replace(/\.[^/.]+$/, '');
  const matches = [...text.matchAll(CHAPTER_REGEX)];

  const chapters = [];

  if (matches.length > 0) {
    // 序章 / 楔子 (若第 1 章前有文字)
    if (matches[0].index > 0) {
      const introContent = text.substring(0, matches[0].index).trim();
      if (introContent.length > 0) {
        chapters.push({
          index: 0,
          title: '前言 / 序言',
          content: formatContent(introContent)
        });
      }
    }

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const title = match[0].trim();
      const startIndex = match.index + match[0].length;
      const endIndex = (i + 1 < matches.length) ? matches[i + 1].index : text.length;
      const rawContent = text.substring(startIndex, endIndex);

      chapters.push({
        index: chapters.length,
        title,
        content: formatContent(rawContent)
      });
    }
  } else {
    // 未匹配到章節標題，按每 8000 字自動切割
    const CHUNK_SIZE = 8000;
    const totalChunks = Math.ceil(text.length / CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
      const chunk = text.substr(i * CHUNK_SIZE, CHUNK_SIZE);
      chapters.push({
        index: i,
        title: `第 ${i + 1} 部分`,
        content: formatContent(chunk)
      });
    }
  }

  return {
    id: `local_txt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    title: bookTitle,
    author: '本地書籍',
    cover: '',
    intro: `本地 TXT 匯入 (${encodingUsed.toUpperCase()} 編碼，共 ${chapters.length} 章)`,
    sourceId: 'local',
    sourceName: '本地文件',
    chapters
  };
}

/**
 * 解析本地 EPUB 檔案
 * @param {File} file
 */
export async function parseEpubFile(file) {
  const zip = await JSZip.loadAsync(file);

  // 1. 讀取 META-INF/container.xml 找出 content.opf 路徑
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) {
    throw new Error('無效的 EPUB 格式: 缺少 container.xml');
  }

  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, 'application/xml');
  const rootfileEl = containerDoc.querySelector('rootfile');
  const opfPath = rootfileEl ? rootfileEl.getAttribute('full-path') : '';
  if (!opfPath) {
    throw new Error('無法定位 EPUB 內容根目錄 (OPF)');
  }

  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
  const opfContent = await zip.file(opfPath)?.async('string');
  const opfDoc = parser.parseFromString(opfContent, 'application/xml');

  // 2. 解析元數據
  const title = opfDoc.querySelector('title')?.textContent?.trim() || file.name.replace(/\.[^/.]+$/, '');
  const author = opfDoc.querySelector('creator')?.textContent?.trim() || '未知作者';
  const intro = opfDoc.querySelector('description')?.textContent?.trim() || '本地 EPUB 匯入書籍';

  // 3. 處理 Manifest 與 Spine
  const manifestItems = {};
  opfDoc.querySelectorAll('manifest > item').forEach((item) => {
    manifestItems[item.getAttribute('id')] = item.getAttribute('href');
  });

  const spineItemRefs = opfDoc.querySelectorAll('spine > itemref');
  const chapters = [];

  for (let i = 0; i < spineItemRefs.length; i++) {
    const idref = spineItemRefs[i].getAttribute('idref');
    const href = manifestItems[idref];
    if (href) {
      const fullPath = opfDir + href;
      const htmlContent = await zip.file(fullPath)?.async('string');
      if (htmlContent) {
        const chapterDoc = parser.parseFromString(htmlContent, 'text/html');
        const chapterTitle = chapterDoc.querySelector('h1, h2, h3, title')?.textContent?.trim() || `第 ${i + 1} 章`;
        
        // 清理 HTML
        chapterDoc.querySelectorAll('script, style, link').forEach((el) => el.remove());
        const bodyText = chapterDoc.body ? chapterDoc.body.textContent : '';

        chapters.push({
          index: chapters.length,
          title: chapterTitle,
          content: formatContent(bodyText)
        });
      }
    }
  }

  return {
    id: `local_epub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    title,
    author,
    cover: '',
    intro,
    sourceId: 'local',
    sourceName: '本地 EPUB',
    chapters
  };
}

/**
 * 格式化文字內容
 */
function formatContent(text) {
  if (!text) return '';
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n\n');
}
