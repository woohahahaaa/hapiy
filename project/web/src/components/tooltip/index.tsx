import type { ComponentProps } from 'react'
import {
  Tooltip as UITooltip,
  TooltipContent as UITooltipContent,
  TooltipProvider as UITooltipProvider,
  TooltipTrigger as UITooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// 主题化 tooltip：复用系统组件，把配色改为主题背景色打底、前景描边。
export function Tooltip(props: ComponentProps<typeof UITooltip>) {
  return <UITooltip {...props} />
}

export function TooltipProvider(props: ComponentProps<typeof UITooltipProvider>) {
  return <UITooltipProvider {...props} />
}

export function TooltipTrigger(props: ComponentProps<typeof UITooltipTrigger>) {
  return <UITooltipTrigger {...props} />
}

export function TooltipContent({ className, ...props }: ComponentProps<typeof UITooltipContent>) {
  return (
    <UITooltipContent
      className={cn(
        'border border-foreground/15 bg-background text-foreground',
        className,
      )}
      {...props}
    />
  )
}
