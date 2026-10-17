import type { CSSProperties, ReactElement } from "react"
import { glyphs } from "./icon-glyphs"
import { IconSurface } from "./icon-runtime"
import type {
  Glyph,
  IconStrokeLinecap,
  IconStrokeLinejoin,
  IconTheme,
} from "./icon-runtime"
import iconConfig from "./icons.json"

export type { IconStrokeLinecap, IconStrokeLinejoin, IconTheme }

export interface IconProps {
  size?: number | string
  strokeWidth?: number
  strokeLinecap?: IconStrokeLinecap
  strokeLinejoin?: IconStrokeLinejoin
  theme?: IconTheme
  fill?: string | string[]
  className?: string
  style?: CSSProperties
  spin?: boolean
}

// Global default style for every icon, editable from `icons.json`.
export const iconStyle = {
  size: iconConfig.global.size as number,
  strokeWidth: iconConfig.global.strokeWidth as number,
  theme: iconConfig.global.theme as IconTheme,
  strokeLinecap: iconConfig.global.strokeLinecap as IconStrokeLinecap,
  strokeLinejoin: iconConfig.global.strokeLinejoin as IconStrokeLinejoin,
  rtl: iconConfig.global.rtl as boolean,
  spin: iconConfig.global.spin as boolean,
} as const

// 语义化图标名 -> 图标文件名（可通过 `icons.json` 编辑）。形状来自 myIconpark 的源
// svg：`icon-glyphs.tsx` 由 `scripts/icons-build.mjs` 按这份映射编译出来。
const NAME_TO_GLYPH: Readonly<Record<string, string>> = iconConfig.icons

// 名字是数据（icons.json），只能按字符串取；生成器保证键和 icons.json 同步。
const GLYPHS: Readonly<Record<string, Glyph>> = glyphs

// Merge the caller's per-icon overrides on top of the global defaults.
export function resolveIconProps(overrides?: IconProps): IconProps {
  const { size, strokeWidth, theme, strokeLinecap, strokeLinejoin, spin, ...rest } = overrides ?? {}
  return {
    size: size ?? iconStyle.size,
    strokeWidth: strokeWidth ?? iconStyle.strokeWidth,
    theme: theme ?? iconStyle.theme,
    strokeLinecap: strokeLinecap ?? iconStyle.strokeLinecap,
    strokeLinejoin: strokeLinejoin ?? iconStyle.strokeLinejoin,
    spin: spin ?? iconStyle.spin,
    ...rest,
  }
}

export function renderIcon(
  name: string,
  overrides?: IconProps
): ReactElement | null {
  const glyphName = NAME_TO_GLYPH[name]
  const glyph = glyphName ? GLYPHS[glyphName] : undefined
  if (!glyph) return null

  const {
    size = iconStyle.size,
    strokeWidth = iconStyle.strokeWidth,
    theme = iconStyle.theme,
    strokeLinecap = iconStyle.strokeLinecap,
    strokeLinejoin = iconStyle.strokeLinejoin,
    fill,
    spin = iconStyle.spin,
    className,
    style,
  } = resolveIconProps(overrides)

  return (
    <IconSurface
      glyph={glyph}
      name={glyphName}
      size={size}
      strokeWidth={strokeWidth}
      strokeLinecap={strokeLinecap}
      strokeLinejoin={strokeLinejoin}
      theme={theme}
      fill={fill}
      spin={spin}
      // rtl：IconPark 里是「图标自带的方向标记 × 全局开关」，源 svg 里没有那个标记，
      // 这里只认全局开关（当前配置是 false；一旦打开就是所有图标一起水平镜像）。
      rtl={iconStyle.rtl}
      className={className}
      style={style}
    />
  )
}
