import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, Background, type Node, type CSSProperties } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '@/index.css'
import { NodeExecutor } from '@/components/wooh/node/executor'
import { NodeSlot } from '@/components/wooh/node/slot'
import { NodeSwitch } from '@/components/wooh/node/switch'
import { NodeModel } from '@/components/wooh/node/model'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import '@/i18n/i18n'

const nodeTypes = {
  modelHub: NodeModel,
  slot: NodeSlot,
  requestEntry: NodeExecutor,
  switch: NodeSwitch,
}

const FLASH: FlowLayerOverlay[] = [{ runId: 7, color: '#7cc7f0', loop: 0 }]
const ACCENT = { '--node-accent': 'var(--warning)' } as CSSProperties

const entryData = (extra: Record<string, unknown> = {}) => ({
  label: '请求入口',
  enabled: true,
  weight: 1,
  models: [{ id: 'm1', label: 'openai', active: true }],
  onChangeEnabled: () => {},
  onChangeWeight: () => {},
  ...extra,
})

const nodes: Node[] = [
  { id: 'entry-normal', type: 'requestEntry', position: { x: 40, y: 40 }, data: entryData() },
  { id: 'entry-selected', type: 'requestEntry', position: { x: 400, y: 40 }, selected: true, data: entryData({ label: '请求入口·选中' }) },
  { id: 'entry-flash', type: 'requestEntry', position: { x: 760, y: 40 }, data: entryData({ label: '请求入口·flash', flashLayers: FLASH }) },
  { id: 'entry-emergency', type: 'requestEntry', position: { x: 1120, y: 40 }, style: ACCENT, data: entryData({ label: '应急请求入口', accentColor: 'var(--warning)' }) },
  {
    id: 'slot-normal',
    type: 'slot',
    position: { x: 40, y: 340 },
    data: {
      title: '供应商',
      slotType: 'provider',
      isProviderSlot: true,
      connectionCount: 1,
      enabled: true,
      children: [
        {
          id: 'p1', providerId: 'p1', label: 'deepseek', baseURLCount: 1, keyCount: 2, modelCount: 3,
          endpointCount: 0, enabled: true, providerStatus: true, autoDisabled: false,
        },
      ],
      providers: [{ id: 'p1', name: 'deepseek' }],
      strategy: 'sequential',
      onAddProvider: () => {}, onSelectProvider: () => {}, onToggleProvider: () => {},
      onDeleteProvider: () => {}, onReorderProvider: () => {}, onToggleEnabled: () => {},
      onSelectExecutor: () => {},
    },
  },
  {
    id: 'slot-selected',
    type: 'slot',
    position: { x: 480, y: 340 },
    selected: true,
    data: {
      title: '供应商·选中',
      slotType: 'provider',
      isProviderSlot: true,
      connectionCount: 2,
      enabled: true,
      children: [],
      providers: [{ id: 'p1', name: 'deepseek' }],
      strategy: 'sequential',
      onAddProvider: () => {}, onSelectProvider: () => {}, onToggleProvider: () => {},
      onDeleteProvider: () => {}, onReorderProvider: () => {}, onToggleEnabled: () => {},
      onSelectExecutor: () => {},
    },
  },
  {
    id: 'switch-normal',
    type: 'switch',
    position: { x: 940, y: 340 },
    data: {
      title: '条件开关',
      connectionCount: 1,
      providers: [{ id: 'p1', name: 'deepseek', models: ['m1'] }],
      config: { mode: 'provider', providers: ['p1'], models: [], conditions: [] },
      onSaveConfig: () => {},
    },
  },
  {
    id: 'switch-flash',
    type: 'switch',
    position: { x: 1320, y: 340 },
    data: {
      title: '条件开关·flash',
      connectionCount: 1,
      providers: [{ id: 'p1', name: 'deepseek', models: ['m1'] }],
      config: { mode: 'provider', providers: ['p1'], models: [], conditions: [] },
      flashLayers: FLASH,
      onSaveConfig: () => {},
    },
  },
  {
    id: 'model-normal',
    type: 'modelHub',
    position: { x: 40, y: 620 },
    data: { models: [{ id: 'm1', label: 'openai', color: '#7cc7f0' }], simplified: true },
  },
]

function measure() {
  const lines: string[] = []
  const probe = (label: string, el: Element | null, extra?: (cs: CSSStyleDeclaration) => string) => {
    if (!el) { lines.push(`${label}: MISSING`); return }
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    lines.push(
      `${label}: radius=${cs.borderRadius} borderColor=${cs.borderColor} boxShadow=${cs.boxShadow === 'none' ? 'none' : cs.boxShadow.slice(0, 34)}` +
      ` rect=${r.width.toFixed(1)}x${r.height.toFixed(1)} anim=${cs.animationName}${extra ? ' ' + extra(cs) : ''}`,
    )
  }
  for (const node of nodes) {
    lines.push(`── ${node.id} ──`)
    const wrapper = document.querySelector(`.react-flow__node[data-id="${node.id}"]`)
    if (!wrapper) { lines.push('  wrapper MISSING'); continue }
    probe('  wrapper', wrapper)
    probe('  card(框)', wrapper.querySelector(':scope > div.node-frame'))
    probe('  card flash', wrapper.querySelector(':scope > div.node-frame > span'))
    probe('  rail 容器', wrapper.querySelector(':scope > div:not(.node-frame)'))
    probe('  rail pill', wrapper.querySelector('.node-frame-lit'))
    probe('  rail flash', wrapper.querySelector('span.node-frame'))
    probe('  source handle', wrapper.querySelector('.react-flow__handle'))
    lines.push('')
  }
  document.getElementById('out')!.textContent = lines.join('\n')
}

void (async () => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <div style={{ width: '100%', height: '100%' }} className="verify-freeze">
        <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} proOptions={{ hideAttribution: true }} fitView>
          <Background />
        </ReactFlow>
      </div>
    </StrictMode>,
  )
  await new Promise((r) => setTimeout(r, 1200))
  measure()
})()
