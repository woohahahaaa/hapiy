import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'

// Light payload attached to an edge's `data.light` while a flow animation runs.
// The whole chain loops on a shared `cycleMs` clock; each edge becomes visible
// and sweeps during its own `phaseMs` window of length `durMs`, so the beam
// relays down the chain and restarts from the model node once the cycle ends.
// `color` is the model lamp colour the beam inherits.
export type FlowLightPayload = {
  readonly runId: number
  readonly cycleMs: number
  readonly phaseMs: number
  readonly durMs: number
  readonly color: string
}

// The light is a moving dash on the edge path (pathLength normalises it to 100
// units). The dash grows from zero length at the edge start, then slides to
// the far end: dashoffset animates 100 → FLOW_END_OFFSET. A positive
// stroke-dashoffset pushes the pattern toward the path start, so decreasing
// the offset moves the dash forward: at 100 the tail sits at [0,55] (path
// start), at FLOW_END_OFFSET (= FLOW_TAIL_LEN = 55) it sits at [45,100] (path
// end) — a full forward sweep that never wraps. A longer, fainter trailing
// dash shares the same keyframes via CSS variables.
// The bright head sits at the beam's upstream end (start of the sweep) so the
// fully opaque part appears first at the path origin, and the fainter tail
// trails behind it toward the downstream end.
const FLOW_HEAD_LEN = 22
const FLOW_TAIL_LEN = 55
const FLOW_END_OFFSET = FLOW_TAIL_LEN
const FLOW_TAIL_OPACITY = 0.35
const FLOW_GROW_FRACTION = 0.3

function safeId(edgeId: string): string {
  return edgeId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

// Per-edge loop keyframes: zero-length at the window start, grow to full
// length in place, slide to the path end, then vanish so the next edge takes
// over. `--beam-dash`/`--beam-on` let the head and tail dashes share the frame.
function buildKeyframes(name: string, light: FlowLightPayload): string {
  const start = Math.max(0, (light.phaseMs / light.cycleMs) * 100)
  const end = Math.min(100, ((light.phaseMs + light.durMs) / light.cycleMs) * 100)
  const g = (start + (end - start) * FLOW_GROW_FRACTION).toFixed(2)
  const e = end.toFixed(2)
  // The first visible frame must be strictly after 0%, otherwise the loop
  // wrap (100% → 0%) interpolates opacity 0→1 while the dash is still parked
  // at the path end (offset FLOW_END_OFFSET), flashing a bright dot at the
  // end right as the beam appears at the start.
  const sVisible = Math.max(0.001, start).toFixed(3)
  return (
    `@keyframes ${name}{` +
    `0%{stroke-dasharray:0 100;stroke-dashoffset:100;opacity:0}` +
    `${sVisible}%{stroke-dasharray:0 100;stroke-dashoffset:100;opacity:1}` +
    `${g}%{stroke-dasharray:var(--beam-dash);stroke-dashoffset:100;opacity:var(--beam-on)}` +
    `${e}%{stroke-dasharray:var(--beam-dash);stroke-dashoffset:${FLOW_END_OFFSET};opacity:var(--beam-on)}` +
    `${e}%{stroke-dasharray:var(--beam-dash);stroke-dashoffset:${FLOW_END_OFFSET};opacity:0}` +
    `100%{stroke-dasharray:var(--beam-dash);stroke-dashoffset:${FLOW_END_OFFSET};opacity:0}}`
  )
}

/**
 * Default bezier edge that renders a flowing light beam while `data.light` is
 * set. The beam is a growing dash sliding along the edge path (stroke-dash
 * animation on a pathLength-normalised overlay), coloured by the model lamp.
 * `phaseMs` offsets + the shared `cycleMs` loop make the sweep relay down the
 * chain and repeat for the request's lifetime.
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
        animationName: kfName,
        animationDuration: `${light.cycleMs}ms`,
        animationTimingFunction: 'linear',
        animationIterationCount: 'infinite',
        animationFillMode: 'forwards',
      }
    : undefined

  const dashVars = (dash: string, on: number): CSSProperties =>
    ({ '--beam-dash': dash, '--beam-on': String(on) }) as CSSProperties

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />
      {light && (
        <g
          key={`beam-${light.runId}`}
          style={{ filter: `drop-shadow(0 0 4px ${light.color})` }}
        >
          <style>{css}</style>
          <path
            d={path}
            fill="none"
            stroke={light.color}
            strokeWidth={5}
            strokeLinecap="round"
            pathLength={100}
            style={{ ...animStyle, ...dashVars(`${FLOW_TAIL_LEN} ${100 - FLOW_TAIL_LEN}`, FLOW_TAIL_OPACITY) }}
          />
          <path
            d={path}
            fill="none"
            stroke={light.color}
            strokeWidth={5}
            strokeLinecap="round"
            pathLength={100}
            style={{
              ...animStyle,
              ...dashVars(`${FLOW_HEAD_LEN} ${100 - FLOW_HEAD_LEN}`, 1),
            }}
          />
        </g>
      )}
    </>
  )
}
