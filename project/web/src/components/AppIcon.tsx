import { renderIcon } from '@/config/icons'
import type { IconProps } from '@/config/icons'
import { cn } from "@/lib/utils"

interface AppIconProps extends React.ComponentProps<"span"> {
  name: string
  size?: number
  filled?: boolean
}

export function AppIcon({
  name,
  size,
  filled = false,
  className,
  style,
  ...rest
}: AppIconProps) {
  const icon = renderIcon(name, {
    size,
    theme: filled ? 'filled' : undefined,
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
