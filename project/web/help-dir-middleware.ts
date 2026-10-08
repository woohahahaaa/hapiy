// dev-only：把 /help 与 /help/ 重写到 public/help/index.html。
// Vite 不会为 public 目录解析目录索引，否则会落到 SPA fallback 返回应用首页；
// 生产环境由 Go 静态服务承担同样的目录 index 行为（见 cmd/hapiy/main.go）。
import type { Plugin } from "vite"

export function helpDirMiddleware(): Plugin {
  return {
    name: "help-dir-middleware",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = req.url?.split("?")[0]
        if (path === "/help" || path === "/help/") req.url = "/help/index.html"
        next()
      })
    },
  }
}
