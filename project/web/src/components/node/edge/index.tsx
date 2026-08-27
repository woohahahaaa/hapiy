/* eslint-disable react-refresh/only-export-components */
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import { memo, type ComponentProps, type CSSProperties } from 'react'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import { FLOW_STEP_MS } from '@/modules/flow-hub'
import { edgeFlowKeyframeName } from '@/components/node/flash-layer'
import { DefaultBeam, ChannelAffinityBeam, FLOW_TAIL_LEN } from './beams'

// The edge renders the beam as a moving dash: an opaque head (FLOW_HEAD_LEN)
// followed by a faint tail (FLOW_TAIL_LEN at FLOW_TAIL_OPACITY). Each active
// run owns one keyframe keyed by runId+edgeId (stable, never renamed), and
// the beam slides from source to target once per FLOW_STEP_MS cycle. Overlap
// runs stack naturally — each layer is a separate <g>.
const FLOW_START_OFFSET = FLOW_TAIL_LEN
const FLOW_END_OFFSET = -100

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
        if (layer.channelAffinity) {
          return (
            <ChannelAffinityBeam
              key={`${layer.runId}-${layer.loop}-aff`}
              css={css}
              animStyle={animStyle}
              dashVars={dashVars}
              lightPath={path}
              color={layer.color}
            />
          )
        }
        return (
          <DefaultBeam
            key={`${layer.runId}-${layer.loop}`}
            css={css}
            animStyle={animStyle}
            dashVars={dashVars}
            lightPath={path}
            color={layer.color}
          />
        )
      })}
    </>
  )
}
