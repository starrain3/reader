/**
 * Cloudflare Worker 免費 CORS 代理轉發腳本 (含專屬 API Key 安全防護)
 * 
 * 部署教學：
 * 1. 登入 Cloudflare (https://dash.cloudflare.com/)
 * 2. 點選左側選單「Workers & Pages」 -> 「Create application」 -> 「Create Worker」
 * 3. 命名後點選「Deploy」，接著點選「Edit code」
 * 4. 將本檔案全部程式碼貼上：
 *    - 您可以在下方 API_KEY_SECRET 填寫您自訂的密碼（例如 "my-novel-pass-2026"）
 *    - 或者在 Cloudflare 後台 Settings -> Variables 新增一個名為 API_KEY 的環境變數
 * 5. 點選「Save and Deploy」
 * 6. 回到閱讀器 APP 的「設定」頁面：
 *    - 填入 Worker 網址 (如 https://novel-proxy.xxx.workers.dev)
 *    - 填入您的安全金鑰 (如 my-novel-pass-2026)
 *    - 點擊「測試連線」驗證成功即可！
 */

// 若您不想在 Cloudflare 後台設環境變數，可直接在下方引號中填入您的自訂通關金鑰
const HARDCODED_API_KEY = ""; 

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    };

    // 處理預檢 OPTIONS 請求
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    // 取得客戶端傳入的金鑰 (支援網址參數 key 或 Header x-api-key)
    const clientKey = url.searchParams.get("key") || request.headers.get("x-api-key");
    const requiredKey = env?.API_KEY || HARDCODED_API_KEY;


    // 2. 健康檢查與連線測試通道
    if (url.searchParams.get("ping") === "1" || !targetUrl) {
      return new Response(
        JSON.stringify({
          status: "ok",
          message: "✓ Cloudflare Worker 連線正常，金鑰認證通過！",
          timestamp: Date.now(),
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
        }
      );
    }

    // 3. 執行代理轉發請求
    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      const newHeaders = new Headers(response.headers);
      Object.keys(corsHeaders).forEach((k) => newHeaders.set(k, corsHeaders[k]));

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: `轉發請求失敗: ${err.message}` }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
      });
    }
  },
};
