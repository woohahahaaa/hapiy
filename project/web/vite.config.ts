import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import fs from "node:fs"
import { defineConfig, type Plugin } from "vite"

// FLOW-DEBUG: dev-only endpoint appending animation lifecycle lines to .debug/flow.log
// (gitignored). Removed together with the flow-log module after diagnosis.
function flowLogMiddleware(): Plugin {
  return {
    name: "flow-log-middleware",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__flow-log", (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405)
          res.end()
          return
        }
        let body = ""
        req.on("data", (chunk: Buffer) => void (body += chunk.toString()))
        req.on("end", () => {
          try {
            const { line } = JSON.parse(body) as { line: string }
            if (typeof line !== "string") throw new Error("bad line")
            const dir = path.resolve(__dirname, ".debug")
            fs.mkdirSync(dir, { recursive: true })
            fs.appendFileSync(path.join(dir, "flow.log"), `${line}\n`)
            res.writeHead(204)
          } catch {
            res.writeHead(400)
          } finally {
            res.end()
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [flowLogMiddleware(), react(), tailwindcss()],
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
