import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NodeExecutorConcurrency } from './concurrency'
import type { ConcurrencySlotEntry } from '@/components/node/slot/items'

const entry: ConcurrencySlotEntry = {
  id: 'cq-1',
  slotType: 'concurrency',
  index: 1,
  ruleId: null,
  enabled: true,
  config: { windowMinutes: 1, maxCount: 20 },
}

describe('NodeExecutorConcurrency', () => {
  it('渲染规则摘要（每 X 分钟内最多 N 条）', () => {
    const markup = renderToStaticMarkup(
      <NodeExecutorConcurrency entry={entry} onChange={() => {}} onDelete={() => {}} />,
    )
    expect(markup).toContain('每')
    expect(markup).toContain('分钟内最多')
    expect(markup).toContain('条')
  })

  it('无窗口占用数据时显示 0/上限（不隐藏统计行）', () => {
    const markup = renderToStaticMarkup(
      <NodeExecutorConcurrency entry={entry} nodeId="cq-node" onChange={() => {}} onDelete={() => {}} />,
    )
    expect(markup).toContain('窗口内 0/20')
  })

  it('未提供 nodeId 时不渲染窗口占用行', () => {
    const markup = renderToStaticMarkup(
      <NodeExecutorConcurrency entry={entry} onChange={() => {}} onDelete={() => {}} />,
    )
    expect(markup).not.toContain('窗口内')
  })
})