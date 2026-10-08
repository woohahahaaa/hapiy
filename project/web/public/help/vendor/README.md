# vendor

第三方静态资源，构建时不加工，直接随 `public/help/` 复制进 `webdist/help/`。

- `docsify.min.js`、`themes/vue.css`、`themes/dark.css`、`plugins/search.min.js`
  来自 docsify 4.13.1（npm 包 `docsify@4.13.1`，MIT License）。
- CSS 中原本指向 Google Fonts 的 `@import` 已移除，保证离线/内网可用。
