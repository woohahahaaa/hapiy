import {
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react"
import { Link, useLocation } from "react-router-dom"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { AppIcon } from "@/components/AppIcon"
import { ModeToggle } from "@/components/ModeToggle"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import helpMarkdown from "./help.md?raw"

// ── 目录解析 ──────────────────────────────────────────────────────────────────

interface HelpSection {
  readonly id: string
  readonly title: string
  readonly level: 2 | 3
  /** 该章节的原始 Markdown 正文，供搜索用。 */
  readonly text: string
}

const QUICK_LINKS: readonly {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly icon: string
}[] = [
  {
    id: "快速开始",
    title: "快速开始",
    description: "四步搭好第一条 API 转发工作流",
    icon: "bolt",
  },
  {
    id: "转发拓扑",
    title: "转发拓扑",
    description: "可视化编排请求的转发路径",
    icon: "call_split",
  },
  {
    id: "模型接入",
    title: "模型接入",
    description: "配置上游供应商与访问令牌",
    icon: "layers",
  },
  {
    id: "请求处理",
    title: "请求处理",
    description: "改写、并发控制、故障转移与渠道亲和",
    icon: "tune",
  },
  {
    id: "监控",
    title: "监控",
    description: "活动请求、使用记录与日志抓取",
    icon: "monitoring",
  },
  {
    id: "系统设置",
    title: "系统设置",
    description: "BaseURL、汇率、备份与用量查询",
    icon: "settings",
  },
]

// 与 Markdown 标题渲染共用同一套 id 生成规则，保证目录锚点可定位。
function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
}

function collectText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(collectText).join("")
  if (typeof node === "object" && "props" in node) {
    return collectText(
      (node as ReactElement<{ children?: ReactNode }>).props.children
    )
  }
  return ""
}

// 扫描 ## / ### 标题切分章节；跳过代码块里的 `#` 行。
function parseSections(markdown: string): HelpSection[] {
  const sections: HelpSection[] = []
  let inFence = false
  let current: {
    id: string
    title: string
    level: 2 | 3
    lines: string[]
  } | null = null
  const push = () => {
    if (!current) return
    sections.push({
      id: current.id,
      title: current.title,
      level: current.level,
      text: current.lines.join("\n"),
    })
    current = null
  }
  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence
      current?.lines.push(line)
      continue
    }
    if (!inFence) {
      const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
      if (match) {
        push()
        const title = match[2].replace(/[`*_~]/g, "")
        current = {
          id: slugifyHeading(title),
          title,
          level: match[1].length as 2 | 3,
          lines: [],
        }
        continue
      }
    }
    current?.lines.push(line)
  }
  push()
  return sections
}

// 搜索结果摘要：去掉 Markdown 记号，围绕命中位置截一小段。
function excerptOf(text: string, query: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`|_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const index = plain.toLowerCase().indexOf(query)
  const start = Math.max(0, index - 24)
  const slice = plain.slice(start, start + 90)
  return `${start > 0 ? "…" : ""}${slice}${plain.length > start + 90 ? "…" : ""}`
}

function codeLanguage(node: ReactNode): string | undefined {
  if (!isValidElement(node)) return undefined
  const className = (node.props as { className?: string }).className
  return /language-([\w-]+)/.exec(className ?? "")?.[1]
}

// ── Markdown 样式映射（shadcn 设计变量） ──────────────────────────────────────

function MarkdownHeading({
  id,
  level,
  children,
}: {
  id: string
  level: 2 | 3
  children: ReactNode
}) {
  if (level === 2) {
    return (
      <h2
        id={id}
        data-help-heading
        className="mt-16 mb-5 scroll-mt-6 text-2xl font-semibold tracking-tight first:mt-0"
      >
        {children}
      </h2>
    )
  }
  return (
    <h3
      id={id}
      data-help-heading
      className="mt-10 mb-3 scroll-mt-6 text-lg font-semibold"
    >
      {children}
    </h3>
  )
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-8 text-3xl font-semibold tracking-tight">{children}</h1>
  ),
  h2: ({ children }) => (
    <MarkdownHeading level={2} id={slugifyHeading(collectText(children))}>
      {children}
    </MarkdownHeading>
  ),
  h3: ({ children }) => (
    <MarkdownHeading level={3} id={slugifyHeading(collectText(children))}>
      {children}
    </MarkdownHeading>
  ),
  h4: ({ children }) => (
    <h4 className="mt-8 mb-2 text-base font-semibold">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="my-4 text-[15px] leading-7 break-words text-foreground/85">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="my-4 ml-5 list-disc space-y-2 text-[15px] leading-7 marker:text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-4 ml-5 list-decimal space-y-2 text-[15px] leading-7 marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-4 hover:opacity-80"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  hr: () => <Separator className="my-10 bg-border-subtle" />,
  blockquote: ({ children }) => (
    <blockquote className="my-5 flex gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-muted-foreground [&_p]:my-0 [&_p]:leading-7 [&_p]:text-muted-foreground">
      <AppIcon name="info" size={16} className="mt-1 shrink-0 text-primary" />
      <div className="min-w-0">{children}</div>
    </blockquote>
  ),
  pre: ({ children }) => {
    const language = codeLanguage(children)
    return (
      <div className="my-5 overflow-hidden rounded-xl border border-border-subtle bg-card/50">
        <div className="flex items-center border-b border-border-subtle px-4 py-2">
          <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            {language ?? "text"}
          </span>
        </div>
        <pre className="overflow-x-auto p-4 font-mono text-xs leading-6">
          {children}
        </pre>
      </div>
    )
  },
  code: ({ className, children }) => {
    if (/language-/.test(className ?? ""))
      return <code className={cn("font-mono", className)}>{children}</code>
    return (
      <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] break-all">
        {children}
      </code>
    )
  },
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto rounded-xl border border-border-subtle">
      <table className="w-full border-collapse text-sm [&_tr:last-child>*]:border-b-0">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border-subtle bg-muted/50 px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border-subtle px-4 py-2.5 align-top text-sm text-foreground/85">
      {children}
    </td>
  ),
}

// ── 页面 ─────────────────────────────────────────────────────────────────────

export function HelpPage() {
  const sections = useMemo(() => parseSections(helpMarkdown), [])
  const bodyMarkdown = useMemo(() => helpMarkdown.replace(/^#\s+.*\n+/, ""), [])
  const groups = useMemo(() => {
    const result: { item: HelpSection; children: HelpSection[] }[] = []
    for (const item of sections) {
      if (item.level === 2) result.push({ item, children: [] })
      else result.at(-1)?.children.push(item)
    }
    return result
  }, [sections])
  const iconById = useMemo(
    () => new Map(QUICK_LINKS.map((link) => [link.id, link.icon])),
    []
  )

  const [query, setQuery] = useState("")
  const trimmedQuery = query.trim()
  const searchResults = useMemo(() => {
    const q = trimmedQuery.toLowerCase()
    if (!q) return []
    return sections
      .filter(
        (section) =>
          section.title.toLowerCase().includes(q) ||
          section.text.toLowerCase().includes(q)
      )
      .slice(0, 8)
      .map((section) => ({
        id: section.id,
        title: section.title,
        excerpt: excerptOf(section.text, q),
      }))
  }, [trimmedQuery, sections])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "")
  const location = useLocation()

  const scrollTo = useCallback((id: string) => {
    const container = scrollRef.current
    const target = document.getElementById(id)
    if (!container || !target) return
    const top =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      12
    container.scrollTo({ top, behavior: "smooth" })
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
      let current = ""
      for (const heading of container.querySelectorAll<HTMLElement>(
        "[data-help-heading]"
      )) {
        if (heading.getBoundingClientRect().top - containerTop <= 96)
          current = heading.id
        else break
      }
      if (current) setActiveId((prev) => (prev === current ? prev : current))
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    container.addEventListener("scroll", onScroll, { passive: true })
    update()
    return () => {
      container.removeEventListener("scroll", onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [sections])

  // 支持 /help#section 直接定位
  useEffect(() => {
    const id = decodeURIComponent(location.hash.replace(/^#/, ""))
    if (!id) return
    const timer = window.setTimeout(() => scrollTo(id), 60)
    return () => window.clearTimeout(timer)
  }, [location.hash, scrollTo])

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* 整页按 1100px 宽的版面处理：顶栏、目录、正文同处一个居中列。 */}
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1100px] flex-col border-x border-border-subtle">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-card px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/"
              className="shrink-0 font-hapiy-logo text-2xl leading-none text-foreground"
            >
              hapiy
            </Link>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              帮助文档
            </span>
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
              {sections.map((item) => (
                <SelectItem
                  key={item.id}
                  value={item.id}
                  className={cn("text-xs", item.level === 3 && "pl-6")}
                >
                  {item.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-border-subtle bg-card/30 px-3 py-4 lg:flex">
            <div className="relative mb-3">
              <AppIcon
                name="search"
                size={14}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && searchResults[0])
                    scrollTo(searchResults[0].id)
                  if (event.key === "Escape") setQuery("")
                }}
                placeholder="搜索文档…"
                aria-label="搜索文档"
                className="h-8 w-full rounded-lg border border-border-subtle bg-background pr-2 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
              />
            </div>
            <div className="mb-2 px-2 text-[11px] font-medium text-muted-foreground">
              {trimmedQuery ? `找到 ${searchResults.length} 处` : "本页目录"}
            </div>

            {trimmedQuery ? (
              searchResults.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  没有找到相关内容
                </p>
              ) : (
                <div className="flex flex-col gap-1 pb-10">
                  {searchResults.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => scrollTo(section.id)}
                      className="rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
                    >
                      <div className="truncate text-xs font-medium">
                        {section.title}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
                        {section.excerpt}
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <nav className="flex flex-col gap-0.5 pb-10">
                {groups.map(({ item, children }) => (
                  <div key={item.id} className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => scrollTo(item.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
                        activeId === item.id
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-foreground/80 hover:bg-muted"
                      )}
                    >
                      {iconById.has(item.id) && (
                        <AppIcon
                          name={iconById.get(item.id)!}
                          size={14}
                          className="shrink-0"
                        />
                      )}
                      <span className="truncate">{item.title}</span>
                    </button>
                    {children.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => scrollTo(child.id)}
                        className={cn(
                          "truncate rounded-lg py-1.5 pr-2 pl-8 text-left text-xs transition-colors",
                          activeId === child.id
                            ? "font-medium text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground/80"
                        )}
                      >
                        {child.title}
                      </button>
                    ))}
                  </div>
                ))}
              </nav>
            )}
          </aside>

          <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
            <div className="relative">
              {/* 顶部一层主题色辉光，参考文档站的首页氛围 */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-72"
                style={{
                  backgroundImage:
                    "radial-gradient(60% 100% at 50% 0%, color-mix(in oklab, var(--primary) 10%, transparent), transparent)",
                }}
              />
              <article className="relative mx-auto w-full max-w-3xl px-6 py-10 lg:px-10">
                <h1 className="text-4xl font-semibold tracking-tight">
                  hapiy 帮助文档
                </h1>
                <p className="mt-3 max-w-2xl text-[15px] leading-7 text-muted-foreground">
                  自托管 LLM API
                  网关的使用手册：从搭建第一条转发链路，到改写、监控和 Agent
                  接入。
                </p>
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  {QUICK_LINKS.map((link) => (
                    <button
                      key={link.id}
                      type="button"
                      onClick={() => scrollTo(link.id)}
                      className="group flex items-start gap-3 rounded-xl border border-border-subtle bg-card/40 p-4 text-left transition-colors hover:border-border hover:bg-card"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <AppIcon name={link.icon} size={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1 text-sm font-medium">
                          {link.title}
                          <AppIcon
                            name="chevron_right"
                            size={14}
                            className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                          />
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          {link.description}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>

                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {bodyMarkdown}
                </ReactMarkdown>
                <Separator className="mt-12 bg-border-subtle" />
                <p className="py-6 text-xs text-muted-foreground">
                  hapiy 帮助文档 · 内容随版本更新，以实际页面为准
                </p>
              </article>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
