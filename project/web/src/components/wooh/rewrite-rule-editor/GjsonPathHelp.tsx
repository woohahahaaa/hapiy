import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/wooh/AppIcon'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/wooh/tooltip'

// The two request containers have their own path vocabulary: a JSON body is
// addressed with gjson paths, a multipart body is a flat form whose field
// names are the paths. The help follows the rule's 请求体格式 so the example
// list never shows syntax the active format cannot use.
export type PathHelpFormat = 'json' | 'multipart'

const JSON_EXAMPLES: ReadonlyArray<{ readonly path: string; readonly descKey: string }> = [
  { path: 'model', descKey: 'gjson.examples.topLevel' },
  { path: 'messages.0.content', descKey: 'gjson.examples.arrayIndex' },
  { path: 'messages.-1.content', descKey: 'gjson.examples.arrayLast' },
  { path: 'body.hello', descKey: 'gjson.examples.nested' },
  { path: 'header.X-Request-ID', descKey: 'gjson.examples.header' },
]

const MULTIPART_EXAMPLES: ReadonlyArray<{ readonly path: string; readonly descKey: string }> = [
  { path: 'model', descKey: 'multipart.examples.field' },
  { path: 'prompt', descKey: 'multipart.examples.prompt' },
  { path: 'image.0', descKey: 'multipart.examples.sliceIndex' },
  { path: 'image.0.filename', descKey: 'multipart.examples.fileHeader' },
  { path: 'header.X-Request-ID', descKey: 'multipart.examples.header' },
]

export function GjsonPathHelp({ format = 'json' }: { readonly format?: PathHelpFormat }) {
  const { t } = useTranslation('rewrite')
  const multipart = format === 'multipart'
  const examples = multipart ? MULTIPART_EXAMPLES : JSON_EXAMPLES
  const namespace = multipart ? 'multipart' : 'gjson'
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="nodrag nopan inline-flex items-center gap-1 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={t(`${namespace}.triggerAria`)}
          >
            <AppIcon name="help" size={14} />
            <span>{t(`${namespace}.triggerLabel`)}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          // The example list sizes to its content: a wrapped path/description
          // pair reads worse than a wide popover.
          className="w-max max-w-none !px-0 !py-0"
        >
          <div className="px-3 py-2.5">
            {/* Plain words first, examples after: the rule reads once, then the
                list shows what each path addresses. */}
            <p className="max-w-[22rem] text-[11px] leading-relaxed text-zinc-300">{t(`${namespace}.howTo`)}</p>
            <ul className="mt-2 space-y-1 border-t border-white/10 pt-2">
              {examples.map((ex) => (
                <li key={ex.path} className="flex items-start gap-2 whitespace-nowrap text-[11px]">
                  <code className="shrink-0 rounded-sm bg-white/15 px-1 py-px font-mono">{ex.path}</code>
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
