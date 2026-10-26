// 把 src/__preview__/onboarding.tsx 打包成一个自包含的静态 HTML：
// JS、CSS、字体全部内联，双击 docs/onboarding-preview.html 就能看，不需要服务。
//
// 用法：pnpm build:onboarding-preview（或 node scripts/build-onboarding-preview.mjs）
import path from 'node:path'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { build } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, '..')
const outDir = path.join(webRoot, 'dist-onboarding')
const target = path.resolve(webRoot, '../docs/onboarding-preview.html')

await build({
  root: webRoot,
  configFile: false,
  logLevel: 'warn',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.join(webRoot, 'src') } },
  build: {
    outDir,
    emptyOutDir: true,
    assetsInlineLimit: 100 * 1024 * 1024,
    cssCodeSplit: false,
    modulePreload: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: path.join(webRoot, 'onboarding.html'),
      output: { inlineDynamicImports: true },
    },
  },
})

const htmlPath = path.join(outDir, 'onboarding.html')
let html = await readFile(htmlPath, 'utf8')

// 把外链的样式和脚本替换成内联内容，并把其他资源的相对路径改成绝对路径。
const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
for (const asset of assets) {
  if (!asset.startsWith('/')) continue
  const file = path.join(outDir, asset.slice(1))
  const content = await readFile(file, 'utf8').catch(() => null)
  if (content === null) continue
  // 用函数替换，避免内联代码里的 $&、$` 等被当成替换模式展开。
  if (asset.endsWith('.css')) {
    html = html.replace(`<link rel="stylesheet" crossorigin href="${asset}">`, () => `<style>\n${content}\n</style>`)
  } else if (asset.endsWith('.js')) {
    html = html.replace(
      `<script type="module" crossorigin src="${asset}"></script>`,
      () => `<script type="module">\n${content}\n</script>`,
    )
  }
}

if (/(?:src|href)="\/assets\//.test(html)) {
  throw new Error('still referencing /assets after inlining')
}

await writeFile(target, html)
await rm(outDir, { recursive: true, force: true })
console.log(`[onboarding] wrote ${path.relative(process.cwd(), target)} (${(html.length / 1024).toFixed(0)} KB)`)
