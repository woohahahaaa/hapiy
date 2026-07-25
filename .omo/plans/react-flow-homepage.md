# react-flow-homepage - Work Plan

> Historical plan: This file records the implementation plan at that time. The current sources of truth are `prototype/app/DESIGN.md` and `prototype/app/src/components/Sidebar.jsx`. The old 200/48 sidebar sizes, old menu references, and node-count acceptance criteria below are superseded.

## TL;DR (For humans)

**What you'll get:** 一个带深色主题的 React 首页——左侧可折叠侧边栏（6 项菜单 + 子菜单展开），右侧 React Flow 节点画布，展示完整的代理路由拓扑（Endpoint → Route → Channel + 自动切换节点），Minimal Neutral 极简单色系配色。

**Why this approach:** React Flow 的 CSS 变量主题系统让深色主题几乎零成本实现，自定义节点用 React 组件写比 LiteGraph 的 Canvas 绘图干净十倍。Vite HMR 直接用，不需要 Python 轮询。

**What it will NOT do:** 没有后端对接，没有真实路由逻辑，其他页面的表单/表格都是空壳，自动切换/自动回复只是视觉占位不做功能。

**Effort:** Short（6 个 todo，两波并行执行）
**Risk:** Low — 纯前端原型，无破坏性操作
**Decisions to sanity-check:** 侧边栏默认展开 vs 收起；自动切换/自动回复节点的 UI 设计（目前基于需求文档的定义，没有视觉参考）

Your next move: approve, or run a high-accuracy review. Full execution detail follows below.

---

> TL;DR (machine): Short, Low risk, 6 todos in 2 waves → React Flow homepage with Minimal Neutral dark theme + collapsible sidebar + demo topology

## Scope
### Must have
- C1: Vite React project at `prototype/app/` with `@xyflow/react` installed, vite.config on 0.0.0.0:28001
- C2: Minimal Neutral dark CSS variables (52 dark + 9 theme + light fallback) injected into the app
- C3: Collapsible sidebar (200px→48px) with 6-item menu tree per REQUIREMENTS.md:92-122
- C4: React Flow canvas with 5 custom node types: Endpoint, Route, Channel, AutoSwitch, AutoReply
- C5: Demo topology: 2 Endpoints → 2 Routes → 3 Channels + 1 AutoSwitch attached
- DM Sans + Geist Mono Google Fonts loaded
- Updated `start.sh` shell script calling Vite dev server
- Responsive: sidebar collapses, canvas fills remaining space

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No TypeScript (keep JSX)
- No Tailwind CSS (plain CSS with Tweakcn variables)
- No backend API calls
- No real routing logic
- No form components on other pages (placeholder only)
- No auto-switch / auto-reply functional logic (visual nodes only)
- No dark/light toggle (dark only)
- No tests (prototype stage, visual verification only)
- No CSS-in-JS / styled-components / CSS modules
- No extra npm dependencies beyond react, react-dom, @xyflow/react

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: none (prototype, visual verification only)
- Evidence: Playwright screenshots at .omo/evidence/react-flow-homepage/ after each wave
- Every todo: `lsp_diagnostics` on changed files, Vite build pass, visual check via Playwright

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

**Wave 1 (parallel, no dependencies):** C1 + C2 + C3 + C4
- T1: Project setup (vite.config, start.sh, clean Vite boilerplate)
- T2: Theme system (CSS variables, fonts, base styles)
- T3: Sidebar component (collapsible, menu tree, icons)
- T4: Custom React Flow nodes (Endpoint, Route, Channel, AutoSwitch, AutoReply)

**Wave 2 (after Wave 1):** C5
- T5: App shell (sidebar + canvas layout, responsive)
- T6: Demo topology (2 EP → 2 R → 3 CH + auto-switch placeholder)

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| T1 | — | T5, T6 | T2, T3, T4 |
| T2 | — | T5, T6 | T1, T3, T4 |
| T3 | — | T5 | T1, T2, T4 |
| T4 | — | T6 | T1, T2, T3 |
| T5 | T1, T2, T3 | T6 | — |
| T6 | T4, T5 | — | — |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Project setup: configure vite.config, update start.sh, clean Vite boilerplate
  What to do / Must NOT do: Configure vite.config.js to serve on 0.0.0.0:28001. Update start.sh to run `npm run dev` in prototype/app/. Delete Vite boilerplate: App.css contents, App.jsx contents (keep file), logo.svg, react.svg. Keep index.html, main.jsx, index.css (empty for now). Do NOT install any new npm packages beyond what's already there.
  Parallelization: Wave 1 | Blocked by: — | Blocks: T5, T6
  References: prototype/app/vite.config.js:1-7, prototype/start.sh:1-17, prototype/app/src/App.jsx, prototype/app/src/App.css, prototype/app/src/index.css, prototype/app/src/main.jsx
  Acceptance criteria: `npm run dev` starts on 0.0.0.0:28001. `npm run build` exits 0. No Vite boilerplate visible in browser.
  QA scenarios: happy — `curl -s http://localhost:28001` returns HTML with `<div id="root">`. failure — `lsof -i :28001` shows PID. Evidence .omo/evidence/react-flow-homepage/t1-build.txt
  Commit: Y | chore(prototype): configure Vite dev server, clean boilerplate

- [x] 2. Theme system: inject Minimal Neutral dark CSS variables + Google Fonts
  What to do / Must NOT do: Write all 52 dark CSS variables + 9 theme variables + light fallback (tracking-normal) into index.css as `:root` block. Add DM Sans + Geist Mono Google Fonts link to index.html with `font-display: swap` + `preconnect`. Set `color-scheme: dark`. Set body background/font defaults. Do NOT add Tailwind. Do NOT skip any CSS variable. Use the exact oklch() values from theme.json.
  Parallelization: Wave 1 | Blocked by: — | Blocks: T5, T6
  References: prototype/app/index.html, prototype/app/src/index.css, prototype/app/src/theme.json (dark: 52 items, theme: 9 items, light fallback: tracking-normal=0em)
  Acceptance criteria: Browser renders dark background (oklch(0.205 0 0)). DM Sans font applied to body. All 61 CSS variables present in computed styles.
  QA scenarios: happy — Playwright screenshot shows dark background, DM Sans text. failure — Open DevTools: missing CSS variable causes fallback to serif. Evidence .omo/evidence/react-flow-homepage/t2-theme.png
  Commit: Y | style(prototype): add Minimal Neutral dark theme, DM Sans + Geist Mono fonts

- [x] 3. Sidebar: collapsible sidebar with 6-item menu tree
  What to do / Must NOT do: Create src/components/Sidebar.jsx and src/components/Sidebar.css. Implement collapsible sidebar (200px expanded → 48px collapsed). 6 menu items with sub-items per REQUIREMENTS.md:92-122. Active state highlighting with sidebar-primary color. Collapse toggle button in sidebar footer. Use Tweakcn sidebar CSS variables for colors. Must NOT implement page routing — clicking nav items just sets active state. Must NOT use any icon library — use unicode/emoji or simple SVG shapes.
  Parallelization: Wave 1 | Blocked by: — | Blocks: T5
  References: prototype/REQUIREMENTS.md:92-122 (menu tree), prototype/app/src/theme.json (sidebar: oklch(0.269 0 0), sidebar-foreground: oklch(0.985 0 0), sidebar-primary: oklch(0.488 0.243 264.376), sidebar-accent: oklch(0.269 0 0), sidebar-border: oklch(0.275 0 0), sidebar-ring: oklch(0.439 0 0))
  Acceptance criteria: Sidebar renders 6 items. Clicking collapse button toggles 200px↔48px. Active item has sidebar-primary left border. Sub-items expand/collapse on click.
  QA scenarios: happy — Playwright screenshot: sidebar expanded with 代理配置 active. failure — Click collapse: sidebar shrinks to 48px, icons remain. Evidence .omo/evidence/react-flow-homepage/t3-sidebar.png
  Commit: Y | feat(prototype): add collapsible sidebar with menu tree

- [x] 4. Custom React Flow nodes: Endpoint, Route, Channel, AutoSwitch, AutoReply
  What to do / Must NOT do: Create src/nodes/ directory with 5 node components + CSS. Each node is a React component using React Flow's Handle for inputs/outputs. Use Tweakcn CSS variables for colors. Endpoint=blue-ish primary, Route=green-ish, Channel=purple-ish, AutoSwitch=amber, AutoReply=cyan. Each node shows its type label, key properties, and status indicator. Must NOT implement any functional logic — visual only. Must NOT use canvas API — pure CSS + React.
  Parallelization: Wave 1 | Blocked by: — | Blocks: T6
  References: prototype/index.html:48-141 (existing LiteGraph node shapes/properties for Endpoint/Route/Channel), prototype/REQUIREMENTS.md:44-53 (node descriptions + AutoSwitch specs: 拖拽 Key/BaseURL/Provider 三个槽位; AutoReply specs: 超时时间 + 自动插入消息). Endpoint: name, model, status. Route: name, rule, priority. Channel: name, provider, url, latency. AutoSwitch: 3 slot labels (Key, BaseURL, Provider), amber tint. AutoReply: timeout, message, cyan tint, 1 input + 1 output Handle.
  Acceptance criteria: All 5 node types render in React Flow. Each shows correct properties. Handles appear on hover. Nodes are draggable.
  QA scenarios: happy — Playwright screenshot: Endpoint node with "GPT 入口" label, blue tint. failure — Missing Handle import causes nodes to not connect. Evidence .omo/evidence/react-flow-homepage/t4-nodes.png
  Commit: Y | feat(prototype): add custom React Flow nodes (Endpoint, Route, Channel, AutoSwitch, AutoReply)

- [x] 5. App shell: sidebar + React Flow canvas layout
  What to do / Must NOT do: Rewrite App.jsx with Sidebar + ReactFlow components. App.css: flex layout, sidebar on left, canvas fills remaining space. ReactFlow component with dark background, minimap, controls. nodeTypes registration. Must NOT hardcode demo nodes — they go in T6. Must NOT add page routing.
  Parallelization: Wave 2 | Blocked by: T1, T2, T3 | Blocks: T6
  References: prototype/app/src/App.jsx, prototype/app/src/App.css, prototype/REQUIREMENTS.md:19-38 (layout diagram)
  Acceptance criteria: Page renders sidebar + canvas. Sidebar collapses, canvas reflows. React Flow controls visible (bottom-right). Minimap visible (bottom-left).
  QA scenarios: happy — Playwright screenshot: sidebar on left, dark canvas with minimap on right. failure — Sidebar overlap on canvas. Evidence .omo/evidence/react-flow-homepage/t5-layout.png
  Commit: Y | feat(prototype): wire sidebar + React Flow canvas layout

- [x] 6. Demo topology: 2 Endpoints → 2 Routes → 3 Channels, wired
  What to do / Must NOT do: Create src/data/demoTopology.js with initialNodes and initialEdges. Replicate existing LiteGraph demo: ep1 (GPT 入口, gpt-4o/gpt-4o-mini, active) → route1 (优先路由, model contains 'gpt-4o', priority 1) → ch1 (OpenAI 官方, 230ms) + ch2 (Azure OpenAI, 180ms). ep2 (Claude 入口, claude-3.5-sonnet, active) → route2 (Claude 路由, model contains 'claude', priority 2) → ch3 (Anthropic, 310ms). Add one AutoSwitch node attached to route1. Must NOT connect AutoReply node (leave it unconnected as placeholder). Position nodes in a left-to-right layout.
  Parallelization: Wave 2 | Blocked by: T4, T5 | Blocks: —
  References: prototype/index.html:155-198 (existing demo layout), prototype/REQUIREMENTS.md:44-53 (node descriptions)
  Acceptance criteria: 6 nodes visible on canvas. Edges rendered between EP→Route→Channel. AutoSwitch node attached to route1. Nodes are draggable. Connections have arrows.
  QA scenarios: happy — Playwright screenshot: full topology visible, edges connected. failure — Node positions overlap or edges missing. Evidence .omo/evidence/react-flow-homepage/t6-demo.png
  Commit: Y | feat(prototype): add demo topology with auto-switch placeholder

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit: all 6 todos completed, no scope creep
- [x] F2. Vite build check: `npm run build` exits 0
- [x] F3. Visual QA: Playwright screenshot of full page — sidebar + demo topology + dark theme
- [x] F4. Scope fidelity: no TypeScript, no Tailwind, no backend, no routing, no tests added

## Commit strategy
- One commit per todo (6 commits total)
- Commit after each todo passes acceptance criteria
- Format: `<type>(prototype): <summary>`

## Success criteria
- [x] Page loads at http://0.0.0.0:28001 with dark theme
- [x] Sidebar shows 6 menu items, collapsible
- [x] Canvas shows 6+ nodes with connections
- [x] Nodes are draggable, zoomable, connectable
- [x] Minimal Neutral theme visually matches Tweakcn reference
- [x] DM Sans font renders on all text
- [x] `npm run build` exits 0
- [x] `./start.sh` starts the dev server
