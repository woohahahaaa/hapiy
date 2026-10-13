# PWA（框架无关）

图标 / `manifest.webmanifest` / `sw.js` 由 `./alive/pwa.sh` 从一张 logo 生成，
纯静态资产，任何前端框架都能用（命令与配置见 `CONTRACT.md` 第六节）。

```sh
./alive/pwa.sh logo web/logo.png --round 10%
./alive/pwa.sh title "我的应用" --short 短名
./alive/pwa.sh theme "#0a0202"
```

命令把生成物写进前端静态目录（自动探测 `web/public`、`public` …），并打印一段
要贴进 `index.html` `<head>` 的片段。`sw.js` 只在缺失时生成一次，之后按注释自己
维护（改界面大改时把 CACHE 版本号 +1）。

## 还需要手写的两处

1. 应用入口注册 service worker（仅生产环境）：

   ```js
   if (import.meta.env.PROD && "serviceWorker" in navigator) {
     navigator.serviceWorker.register("/sw.js").catch(() => undefined);
   }
   ```

   dev 模式建议主动注销残留的 SW（旧的缓存会卡住 HMR 页面）。

2. 可选：捕获 `beforeinstallprompt`，在设置页放"安装应用"按钮：

   ```ts
   let deferred: any = null;
   window.addEventListener("beforeinstallprompt", (e) => {
     e.preventDefault();
     deferred = e;
   });
   export async function install() {
     if (!deferred) return;
     deferred.prompt();
     await deferred.userChoice;
     deferred = null;
   }
   ```

## 说明

- 生成的 `sw.js` 是保守版：只缓存不可变静态资产（构建产物前缀、图标），不碰
  `/api/**`、不拦导航。纯静态层的 installability 不依赖它（现代 Chrome 已放宽）；
  它只负责离线缓存，装了不吃亏。
- macOS 桌面体验建议走 kit 的原生壳（`INSTALL_DESKTOP=1`，见 CONTRACT.md
  第五节）：程序坞图标、无地址栏，比 PWA 更"原生"，而且复用同一张
  `icon-512.png`；PWA 是浏览器侧的正交补充。
