import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SlotItemCard } from './SlotItemCard'
import type { ProviderFlashPayload } from '@/edges/FlowLightEdge'

const FLASH: ProviderFlashPayload = {
  runId: 5,
  cycleMs: 680,
  phaseMs: 340,
  durMs: 340,
  color: '#38bdf8',
}

function renderCard(props: { flash?: ProviderFlashPayload }): string {
  return renderToStaticMarkup(
    <SlotItemCard index={1} enabled={true} onToggleEnabled={() => {}} flash={props.flash}>
      <span>body</span>
    </SlotItemCard>,
  )
}

describe('SlotItemCard', () => {
  it('emits no keyframe style tag and no animation when no flash prop is set', () => {
    const markup = renderCard({})
    expect(markup).not.toContain('@keyframes provider-flash')
    expect(markup).not.toContain('animation-name:')
  })

  it('renders a unique keyframe block and binds the animation when flash is set', () => {
    const markup = renderCard({ flash: FLASH })
    expect(markup).toContain('@keyframes provider-flash-5-340')
    expect(markup).toContain('border-color:#38bdf8')
    expect(markup).toContain('box-shadow:0 0 8px #38bdf8')
    expect(markup).toContain('animation-name:provider-flash-5-340')
    expect(markup).toContain('animation-duration:680ms')
    expect(markup).toContain('animation-iteration-count:infinite')
  })
})
