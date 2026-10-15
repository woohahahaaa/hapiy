import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { ThemeProvider } from '@/components/wooh/theme-provider'
import { i18n } from '@/i18n/i18n'
import { HelpPage } from './HelpPage'

// 测试跑在 Node 环境里（没有 DOM）：ThemeProvider 在渲染期读 localStorage，
// 这里给一个内存实现，够它取默认主题即可。
const memoryStore = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => void memoryStore.set(key, String(value)),
    removeItem: (key: string) => void memoryStore.delete(key),
    clear: () => memoryStore.clear(),
  },
})

function renderPage(): string {
  return renderToStaticMarkup(
    <ThemeProvider>
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    </ThemeProvider>
  )
}

// 帮助页在独立标签页打开（不套 AppShell），正文与快速入口都随 i18n 语言切换：
// 这里锁定两种语言各自的文案与锚点 id，避免一边改了另一边没跟上。
describe('HelpPage 中英对照', () => {
  afterEach(async () => {
    await i18n.changeLanguage('zh')
  })

  it('中文模式渲染中文帮助与中文锚点', async () => {
    await i18n.changeLanguage('zh')
    const html = renderPage()
    expect(html).toContain('hapiy帮助文档')
    expect(html).toContain('四步搭好第一条API转发工作流')
    expect(html).toContain('搜索文档')
    expect(html).toContain('第1步-添加供应商')
  })

  it('英文模式渲染英文帮助与英文锚点', async () => {
    await i18n.changeLanguage('en')
    const html = renderPage()
    expect(html).toContain('hapiy Help')
    expect(html).toContain('Four steps to your first API forwarding workflow')
    expect(html).toContain('Search the docs')
    expect(html).toContain('step-1-add-a-provider')
    expect(html).not.toContain('四步搭好第一条API转发工作流')
  })
})
