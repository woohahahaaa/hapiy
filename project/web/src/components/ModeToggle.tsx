import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/AppIcon"
import { useTranslation } from "react-i18next"
import * as React from "react"

interface ModeToggleProps {
  className?: string
  size?: "icon-sm" | "icon" | "icon-xs"
}

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"

// Sun/Moon icon button. Derive isDark from the React-managed `theme` state
// (NOT from document.documentElement.classList, which is written in an effect
// and therefore lags by one render — the source of a stuck-after-toggle bug).
export function ModeToggle({ className, size = "icon-sm" }: ModeToggleProps) {
  const { theme, setTheme } = useTheme()
  const { t } = useTranslation('common')

  const [systemIsDark, setSystemIsDark] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia(COLOR_SCHEME_QUERY).matches
  })

  React.useEffect(() => {
    const mq = window.matchMedia(COLOR_SCHEME_QUERY)
    const handler = (event: MediaQueryListEvent) => setSystemIsDark(event.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  const isDark = theme === "dark" || (theme === "system" && systemIsDark)

  return (
    <Button
      data-sidebar="mode-toggle"
      data-slot="mode-toggle"
      variant="ghost"
      size={size}
      className={className}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? t('theme.toLight') : t('theme.toDark')}
      title={isDark ? t('theme.toLight') : t('theme.toDark')}
    >
      {isDark ? <AppIcon name="light_mode" size={16} /> : <AppIcon name="dark_mode" size={16} />}
      <span className="sr-only">{t('theme.switch')}</span>
    </Button>
  )
}
