import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AppIcon } from '@/components/AppIcon'
import { ModeToggle } from '@/components/ModeToggle'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import helpMarkdown from './help.md?raw'

// ── 目录解析 ──────────────────────────────────────────────────────────────────

interface TocItem {
  readonly id: string
  readonly title: string
  readonly level: 2 | 3
}

// 与 Markdown 标题渲染共用同一套 id 生成规则，保证目录锚点可定位。
function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

function collectText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return collectText((node as ReactElement<{ children?: ReactNode }>).props.children)
  }
  return ''
}

// 扫描 #### 以上标题生成目录；跳过代码块里的 `#` 行。
function parseToc(markdown: string): TocItem[] {
  const items: TocItem[] = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
    if (!match) continue
    const raw = match[2]
    items.push({
      id: slugifyHeading(raw.replace(/[`*_~]/g, '')),
      title: raw.replace(/[`*_~]/g, ''),
      level: match[1].length as 2 | 3,
    })
  }
  return items
}

// ── Markdown 样式映射（shadcn 设计变量） ──────────────────────────────────────

function MarkdownHeading({ id, level, children }: { id: string; level: 2 | 3; children: ReactNode }) {
  if (level === 2) {
    return (
      <h2
        id={id}
        data-help-heading
        className="mt-14 mb-4 scroll-mt-6 border-b border-border-subtle pb-2 text-xl font-semibold tracking-tight first:mt-0"
      >
        {children}
      </h2>
    )
  }
  return (
    <h3 id={id} data-help-heading className="mt-8 mb-3 scroll-mt-6 text-base font-semibold">
      {children}
    </h3>
  )
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-8 text-3xl font-semibold tracking-tight">{children}</h1>
  ),
  h2: ({ children }) => <MarkdownHeading level={2} id={slugifyHeading(collectText(children))}>{children}</MarkdownHeading>,
  h3: ({ children }) => <MarkdownHeading level={3} id={slugifyHeading(collectText(children))}>{children}</MarkdownHeading>,
  h4: ({ children }) => <h4 className="mt-6 mb-2 text-sm font-semibold">{children}</h4>,
  p: ({ children }) => <p className="my-3 text-sm leading-7 break-words text-foreground/90">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-3 ml-5 list-disc space-y-1.5 text-sm leading-6 marker:text-muted-foreground">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 ml-5 list-decimal space-y-1.5 text-sm leading-6 marker:text-muted-foreground">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:opacity-80">
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  hr: () => <Separator className="my-8 bg-border-subtle" />,
  blockquote: ({ children }) => (
    <blockquote className="my-4 flex gap-2.5 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-muted-foreground [&_p]:my-0 [&_p]:text-muted-foreground [&_p]:leading-6">
      <AppIcon name="info" size={16} className="mt-1 shrink-0 text-primary" />
      <div className="min-w-0">{children}</div>
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-lg border border-border-subtle bg-muted/50 p-4 font-mono text-xs leading-6">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    if (/language-/.test(className ?? '')) return <code className={cn('font-mono', className)}>{children}</code>
    return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] break-all">{children}</code>
  },
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full border-collapse text-sm [&_tr:last-child>*]:border-b-0">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border-subtle bg-muted/50 px-3 py-2 text-left text-xs font-medium text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-b border-border-subtle px-3 py-2 align-top text-foreground/90">{children}</td>,
}

// ── 页面 ─────────────────────────────────────────────────────────────────────

export function HelpPage() {
  const toc = useMemo(() => parseToc(helpMarkdown), [])
  const groups = useMemo(() => {
    const result: { item: TocItem; children: TocItem[] }[] = []
    for (const item of toc) {
      if (item.level === 2) result.push({ item, children: [] })
      else result.at(-1)?.children.push(item)
    }
    return result
  }, [toc])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState(toc[0]?.id ?? '')
  const location = useLocation()

  const scrollTo = useCallback((id: string) => {
    const container = scrollRef.current
    const target = document.getElementById(id)
    if (!container || !target) return
    const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 12
    container.scrollTo({ top, behavior: 'smooth' })
    setActiveId(id)
  }, [])

  // 滚动时高亮当前章节
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    let raf = 0
    const update = () => {
      raf = 0
      const containerTop = container.getBoundingClientRect().top
      let current = ''
      for (const heading of container.querySelectorAll<HTMLElement>('[data-help-heading]')) {
        if (heading.getBoundingClientRect().top - containerTop <= 96) current = heading.id
        else break
      }
      if (current) setActiveId((prev) => (prev === current ? prev : current))
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [toc])

  // 支持 /help#section 直接定位
  useEffect(() => {
    const id = decodeURIComponent(location.hash.replace(/^#/, ''))
    if (!id) return
    const timer = window.setTimeout(() => scrollTo(id), 60)
    return () => window.clearTimeout(timer)
  }, [location.hash, scrollTo])

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-card px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/" className="font-hapiy-logo shrink-0 text-2xl leading-none text-foreground">
            hapiy
          </Link>
          <span className="hidden text-sm text-muted-foreground sm:inline">帮助文档</span>
        </div>
        <div className="flex items-center gap-2">
          <ModeToggle size="icon" />
        </div>
      </header>

      {/* 小屏目录：下拉跳转 */}
      <div className="flex items-center gap-2 border-b border-border-subtle bg-card px-4 py-2 lg:hidden">
        <span className="shrink-0 text-xs text-muted-foreground">目录</span>
        <Select value={activeId} onValueChange={scrollTo}>
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <SelectValue placeholder="选择章节" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {toc.map((item) => (
              <SelectItem key={item.id} value={item.id} className={cn('text-xs', item.level === 3 && 'pl-6')}>
                {item.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-border-subtle bg-card/40 px-3 py-4 lg:block">
          <div className="mb-2 flex items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
            <AppIcon name="help" size={14} />
            本页目录
          </div>
          <nav className="flex flex-col gap-0.5 pb-10">
            {groups.map(({ item, children }) => (
              <div key={item.id} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => scrollTo(item.id)}
                  className={cn(
                    'rounded-xs px-2 py-1.5 text-left text-xs transition-colors',
                    activeId === item.id
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-foreground/80 hover:bg-muted',
                  )}
                >
                  {item.title}
                </button>
                {children.map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    onClick={() => scrollTo(child.id)}
                    className={cn(
                      'rounded-xs py-1.5 pr-2 pl-5 text-left text-xs transition-colors',
                      activeId === child.id
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground/80',
                    )}
                  >
                    {child.title}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
          <article className="mx-auto max-w-3xl px-5 py-8 lg:px-10 lg:py-10">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {helpMarkdown}
            </ReactMarkdown>
            <Separator className="mt-12 bg-border-subtle" />
            <p className="py-6 text-xs text-muted-foreground">hapiy 帮助文档 · 内容随版本更新，以实际页面为准</p>
          </article>
        </div>
      </div>
    </div>
  )
}
