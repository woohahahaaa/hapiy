import { renderIcon } from '@/config/icons'
import type { IconProps, IconTheme } from '@/config/icons'
import { cn } from "@/lib/utils"

interface AppIconProps extends React.ComponentProps<"span"> {
  name: string
  size?: number | string
  /** Convenience flag: true = 'filled', false = leave undefined (global default). */
  filled?: boolean
  /** Override the global icon theme for this call. */
  theme?: IconTheme
  /** Override the icon fill colour. */
  fill?: string
}

export function AppIcon({
  name,
  size,
  filled = false,
  theme,
  fill,
  className,
  style,
  ...rest
}: AppIconProps) {
  const icon = renderIcon(name, {
    size,
    theme: theme ?? (filled ? 'filled' : undefined),
    fill,
  } as IconProps)

  if (!icon) return null

  return (
    <span
      aria-hidden
      {...rest}
      className={cn("inline-flex items-center justify-center", className)}
      style={style}
    >
      {icon}
    </span>
  )
}
