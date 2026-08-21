import {
  Add,
  Magic,
  MagicWand,
  Thunderbolt,
  CloseOne,
  Comment,
  Check,
  Success,
  Right,
  Close,
  Code,
  Copy,
  Moon,
  Delete,
  Server,
  Drag,
  Edit,
  Error,
  Up,
  Down,
  HashtagKey,
  Help,
  History,
  Info,
  Layers,
  Sun,
  Link,
  Lock,
  Logout,
  Export,
  User,
  LoadingFour,
  Refresh,
  Schedule,
  Setting,
  Shield,
  Filter,
  LayoutOne,
  Attention,
  ViewGridCard,
  Monitor,
  Key,
  SplitBranch,
  Tag,
  FileText,
  ChartGraph,
  FactoryBuilding,
  ConnectionPoint,
  Undo,
  Redo,
  FullSelection,
  AlignLeftTwo,
  AlignRightTwo,
  More,
  ParagraphBreak,
  TextWrapTruncation,
  BackgroundColor,
  FullScreen,
} from '@icon-park/react'
import type { CSSProperties, ReactElement } from 'react'
import iconConfig from './icons.json'

export type IconTheme = 'outline' | 'filled' | 'two-tone' | 'multi-color'
export type IconStrokeLinecap = 'butt' | 'round' | 'square'
export type IconStrokeLinejoin = 'miter' | 'round' | 'bevel'

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

type IconComponent = (props: IconProps) => ReactElement

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

// Static component registry keyed by IconPark component name. Explicit imports
// keep tree-shaking working: only the icons referenced here end up in the bundle.
const COMPONENTS: Readonly<Record<string, IconComponent>> = {
  Add,
  Magic,
  MagicWand,
  Thunderbolt,
  CloseOne,
  Comment,
  Check,
  Success,
  Right,
  Close,
  Code,
  Copy,
  Moon,
  Delete,
  Server,
  Drag,
  Edit,
  Error,
  Up,
  Down,
  HashtagKey,
  Help,
  History,
  Info,
  Layers,
  Sun,
  Link,
  Lock,
  Logout,
  Export,
  User,
  LoadingFour,
  Refresh,
  Schedule,
  Setting,
  Shield,
  Filter,
  LayoutOne,
  Attention,
  ViewGridCard,
  Monitor,
  Key,
  SplitBranch,
  Tag,
  FileText,
  ChartGraph,
  FactoryBuilding,
  ConnectionPoint,
  Undo,
  Redo,
  FullSelection,
  AlignLeftTwo,
  AlignRightTwo,
  More,
  ParagraphBreak,
  TextWrapTruncation,
  BackgroundColor,
  FullScreen,
}

// 语义化图标名 -> IconPark 组件名（可通过 `icons.json` 编辑）。
const NAME_TO_COMPONENT: Readonly<Record<string, string>> = iconConfig.icons

function componentFor(name: string): IconComponent | null {
  const componentName = NAME_TO_COMPONENT[name]
  if (!componentName) return null
  return COMPONENTS[componentName] ?? null
}

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

export function renderIcon(name: string, overrides?: IconProps) {
  const component = componentFor(name)
  if (!component) return null
  return component(resolveIconProps(overrides))
}
