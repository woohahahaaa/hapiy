/// <reference types="vitest/config" />
import path from "node:path"
import { execFileSync } from "node:child_process"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { flowLogMiddleware } from "./flow-log-middleware"

function configuredReverseProxyDomains(): string[] {
  const dbPath = process.env.HAPIY_DB_PATH ?? path.resolve(__dirname, "../backend/hapiy.db")
  try {
    const raw = execFileSync("sqlite3", ["-json", dbPath, "SELECT value FROM settings WHERE key = 'reverse_proxy_domains' LIMIT 1;"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    const value = JSON.parse(raw.trim() || "[]")[0]?.value
    const domains = JSON.parse(typeof value === "string" ? value : "[]")
    return Array.isArray(domains) ? domains.filter((domain): domain is string => typeof domain === "string") : []
  } catch {
    return []
  }
}

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
    allowedHosts: ["macs1.example.com", "hapiying.example.com", ...configuredReverseProxyDomains()],
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
