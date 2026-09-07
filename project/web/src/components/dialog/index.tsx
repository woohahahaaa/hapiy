import * as React from "react"
import { useEffect, useRef, useState } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/AppIcon"

const WIDTH_MAP: Record<string, string> = {
  xs: '!w-[384px] !max-w-[384px]',
  sm: '!w-[640px] !max-w-[640px]',
  md: '!w-[960px] !max-w-[960px]',
  lg: '!w-[1024px] !max-w-[1024px]',
  full: '!w-screen !max-w-none',
}
const HEIGHT_MAP: Record<string, string> = {
  auto: 'max-h-[85vh]',
  full: '!h-screen !max-h-none',
}

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  width = 'sm',
  height = 'auto',
  minHeight,
  bare = false,
  scrollFooter = false,
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  width?: 'xs' | 'sm' | 'md' | 'lg' | 'full'
  height?: 'auto' | 'full'
  /** Minimum content height (e.g. "640px"): keeps the dialog at a usable
   * size regardless of its content, e.g. so list dialogs don't jump. */
  minHeight?: number | string
  /** Edge-to-edge mode: strips the dialog chrome (radius, border, padding)
   * for fullscreen editors/panels. Callers still provide their own layout. */
  bare?: boolean
  /** 固定底部按钮栏模式：面板本身不滚动（flex 列 + 85vh 封顶），内容区
   * 交由 DialogScrollBody 内部滚动，DialogFooter 作为兄弟被钉在底部。 */
  scrollFooter?: boolean
}) {
  const sizeClass = width === 'full' && height === 'full'
    ? '!w-screen !max-w-none !h-screen !max-h-none !inset-0 !translate-x-0 !translate-y-0'
    : `${WIDTH_MAP[width] ?? ''} ${HEIGHT_MAP[height] ?? ''}`

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-none bg-popover p-4 text-xs/relaxed text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          sizeClass,
          bare && 'rounded-none border-0 p-0 !gap-0',
          scrollFooter && 'flex max-h-[85vh] flex-col gap-0 overflow-hidden',
          className,
        )}
        style={{ minHeight, ...style }}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
            >
              <AppIcon name="close" size={16} />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1 text-left", className)}
      {...props}
    />
  )
}

/**
 * 固定底部按钮栏的滚动内容区：配合 DialogContent 的 scrollFooter 使用。
 * 把内容包在自滚动的区域里，footer 栏钉在弹窗底部、随内容滚不到，
 * 滚到底时 footer 顶部分隔线自动消失（按钮像浮在内容之上）。
 * footer 直接传按钮（可含多个），DialogFooter 外壳由本组件统一渲染。
 */
function DialogScrollBody({
  className,
  children,
  footer,
}: React.ComponentProps<"div"> & {
  footer: React.ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  return (
    <>
      <div ref={scrollRef} className={cn("min-h-0 flex-1 overflow-y-auto p-4", className)}>
        {children}
      </div>
      <DialogFooter scrollRef={scrollRef} bleed>
        {footer}
      </DialogFooter>
    </>
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  scrollRef,
  bleed = false,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
  /** 弹窗内容区滚动容器：传了则根据"内容是否已滚到底"自动隐藏顶部分隔线；
   *  未传时固定显示分隔线。 */
  scrollRef?: React.RefObject<HTMLElement | null>
  /** 用负 margin 抵消弹窗左右 padding，让顶部分隔线贯穿整个弹窗宽度。 */
  bleed?: boolean
}) {
  // 监听内容区滚动：当内容已滚到底（按钮紧贴内容末尾）时顶部分隔线隐藏，
  // 营造"按钮在内容之上浮动 → 内容完全展开后无边界"的视觉。
  const [atBottom, setAtBottom] = useState(false)
  useEffect(() => {
    const el = scrollRef?.current
    if (!el) return
    const check = () => {
      setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 1)
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', check)
      ro.disconnect()
    }
  }, [scrollRef])
  const borderClass = scrollRef
    ? (atBottom ? 'border-t border-transparent' : 'border-t border-border')
    : 'border-t border-border'
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 px-4 pt-4 sm:flex-row sm:justify-end",
        borderClass,
        bleed && '-mx-4',
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-sm font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-xs/relaxed text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogScrollBody,
  DialogTitle,
  DialogTrigger,
}
