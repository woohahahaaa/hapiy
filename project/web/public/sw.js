// kill-switch SW：hapiy 本身从不注册 Service Worker，本文件只是"逃生出口"，
// 让此源上残留的任何旧 SW 自动更新到本脚本，安装后立即清空所有缓存、注销
// 自己并刷新页面 —— 避免旧 SW 缓存卡死页面。
// 必须存在：/sw.js 一旦落到 SPA fallback 返回 index.html(text/html)，
// 残留的 SW 更新请求拿到 HTML 会永远失败、再也清不掉。
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', async (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach((c) => {
        try {
          c.navigate(c.url);
        } catch {
          /* ignore */
        }
      });
    })(),
  );
});
