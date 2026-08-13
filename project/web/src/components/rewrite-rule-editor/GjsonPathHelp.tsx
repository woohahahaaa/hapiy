import { AppIcon } from '@/components/AppIcon'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const EXAMPLES: ReadonlyArray<{ readonly path: string; readonly desc: string }> = [
  { path: 'model', desc: '顶层字段' },
  { path: 'messages.0.content', desc: '数组第 0 项的字段' },
  { path: 'messages.-1.content', desc: '数组最后一项（负数索引）' },
  { path: 'body.hello', desc: '嵌套字段' },
  { path: 'header.X-Request-ID', desc: 'HTTP header（scope=header 时，路径只填名字，如 X-Request-ID）' },
]

export function GjsonPathHelp() {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="nodrag nopan inline-flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="gjson 路径实例"
          >
            <AppIcon name="help" size={14} />
            <span>gjson 路径实例</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="w-72 !rounded-md !border-0 !bg-zinc-900 !px-0 !py-0 !text-zinc-100 [&_[data-slot=tooltip-arrow]]:!bg-zinc-900 [&_[data-slot=tooltip-arrow]]:!fill-zinc-900"
        >
          <div className="space-y-2 px-3 py-2.5">
            <div className="text-[11px] font-semibold">gjson 路径语法</div>
            <ul className="space-y-1">
              {EXAMPLES.map((ex) => (
                <li key={ex.path} className="flex items-start gap-2 text-[11px]">
                  <code className="shrink-0 rounded bg-white/15 px-1 py-px font-mono">{ex.path}</code>
                  <span className="text-zinc-300">{ex.desc}</span>
                </li>
              ))}
            </ul>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}