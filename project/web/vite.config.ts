/// <reference types="vitest/config" />
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { flowLogMiddleware } from "./flow-log-middleware"

// https://vite.dev/config/
export default defineConfig({
  plugins: [flowLogMiddleware(), react(), tailwindcss()],
  test: {
    // Component snapshot tests render translated UI; load the i18n singleton
    // (defaults to Chinese) before each test file.
    setupFiles: ["./src/test/setup.ts"],
  },
  server: {
    host: "0.0.0.0",
    port: 18009,
    strictPort: true,
    allowedHosts: ["macs1.hihy.me", "hapiying.hihy.me"],
    proxy: {
      // Agent 接入走 /proxy/__来源 前缀（来源标记），转发到后端 API。
      // 例：/proxy/__opencodetest/chat/completions -> /v1/chat/completions
      "/proxy": {
        target: "http://localhost:8080",
        rewrite: (path: string) => {
          const match = path.match(/^\/proxy\/__[^/]+(\/.*)?$/)
          return match ? `/v1${match[1] ?? ""}` : path
        },
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const original = (req as any).originalUrl ?? req.url ?? ""
            const match = original.match(/^\/proxy\/(__[^/]+)/)
            if (match) {
              proxyReq.setHeader("X-Hapiy-Source", match[1])
            }
          })
        },
      },
      "/v1": "http://localhost:8080",
      "/metrics": "http://localhost:8080",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})