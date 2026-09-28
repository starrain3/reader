/**
 * Cloudflare Worker 免費 CORS 代理轉發腳本
 * 
 * 部署教學：
 * 1. 登入 Cloudflare (https://dash.cloudflare.com/)
 * 2. 點選左側選單「Workers & Pages」 -> 「Create application」 -> 「Create Worker」
 * 3. 命名後點選「Deploy」，接著點選「Edit code」
 * 4. 將本檔案全部程式碼貼上並點選「Save and Deploy」
 * 5. 將產生的 Worker 網址 (如 https://novel-proxy.xxx.workers.dev/?url=) 填入閱讀器的「設定」中即可！
 */

export default {
  async fetch(request) {
    // 處理預檢 OPTIONS 請求
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "Missing 'url' query parameter" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    try {
      // 偽造行動端瀏覽器請求標頭以避免被小說網站阻擋
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      const newHeaders = new Headers(response.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      newHeaders.set("Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS");
      newHeaders.set("Access-Control-Allow-Headers", "*");

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  },
};
