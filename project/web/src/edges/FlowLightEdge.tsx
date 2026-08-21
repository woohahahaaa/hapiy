import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import { FLOW_STEP_MS } from '@/modules/flow-hub'

// The edge renders a moving light dot per active layer. Each layer is a
// separate SVG circle animated along the path with <animateMotion>; the run
// holds one step for FLOW_STEP_MS, so the dot travels the full edge in that
// window. Overlapping runs stack naturally (one circle each, DOM order later
// on top).
const FLOW_DOT_RADIUS = 4

export function FlowLightEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    style,
    interactionWidth,
    data,
  } = props

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const layers = (data?.layers as FlowLayerOverlay[] | undefined) ?? []

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />
      {layers.map((layer) => (
        <g key={layer.runId}>
          <circle r={FLOW_DOT_RADIUS} fill={layer.color}>
            <animateMotion
              dur={`${FLOW_STEP_MS}ms`}
              repeatCount="indefinite"
              path={path}
              rotate="auto"
            />
          </circle>
        </g>
      ))}
    </>
  )
}
