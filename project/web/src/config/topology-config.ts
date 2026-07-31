import topologyJson from './topology.json'

type NodeType =
  | 'modelHub'
  | 'channel'
  | 'slot'

type NodeDimension = {
  readonly minWidth: number
  readonly maxWidth: number
  readonly height: number
}

type Dimension = {
  readonly width: number
  readonly height: number
}

type HandleMetric = Dimension & {
  readonly borderWidth: number
}

type TopologyConfig = {
  readonly dagre: {
    readonly direction: string
    readonly nodeSeparation: number
    readonly rankSeparation: number
    readonly margin: Readonly<{ readonly x: number; readonly y: number }>
  }
  readonly nodeDimensions: Readonly<Record<string, NodeDimension>> & Readonly<Record<NodeType, NodeDimension>>
  readonly fallbackNodeDimension: NodeDimension
  readonly initialPositions: {
    readonly modelHub: Readonly<{ readonly x: number; readonly y: number; readonly verticalOffset: number }>
    readonly channel: Readonly<{ readonly x: number; readonly y: number; readonly verticalOffset: number }>
    readonly slot: Readonly<{
      readonly x: number
      readonly y: number
      readonly horizontalOffset: number
      readonly verticalOffset: number
    }>
  }
  readonly edge: Readonly<{ readonly animated: boolean; readonly strokeWidth: number }>
  readonly grid: Readonly<{ readonly color: string; readonly gap: number; readonly size: number }>
  readonly handles: {
    readonly channel: Readonly<{
      readonly target: HandleMetric
      readonly source: HandleMetric
      readonly segmentGap: number
    }>
    readonly modelHub: Readonly<{ readonly source: HandleMetric }>
    readonly slot: Readonly<{ readonly target: HandleMetric; readonly source: HandleMetric }>
  }
}

export const topologyConfig: TopologyConfig = topologyJson satisfies TopologyConfig

export function getTopologyNodeDimension(nodeType: string | undefined): NodeDimension {
  return topologyConfig.nodeDimensions[nodeType ?? ''] ?? topologyConfig.fallbackNodeDimension
}

export function getTopologyLayoutDimension(nodeType: string | undefined): Dimension {
  const d = getTopologyNodeDimension(nodeType)
  return { width: d.maxWidth, height: d.height }
}
