import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RuleSelect } from './rule-select'

// 触发区文案（SelectValue 的 children）在 SSR 阶段即渲染，可直接断言；
// 下拉内容区（加载中…/加载失败/选项列表）需要打开态，jsdom 环境下另行覆盖。
describe('RuleSelect', () => {
  const rules = [
    { id: 'rule-hb-1', label: '心跳规则A' },
    { id: 'rule-hb-2', label: '心跳规则B' },
  ]

  it('已绑定规则时触发区显示规则名', () => {
    const markup = renderToStaticMarkup(
      <RuleSelect value="rule-hb-1" options={rules} placeholder="请选择" onChange={() => {}} />,
    )
    expect(markup).toContain('心跳规则A')
    expect(markup).not.toContain('rule-hb-1')
  })

  it('孤儿引用（value 不在 options 中）回退为占位文案，不泄露原始 ruleId', () => {
    const orphanId = 'orphan-deleted-uuid-12345'
    const markup = renderToStaticMarkup(
      <RuleSelect value={orphanId} options={rules} placeholder="请选择" onChange={() => {}} />,
    )
    expect(markup).toContain('请选择')
    expect(markup).not.toContain(orphanId)
  })

  it('未绑定时显示占位文案「请选择」', () => {
    const markup = renderToStaticMarkup(
      <RuleSelect value={null} options={rules} placeholder="请选择" onChange={() => {}} />,
    )
    expect(markup).toContain('请选择')
  })

  it('空列表且未加载/未失败时触发区显示「暂无可用规则」', () => {
    const markup = renderToStaticMarkup(
      <RuleSelect value={null} options={[]} placeholder="请选择" onChange={() => {}} />,
    )
    expect(markup).toContain('暂无可用规则')
  })

  it('加载中不显示「暂无可用规则」，回退为「请选择」', () => {
    const markup = renderToStaticMarkup(
      <RuleSelect value={null} options={[]} placeholder="请选择" loading onChange={() => {}} />,
    )
    expect(markup).not.toContain('暂无可用规则')
    expect(markup).toContain('请选择')
  })

  it('加载失败时不显示「暂无可用规则」，回退为「请选择」', () => {
    const markup = renderToStaticMarkup(
      <RuleSelect value={null} options={[]} placeholder="请选择" error="加载失败" onChange={() => {}} />,
    )
    expect(markup).not.toContain('暂无可用规则')
    expect(markup).toContain('请选择')
  })
})