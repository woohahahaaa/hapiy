// 临时预览入口（preview.html）：加载真实样式与 i18n，只渲染预览页。
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IconProvider, DEFAULT_ICON_CONFIGS } from '@icon-park/react'
import type { IIconConfig } from '@icon-park/react/es/runtime'

// 预览页刻意自带新主题副本，不跟随应用 src/index.css 的主题。
import './theme.css'
import '@/i18n/i18n'
import iconConfig from '@/config/icons.json'
import { PreviewApp } from './app'

const iconProviderValue: IIconConfig = {
  ...DEFAULT_ICON_CONFIGS,
  rtl: iconConfig.global.rtl,
  size: iconConfig.global.size,
  strokeWidth: iconConfig.global.strokeWidth,
  theme: iconConfig.global.theme as IIconConfig['theme'],
  strokeLinecap: iconConfig.global.strokeLinecap as IIconConfig['strokeLinecap'],
  strokeLinejoin: iconConfig.global.strokeLinejoin as IIconConfig['strokeLinejoin'],
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconProvider value={iconProviderValue}>
      <PreviewApp />
    </IconProvider>
  </StrictMode>,
)
