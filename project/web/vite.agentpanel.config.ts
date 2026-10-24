import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// 只构建 AgentPanel 预览页：产物 dist-agentpanel/agentpanel.html。
// base 用相对路径，构建结果可以直接用静态服务器打开。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  build: {
    outDir: "dist-agentpanel",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        agentpanel: "agentpanel.html",
        sidebar: "sidebar.html",
        shell: "shell.html",
        chat: "chat.html",
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
