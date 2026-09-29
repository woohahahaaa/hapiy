import { useTranslation } from 'react-i18next'

import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/AppIcon"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useLanguage } from "@/i18n/language-context"
import { SUPPORTED_LANGUAGES, type Language } from "@/i18n/languages"

interface LanguageToggleProps {
  className?: string
  size?: "icon-sm" | "icon" | "icon-xs"
}

const LANGUAGE_LABEL_KEY: Record<Language, string> = {
  zh: 'language.zh',
  en: 'language.en',
}

export function LanguageToggle({ className, size = "icon-sm" }: LanguageToggleProps) {
  const { t } = useTranslation('common')
  const { language, setLanguage } = useLanguage()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-sidebar="language-toggle"
          data-slot="language-toggle"
          variant="ghost"
          size={size}
          className={className}
          aria-label={t('language.switch')}
          title={t('language.switch')}
        >
          <AppIcon name="translate" size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" sideOffset={6}>
        {SUPPORTED_LANGUAGES.map((lng) => (
          <DropdownMenuItem
            key={lng}
            onSelect={() => setLanguage(lng)}
            aria-current={language === lng}
          >
            <span className="flex-1">{t(LANGUAGE_LABEL_KEY[lng])}</span>
            {language === lng && <AppIcon name="check" size={16} />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
