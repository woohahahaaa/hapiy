import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/tooltip'

const EXAMPLES: ReadonlyArray<{ readonly path: string; readonly descKey: string }> = [
  { path: 'model', descKey: 'gjson.examples.topLevel' },
  { path: 'messages.0.content', descKey: 'gjson.examples.arrayIndex' },
  { path: 'messages.-1.content', descKey: 'gjson.examples.arrayLast' },
  { path: 'body.hello', descKey: 'gjson.examples.nested' },
  { path: 'header.X-Request-ID', descKey: 'gjson.examples.header' },
]

export function GjsonPathHelp() {
  const { t } = useTranslation('rewrite')
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="nodrag nopan inline-flex items-center gap-1 rounded-xs text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={t('gjson.triggerAria')}
          >
            <AppIcon name="help" size={14} />
            <span>{t('gjson.triggerLabel')}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="w-72 !px-0 !py-0"
        >
          <div className="space-y-2 px-3 py-2.5">
            <div className="text-[11px] font-semibold">{t('gjson.syntaxTitle')}</div>
            <ul className="space-y-1">
              {EXAMPLES.map((ex) => (
                <li key={ex.path} className="flex items-start gap-2 text-[11px]">
                  <code className="shrink-0 rounded-xs bg-white/15 px-1 py-px font-mono">{ex.path}</code>
                  <span className="text-zinc-300">{t(ex.descKey)}</span>
                </li>
              ))}
            </ul>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}