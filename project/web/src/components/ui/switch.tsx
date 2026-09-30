import * as SwitchPrimitive from "@radix-ui/react-switch"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

type SwitchSize = number | "sm" | "default"

function resolveSize(s: SwitchSize): number {
  if (s === "sm") return 14
  if (s === "default") return 18.4
  if (typeof s === "number") return s
  return 18.4
}

interface SwitchProps extends ComponentProps<typeof SwitchPrimitive.Root> {
  size?: SwitchSize
  color?: string
  rounded?: "full" | "square" | "theme"
}

function Switch({
  className,
  size = "default",
  color,
  rounded = "full",
  style,
  ...props
}: SwitchProps) {
  const basePx = resolveSize(size)
  const h = basePx
  const w = basePx * 1.75
  const thumbSize = basePx - 4
  const translateVal = w - thumbSize - 2
  const rootRadius = rounded === "full" ? "9999px" : rounded === "square" ? "0px" : "var(--radius-xs)"
  const thumbRadius = rounded === "full" ? "9999px" : rounded === "square" ? "0px" : "var(--radius-xs)"
  const checked = props.checked ?? props.defaultChecked ?? false

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center border border-transparent transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:bg-transparent data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      style={{
        height: h,
        width: w,
        borderRadius: rootRadius,
        backgroundColor: checked ? (color ?? "var(--node-accent, var(--color-primary))") : "var(--color-secondary)",
        ...style,
      }}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none block bg-background ring-0 transition-transform"
        style={{
          width: thumbSize,
          height: thumbSize,
          borderRadius: thumbRadius,
          transform: checked ? `translateX(${translateVal}px)` : "translateX(2px)",
        }}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }