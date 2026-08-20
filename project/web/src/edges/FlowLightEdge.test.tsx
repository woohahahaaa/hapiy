import { Position, type EdgeProps } from '@xyflow/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FlowLightEdge, type FlowLightPayload } from './FlowLightEdge'

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
