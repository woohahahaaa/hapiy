/* eslint-disable react-refresh/only-export-components */
import { BaseEdge, getBezierPath, Position, type EdgeProps } from '@xyflow/react'
import { memo, type ComponentProps, type CSSProperties } from 'react'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import { FLOW_STEP_MS } from '@/modules/flow-hub'
import { edgeFlowKeyframeName } from '@/components/node/flash-layer'

// The edge renders the beam as a moving dash: an opaque head (FLOW_HEAD_LEN)
// followed by a faint tail (FLOW_TAIL_LEN at FLOW_TAIL_OPACITY). Each active
// run owns one keyframe keyed by runId+edgeId (stable, never renamed), and
// the beam slides from source to target once per FLOW_STEP_MS cycle. Overlap
// runs stack naturally — each layer is a separate <g>.
const FLOW_HEAD_LEN = 22
const FLOW_TAIL_LEN = 55
const FLOW_PATTERN_LENGTH = 200
const FLOW_PATTERN_GAP = FLOW_PATTERN_LENGTH - FLOW_TAIL_LEN
const FLOW_STROKE_WIDTH = 5
const FLOW_OVERSHOOT = FLOW_STROKE_WIDTH * 2
const FLOW_START_OFFSET = FLOW_TAIL_LEN
const FLOW_END_OFFSET = -100
const FLOW_TAIL_OPACITY = 0.35

function extendAgainstHandle(x: number, y: number, position: Position): { x: number; y: number } {
  switch (position) {
    case Position.Left:
      return { x: x + FLOW_OVERSHOOT, y }
    case Position.Right:
      return { x: x - FLOW_OVERSHOOT, y }
    case Position.Top:
      return { x, y: y + FLOW_OVERSHOOT }
    case Position.Bottom:
      return { x, y: y - FLOW_OVERSHOOT }
  }
}

// One full sweep from source to target. The keyframe name is stable per run,
// so re-activating the same edge from the same run never restarts the
// animation mid-way; a new run gets a fresh keyframe and plays its own sweep.
function buildSweepKeyframes(name: string): string {
  return (
    `@keyframes ${name}{` +
    `0%{stroke-dashoffset:${FLOW_START_OFFSET};opacity:0}` +
    `1%{stroke-dashoffset:${FLOW_START_OFFSET};opacity:var(--beam-on)}` +
    `99%{stroke-dashoffset:${FLOW_END_OFFSET};opacity:var(--beam-on)}` +
    `100%{stroke-dashoffset:${FLOW_END_OFFSET};opacity:0}}`
  )
}

type StaticBaseEdgeProps = ComponentProps<typeof BaseEdge>

const StaticBaseEdge = memo(
  function StaticBaseEdge(props: StaticBaseEdgeProps) {
    return <BaseEdge {...props} />
  },
  (previous, next) =>
    previous.id === next.id &&
    previous.path === next.path &&
    previous.markerEnd === next.markerEnd &&
    previous.style === next.style &&
    previous.interactionWidth === next.interactionWidth,
)

export function NodeEdge(props: EdgeProps) {
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

  const lightSource = extendAgainstHandle(sourceX, sourceY, sourcePosition)
  const lightTarget = extendAgainstHandle(targetX, targetY, targetPosition)
  const [lightPath] = getBezierPath({
    sourceX: lightSource.x,
    sourceY: lightSource.y,
    sourcePosition,
    targetX: lightTarget.x,
    targetY: lightTarget.y,
    targetPosition,
  })

  const layers = (data?.layers as FlowLayerOverlay[] | undefined) ?? []

  return (
    <>
      <StaticBaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />
      {layers.map((layer) => {
        const kfName = edgeFlowKeyframeName(layer.runId, id)
        const css = buildSweepKeyframes(kfName)
        const animStyle: CSSProperties = {
          animationName: kfName,
          animationDuration: `${FLOW_STEP_MS}ms`,
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
          animationFillMode: 'forwards',
        }
        const dashVars = (dash: string, on: number): CSSProperties =>
          ({ strokeDasharray: dash, strokeDashoffset: FLOW_START_OFFSET, '--beam-on': String(on) }) as CSSProperties
        return (
          <g key={`${layer.runId}-${layer.loop}`} style={{ filter: `drop-shadow(0 0 4px ${layer.color})` }}>
            <style>{css}</style>
            <path
              d={lightPath}
              fill="none"
              stroke={layer.color}
              strokeWidth={FLOW_STROKE_WIDTH}
              strokeLinecap="butt"
              pathLength={100}
              style={{ ...animStyle, ...dashVars(`${FLOW_TAIL_LEN} ${FLOW_PATTERN_GAP}`, FLOW_TAIL_OPACITY) }}
            />
            <path
              d={lightPath}
              fill="none"
              stroke={layer.color}
              strokeWidth={FLOW_STROKE_WIDTH}
              strokeLinecap="butt"
              pathLength={100}
              style={{
                ...animStyle,
                ...dashVars(
                  `0 ${FLOW_TAIL_LEN - FLOW_HEAD_LEN} ${FLOW_HEAD_LEN} ${FLOW_PATTERN_LENGTH - FLOW_TAIL_LEN}`,
                  1,
                ),
              }}
            />
          </g>
        )
      })}
    </>
  )
}
