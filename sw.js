// 浸染試染工具 — Service Worker
// 策略：網路優先（online 時一定抓最新版本），只有離線時才退回使用快取。
// 這樣現場有網路時更新 index.html，重新整理就能看到新版；真的沒網路時仍可用舊版開啟。
// 技術手冊已搬到「染整工具箱」入口頁，這裡不再快取PDF檔案。
const CACHE_NAME = "dye-work-order-v8";
const CORE_ASSETS = [
  "./index.html",
  "./data.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// iPhone 拍照存結果照片時，app.js 會動態載入這個 HEIC 轉檔函式庫。
// 網址是釘死版本號的（@0.0.4），內容不會變，所以一旦成功抓過一次、快取起來，
// 之後離線也能用，不用每次都連網才能存 HEIC 照片。
const HEIC2ANY_URL = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting(); // 新版本安裝好立刻接手，不用等所有分頁都關掉
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // 只接管自己網域的檔案，加上 heic2any 這個特例（版本釘死、值得離線快取）；
  // 其他外部 CDN（例如 html2canvas）交給瀏覽器自己的 HTTP 快取處理，不在這裡攔截
  let sameOrigin = false;
  try { sameOrigin = new URL(req.url).origin === self.location.origin; } catch (e) {}
  if (!sameOrigin && req.url !== HEIC2ANY_URL) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req)) // 離線時才退回用快取
  );
});
