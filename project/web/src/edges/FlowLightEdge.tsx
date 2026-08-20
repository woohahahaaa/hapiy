/* eslint-disable react-refresh/only-export-components */
import { BaseEdge, getBezierPath, Position, type EdgeProps } from '@xyflow/react'
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

// Provider slot border flash payload attached to a provider slot while its
// active flow light passes through. `phaseMs` is the start of the chain edge
// entering the slot (the beam arrives at the slot input); `durMs` equals
// FLOW_PER_EDGE_MS so the flash lasts exactly the time the beam spends crossing
// the slot node. The flash ends right as the beam starts flowing out of the
// slot output.
export type ProviderFlashPayload = {
  readonly runId: number
  readonly cycleMs: number
  readonly phaseMs: number
  readonly durMs: number
  readonly color: string
}

// The light uses fixed dash patterns on a normalized pathLength of 100. The
// opaque head enters at the source, then travels to the target while the faint
// tail follows behind it outside the path at the beginning.
const FLOW_HEAD_LEN = 22
const FLOW_TAIL_LEN = 55
const FLOW_PATTERN_LENGTH = 200
const FLOW_PATTERN_GAP = FLOW_PATTERN_LENGTH - FLOW_TAIL_LEN
const FLOW_STROKE_WIDTH = 5
const FLOW_OVERSHOOT = FLOW_STROKE_WIDTH * 2
const FLOW_START_OFFSET = FLOW_TAIL_LEN
const FLOW_END_OFFSET = -100
const FLOW_TAIL_OPACITY = 0.35

function safeId(edgeId: string): string {
  return edgeId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

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

function buildKeyframes(name: string, light: FlowLightPayload): string {
  const start = Math.max(0, (light.phaseMs / light.cycleMs) * 100)
  const end = Math.min(100, ((light.phaseMs + light.durMs) / light.cycleMs) * 100)
  const startHidden = Math.max(0, start - 0.001).toFixed(3)
  const startVisible = Math.max(0.001, start).toFixed(3)
  const endVisible = Math.max(start, end - 0.001).toFixed(3)
  return (
    `@keyframes ${name}{` +
    `0%{stroke-dashoffset:${FLOW_START_OFFSET};opacity:0}` +
    `${startHidden}%{stroke-dashoffset:${FLOW_START_OFFSET};opacity:0}` +
    `${startVisible}%{stroke-dashoffset:${FLOW_START_OFFSET};opacity:var(--beam-on)}` +
    `${endVisible}%{stroke-dashoffset:${FLOW_END_OFFSET};opacity:var(--beam-on)}` +
    `${end.toFixed(3)}%{stroke-dashoffset:${FLOW_END_OFFSET};opacity:0}` +
    `100%{stroke-dashoffset:${FLOW_END_OFFSET};opacity:0}}`
  )
}

// Provider flash keyframes animate `border-color` and `box-shadow` directly,
// keeping them at resting values outside the flash window and ramping to the
// provider colour at the midpoint.
export function buildFlashKeyframes(name: string, flash: ProviderFlashPayload): string {
  const start = Math.max(0, (flash.phaseMs / flash.cycleMs) * 100)
  const end = Math.min(100, ((flash.phaseMs + flash.durMs) / flash.cycleMs) * 100)
  const mid = (start + end) / 2
  const startHidden = Math.max(0, start - 0.001).toFixed(3)
  const startVisible = Math.max(0.001, start).toFixed(3)
  const endVisible = Math.max(start, end - 0.001).toFixed(3)
  const rest = 'border-color:var(--border);box-shadow:0 0 0 transparent'
  const peak = `border-color:${flash.color};box-shadow:0 0 8px ${flash.color},inset 0 0 2px ${flash.color}`
  return (
    `@keyframes ${name}{` +
    `0%{${rest}}` +
    `${startHidden}%{${rest}}` +
    `${startVisible}%{${rest}}` +
    `${mid.toFixed(3)}%{${peak}}` +
    `${endVisible}%{${rest}}` +
    `${end.toFixed(3)}%{${rest}}` +
    `100%{${rest}}}`
  )
}

export function flashKeyframeName(flash: ProviderFlashPayload): string {
  return `provider-flash-${flash.runId}-${flash.phaseMs}`
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
    ({ strokeDasharray: dash, strokeDashoffset: FLOW_START_OFFSET, '--beam-on': String(on) }) as CSSProperties

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
            d={lightPath}
            fill="none"
            stroke={light.color}
            strokeWidth={FLOW_STROKE_WIDTH}
            strokeLinecap="butt"
            pathLength={100}
            style={{ ...animStyle, ...dashVars(`${FLOW_TAIL_LEN} ${FLOW_PATTERN_GAP}`, FLOW_TAIL_OPACITY) }}
          />
          <path
            d={lightPath}
            fill="none"
            stroke={light.color}
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
      )}
    </>
  )
}
