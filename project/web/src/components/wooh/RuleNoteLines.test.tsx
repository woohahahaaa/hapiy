import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { RuleNoteLines } from './RuleNoteLines'

function render(el: ReactElement): string {
  return renderToStaticMarkup(el)
}

describe('RuleNoteLines', () => {
  it('colours each verdict distinctly', () => {
    const html = render(<RuleNoteLines text={
      '[请求改写] 命中·生效：改温度\n' +
      '[请求改写] 命中·部分生效：改温度并替换（目标路径 x 不存在）\n' +
      '[请求改写] 命中·未生效：加会话头（引用源 y 不存在）\n' +
      '[故障转移] 命中·出错：主转移（无可用回退供应商）\n' +
      '[故障转移] 未命中：主转移'
    } />)
    expect(html).toContain('text-emerald-700')  // 生效
    expect(html).toContain('text-amber-700')    // 部分生效
    expect(html).toContain('text-orange-700')   // 未生效
    expect(html).toContain('text-destructive')  // 出错
    expect(html).toContain('text-muted-foreground') // 未命中
  })

  it('keeps the rule name and reason in the line', () => {
    const html = render(<RuleNoteLines text="[请求改写] 命中·未生效：加会话头（引用源 X-Session-Id 不存在）" />)
    expect(html).toContain('加会话头')
    expect(html).toContain('引用源 X-Session-Id 不存在')
  })

  it('passes lines without a verdict through plain', () => {
    const html = render(<RuleNoteLines text="渠道被禁用：连续失败" />)
    expect(html).toContain('渠道被禁用：连续失败')
    expect(html).not.toContain('text-emerald-')
    expect(html).not.toContain('text-destructive')
  })

  it('renders nothing for empty text', () => {
    expect(render(<RuleNoteLines text="" />)).toBe('')
  })
})
