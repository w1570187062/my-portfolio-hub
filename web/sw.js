/* 持仓侠 PWA Service Worker —— 提供离线可用与「添加到主屏幕」。
   注意：Service Worker 仅在安全上下文（https 或 http://localhost）下才会注册/生效；
   通过局域网 http://<ip>:9989 访问时不会启用（前端已用 isSecureContext 判断，不会报错）。 */
const CACHE = 'pf-cache-v2';
const PRECACHE = [
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 服务端给静态资源加了 no-store，Cache API 会拒收；这里重建响应剥掉该头部，
// 让 app.js / style.css / index.html 能可靠落盘。
function cacheable(res) {
  const h = new Headers(res.headers);
  h.delete('cache-control');
  h.delete('pragma');
  return new Response(res.clone().body, {
    status: res.status,
    statusText: res.statusText,
    headers: h,
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return; // 接口请求永不缓存

  // 页面导航：网络优先，断网回退到已缓存的首页（离线仍能看到上次界面）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          caches.open(CACHE).then((cc) => cc.put('/index.html', cacheable(res)));
        }
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 静态资源（/app.js?v=…、/style.css?v=…、/favicon.svg 等）：缓存优先 + 后台更新
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const cached = await c.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) c.put(req, cacheable(res));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
