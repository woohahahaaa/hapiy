"use client"

import * as React from "react"
import type { JSX } from "react"
import type { ReactNode } from "react"

import { AppIcon } from "@/components/AppIcon"
import type { ColumnDef } from "../ColumnDef"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { ColumnDisplayConfig } from "@/lib/dashboard-api"
import { cn } from "@/lib/utils"

type ColumnSettingsPopoverProps<T> = {
  columns: readonly ColumnDef<T>[]
  configs: ColumnDisplayConfig[]
  widthInput: string[]
  widthError: (string | null)[]
  locked: boolean[]
  onConfigChange: (index: number, next: ColumnDisplayConfig) => void
  onWidthInputChange: (index: number, raw: string) => void
  onLockToggle: (index: number) => void
  /** Content rendered to the right of the "列设置" title (e.g. the magic wand). */
  headerExtra?: ReactNode
  /** Controlled open state (optional; internal state used when omitted). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  anchorRef?: React.Ref<HTMLButtonElement>
}

// Icon note: the AppIcon registry exposes a `lock` semantic alias (mapped to
// IconPark's `Lock`) but no `lock_open`. We render `lock` for both states; the
// `secondary`/`ghost` variant plus the row's `opacity-60` communicates the
// locked/unlocked affordance.
const LOCK_ICON = "lock"

export function ColumnSettingsPopover<T>(
  props: ColumnSettingsPopoverProps<T>,
): JSX.Element {
  const {
    columns,
    configs,
    widthInput,
    widthError,
    locked,
    onConfigChange,
    onWidthInputChange,
    onLockToggle,
    headerExtra,
    open: openProp,
    onOpenChange,
    anchorRef,
  } = props

  const [internalOpen, setInternalOpen] = React.useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : internalOpen

  // Self-adaptive height: measure the popover's own position after Radix
  // places it and clamp the list height to the space actually left below it.
  // Some Android WebViews don't honour dvh, so the measured value (rather than
  // a viewport unit) is what keeps the popover inside the window on small pads.
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [maxListHeight, setMaxListHeight] = React.useState<number | undefined>(undefined)
  React.useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const el = contentRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const margin = 16
      const avail = Math.floor(window.innerHeight - rect.top - margin)
      setMaxListHeight(avail > 80 ? avail : undefined)
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (contentRef.current) observer.observe(contentRef.current)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [open])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (isControlled) onOpenChange?.(next)
        else setInternalOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={anchorRef}
          variant="ghost"
          size="icon"
          aria-label="列设置"
        >
          <AppIcon name="auto_width" size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} collisionPadding={8} className="w-80 p-3">
        <div
          ref={contentRef}
          style={{ maxHeight: maxListHeight ?? undefined }}
          className="flex max-h-[min(60vh,calc(100dvh-8rem))] flex-col gap-3 overflow-y-auto"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium">列设置</div>
            {headerExtra}
          </div>
          {columns.map((col, i) => {
            const cfg = configs[i]
            const isLocked = locked[i] ?? false
            return (
              <div
                key={col.key}
                className={cn(
                  "flex flex-col gap-1.5",
                  isLocked && "opacity-60",
                )}
              >
                <div className="text-xs font-medium">{col.label}</div>
                <div className="flex gap-2">
                  <Input
                    value={widthInput[i] ?? ""}
                    onChange={(e) => onWidthInputChange(i, e.target.value)}
                    placeholder="如 200 px 或 30 %"
                    className="flex-1"
                    disabled={isLocked}
                  />
                  <div className="flex rounded-md border border-border">
                    <Button
                      variant={cfg.align === "left" ? "secondary" : "ghost"}
                      size="icon-sm"
                      aria-label="左对齐"
                      onClick={() => onConfigChange(i, { ...cfg, align: "left" })}
                      disabled={isLocked}
                    >
                      <AppIcon name="format_align_left" size={14} />
                    </Button>
                    <Button
                      variant={cfg.align === "right" ? "secondary" : "ghost"}
                      size="icon-sm"
                      aria-label="右对齐"
                      onClick={() => onConfigChange(i, { ...cfg, align: "right" })}
                      disabled={isLocked}
                    >
                      <AppIcon name="format_align_right" size={14} />
                    </Button>
                  </div>
                  <div className="flex rounded-md border border-border">
                    <Button
                      variant={
                        cfg.overflow === "ellipsis" ? "secondary" : "ghost"
                      }
                      size="icon-sm"
                      title="省略号"
                      aria-label="省略号"
                      onClick={() =>
                        onConfigChange(i, { ...cfg, overflow: "ellipsis" })
                      }
                      disabled={isLocked}
                    >
                      <AppIcon name="more_horiz" size={14} />
                    </Button>
                    <Button
                      variant={cfg.overflow === "wrap" ? "secondary" : "ghost"}
                      size="icon-sm"
                      title="换行"
                      aria-label="换行"
                      onClick={() =>
                        onConfigChange(i, { ...cfg, overflow: "wrap" })
                      }
                      disabled={isLocked}
                    >
                      <AppIcon name="paragraph_break" size={14} />
                    </Button>
                  </div>
                  <div className="flex rounded-md border border-border">
                    <Button
                      variant={isLocked ? "secondary" : "ghost"}
                      size="icon-sm"
                      title={isLocked ? "解锁" : "锁定"}
                      aria-label={isLocked ? "解锁" : "锁定"}
                      onClick={() => onLockToggle(i)}
                    >
                      <AppIcon name={LOCK_ICON} size={14} />
                    </Button>
                  </div>
                </div>
                {widthError[i] && (
                  <p className="text-xs text-destructive">{widthError[i]}</p>
                )}
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}