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
    bookUrlSelector: 'a.novel-item-title',
    coverSelector: '.novel-item-thumbnail img',
    introSelector: '.novel-item-description',
    // 書籍詳情與目錄規則
    detailCoverSelector: '.novel-detail-item .thumbnail img',
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
    id: 'biqu5200',
    name: '新筆趣閣 (Biquge)',
    baseUrl: 'https://www.biqu5200.net',
    enabled: true,
    charset: 'gbk',
    searchUrl: 'https://www.biqu5200.net/modules/article/search.php?searchkey={keyword}',
    searchListSelector: 'table.grid tr:not(:first-child)',
    titleSelector: 'td:nth-child(1) a',
    authorSelector: 'td:nth-child(3)',
    bookUrlSelector: 'td:nth-child(1) a',
    coverSelector: '',
    introSelector: '',
    detailCoverSelector: '#fmimg img',
    detailIntroSelector: '#intro',
    detailLatestChapterSelector: '#info p:last-child a',
    chapterListSelector: '#list dd a',
    chapterTitleSelector: '',
    chapterUrlSelector: '',
    contentSelector: '#content',
    filterRegex: '(筆趣閣|www\\.biqu5200\\.net|最新章節！|請收藏本站)'
  },
  {
    id: 'shuba69',
    name: '69書吧 (69shu)',
    baseUrl: 'https://www.69shu.cx',
    enabled: true,
    charset: 'gbk',
    searchUrl: 'https://www.69shu.cx/modules/article/search.php?searchkey={keyword}&searchtype=all',
    searchListSelector: '.newbox ul li',
    titleSelector: 'h3 a',
    authorSelector: '.zong a',
    bookUrlSelector: 'h3 a',
    coverSelector: 'img',
    introSelector: 'ol',
    detailCoverSelector: '.bookbox .bookimg2 img',
    detailIntroSelector: '.navtxt p',
    detailLatestChapterSelector: '.quyu a',
    chapterListSelector: '#catalog ul li a',
    chapterTitleSelector: '',
    chapterUrlSelector: '',
    contentSelector: '.txtnav',
    filterRegex: '(69書吧|www\\.69shu\\.cx|帶上隨身空間|純文字在線閱讀)'
  }
];
