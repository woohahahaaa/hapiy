"use client"

import * as React from "react"
import type { JSX } from "react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

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
  const { t } = useTranslation('ui')

  const [internalOpen, setInternalOpen] = React.useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : internalOpen

  // Max height of the popover is always the browser window height (minus the
  // collision padding). No overflow prediction: the popover opens flush to the
  // left of the trigger, bottom-aligned with it, and Radix's collision
  // handling clamps the opposite edge inside the window — with the height
  // capped here it can never poke out on either side.
  const [maxContentHeight, setMaxContentHeight] = React.useState<number | undefined>(undefined)
  React.useLayoutEffect(() => {
    if (!open) return
    const update = () => setMaxContentHeight(Math.max(0, window.innerHeight - 16))
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
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
          aria-label={t('columns.settings')}
        >
          <AppIcon name="auto_width" size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="end"
        sideOffset={0}
        collisionPadding={8}
        style={{ maxHeight: maxContentHeight ?? undefined }}
        className="flex w-80 flex-col p-3"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium">{t('columns.settings')}</div>
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
                    placeholder={t('columns.widthPlaceholder')}
                    className="flex-1"
                    disabled={isLocked}
                  />
                  <div className="flex rounded-md border border-border">
                    <Button
                      variant={cfg.align === "left" ? "secondary" : "ghost"}
                      size="icon-sm"
                      aria-label={t('columns.alignLeft')}
                      onClick={() => onConfigChange(i, { ...cfg, align: "left" })}
                      disabled={isLocked}
                    >
                      <AppIcon name="format_align_left" size={14} />
                    </Button>
                    <Button
                      variant={cfg.align === "right" ? "secondary" : "ghost"}
                      size="icon-sm"
                      aria-label={t('columns.alignRight')}
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
                      title={t('columns.ellipsis')}
                      aria-label={t('columns.ellipsis')}
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
                      title={t('columns.wrap')}
                      aria-label={t('columns.wrap')}
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
                      title={isLocked ? t('columns.unlock') : t('columns.lock')}
                      aria-label={isLocked ? t('columns.unlock') : t('columns.lock')}
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