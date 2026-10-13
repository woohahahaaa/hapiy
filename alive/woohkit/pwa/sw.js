/**
 * woohkit 通用 PWA service worker（保守版）。
 *
 * 和框架无关：Vite / Next / 纯静态都好用。行为刻意做窄，安全优先：
 *  - 只缓存不可变静态资产（构建产物前缀、应用图标）；
 *  - 永远不碰 /api/**（那是实时数据）；
 *  - 永远不拦截导航，UI 每次都是服务端/网络的新鲜版本。
 * 它注册了 fetch handler，这是让应用可被"安装"的关键之一（现代 Chrome 已
 * 放宽，但保留这一层最稳）。外壳/界面大改时把 CACHE 版本号 +1。
 */

const CACHE = "APP_ID_CACHE_PLACEHOLDER-static-v1";
// 按项目改：构建产物的不可变前缀 + 图标。
const STATIC_PREFIXES = ["/assets/", "/_next/static/", "/icon-", "/apple-touch-icon.png"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (!STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        cache.put(request, response.clone()).catch(() => undefined);
      }
      return response;
    })(),
  );
});
