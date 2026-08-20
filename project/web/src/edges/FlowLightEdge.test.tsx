import { Position, type EdgeProps } from '@xyflow/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FlowLightEdge, buildFlashKeyframes, flashKeyframeName, type FlowLightPayload, type ProviderFlashPayload } from './FlowLightEdge'

function renderEdge(light: FlowLightPayload): string {
  const props = {
    id: 'model-to-entry',
    source: 'model',
    target: 'entry',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    selected: false,
    deletable: true,
    selectable: true,
    draggable: false,
    data: { light },
  } as EdgeProps

  return renderToStaticMarkup(<FlowLightEdge {...props} />)
}

describe('FlowLightEdge', () => {
  it('keeps a phased edge fully hidden outside its own animation window', () => {
    const markup = renderEdge({
      runId: 1,
      cycleMs: 680,
      phaseMs: 340,
      durMs: 340,
      color: '#38bdf8',
    })

    expect(markup).toContain('49.999%{stroke-dashoffset:55;opacity:0}')
    expect(markup).toContain('50.000%{stroke-dashoffset:55;opacity:var(--beam-on)}')
    expect(markup).toContain('99.999%{stroke-dashoffset:-100;opacity:var(--beam-on)}')
    expect(markup).toContain('100.000%{stroke-dashoffset:-100;opacity:0}')
  })

  it('uses fixed patterns and flat caps for one opaque head over one faint tail', () => {
    const markup = renderEdge({
      runId: 2,
      cycleMs: 340,
      phaseMs: 0,
      durMs: 340,
      color: '#38bdf8',
    })

    expect(markup).toContain('stroke-dasharray:55 145')
    expect(markup).toContain('stroke-dasharray:0 33 22 145')
    expect(markup).not.toContain('stroke-dasharray:55 100')
    expect(markup.match(/stroke-linecap="butt"/g)).toHaveLength(2)
    expect(markup).not.toContain('@keyframes flow-light-slide-2-model-to-entry-fade')
    expect(markup).toContain('d="M-10,0')
    expect(markup).toContain('110,0"')
  })
})

describe('buildFlashKeyframes', () => {
  const flash: ProviderFlashPayload = {
    runId: 7,
    cycleMs: 680,
    phaseMs: 340,
    durMs: 340,
    color: '#38bdf8',
  }

  it('keeps the border at rest outside the flash window', () => {
    const css = buildFlashKeyframes('provider-flash-test', flash)
    expect(css).toContain('0%{border-color:var(--border);box-shadow:0 0 0 transparent}')
    expect(css).toMatch(/100%\{border-color:var\(--border\)/)
  })

  it('peaks at the midpoint with the provider colour and a glow', () => {
    const css = buildFlashKeyframes('provider-flash-test', flash)
    // mid = (phaseMs + durMs/2) / cycleMs * 100 = (340 + 170) / 680 * 100 = 75.000%
    expect(css).toContain('75.000%{border-color:#38bdf8;box-shadow:0 0 8px #38bdf8,inset 0 0 2px #38bdf8}')
  })

  it('returns to rest before the next cycle begins', () => {
    const css = buildFlashKeyframes('provider-flash-test', flash)
    const endPct = ((flash.phaseMs + flash.durMs) / flash.cycleMs) * 100
    expect(css).toContain(`${(endPct - 0.001).toFixed(3)}%{border-color:var(--border);box-shadow:0 0 0 transparent}`)
  })
})

describe('flashKeyframeName', () => {
  it('is unique per (runId, phaseMs) pair', () => {
    const a = flashKeyframeName({ runId: 1, cycleMs: 340, phaseMs: 0, durMs: 340, color: '#fff' })
    const b = flashKeyframeName({ runId: 2, cycleMs: 340, phaseMs: 0, durMs: 340, color: '#fff' })
    const c = flashKeyframeName({ runId: 1, cycleMs: 340, phaseMs: 340, durMs: 340, color: '#fff' })
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
    expect(a).toContain('provider-flash-1-0')
  })
})
