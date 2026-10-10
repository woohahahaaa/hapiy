import { dashboardApi } from './dashboard-api'

// 主题配置的持久化键：已安装主题清单 + 深浅模式各自选中的主题。
export const DEFAULT_THEME_ID = 'default'
export const THEME_REGISTRY_KEY = 'theme_registry'
export const THEME_DARK_KEY = 'theme_dark'
export const THEME_LIGHT_KEY = 'theme_light'

const STYLE_ELEMENT_ID = 'hapiy-theme-overrides'

export type ThemeVars = Record<string, string>

export type InstalledTheme = {
  readonly id: string
  readonly name: string
  readonly light: ThemeVars
  readonly dark: ThemeVars
}

export type ThemeState = {
  readonly themes: readonly InstalledTheme[]
  readonly darkId: string
  readonly lightId: string
}

const initialState: ThemeState = { themes: [], darkId: DEFAULT_THEME_ID, lightId: DEFAULT_THEME_ID }

let state: ThemeState = initialState
const listeners = new Set<() => void>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// shadcn registry 的旧格式是裸 HSL 三分量（如 "240 10% 3.9%"），这里补上 hsl()；
// 已经是 oklch()/hsl()/#/var() 的值保持原样。
function normalizeValue(raw: string): string {
  const value = raw.trim()
  if (value === '') return value
  if (value.includes('(') || value.startsWith('#') || value.startsWith('var')) return value
  if (/^[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(value)) return `hsl(${value})`
  return value
}

function readVars(value: unknown): ThemeVars {
  if (!isRecord(value)) return {}
  const vars: ThemeVars = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string' && typeof raw !== 'number') continue
    vars[key.startsWith('--') ? key : `--${key}`] = normalizeValue(String(raw))
  }
  return vars
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'theme'
}

// 解析 shadcn registry 主题 JSON：cssVars 下可能有 theme（共享）/light/dark 三块，
// 也可能把 light/dark 直接放在顶层。共享变量合并进两种模式。
export function parseTheme(raw: unknown): InstalledTheme {
  if (!isRecord(raw)) throw new Error('invalid')
  const container = isRecord(raw.cssVars) ? raw.cssVars : raw
  const shared = readVars(container.theme)
  const light = { ...shared, ...readVars(container.light) }
  const dark = { ...shared, ...readVars(container.dark) }
  if (Object.keys(light).length === 0 && Object.keys(dark).length === 0) throw new Error('no-vars')

  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const displayName = label || name || 'Theme'
  return { id: `t_${slugify(displayName)}`, name: displayName, light, dark }
}

export function parseThemeRegistry(raw: string): InstalledTheme[] {
  if (raw.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const themes: InstalledTheme[] = []
  for (const item of parsed) {
    try {
      const theme = parseTheme(item)
      if (!themes.some((existing) => existing.id === theme.id)) themes.push(theme)
    } catch {
      // 跳过损坏条目
    }
  }
  return themes
}

function themeById(themes: readonly InstalledTheme[], id: string): InstalledTheme | undefined {
  return themes.find((theme) => theme.id === id)
}

function buildCss(light: ThemeVars | null, dark: ThemeVars | null): string {
  const block = (selector: string, vars: ThemeVars | null) => {
    const entries = vars ? Object.entries(vars) : []
    if (entries.length === 0) return ''
    return `${selector}{${entries.map(([key, value]) => `${key}:${value}`).join(';')}}`
  }
  // 浅色用 :root:not(.dark) 限定，避免覆盖 index.css 里 .dark 的内置变量。
  return [block(':root:not(.dark)', light), block('.dark', dark)].filter(Boolean).join('\n')
}

function applyCss(): void {
  if (typeof document === 'undefined') return
  const light = themeById(state.themes, state.lightId)?.light ?? null
  const dark = themeById(state.themes, state.darkId)?.dark ?? null
  const existing = document.getElementById(STYLE_ELEMENT_ID)
  const css = buildCss(light, dark)
  if (css === '') {
    existing?.remove()
    return
  }
  const style = existing instanceof HTMLStyleElement ? existing : document.createElement('style')
  style.id = STYLE_ELEMENT_ID
  style.textContent = css
  if (!existing) document.head.appendChild(style)
}

function setState(next: ThemeState): void {
  state = next
  applyCss()
  for (const listener of listeners) listener()
}

export function getThemeState(): ThemeState {
  return state
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// 从系统设置列表同步主题状态并即时应用。
export function syncThemeFromSettings(settings: readonly { key: string; value: string }[]): void {
  const value = (key: string) => settings.find((setting) => setting.key === key)?.value ?? ''
  const themes = parseThemeRegistry(value(THEME_REGISTRY_KEY))
  const darkRaw = value(THEME_DARK_KEY)
  const lightRaw = value(THEME_LIGHT_KEY)
  setState({
    themes,
    darkId: themeById(themes, darkRaw) ? darkRaw : DEFAULT_THEME_ID,
    lightId: themeById(themes, lightRaw) ? lightRaw : DEFAULT_THEME_ID,
  })
}

export function setThemeSelection(mode: 'dark' | 'light', id: string): void {
  setState(mode === 'dark' ? { ...state, darkId: id } : { ...state, lightId: id })
}

export function setInstalledThemes(themes: readonly InstalledTheme[]): void {
  setState({
    themes,
    darkId: themeById(themes, state.darkId) ? state.darkId : DEFAULT_THEME_ID,
    lightId: themeById(themes, state.lightId) ? state.lightId : DEFAULT_THEME_ID,
  })
}

export async function loadThemeState(): Promise<void> {
  syncThemeFromSettings(await dashboardApi.getSettings())
}

// 从 URL 抓取主题（前端直接 fetch；shadcn registry 返回带 CORS 头）。
export async function fetchTheme(url: string): Promise<InstalledTheme> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return parseTheme(await response.json())
}

export function upsertTheme(
  themes: readonly InstalledTheme[],
  theme: InstalledTheme,
): InstalledTheme[] {
  return [...themes.filter((item) => item.id !== theme.id), theme]
}

export function removeTheme(themes: readonly InstalledTheme[], id: string): InstalledTheme[] {
  return themes.filter((item) => item.id !== id)
}
