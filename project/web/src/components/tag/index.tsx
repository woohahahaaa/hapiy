import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { cn } from '@/lib/utils'

// RemovableTag — 可删除标签：关闭按钮固定在左侧，文本超长自动截断。
// 用于多选下拉的已选项展示（如托管供应商里勾选的供应商 tag）。
export function RemovableTag({
  label,
  onRemove,
  removeTitle,
  className,
}: {
  readonly label: ReactNode
  readonly onRemove: () => void
  readonly removeTitle?: string
  readonly className?: string
}) {
  const { t } = useTranslation('ui')
  const title = removeTitle ?? t('tag.remove')
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-xs border border-border bg-muted/40 px-1.5 py-0.5',
        className,
      )}
    >
      <button
        type="button"
        aria-label={title}
        title={title}
        onClick={(e) => {
          // tag 常被渲染在可点击容器（如下拉触发器）内，阻止冒泡避免
          // 点 × 移除时连带触发父级点击（例如把下拉召唤出来）。
          e.stopPropagation()
          onRemove()
        }}
        className="flex size-4 shrink-0 items-center justify-center p-0 leading-none text-muted-foreground transition-colors hover:text-foreground"
      >
        <AppIcon name="close" size={12} />
      </button>
      <span className="min-w-0 truncate leading-none">{label}</span>
    </span>
  )
}