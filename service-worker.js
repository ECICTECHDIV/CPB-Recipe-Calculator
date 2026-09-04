// 版本号:以后更新 index.html 内容时,把这个字符串改成新的日期/版本号(例如 'cpb-cache-v2'),
// 手机上的旧快取才会被换掉、抓到新版本。不改版本号的话,使用者可能会一直看到旧版画面。
const CACHE_NAME = 'cpb-cache-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// 安装阶段:把整个工具的檔案(包含外部 CDN 脚本)先存一份进手机的快取,
// 之后离线时才有东西可以用。外部 CDN 请求用 no-cors 模式,避免因为对方
// 服务器没设好 CORS 而让整个安装失败。
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        APP_SHELL.map((url) => {
          const request = url.startsWith('http') ? new Request(url, { mode: 'no-cors' }) : url;
          return cache.add(request).catch((err) => {
            // 单一资源快取失败不该让整个安装失败(比如使用者当下没网路连不到 CDN),
            // 之后正常连网使用时,fetch 事件那边还是会再补快取一次
            console.warn('Service worker: failed to cache', url, err);
          });
        })
      );
    })
  );
  self.skipWaiting();
});

// 启用阶段:清掉旧版本留下的快取,避免占用空间、也避免读到过期档案
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// 请求拦截:快取优先(cache-first)——先看手机里有没有存过,有的话直接用(离线也能开),
// 没有的话才去网路上抓,抓到了顺便存一份起来,下次离线也能用
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // 只快取「有效回应」,避免把错误页面也存进去
          const shouldCache = response && (response.status === 200 || response.type === 'opaque');
          if (shouldCache) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return response;
        })
        .catch(() => {
          // 离线且快取里也没有的情况(例如第一次开就没网路):
          // 至少把 index.html 挡回去,而不是整个白屏
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});
