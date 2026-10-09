import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

function Input({
  className,
  type,
  size = "default",
  ...props
}: Omit<ComponentProps<"input">, "size"> & {
  size?: "sm" | "default"
}) {
  return (
    <input
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(
        "w-full min-w-0 rounded-none border border-border bg-input/30 px-2.5 py-1 text-xs transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-xs dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        // 高度用普通 class 交给 twMerge 合并：写成 data-[size=*]:h-* 变体时
        // 变体规则会盖过调用方传的 h-*，导致同一行里 input 比 select 高一截。
        size === "sm" ? "h-7" : "h-8",
        className
      )}
      {...props}
    />
  )
}

export { Input }
