/**
 * 預設書源設定檔 (Default Book Sources)
 * 遵循靈活的 CSS Selector 規則，支援自訂與匯入/匯出
 */

export const DEFAULT_BOOK_SOURCES = [
  {
    id: 'czbooks',
    name: '小說狂人 (CZBooks)',
    baseUrl: 'https://czbooks.net',
    enabled: true,
    charset: 'utf-8',
    searchUrl: 'https://czbooks.net/s/{keyword}',
    searchListSelector: '.novel-item-wrapper',
    titleSelector: '.novel-item-title',
    authorSelector: '.novel-item-author a, .novel-item-author',
    bookUrlSelector: 'a',
    coverSelector: '.novel-item-thumbnail img',
    introSelector: '.novel-item-description',
    // 書籍詳情與目錄規則
    detailCoverSelector: '.novel-detail-item .thumbnail img, .thumbnail img',
    detailIntroSelector: '.description',
    detailLatestChapterSelector: '.chapter-detail-item .chapter-name',
    chapterListSelector: 'ul.chapter-list li a',
    chapterTitleSelector: '',
    chapterUrlSelector: '',
    // 內文規則
    contentSelector: '.content',
    filterRegex: '(請記住本書首發域名|小說狂人|轉載請註明出處|czbooks\\.net)'
  },
  {
    id: 'piaotia',
    name: '飄天文學 (Piaotia)',
    baseUrl: 'https://www.piaotia.com',
    enabled: true,
    charset: 'gbk',
    searchUrl: 'https://www.piaotia.com/modules/article/search.php?searchkey={keyword}',
    searchListSelector: 'table.grid tr:not(:first-child)',
    titleSelector: 'td:nth-child(1) a',
    authorSelector: 'td:nth-child(3)',
    bookUrlSelector: 'td:nth-child(1) a',
    coverSelector: '',
    introSelector: '',
    // 書籍詳情與目錄規則
    detailCoverSelector: 'img[src*="files/article/image"]',
    detailIntroSelector: 'table td[colspan="4"] + tr',
    detailLatestChapterSelector: '.hottext + a',
    chapterListSelector: '.centent a, ul li a',
    chapterTitleSelector: '',
    chapterUrlSelector: '',
    // 內文規則
    contentSelector: '#content',
    filterRegex: '(飄天文學|www\\.piaotia\\.com|最新章節！|請收藏本站|最快更新|天才一秒記住本站地址)'
  }
];
