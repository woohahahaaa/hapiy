/// <reference types="vitest/config" />
import path from "node:path"
import { execFileSync } from "node:child_process"
import os from "node:os"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { flowLogMiddleware } from "./flow-log-middleware"

function configuredReverseProxyDomains(): string[] {
  const dbPath = process.env.HAPIY_DB_PATH ?? path.join(os.homedir(), ".hapiy", "hapiy.db")
  try {
    const raw = execFileSync("sqlite3", ["-json", dbPath, "SELECT value FROM settings WHERE key = 'reverse_proxy_domains' LIMIT 1;"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    const value = JSON.parse(raw.trim() || "[]")[0]?.value
    const domains = JSON.parse(typeof value === "string" ? value : "[]")
    return Array.isArray(domains)
      ? domains
          .filter((domain): domain is string => typeof domain === "string")
          .map((domain) => (domain.startsWith("*.") ? `.${domain.slice(2)}` : domain))
      : []
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
      // Agent 接入走 /proxy/__来源 前缀（来源标记），原样转发给后端；后端
      // 的来源前缀路由负责剥离前缀、落 X-Hapiy-Source，并把 agent 自己拼的
      // 操作路径（/chat/completions 等）直接交给 dispatch 与上游拼接。
      // 例：/proxy/__opencodetest/chat/completions -> 后端见 /chat/completions
      "/proxy": {
        target: "http://localhost:8080",
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
