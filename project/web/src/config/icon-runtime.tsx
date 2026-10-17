/* eslint-disable react-refresh/only-export-components -- 这里是图标运行时（外壳 + 颜色槽），不是纯组件文件 */

import { useId, type CSSProperties, type ReactNode } from "react"

/**
 * 图标运行时 —— 图标本体在 `icon-glyphs.tsx`（由 `scripts/icons-build.mjs` 从
 * myIconpark 的 svg 生成），这里只负责把一段 glyph 画成 `<span><svg/></span>`。
 *
 * 画法沿用 IconPark 那一套：48×48 的方格、四个颜色槽、线宽／端点／拐点由调用方给。
 * 区别是图标不再从 `@icon-park/react` 引 —— 形状在我们自己的仓库里，改粗细、圆角、
 * 配色改这里（或改 myIconpark 的源 svg）就够了。对外的出口是 `icons.tsx`。
 */

/** IconPark 的四个颜色槽，顺序：外描边、外填充、内描边、内填充。 */
export type IconColors = readonly [string, string, string, string]

export type IconTheme = "outline" | "filled" | "two-tone" | "multi-color"
export type IconStrokeLinecap = "butt" | "round" | "square"
export type IconStrokeLinejoin = "miter" | "round" | "bevel"

export interface GlyphProps {
  /** 每个实例各一份的前缀，给 mask / clipPath 的 id 用。 */
  id: string
  c: IconColors
  strokeWidth: number
  strokeLinecap: IconStrokeLinecap
  strokeLinejoin: IconStrokeLinejoin
}

/** 一个图标的画法：它那份 48×48 `<svg>` 的子节点。 */
export type Glyph = (props: GlyphProps) => ReactNode

/**
 * 主题 → 四个槽里的颜色，和 IconPark runtime 的 `IconConverter` 一一对应：
 * 线框是两根描边同色、填充空；实心是外填充上色、内层白；双色／多色按 `fill` 给的
 * 颜色逐个顶上去，没给的用上游那套默认值。
 */
export function colorsFor(
  theme: IconTheme,
  fill?: string | string[]
): IconColors {
  const colors = typeof fill === "string" ? [fill] : (fill ?? [])
  const outStroke = colors[0] ?? "currentColor"
  switch (theme) {
    case "filled":
      return [outStroke, outStroke, "#FFF", "#FFF"]
    case "two-tone":
      return [
        outStroke,
        colors[1] ?? "#2F88FF",
        outStroke,
        colors[1] ?? "#2F88FF",
      ]
    case "multi-color":
      return [
        outStroke,
        colors[1] ?? "#2F88FF",
        colors[2] ?? "#FFF",
        colors[3] ?? "#43CCF8",
      ]
    default:
      return [outStroke, "none", outStroke, "none"]
  }
}

export interface IconSurfaceProps {
  glyph: Glyph
  /** 图标文件名，只用来拼 class（`i-icon-<名字>`），换图标时好排查。 */
  name: string
  size: number | string
  strokeWidth: number
  strokeLinecap: IconStrokeLinecap
  strokeLinejoin: IconStrokeLinejoin
  theme: IconTheme
  fill?: string | string[]
  spin?: boolean
  rtl?: boolean
  className?: string
  style?: CSSProperties
}

/** 图标的外壳：`<span class="i-icon i-icon-<名字>"><svg…/></span>`。 */
export function IconSurface({
  glyph,
  name,
  size,
  strokeWidth,
  strokeLinecap,
  strokeLinejoin,
  theme,
  fill,
  spin,
  rtl,
  className,
  style,
}: IconSurfaceProps) {
  // mask / clipPath 的 id 只在文件内唯一，加上实例前缀整页才唯一
  const uid = useId()
  const classes = ["i-icon", `i-icon-${name}`]
  if (rtl) classes.push("i-icon-rtl")
  if (spin) classes.push("i-icon-spin")
  if (className) classes.push(className)

  return (
    <span className={classes.join(" ")} style={style}>
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        {glyph({
          id: `icon-${name}-${uid}`,
          c: colorsFor(theme, fill),
          strokeWidth,
          strokeLinecap,
          strokeLinejoin,
        })}
      </svg>
    </span>
  )
}
