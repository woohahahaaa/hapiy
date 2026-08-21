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
  it('renders no light dots without layers', () => {
    const markup = renderEdge(undefined)
    expect(markup).not.toContain('animateMotion')
    expect(markup).not.toContain('circle')
  })

  it('renders one moving dot per layer, keyed by runId', () => {
    const layers: FlowLayerOverlay[] = [
      { runId: 1, color: '#38bdf8' },
      { runId: 2, color: '#f97316' },
    ]
    const markup = renderEdge(layers)
    expect(markup.match(/<circle/g)).toHaveLength(2)
    expect(markup.match(/<animateMotion/g)).toHaveLength(2)
    expect(markup).toContain('fill="#38bdf8"')
    expect(markup).toContain('fill="#f97316"')
    expect(markup).toContain('dur="340ms"')
  })
})
