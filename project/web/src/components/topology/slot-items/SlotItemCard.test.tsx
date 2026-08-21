import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SlotItemCard } from './SlotItemCard'
import type { FlowLayerOverlay } from '@/modules/flow-hub'

function renderCard(layers: FlowLayerOverlay[] | undefined): string {
  return renderToStaticMarkup(
    <SlotItemCard index={1} enabled={true} onToggleEnabled={() => {}} flashLayers={layers}>
      <span>body</span>
    </SlotItemCard>,
  )
}

describe('SlotItemCard', () => {
  it('renders no glow ring when no layers are active', () => {
    const markup = renderCard(undefined)
    expect(markup).not.toContain('flash-pulse-')
  })

  it('renders one bell-shaped pulse keyframe per layer', () => {
    const layers: FlowLayerOverlay[] = [
      { runId: 5, color: '#38bdf8', loop: 0 },
      { runId: 9, color: '#f97316', loop: 1 },
    ]
    const markup = renderCard(layers)
    expect(markup).toContain('flash-pulse-5-0')
    expect(markup).toContain('flash-pulse-9-1')
    expect(markup).toContain('0 0 8px #38bdf8,inset 0 0 2px #38bdf8')
    expect(markup).toContain('0 0 8px #f97316,inset 0 0 2px #f97316')
    expect(markup).toContain('animation-duration:340ms')
  })
})
