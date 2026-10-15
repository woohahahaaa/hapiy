import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// 只构建预览页（preview.html）的独立配置：产物 dist-preview/p.html，
// 拷到生产 webdist 时改名为无后缀的 p，短链 /p 即可访问。
// 不引入 vite.config.ts（那里有 dev 专用的中间件与 dev server 设置）。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
  build: {
    outDir: "dist-preview",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        p: "preview.html",
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
