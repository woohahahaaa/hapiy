import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/AppIcon"

interface LanguageToggleProps {
  className?: string
  size?: "icon-sm" | "icon" | "icon-xs"
}

// 语言切换按钮占位：先放 icon，等 i18n 基建就绪后再接 locale 状态。
export function LanguageToggle({ className, size = "icon-sm" }: LanguageToggleProps) {
  return (
    <Button
      data-sidebar="language-toggle"
      data-slot="language-toggle"
      variant="ghost"
      size={size}
      className={className}
      aria-label="切换语言"
      title="切换语言"
    >
      <AppIcon name="translate" size={16} />
    </Button>
  )
}
