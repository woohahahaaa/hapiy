// 临时预览入口（preview.html）：加载真实样式与 i18n，只渲染预览页。
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// 预览页刻意自带新主题副本，不跟随应用 src/index.css 的主题。
import './theme.css'
import '@/i18n/i18n'
import { PreviewApp } from './app'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
)
