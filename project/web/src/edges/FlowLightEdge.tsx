import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'

// Light payload attached to an edge's `data.light` while a flow animation runs.
// The whole chain loops on a shared `cycleMs` clock; each edge becomes visible
// and sweeps during its own `phaseMs` window of length `durMs`, so the beam
// relays down the chain and restarts from the model node once the cycle ends.
export type FlowLightPayload = {
  readonly runId: number
  readonly cycleMs: number
  readonly phaseMs: number
  readonly durMs: number
}

// The light is a moving dash on the edge path: pathLength normalises the path
// to 100 units so dash length / offset are path-length independent. The head
// dash is solid primary; a longer, fainter tail dash trails behind it so the
// light reads as a comet with a fading tail.
const FLOW_HEAD_LEN = 22
const FLOW_TAIL_LEN = 55
const FLOW_TAIL_OPACITY = 0.35

function safeId(edgeId: string): string {
  return edgeId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

// Per-edge loop keyframes: the dash sits off-path before the window, sweeps
// from start to end inside it, and fades out; repeats on the shared chain cycle.
function buildKeyframes(name: string, light: FlowLightPayload): string {
  const start = Math.max(0, (light.phaseMs / light.cycleMs) * 100)
  const end = Math.min(100, ((light.phaseMs + light.durMs) / light.cycleMs) * 100)
  const s = start.toFixed(2)
  const e = end.toFixed(2)
  // The dash sweeps 100→0 inside the window; at `e` it snaps to invisible so
  // the next edge (whose path starts at this node) takes over immediately —
  // the light reads as one continuous beam across nodes, no dwell at ends.
  return (
    `@keyframes ${name}{` +
    `0%{stroke-dashoffset:100;opacity:0}` +
    `${s}%{stroke-dashoffset:100;opacity:1}` +
    `${e}%{stroke-dashoffset:0;opacity:1}` +
    `${e}%{stroke-dashoffset:0;opacity:0}` +
    `100%{stroke-dashoffset:0;opacity:0}}`
  )
}

/**
 * Default bezier edge that renders a flowing light beam while `data.light` is
 * set. The beam is a moving dash along the edge path (stroke-dashoffset
 * animation on a pathLength-normalised overlay path) with a fainter trailing
 * dash, so it needs no rotation or motion-path support. `phaseMs` offsets +
 * the shared `cycleMs` loop make the sweep relay down the chain and repeat for
 * the request's lifetime.
 */
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

  const light = data?.light as FlowLightPayload | undefined
  const kfName = light ? `flow-light-slide-${light.runId}-${safeId(id)}` : ''
  const css = light ? buildKeyframes(kfName, light) : ''

  const animStyle = light
    ? {
        strokeDasharray: `${FLOW_HEAD_LEN} ${100 - FLOW_HEAD_LEN}`,
        strokeDashoffset: 100,
        animationName: kfName,
        animationDuration: `${light.cycleMs}ms`,
        animationTimingFunction: 'linear',
        animationIterationCount: 'infinite',
        animationFillMode: 'forwards',
      }
    : undefined

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />
      {light && (
        <g key={`beam-${light.runId}`} className="flow-light-beam">
          <style>{css}</style>
          <path
            d={path}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={5}
            strokeLinecap="round"
            pathLength={100}
            style={{ ...animStyle, strokeDasharray: `${FLOW_TAIL_LEN} ${100 - FLOW_TAIL_LEN}`, opacity: FLOW_TAIL_OPACITY }}
          />
          <path
            d={path}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={5}
            strokeLinecap="round"
            pathLength={100}
            style={animStyle}
          />
        </g>
      )}
    </>
  )
}
