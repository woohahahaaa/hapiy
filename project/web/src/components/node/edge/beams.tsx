import type { CSSProperties } from 'react'

// ── 连线光带渲染（默认 / 渠道亲和性命中两版） ──

export const FLOW_HEAD_LEN = 20
export const FLOW_TAIL_LEN = 60
export const FLOW_PATTERN_LENGTH = 200
export const FLOW_PATTERN_GAP = FLOW_PATTERN_LENGTH - FLOW_TAIL_LEN
export const FLOW_STROKE_WIDTH = 4
export const FLOW_TAIL_OPACITY = 0.35

// 两种光带共享的渲染参数（keyframe、动画、dash 构造器、光束路径、run 颜色）。
export type BeamRenderProps = {
  css: string
  animStyle: CSSProperties
  dashVars: (dash: string, on: number) => CSSProperties
  lightPath: string
  color: string
}

// 默认光带：60 尾 + 20 头，4px，头部与尾部同色（run 颜色）。整体透明度为
// 基础值的一半（尾 0.35/2、头 1/2），略淡于常规光带。
export function DefaultBeam({ css, animStyle, dashVars, lightPath, color }: BeamRenderProps) {
  const tailOn = FLOW_TAIL_OPACITY / 2
  const headOn = 1 / 2
  return (
    <g style={{ filter: `drop-shadow(0 0 4px ${color})` }}>
      <style>{css}</style>
      <path
        d={lightPath}
        fill="none"
        stroke={color}
        strokeWidth={FLOW_STROKE_WIDTH}
        strokeLinecap="butt"
        pathLength={100}
        style={{ ...animStyle, ...dashVars(`${FLOW_TAIL_LEN} ${FLOW_PATTERN_GAP}`, tailOn) }}
      />
      <path
        d={lightPath}
        fill="none"
        stroke={color}
        strokeWidth={FLOW_STROKE_WIDTH}
        strokeLinecap="butt"
        pathLength={100}
        style={{
          ...animStyle,
          ...dashVars(`0 ${FLOW_TAIL_LEN - FLOW_HEAD_LEN} ${FLOW_HEAD_LEN} ${FLOW_PATTERN_LENGTH - FLOW_TAIL_LEN}`, headOn),
        }}
      />
    </g>
  )
}

// 渠道亲和性（channel affinity）命中的光带：结构与默认光带完全一致，仅两处
// 不同——宽度 CHANNEL_AFFINITY_STROKE_WIDTH、头部为白色方块。
const CHANNEL_AFFINITY_STROKE_WIDTH = 8

export function ChannelAffinityBeam({ css, animStyle, dashVars, lightPath, color }: BeamRenderProps) {
  return (
    <g style={{ filter: `drop-shadow(0 0 4px ${color})` }}>
      <style>{css}</style>
      <path
        d={lightPath}
        fill="none"
        stroke={color}
        strokeWidth={CHANNEL_AFFINITY_STROKE_WIDTH}
        strokeLinecap="butt"
        pathLength={100}
        style={{ ...animStyle, ...dashVars(`${FLOW_TAIL_LEN} ${FLOW_PATTERN_GAP}`, FLOW_TAIL_OPACITY) }}
      />
      <path
        d={lightPath}
        fill="none"
        stroke="#ffffff"
        strokeWidth={CHANNEL_AFFINITY_STROKE_WIDTH}
        strokeLinecap="butt"
        pathLength={100}
        style={{
          ...animStyle,
          ...dashVars(`0 ${FLOW_TAIL_LEN - FLOW_HEAD_LEN} ${FLOW_HEAD_LEN} ${FLOW_PATTERN_LENGTH - FLOW_TAIL_LEN}`, 1),
        }}
      />
    </g>
  )
}