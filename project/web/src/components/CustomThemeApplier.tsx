import { useEffect } from 'react'
import { loadThemeState } from '@/lib/theme-registry'

// 应用启动时载入已安装主题与深浅选择，并把配色注入 <head>。
// 渲染 null：只负责副作用。
export function CustomThemeApplier() {
  useEffect(() => {
    void loadThemeState().catch(() => {})
  }, [])

  return null
}
