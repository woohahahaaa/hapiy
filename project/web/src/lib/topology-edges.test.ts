import { describe, expect, it } from 'vitest'
import type { Workflow } from './topology-document'
import {
  parseTopologyEdges,
  expandTopologyEdges,
  defaultTopologyEdges,
  validateTopologyEdges,
  resolveTopologyEdges,
  reachableSlotTypes,
  serializeTopologyEdges,
  buildEdgesFromTopology,
  isWiringEdge,
  type TopologyEdgeUnit,
} from './topology-edges'
import { emptySlotEntryMap } from '@/components/node/slot/items/types'
import type { WorkflowEntry } from './topology-document'

function doc(...providerIds: string[]): Workflow[] {
  return providerIds.map((id) => [
    { type: 'provider', name: id, provider_id: id },
  ])
}

const workflowEntry = (providerId: string): [string, WorkflowEntry] => [
  `w-${providerId}-0`,
  { providerId, enabled: true, slots: emptySlotEntryMap() },
]

describe('parseTopologyEdges', () => {
  it('parses chains and clusters round-tripping the backend format', () => {
    const raw = [
      ['pv-w-a-0', 'slot-w-a-0-requestModify'],
      [['pv-w-a-0'], ['pv-w-b-0'], ['slot-w-b-0-logOutput']],
    ]
    const units = parseTopologyEdges(raw)
    expect(units).toEqual(raw)
    expect(JSON.parse(JSON.stringify(units))).toEqual(raw)
  })

  it('rejects non-array input', () => {
    expect(() => parseTopologyEdges({})).toThrow('必须是数组')
  })

  it('rejects an empty unit', () => {
    expect(() => parseTopologyEdges([[]])).toThrow('不能为空')
  })

  it('rejects a non-array unit', () => {
    expect(() => parseTopologyEdges(['pv-w-a-0'])).toThrow('必须是数组')
  })

  it('rejects a cluster with a single element', () => {
    expect(() => parseTopologyEdges([[['pv-w-a-0']]])).toThrow('至少包含一个参与链和一个共享尾')
  })

  it('rejects mixed scalar values (mirrors parseChainNode falling through to cluster)', () => {
    expect(() => parseTopologyEdges([['pv-w-a-0', 42]])).toThrow('必须是数组')
  })
})

describe('expandTopologyEdges', () => {
  it('passes plain chains through unchanged', () => {
    const units = [['pv-w-a-0', 'slot-w-a-0-requestModify', 'slot-w-a-0-logOutput']]
    expect(expandTopologyEdges(units)).toEqual(units)
  })

  it('expands a shared-tail cluster into full chains', () => {
    const units = [
      [
        ['pv-w-a-0', 'slot-w-a-0-requestModify'],
        ['pv-w-b-0', 'slot-w-b-0-concurrency'],
        ['slot-w-b-0-logOutput'],
      ],
    ]
    expect(expandTopologyEdges(units)).toEqual([
      ['pv-w-a-0', 'slot-w-a-0-requestModify', 'slot-w-b-0-logOutput'],
      ['pv-w-b-0', 'slot-w-b-0-concurrency', 'slot-w-b-0-logOutput'],
    ])
  })

  it('supports multi-level sharing via flow references (Go Expand semantics)', () => {
    const R = 'slot-w-a-0-requestModify'
    const L = 'slot-w-a-0-logOutput'
    const units = [
      [['pv-w-a-0'], ['pv-w-b-0'], [R]],
      [['pv-w-c-0', R], [R], [L]],
    ]
    expect(expandTopologyEdges(units)).toEqual([
      ['pv-w-c-0', R, L],
      ['pv-w-a-0', R, L],
      ['pv-w-b-0', R, L],
    ])
  })

  it('keeps slot-headed draft chains as top-level chains', () => {
    const units = [
      ['slot-w-a-0-requestModify', 'slot-w-a-0-logOutput'],
      ['pv-w-a-0', 'slot-w-a-0-logOutput'],
    ]
    expect(expandTopologyEdges(units)).toEqual(units)
  })
})

describe('defaultTopologyEdges', () => {
  it('builds provider → all six slots in fixed order, sorted by key', () => {
    const workflows = doc('b', 'a')
    const units = defaultTopologyEdges(workflows)
    expect(units[0]).toEqual([
      'pv-w-a-0',
      'slot-w-a-0-requestModify',
      'slot-w-a-0-responseModify',
      'slot-w-a-0-autoReply',
      'slot-w-a-0-concurrency',
      'slot-w-a-0-autoSwitch',
      'slot-w-a-0-logOutput',
    ])
    expect(units[1][0]).toBe('pv-w-b-0')
  })
})

describe('validateTopologyEdges', () => {
  it('accepts the default edges', () => {
    const workflows = doc('a', 'b')
    expect(() => validateTopologyEdges(defaultTopologyEdges(workflows), workflows)).not.toThrow()
  })

  it('accepts a shared-tail cluster', () => {
    const workflows = doc('a', 'b')
    const units = [
      [
        ['pv-w-a-0', 'slot-w-a-0-requestModify'],
        ['pv-w-b-0', 'slot-w-b-0-concurrency'],
        ['slot-w-b-0-logOutput'],
      ],
    ]
    expect(() => validateTopologyEdges(units, workflows)).not.toThrow()
  })

  it('rejects an unknown provider ref', () => {
    const workflows = doc('a')
    expect(() => validateTopologyEdges([['pv-w-x-0', 'slot-w-a-0-logOutput']], workflows))
      .toThrow(/未知的 provider 引用/)
  })

  it('rejects a provider appearing in more than one chain', () => {
    const workflows = doc('a')
    expect(() => validateTopologyEdges([
      ['pv-w-a-0', 'slot-w-a-0-requestModify'],
      ['pv-w-a-0', 'slot-w-a-0-logOutput'],
    ], workflows)).toThrow(/出现在多条连线链中/)
  })

  it('rejects an unknown slot ref', () => {
    const workflows = doc('a')
    expect(() => validateTopologyEdges([['pv-w-a-0', 'slot-w-a-0-nope']], workflows))
      .toThrow(/未知的槽位引用/)
  })

  it('rejects a duplicate slot within a chain', () => {
    const workflows = doc('a')
    expect(() => validateTopologyEdges([
      ['pv-w-a-0', 'slot-w-a-0-logOutput', 'slot-w-a-0-logOutput'],
    ], workflows)).toThrow(/出现多次/)
  })

  it('rejects a shared tail that does not start with a slot ref', () => {
    const workflows = doc('a', 'b')
    expect(() => validateTopologyEdges([
      [['pv-w-a-0'], ['pv-w-b-0'], ['pv-w-a-0']],
    ], workflows)).toThrow(/共享尾必须以槽位引用开头/)
  })
})

describe('resolveTopologyEdges', () => {
  it('falls back to the default when edges are empty', () => {
    const workflows = doc('a')
    expect(resolveTopologyEdges([], workflows)).toEqual(defaultTopologyEdges(workflows))
  })

  it('falls back to the default when edges are invalid', () => {
    const workflows = doc('a')
    const invalid = [['pv-w-x-0']]
    expect(resolveTopologyEdges(invalid, workflows)).toEqual(defaultTopologyEdges(workflows))
  })

  it('keeps valid edges as-is', () => {
    const workflows = doc('a')
    const units = [['pv-w-a-0', 'slot-w-a-0-logOutput']]
    expect(resolveTopologyEdges(units, workflows)).toEqual(units)
  })
})

describe('reachableSlotTypes', () => {
  it('returns only the provider own reachable slot types', () => {
    const workflows = doc('a', 'b')
    const units = [
      [
        ['pv-w-a-0', 'slot-w-a-0-requestModify'],
        ['pv-w-b-0', 'slot-w-b-0-concurrency'],
        ['slot-w-b-0-logOutput'],
      ],
    ]
    expect([...reachableSlotTypes(units, workflows, 'a')].sort()).toEqual(['requestModify'])
    expect([...reachableSlotTypes(units, workflows, 'b')].sort()).toEqual(['concurrency', 'logOutput'])
  })

  it('returns nothing for a broken-off chain', () => {
    const workflows = doc('a')
    const units = [['pv-w-a-0']]
    expect(reachableSlotTypes(units, workflows, 'a').size).toBe(0)
  })
})

describe('serializeTopologyEdges', () => {
  it('emits one flat chain per root-to-leaf path for a merge', () => {
    const X = 'slot-w-a-0-requestModify'
    const L = 'slot-w-a-0-logOutput'
    const units = serializeTopologyEdges([
      { source: 'pv-w-a-0', target: X },
      { source: 'pv-w-b-0', target: X },
      { source: X, target: L },
    ], ['w-a-0', 'w-b-0'])
    expect(units).toEqual([
      ['pv-w-a-0', X, L],
      ['pv-w-b-0', X, L],
    ])
  })

  it('emits a draft chain for a slot-headed path', () => {
    const X = 'slot-w-a-0-requestModify'
    const L = 'slot-w-a-0-logOutput'
    const units = serializeTopologyEdges([
      { source: X, target: L },
    ], ['w-a-0'])
    expect(units).toEqual([
      ['pv-w-a-0'],
      [X, L],
    ])
  })

  it('emits a lone chain for an isolated provider so the document is never empty', () => {
    const units = serializeTopologyEdges([], ['w-a-0', 'w-b-0'])
    expect(units).toEqual([
      ['pv-w-a-0'],
      ['pv-w-b-0'],
    ])
  })

  it('keeps the document valid after serialization', () => {
    const workflows = doc('a', 'b')
    const units = serializeTopologyEdges([
      { source: 'pv-w-a-0', target: 'slot-w-b-0-logOutput' },
      { source: 'pv-w-b-0', target: 'slot-w-b-0-logOutput' },
    ], ['w-a-0', 'w-b-0'])
    expect(() => validateTopologyEdges(units, workflows)).not.toThrow()
  })
})

describe('buildEdgesFromTopology', () => {
  const providers = [
    { id: 'a', name: 'A', baseUrls: [], keys: [], endpoints: [], models: [{ model: 'gpt', endpoints: [] }], status: true, autoDisabled: false, workflowEnabled: true, weight: 1 },
  ]

  it('renders wiring edges from the expanded chains plus model→provider edges', () => {
    const workflows = new Map<string, WorkflowEntry>([
      workflowEntry('a'),
    ])
    const units: TopologyEdgeUnit[] = [
      ['pv-w-a-0', 'slot-w-a-0-requestModify', 'slot-w-a-0-logOutput'],
    ]
    const edges = buildEdgesFromTopology(units, workflows, providers, { gpt: 'model-gpt' })
    expect(edges).toHaveLength(3)
    expect(edges.map((e) => e.id)).toEqual([
      'model-gpt→pv-w-a-0-gpt',
      'pv-w-a-0→slot-w-a-0-requestModify',
      'slot-w-a-0-requestModify→slot-w-a-0-logOutput',
    ])
    expect(edges.some(isWiringEdge)).toBe(true)
  })

  it('dedupes shared-tail source→target pairs', () => {
    const workflows = new Map<string, WorkflowEntry>([
      workflowEntry('a'),
      workflowEntry('b'),
    ])
    const units: TopologyEdgeUnit[] = [
      ['pv-w-a-0', 'slot-w-b-0-logOutput'],
      ['pv-w-b-0', 'slot-w-b-0-logOutput'],
    ]
    const edges = buildEdgesFromTopology(units, workflows, providers, {})
    const wiringIds = edges.filter(isWiringEdge).map((e) => e.id)
    expect(wiringIds).toEqual(['pv-w-a-0→slot-w-b-0-logOutput', 'pv-w-b-0→slot-w-b-0-logOutput'])
  })
})
