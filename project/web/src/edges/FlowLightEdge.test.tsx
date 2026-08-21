import { Position, type EdgeProps } from '@xyflow/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FlowLightEdge } from './FlowLightEdge'
import type { FlowLayerOverlay } from '@/modules/flow-hub'

function renderEdge(layers: FlowLayerOverlay[] | undefined): string {
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
    data: layers ? { layers } : undefined,
  } as EdgeProps

  return renderToStaticMarkup(<FlowLightEdge {...props} />)
}

describe('FlowLightEdge', () => {
  it('renders no beam without layers', () => {
    const markup = renderEdge(undefined)
    expect(markup).not.toContain('@keyframes flow-light-slide')
  })

  it('renders one head+tail beam per layer, keyed by runId+loop', () => {
    const layers: FlowLayerOverlay[] = [
      { runId: 1, color: '#38bdf8', loop: 0 },
      { runId: 2, color: '#f97316', loop: 1 },
    ]
    const markup = renderEdge(layers)
    expect(markup).toContain('@keyframes flow-light-slide-1-model-to-entry')
    expect(markup).toContain('@keyframes flow-light-slide-2-model-to-entry')
    expect(markup).toContain('stroke-dasharray:55 145')
    expect(markup).toContain('stroke-dasharray:0 33 22 145')
    expect(markup.match(/stroke-linecap="butt"/g)).toHaveLength(4)
    expect(markup).toContain('stroke="#38bdf8"')
    expect(markup).toContain('stroke="#f97316"')
    expect(markup).toContain('animation-duration:340ms')
  })
})
