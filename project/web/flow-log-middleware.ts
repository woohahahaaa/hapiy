// FLOW-DEBUG: dev-only server middleware that appends animation lifecycle
// lines to project/web/.debug/flow.log. Imported only from vite.config.ts;
// comment out that import to disable the file-logging half of the tracer.
// The console half lives in src/modules/flow-debug.ts (imported by the page).
import fs from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"

export function flowLogMiddleware(): Plugin {
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
            const dir = path.resolve(process.cwd(), ".debug")
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