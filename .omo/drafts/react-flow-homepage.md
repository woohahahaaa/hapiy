---
slug: react-flow-homepage
status: drafting
intent: clear
pending-action: write .omo/plans/react-flow-homepage.md
approach: React + Vite + React Flow + Minimal Neutral dark theme. 5 independent components delivered in 2 parallel waves.
---

# Draft: react-flow-homepage

## Components (topology ledger)
| id | outcome | status | evidence path |
| --- | --- | --- | --- |
| C1-project | Vite React project at prototype/app/, deps installed, vite.config port 28001, start.sh updated | active | prototype/app/ |
| C2-theme | Minimal Neutral dark CSS variables + DM Sans/Geist Mono fonts injected into index.html/App.css | active | prototype/app/src/theme.json |
| C3-sidebar | Collapsible sidebar (200px→48px) with 6-item menu tree matching REQUIREMENTS.md | active | prototype/REQUIREMENTS.md:92-122 |
| C4-flow | React Flow canvas with 5 custom nodes: Endpoint, Route, Channel, AutoSwitch, AutoReply | active | prototype/index.html:48-141 (3 existing LiteGraph nodes) + REQUIREMENTS.md:52-53 (auto-switch/auto-reply specs) |
| C5-demo | Demo topology: 2 Endpoints → 2 Routes → 3 Channels + 1 AutoSwitch attached | active | prototype/index.html:155-198 (existing demo) |

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
| --- | --- | --- | --- |
| JSX, not TypeScript | JSX | Confirmed: prototype/app/src/main.jsx exists | yes |
| Sidebar collapsed default | Expanded on first load | Shows full nav context; user can collapse | yes |
| Demo topology identical to existing | Same 2 EP→2 R→3 CH + 1 AutoSwitch | No new design needed; pure migration | yes |
| CSS approach | Plain CSS with Tweakcn CSS variables | No Tailwind in prototype; direct CSS variable usage | yes |
| start.sh rewrite | Replace Python server with Vite dev | Vite provides HMR natively; no need for Python | yes |
| Google Fonts loading | `<link>` with `font-display: swap` + `preconnect` | Prevents FOIT; fallback to system sans-serif | yes |
| AutoSwitch node UI | 3 draggable slot labels (Key/BaseURL/Provider) in an amber-tinted card | REQUIREMENTS.md:52 "拖拽 Key/BaseURL/Provider 三个槽位" | yes |
| AutoReply node UI | timeout + message text in a cyan-tinted card, 1 input + 1 output Handle | REQUIREMENTS.md:53 "自动插入心跳消息" | yes |

## Findings (cited - path:lines)
- `prototype/REQUIREMENTS.md:92-122` — sidebar menu tree: 代理配置 (5 sub), 上游管理 (3 sub), 令牌管理 (0 sub), 规则引擎 (3 sub), 监控 (2 sub), 系统设置 (2 sub)
- `prototype/index.html:48-141` — 3 custom LiteGraph nodes: EndpointNode (blue), RouteNode (green), ChannelNode (purple)
- `prototype/index.html:155-198` — demo topology: ep1→route1→ch1/ch2, ep2→route2→ch3
- `prototype/server.py:1-152` — Python hot-reload server to be replaced by Vite
- `/tmp/tweakcn-theme.json` — Minimal Neutral: dark bg=oklch(0.205 0 0), sidebar=oklch(0.269 0 0), primary=oklch(0.922 0 0), radius=1rem, font=DM Sans
- `prototype/app/` — existing Vite React scaffold, @xyflow/react already installed

## Decisions (with rationale)
1. **React Flow over LiteGraph**: CSS-variable theming, DOM-based custom nodes, built-in dark mode support. User explicitly approved the switch.
2. **Minimal Neutral dark theme**: Clean monochrome palette matches hapiy's developer-tool aesthetic. Tweakcn provides full CSS variable coverage (52 dark + 9 theme + 53 light fallback).
3. **Plain CSS, no Tailwind**: Prototype stage; avoids adding Tailwind as a dependency. Tweakcn CSS variables work directly in vanilla CSS.
4. **Vite HMR replaces Python server**: Vite has superior HMR (instant, no polling), and we're already in a Vite project.

## Scope IN
- React + React Flow project at `prototype/app/`
- Collapsible sidebar with 7 menu items + sub-items
- React Flow canvas with 5 custom node types
- Demo topology (2 EP → 2 Route → 3 Channel)
- Minimal Neutral dark theme (all CSS variables)
- DM Sans + Geist Mono Google Fonts
- Updated start.sh for Vite dev server
- Responsive: sidebar collapses, canvas fills remaining space

## Scope OUT (Must NOT have)
- No TypeScript (keep JSX)
- No Tailwind
- No backend API calls
- No real routing logic
- No form components on other pages (placeholder only)
- No auto-switch / auto-reply functional logic (UI only)
- No dark/light toggle (dark only)
- No tests (prototype stage, visual verification only)

## Open questions
(none — all forks resolved)

## Approval gate
status: approved