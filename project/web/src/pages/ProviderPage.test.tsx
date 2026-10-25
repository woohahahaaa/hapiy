import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { i18n } from '@/i18n/i18n'
import { providerDraftFromUIAction, ProviderValueList } from './ProviderPage'

// 被自动禁用的条目：只在该条下面追加一行「当前 X 已禁用」备注 + 「直接恢复」文字按钮，
// 未禁用的条目不受影响（两个 key 禁用就是两行备注）。
function renderList(values: readonly string[], disabledValues?: Readonly<Record<string, boolean>>): string {
  return renderToStaticMarkup(
    <ProviderValueList
      label="Base URLs"
      placeholder="https://api.openai.com/v1"
      values={values}
      onChange={() => {}}
      disabledValues={disabledValues}
      disabledNote={i18n.t('provider:failoverStatus.disabledNote', { label: 'Base URL' })}
      onRestore={() => {}}
    />,
  )
}

function occurrences(html: string, needle: string): number {
  return html.split(needle).length - 1
}

describe('ProviderValueList 自动禁用备注', () => {
  afterEach(async () => {
    await i18n.changeLanguage('zh')
  })

  it('只给被禁用的那一条加备注，两侧条目都不受影响', () => {
    const html = renderList(
      ['https://a.example.com', 'https://b.example.com', 'https://c.example.com'],
      { 'https://b.example.com': true },
    )
    expect(occurrences(html, '已禁用')).toBe(1)
    expect(occurrences(html, '直接恢复')).toBe(1)
    // 备注排在对应条目之后：b 的输入框先出现，然后是备注。
    expect(html.indexOf('https://b.example.com')).toBeLessThan(html.indexOf('已禁用'))
    expect(html.indexOf('已禁用')).toBeLessThan(html.indexOf('https://c.example.com'))
  })

  it('两个 key 禁用就出两行备注', () => {
    const html = renderList(
      ['sk-1', 'sk-2', 'sk-3'],
      { 'sk-1': true, 'sk-3': true },
    )
    expect(occurrences(html, '已禁用')).toBe(2)
    expect(occurrences(html, '直接恢复')).toBe(2)
  })

  it('没有禁用条目时不出现备注', () => {
    expect(renderList(['https://a.example.com'])).not.toContain('已禁用')
    expect(renderList(['https://a.example.com'], { 'https://a.example.com': false })).not.toContain('已禁用')
    // 禁用的是别的条目（例如已从列表中删掉）时不误报。
    expect(renderList(['https://a.example.com'], { 'https://gone.example.com': true })).not.toContain('已禁用')
  })

  it('英文界面跟着翻译', async () => {
    await i18n.changeLanguage('en')
    const html = renderList(['sk-1'], { 'sk-1': true })
    expect(html).toContain('This Base URL is disabled')
    expect(html).toContain('Restore directly')
  })
})

describe('providerDraftFromUIAction 新建供应商预填', () => {
  it('只把名称带进空表单，其余字段留给用户', () => {
    const draft = providerDraftFromUIAction({ name: '  test  ' })
    expect(draft).not.toBeNull()
    expect(draft?.name).toBe('test')
    expect(draft?.baseUrls).toEqual([])
    expect(draft?.keys).toEqual([])
    expect(draft?.models).toEqual([])
    expect(draft?.status).toBe(true)
  })

  it('没有名称就不开弹窗', () => {
    expect(providerDraftFromUIAction({})).toBeNull()
    expect(providerDraftFromUIAction({ name: '   ' })).toBeNull()
    expect(providerDraftFromUIAction({ name: 42 })).toBeNull()
  })
})
