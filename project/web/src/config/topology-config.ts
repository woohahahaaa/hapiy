import topologyJson from './topology.json'

type Dimension = {
  readonly width: number
  readonly height: number
}

type NodeRenderBounds = {
  readonly minWidth: number
  readonly maxWidth: number
}

type SlotRender = {
  readonly padding: number
  readonly contentGap: number
  readonly shellMinWidth: number
}

type ModelHubRender = {
  readonly paddingX: number
  readonly paddingY: number
}

type LayoutGaps = {
  readonly nodeGap: number
  readonly rowGap: number
  readonly modelHubGap: number
  readonly groupGap: number
  readonly marginX: number
  readonly marginY: number
}

type HandleMetric = Dimension & {
  readonly borderWidth: number
}

type TopologyConfig = {
  readonly render: {
    readonly node: NodeRenderBounds
    readonly slot: SlotRender
    readonly modelHub: ModelHubRender
  }
  readonly layout: LayoutGaps
  readonly fallbackNodeSize: Dimension
  readonly initialPositions: {
    readonly modelHub: Readonly<{ readonly x: number; readonly y: number; readonly verticalOffset: number }>
    readonly provider: Readonly<{ readonly x: number; readonly y: number; readonly verticalOffset: number }>
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
    readonly provider: Readonly<{
      readonly target: HandleMetric
      readonly source: HandleMetric
      readonly segmentGap: number
    }>
    readonly modelHub: Readonly<{ readonly source: HandleMetric }>
    readonly slot: Readonly<{ readonly target: HandleMetric; readonly source: HandleMetric }>
  }
}

export const topologyConfig: TopologyConfig = topologyJson satisfies TopologyConfig

export const nodeRenderBounds: NodeRenderBounds = topologyConfig.render.node

export const fallbackNodeSize: Dimension = topologyConfig.fallbackNodeSize
