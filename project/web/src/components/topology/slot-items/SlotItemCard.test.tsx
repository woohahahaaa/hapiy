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
    expect(markup).not.toContain('box-shadow:')
  })

  it('renders one stacked glow ring per layer, keyed by runId', () => {
    const layers: FlowLayerOverlay[] = [
      { runId: 5, color: '#38bdf8' },
      { runId: 9, color: '#f97316' },
    ]
    const markup = renderCard(layers)
    expect(markup).toContain('box-shadow:0 0 8px 1px #38bdf8')
    expect(markup).toContain('box-shadow:0 0 8px 1px #f97316')
    expect(markup).toContain('border:1px solid #38bdf8')
    expect(markup).toContain('border:1px solid #f97316')
  })
})
