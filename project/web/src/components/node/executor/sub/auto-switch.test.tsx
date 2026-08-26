import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NodeExecutorAutoSwitch } from './auto-switch'
import type { FailoverRule } from '@/lib/dashboard-api'

const rule: FailoverRule = {
  id: 'failover-rule-1',
  name: '故障转移规则A',
  primaryProvider: 'provider-1',
  fallbackProvider: 'provider-2',
  condition: 'timeout',
  status: true,
  keywords: [],
  actions: [],
  dimension: 'provider',
  retryCount: 3,
  autoDisable: false,
  matchPatterns: [],
  ttfbSeconds: 5,
}

const boundEntry = {
  id: 'slot-entry-1',
  slotType: 'autoSwitch' as const,
  index: 1,
  ruleId: 'failover-rule-1',
  enabled: true,
  config: {},
}

// 自动禁用条目必须与心跳回复/并发控制一致：无论是否绑定规则都渲染 RuleSelect，
// 而不是在已绑定时退化成只读的 react-router 跳转链接。
describe('NodeExecutorAutoSwitch', () => {
  it('已绑定规则时渲染 RuleSelect（无跳转链接，仍可切换规则）', () => {
    const markup = renderToStaticMarkup(
      <NodeExecutorAutoSwitch entry={boundEntry} rules={[rule]} onChange={() => {}} onDelete={() => {}} />,
    )
    expect(markup).not.toMatch(/<a\b/)
    expect(markup).toContain('data-slot="select-trigger"')
    expect(markup).toContain('故障转移规则A')
  })

  it('未绑定时同样渲染 RuleSelect', () => {
    const markup = renderToStaticMarkup(
      <NodeExecutorAutoSwitch entry={{ ...boundEntry, ruleId: null }} rules={[rule]} onChange={() => {}} onDelete={() => {}} />,
    )
    expect(markup).not.toMatch(/<a\b/)
    expect(markup).toContain('data-slot="select-trigger"')
    expect(markup).toContain('请选择')
  })

  it('孤儿引用时显示占位文案而非原始 id 或链接', () => {
    const markup = renderToStaticMarkup(
      <NodeExecutorAutoSwitch entry={{ ...boundEntry, ruleId: 'gone-rule-id' }} rules={[rule]} onChange={() => {}} onDelete={() => {}} />,
    )
    expect(markup).not.toMatch(/<a\b/)
    expect(markup).toContain('请选择')
    expect(markup).not.toContain('gone-rule-id')
  })
})