# provider-slot-workflow - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** 每个 Provider 创建后自动生成 6 个固定顺序的插槽，用户往插槽里加规则节点、拖拽调整执行顺序；双击画布或点右下按钮添加节点；同名 Provider 可建多个但只能启一个。

**Why this approach:** 固定插槽消除用户判断该往哪放的心智负担；蚂蚁线空框加大加号一眼可见；串行 index 执行逻辑简单、冲突顺序执行直接报错；复用已有的 topology_configs 表不改数据库结构。

**What it will NOT do:** 不自动纠正错误节点放置、不改动现有4种策略规则、不引入新UI库、不做实际管道运行引擎。

**Effort:** Large (22 个 Todo, 6 波顺序执行)
**Risk:** Low — 无破坏性已有功能变更
**Decisions to sanity-check:** 插槽持久化用 topology_configs 表；Provider 冲突用 Toast 而非弹窗；模型节点跨 Provider 共享去重。

Your next move: 说 **start work** 开始执行，或 **review** 先让 Momus 双审。

---

> TL;DR (machine): Large, 22 todos 6 waves, backend Go + frontend React/TS, TDD with Vitest + Playwright E2E

## Scope
### Must have
1. **Response Rewrite** strategy type: new `rewrite-response` tab in PolicyPage, backend CRUD routes, sidebar entry
2. **Log Output node**: renamed from Debug, with fields (target/level/path/enable) + conditional multi-select for record content
3. **6 fixed slots per Provider**: order = ①requestModify ②responseModify ③autoReply ④concurrency ⑤autoSwitch ⑥logOutput
4. **SlotContainer UI**: ant-line dashed border frame, "+" button, inner nodes with 1-based index badges, drag-to-reorder, red error box on failure
5. **Node addition UX**: double-click empty canvas → categorized popup at click point; bottom-right "+" button → popup at canvas center
6. **Provider 3B rule**: same-name Provider multiple instances allowed, only one active; switch click on second instance → Toast "当前已有一个在启用，要把另一个先关掉" + switch stays OFF
7. **Model group**: simplified ModelHub per Provider (no title, no count line), group-drag (all model nodes move together), cross-Provider model dedup
8. **Topology slot persistence**: slot config saved to/loaded from `topology_configs` table JSON

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Do NOT create any new backend tables beyond response_rewrite_rules and the topology_configs extension
- Do NOT change the existing rewrite/heartbeat/concurrency/failover rule CRUD APIs
- Do NOT add auto-correction of invalid node placement — show error, user fixes manually
- Do NOT modify the existing node components (Channel, AutoReply, AutoSwitch, Concurrency, ModelHub, RequestModify) beyond the scope of this plan
- Do NOT add real-time runtime execution logic (pipeline execution is a separate feature)
- Do NOT change the current dark-only theme setup
- Do NOT introduce new UI libraries (no second notification library, no drag-and-drop library beyond what React Flow provides)

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: **TDD** — Vitest for unit/component tests, Playwright for E2E
- Every todo: red → green → refactor; test file created before implementation file
- Evidence: .omo/evidence/task-<N>-provider-slot-workflow.<ext>
- Unit/component tests run via `npm test` (vitest); E2E via Playwright MCP
- Coverage gate: every new component has at least happy-path + one failure/edge case
- Build gate: `npm run typecheck && npm run build` must pass before marking any todo done

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

| Wave | Name | Todos | Depends on |
|------|------|-------|------------|
| 0 | Backend foundation | T0.1–T0.3 | Nothing |
| 1 | Types + shared infra | T1.1–T1.5 | Wave 0 |
| 2 | PolicyPage response rewrite | T2.1–T2.2 | Wave 1 |
| 3 | Slot UI components | T3.1–T3.4 | Wave 1 |
| 4 | TopologyPage refactor | T4.1–T4.6 | Wave 1 + 3 |
| 5 | Node addition UX | T5.1–T5.3 | Wave 4 |
| 6 | Integration + E2E | T6.1–T6.3 | Wave 5 |

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| T0.1 | — | T0.2, T1.3 | — |
| T0.2 | T0.1 | T1.3 | — |
| T0.3 | — | T4.6 | T0.1, T0.2 |
| T1.1 | T0.2 | T1.4, T1.5, T3.x, T4.x | T1.2 |
| T1.2 | — | T1.3, T2.x, T4.x | T1.1 |
| T1.3 | T1.2, T0.2 | T2.x, T4.x | T1.4, T1.5 |
| T1.4 | T1.1 | T3.x, T4.x | T1.5 |
| T1.5 | T1.1 | T3.x, T4.x, T8(C8) | T1.4 |
| T2.1 | T1.3 | T2.2 | — |
| T2.2 | T2.1 | T6.3 | — |
| T3.1 | T1.1, T1.4, T1.5 | T3.2, T4.x | T3.3 |
| T3.2 | T3.1 | T4.x | T3.4 |
| T3.3 | T3.1, T3.2 | — | — |
| T3.4 | T3.1 | T4.x | T3.2 |
| T4.1 | T1.1, T3.1, T3.2 | T4.2, T5.x | T4.3 |
| T4.2 | T4.1 | T5.x | T4.4 |
| T4.3 | T1.1 | T6.2 | T4.1 |
| T4.4 | T1.1 | T4.5 | T4.2 |
| T4.5 | T4.4 | — | — |
| T4.6 | T0.3, T4.1 | T6.x | T4.5 |
| T5.1 | T4.1 | T5.2, T5.3 | — |
| T5.2 | T5.1 | T6.1 | T5.3 |
| T5.3 | T5.1 | T6.1 | T5.2 |
| T6.1 | T5.2, T5.3 | — | T6.2, T6.3 |
| T6.2 | T4.3 | — | T6.1, T6.3 |
| T6.3 | T2.2 | — | T6.1, T6.2 |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->

### Wave 0: Backend Foundation

 - [ ] 1. Add `response_rewrite_rules` database table migration
  What to do: Create a new GORM model `ResponseRewriteRule` in `project/backend/internal/model/models.go` with fields: ID (uuid, PK), Name (string, not null), Script (text), Status (bool, default true), CreatedAt, UpdatedAt. Add `BeforeCreate` hook for auto-uuid. Run auto-migration.
  Must NOT do: Do NOT modify any existing model structs or change existing migration logic.
  Parallelization: Wave 0 | Blocked by: — | Blocks: T0.2, T1.3
  References: `project/backend/internal/model/models.go:99-112` (RewriteRule as template), `project/backend/internal/model/db.go` (auto-migrate registration)
  Acceptance criteria (agent-executable): `go build ./...` passes; new table exists in SQLite (verify via `sqlite3 hapiy.db ".schema response_rewrite_rules"` shows the table)
  QA scenarios: Happy — model compiles and auto-migrates without error. Failure — duplicate migration does not crash (GORM AutoMigrate idempotent).
  Evidence: .omo/evidence/task-0.1-provider-slot-workflow.txt (go build output + schema dump)
  Commit: Y | feat(backend): add response_rewrite_rules model and migration

 - [ ] 2. Implement response rewrite CRUD API routes
  What to do: In `project/backend/internal/api/`, create handler file for `GET/POST /api/rules/rewrite-response` (list + create) and `PUT/DELETE /api/rules/rewrite-response/:id` (update + delete). Register routes in the router. Parse/validate JSON body matching `ResponseRewriteRule` fields. Use existing GORM pattern.
  Must NOT do: Do NOT break existing rule routes (rewrite, heartbeat, concurrency, failover). Do NOT change the URL prefix structure.
  Parallelization: Wave 0 | Blocked by: T0.1 | Blocks: T1.3
  References: `project/backend/internal/api/` (existing rule handlers), `project/backend/internal/model/models.go:99-105` (RewriteRule struct as pattern), existing route registration in main/router
  Acceptance criteria (agent-executable): `curl -X GET http://localhost:8080/api/rules/rewrite-response` returns `[]` (empty array); `curl -X POST http://localhost:8080/api/rules/rewrite-response -d '{"name":"test","script":"","status":true}'` returns 201 with created record; `curl -X DELETE http://localhost:8080/api/rules/rewrite-response/<id>` returns 204
  QA scenarios: Happy — full CRUD cycle (create → list → update → delete → list empty). Failure — missing name field returns 400; invalid id returns 404.
  Evidence: .omo/evidence/task-0.2-provider-slot-workflow.txt (curl output for each endpoint)
  Commit: Y | feat(backend): add response_rewrite_rules CRUD API

 - [ ] 3. Extend topology_configs JSON schema for slot data
  What to do: Define TypeScript-level shape for the slot configuration JSON stored in `topology_configs.nodes`. Each entry keyed by provider ID: `{ providerId: string, slots: { slotType: string, nodes: { index: number, ruleId: string }[] }[] }`. Document the schema in a comment in `project/web/src/stores/types.ts`. Backend does not need to validate this JSON—it's stored as raw text.
  Must NOT do: Do NOT add backend validation logic for the slot JSON structure—frontend is the sole consumer/producer.
  Parallelization: Wave 0 | Blocked by: — | Blocks: T4.6
  References: `project/backend/internal/model/models.go:166-173` (TopologyConfig model), `project/web/src/stores/types.ts:100-126` (TopologyNode/TopologyEdge interfaces)
  Acceptance criteria (agent-executable): TypeScript interface compiles; shape expressed as a `TopologySlotConfig` type in `stores/types.ts`
  QA scenarios: Happy — interface has: `providerId: string`, `slots: SlotDef[]`, `SlotDef: { type: SlotType, nodes: SlotNode[] }`. Failure — missing required fields flagged by tsc.
  Evidence: .omo/evidence/task-0.3-provider-slot-workflow.txt (tsc output)
  Commit: Y | feat(web): define TopologySlotConfig type

### Wave 1: Types + Shared Infrastructure

 - [ ] 4. Update NodeType union and PolicyRules interface
  What to do: In `project/web/src/stores/types.ts` — Add `'responseModify'` and rename `'debug'` to `'logOutput'` in `NodeType` (line 108). Add `responseRewrite: ResponseRewriteRule[]` to `PolicyRules` (line 43). Import new `ResponseRewriteRule` interface.
  Must NOT do: Do NOT remove any existing NodeType values. Keep `'endpoint'` as-is (unused, not in scope).
  Parallelization: Wave 1 | Blocked by: T0.2 | Blocks: T1.4, T1.5, T3.x, T4.x
  References: `project/web/src/stores/types.ts:108-116` (NodeType), `project/web/src/stores/types.ts:43-48` (PolicyRules)
  Acceptance criteria (agent-executable): `npm run typecheck` passes; `NodeType` union now includes `'responseModify' | 'logOutput'`
  QA scenarios: Happy — type compiles. Failure — using old `'debug'` type name in any remaining TS file would fail typecheck (verify no references remain).
  Evidence: .omo/evidence/task-1.1-provider-slot-workflow.txt (tsc --noEmit output)
  Commit: Y | feat(web): add responseModify and logOutput to NodeType, responseRewrite to PolicyRules

 - [ ] 5. Add `ResponseRewriteRule` TypeScript type + update RuleType union + expand RulesData
  What to do: In `project/web/src/lib/dashboard-api.ts`, add `ResponseRewriteRule` interface (fields: id, name, script, status). Add `'rewrite-response'` to the `RuleType` union (line 346). Add `ruleParserForType` and `ruleSerializerForType` cases for `'rewrite-response'`. In TopologyPage, expand `RulesData` to include `readonly responseRewrite: readonly ResponseRewriteRule[]`.
  Must NOT do: Do NOT change existing rule parsers/serializers.
  Parallelization: Wave 1 | Blocked by: — | Blocks: T1.3, T2.x, T4.x
  References: `project/web/src/lib/dashboard-api.ts:346` (RuleType), `project/web/src/lib/dashboard-api.ts:557-576` (listRules/createRule/updateRule/deleteRule), `project/web/src/pages/TopologyPage.tsx:92-97` (RulesData)
  Acceptance criteria (agent-executable): `npm run typecheck` passes; `dashboardApi.listRules<ResponseRewriteRule>('rewrite-response')` type-checks
  QA scenarios: Happy — new rule type compiles and parser serializes correctly. Failure — providing unknown rule type returns a compile error.
  Evidence: .omo/evidence/task-1.2-provider-slot-workflow.txt (tsc output)
  Commit: Y | feat(web): add ResponseRewriteRule type and 'rewrite-response' to RuleType

 - [ ] 6. Add `dashboardApi` methods for response rewrite rules
  What to do: Expose `listRewriteResponses`, `createRewriteResponse`, `updateRewriteResponse`, `deleteRewriteResponse` on `dashboardApi` object. Use existing `request()` helper and `parseResponseRewriteRule` parser. Follow the exact pattern of rewrite rules at `dashboard-api.ts:557-576`.
  Must NOT do: Do NOT invent new request helpers — reuse existing `request()` and `parseJson()`.
  Parallelization: Wave 1 | Blocked by: T1.2, T0.2 | Blocks: T2.x, T4.x
  References: `project/web/src/lib/dashboard-api.ts:557-576` (existing rule CRUD pattern), `project/web/src/lib/dashboard-api.ts:490-510` (API object shape)
  Acceptance criteria (agent-executable): Unit test: mock fetch to return `[{id:"1",name:"test",script:"",status:true}]`, call `listRewriteResponses()` → returns parsed array. `npm test` passes.
  QA scenarios: Happy — list returns parsed array. Failure — server returns non-array → throws DashboardApiError.
  Evidence: .omo/evidence/task-1.3-provider-slot-workflow.txt (vitest output)
  Commit: Y | test(web): add dashboardApi response rewrite tests + implementation

 - [ ] 7. Create ResponseModifyNode component
  What to do: Create `project/web/src/nodes/ResponseModifyNode.tsx`. Copy structure from `RequestModifyNode.tsx` (same layout: header with label, body with rule list, footer with count, source/target Handles), but change label to "响应改写" and icon context to response-oriented. Use `border-border` for all borders, `bg-card text-card-foreground` for card. Register in `nodeTypes` of TopologyPage.
  Must NOT do: Do NOT copy the exact transforms interface — response rules have different shape than request rules.
  Parallelization: Wave 1 | Blocked by: T1.1 | Blocks: T3.x, T4.x
  References: `project/web/src/nodes/RequestModifyNode.tsx:1-87` (template), `project/web/src/pages/TopologyPage.tsx:32-39` (nodeTypes registration)
  Acceptance criteria (agent-executable): Component unit test: renders with label "响应改写", renders rule list when data has transforms. `npm test` passes.
  QA scenarios: Happy — renders with data. Failure — missing data renders "No transforms configured" fallback.
  Evidence: .omo/evidence/task-1.4-provider-slot-workflow.txt (vitest output)
  Commit: Y | feat(web): add ResponseModifyNode component and register in nodeTypes

 - [ ] 8. Rename DebugNode → LogOutputNode and update its fields
  What to do: Rename `DebugNode.tsx` to `LogOutputNode.tsx`. Update interface: `LogOutputNodeData` with fields: `label` (default="日志输出"), `sourceIds`, `enabled`, `logTarget` ('file'|'console'|'both'), `logLevel` ('info'|'warn'|'error'), `logPath` (string), `recordContent` ({ requestBefore: bool, requestAfter: bool, responseBefore: bool, responseAfter: bool }), `hasRequestRewrite` (bool, controls requestAfter availability), `hasResponseRewrite` (bool, controls responseAfter availability). UI: remove old checkbox grid, replace with: Switch (enable), Select (target), Select (level), Input (path), CheckboxGroup (record content, 4 checkboxes, grey out if not available). Register in nodeTypes as `logOutput`.
  Must NOT do: Do NOT keep old field names. Do NOT register as 'debug'.
  Parallelization: Wave 1 | Blocked by: T1.1 | Blocks: T3.x, T4.x
  References: `project/web/src/nodes/DebugNode.tsx:1-119` (source), `project/web/src/pages/TopologyPage.tsx:32-39` (nodeTypes)
  Acceptance criteria (agent-executable): Unit test: renders with new fields, greyed-out checkboxes work when availability flag is false. `npm test` passes.
  QA scenarios: Happy — "请求修改后" checkbox greyed out when `hasRequestRewrite=false`. Failure — all checkboxes enabled regardless of availability would fail. Typecheck passes.
  Evidence: .omo/evidence/task-1.5-provider-slot-workflow.txt (vitest output)
  Commit: Y | refactor(web): rename DebugNode to LogOutputNode with updated fields

### Wave 2: PolicyPage Response Rewrite

 - [ ] 9. Add RewriteResponsePage + RewriteResponseForm to PolicyPage
  What to do: In `PolicyPage.tsx`, add new component `RewriteResponsePage` following the exact pattern of `RewritePage` (line 209). Use `useRulesApi<ResponseRewriteRule>('rewrite-response')`. Add `RewriteResponseForm` following `RewriteForm` pattern (line 320): fields for name, script (textarea), status. Hook into `handleToggle`, `handleDelete`, `handleSave` identical to existing pages.
  Must NOT do: Do NOT refactor existing page components. Do NOT change the shared `useRulesApi` hook signature.
  Parallelization: Wave 2 | Blocked by: T1.3 | Blocks: T2.2
  References: `project/web/src/pages/PolicyPage.tsx:209-320` (RewritePage + RewriteForm as exact template), `project/web/src/pages/PolicyPage.tsx:52-119` (useRulesApi hook)
  Acceptance criteria (agent-executable): Unit test: component renders table with CRUD buttons. `npm test` passes. `npm run typecheck` passes.
  QA scenarios: Happy — render with 2 response rewrite rules shows 2 rows with toggle/delete. Failure — API error shows error banner.
  Evidence: .omo/evidence/task-2.1-provider-slot-workflow.txt (vitest output)
  Commit: Y | feat(web): add RewriteResponsePage and RewriteResponseForm to PolicyPage

 - [ ] 10. Wire response rewrite route + sidebar entry
  What to do: In `PolicyPage.tsx:37-48`, add condition `activeTab === 'rewrite-response' && <RewriteResponsePage />`. In `Sidebar.tsx:85-90`, add sub-item `{ id: 'rewrite-response', label: '响应改写', href: '/policy/rewrite-response' }` under the policy group. In `App.tsx:24`, router already handles `/policy/:type` — no change needed.
  Must NOT do: Do NOT add a new route in App.tsx — existing `/policy/:type` already handles it.
  Parallelization: Wave 2 | Blocked by: T2.1 | Blocks: T6.3
  References: `project/web/src/pages/PolicyPage.tsx:37-48` (tab routing), `project/web/src/components/Sidebar.tsx:82-90` (policy sub-menu), `project/web/src/App.tsx:24` (route)
  Acceptance criteria (agent-executable): `npm run build` passes. Navigate to `/policy/rewrite-response` → renders RewriteResponsePage.
  QA scenarios: Happy — sidebar click navigates to response rewrite page. Failure — sidebar entry missing or wrong href.
  Evidence: .omo/evidence/task-2.2-provider-slot-workflow.png (Playwright screenshot of the page)
  Commit: Y | feat(web): add response rewrite route and sidebar navigation

### Wave 3: Slot UI Components

 - [ ] 11. Create SlotContainer component (ant-line frame + "+" button)
  What to do: Create `project/web/src/components/topology/SlotContainer.tsx`. Renders a `<div>` with Tailwind `border-2 border-dashed border-border rounded-lg p-4`. Inside: slot title (`<span>` with `text-sm font-medium text-muted-foreground`), a large `+` button (centered, `size-12`, `variant="ghost"`) that triggers `onAddNode` callback. When children exist, render them in a vertical flex list above the `+` button. Props: `title: string`, `slotType: SlotType`, `onAddNode: () => void`, `children?: ReactNode`.
  Must NOT do: Do NOT couple SlotContainer to any specific node type — it's a generic container.
  Parallelization: Wave 3 | Blocked by: T1.1, T1.4, T1.5 | Blocks: T3.2, T4.x
  References: New file, no existing reference. Follow shadcn/ui patterns from `project/web/src/components/ui/`.
  Acceptance criteria (agent-executable): Unit test: renders title and "+" button; clicking "+" calls onAddNode. `npm test` passes.
  QA scenarios: Happy — renders dashed border, title "请求改写", and "+" button. Failure — missing onAddNode prop does not crash (optional callback).
  Evidence: .omo/evidence/task-3.1-provider-slot-workflow.txt (vitest output)
  Commit: Y | feat(web): add SlotContainer component with ant-line frame

 - [ ] 12. Create SlotNodeItem component (indexed inner node with handles)
  What to do: Create `project/web/src/components/topology/SlotNodeItem.tsx`. Renders each node inside a slot: a compact card showing rule name + index badge (small circle with number, `bg-muted text-muted-foreground`), a delete button (`X` icon). Has source/target React Flow Handles for connecting to adjacent slots. Props: `index: number`, `ruleName: string`, `onDelete: () => void`, `sourceIds?: string[]`, color scheme uses `bg-card` `border-border`.
  Must NOT do: Do NOT render Handles if this is the last slot (logOutput slot has no source handle). Use `showSourceHandle` prop.
  Parallelization: Wave 3 | Blocked by: T3.1 | Blocks: T4.x
  References: `project/web/src/nodes/RequestModifyNode.tsx:36-87` (Handle rendering pattern), `project/web/src/components/ui/badge.tsx` (Badge component)
  Acceptance criteria (agent-executable): Unit test: renders index badge "1", rule name, and delete button. Clicking delete calls onDelete. `npm test` passes.
  QA scenarios: Happy — renders with index badge and source/target handles. Failure — no index prop renders no badge.
  Evidence: .omo/evidence/task-3.2-provider-slot-workflow.txt (vitest output)
  Commit: Y | feat(web): add SlotNodeItem component for slot-internal nodes

 - [ ] 13. Implement drag-to-reorder within a slot
  What to do: In `SlotContainer`, implement drag-to-reorder using React Flow's built-in `onNodeDrag` or manual mouse event handlers. When a `SlotNodeItem` is dragged vertically past another, swap their `index` values and call `onReorder(fromIndex, toIndex)`. Visual feedback: dragged item gets `opacity-50 scale-95` during drag. Use `useRef` for drag state. No external drag library needed.
  Must NOT do: Do NOT use `react-dnd` or any external drag library. Use native mouse events or React Flow's API only.
  Parallelization: Wave 3 | Blocked by: T3.1, T3.2 | Blocks: —
  References: MDN Drag and Drop API, React Flow `onNodeDrag` docs
  Acceptance criteria (agent-executable): Component test: mock drag from index 2 to index 1 → onReorder(2, 1) called. `npm test` passes.
  QA scenarios: Happy — drag item from position 3 to position 1, indices update to 1, 2, 3. Failure — drag outside slot bounds cancels operation.
  Evidence: .omo/evidence/task-3.3-provider-slot-workflow.txt (vitest output)
  Commit: Y | feat(web): add drag-to-reorder within SlotContainer

 - [ ] 14. Create SlotErrorBox component
  What to do: Create `project/web/src/components/topology/SlotErrorBox.tsx`. Renders a collapsible red error box below the slot: `bg-destructive/10 border border-destructive/30 rounded-md p-2 text-xs text-destructive`. Shows a short summary (e.g. "规则执行失败"), click to expand and show full error details. Props: `error: string | null`, `onDismiss: () => void`.
  Must NOT do: Do NOT auto-dismiss errors — user must explicitly dismiss.
  Parallelization: Wave 3 | Blocked by: T3.1 | Blocks: T4.x
  References: `project/web/src/pages/ProviderPage.tsx:155-159` (error alert pattern)
  Acceptance criteria (agent-executable): Unit test: renders error message when `error` prop is non-null; clicking dismiss calls onDismiss. `npm test` passes.
  QA scenarios: Happy — renders red box with error text, expandable to show details. Failure — null error prop renders nothing.
  Evidence: .omo/evidence/task-3.4-provider-slot-workflow.txt (vitest output)
  Commit: Y | feat(web): add SlotErrorBox component

### Wave 4: TopologyPage Refactor

 - [ ] 15. Rewrite buildNodes for per-Provider slot system
  What to do: In `TopologyPage.tsx`, rewrite `buildNodes()` (line 109-220). New logic: for each active Provider, generate a `ModelGroupNode` (a parent group node, or an array of model nodes bound together), then 6 `SlotContainer` nodes in fixed order (requestModify → responseModify → autoReply → concurrency → autoSwitch → logOutput). Each slot node has `type: 'slot'` plus a `slotType` data field. Slots load their inner node list from topology_configs (via T4.6). Model group uses simplified `ModelHubNode` (from T4.4). Node IDs use pattern: `{providerId}-{slotType}`. Position calculation: use dagre-based cascading layout (each slot 250px to the right of previous, models 250px left of provider).
  Must NOT do: Do NOT keep the old single-global-pipeline logic. Do NOT create slots for inactive providers.
  Parallelization: Wave 4 | Blocked by: T1.1, T3.1, T3.2 | Blocks: T4.2, T5.x
  References: `project/web/src/pages/TopologyPage.tsx:109-220` (old buildNodes), `project/web/src/pages/TopologyPage.tsx:64-88` (getLayoutedElements for dagre pattern), `project/web/src/pages/TopologyPage.tsx:64-88` (NODE_W/NODE_H constants — add entries for slot + logOutput + responseModify)
  Acceptance criteria (agent-executable): Unit test: with 1 active Provider + 0 rules → returns 1 Provider node + 1 ModelGroup + 6 slots = 8 nodes. With 2 Providers → returns 2 Provider nodes + 2 ModelGroups + 12 slots. `npm test` passes.
  QA scenarios: Happy — correct node count with correct IDs. Failure — inactive provider generates 0 nodes.
  Evidence: .omo/evidence/task-4.1-provider-slot-workflow.txt (vitest output)
  Commit: Y | refactor(web): rewrite buildNodes for per-Provider slot system

 - [ ] 16. Rewrite buildEdges for slot pipeline wiring
  What to do: Rewrite `buildEdges()` (line 222-296). New logic: ModelGroup → Provider (one edge per model). Provider → first slot (requestModify). Each slot → next slot (requestModify → responseModify → autoReply → concurrency → autoSwitch → logOutput). All edges animated, `strokeWidth: 1.5`. Edge IDs: `{sourceId}:{slotType}→{targetId}:{slotType}`.
  Must NOT do: Do NOT create edges for inactive providers. Do NOT retain old failover primary/fallback edge logic (failover is now just a slot).
  Parallelization: Wave 4 | Blocked by: T4.1 | Blocks: T5.x
  References: `project/web/src/pages/TopologyPage.tsx:222-296` (old buildEdges), `project/web/src/pages/TopologyPage.tsx:41-43` (defaultEdgeOptions)
  Acceptance criteria (agent-executable): Unit test: with 1 Provider → 7 edges (1 Provider→slot1 + 5 inter-slot). No edges from inactive providers. `npm test` passes.
  QA scenarios: Happy — correct edge count with continuous flow. Failure — 2 providers each get independent slot chains (no cross-provider edges).
  Evidence: .omo/evidence/task-4.2-provider-slot-workflow.txt (vitest output)
  Commit: Y | refactor(web): rewrite buildEdges for slot pipeline wiring

 - [ ] 17. Implement Provider 3B rule: same-name detection + only-one-active + toast on conflict
  What to do: In `TopologyPage.tsx`, add logic in `loadData()` or a new `handleToggleProvider(providerId)` function: before toggling a provider ON, check if any other provider with the SAME `.name` is already active. If yes: show a Toast (using Sonner/toast from shadcn) with message "当前已有一个同名渠道在启用，请先将另一个关闭" and do NOT toggle this one (switch stays OFF). Otherwise, proceed with toggle. Note: Sonner is built into shadcn; import `toast` from `sonner` or use shadcn's toast.
  Must NOT do: Do NOT use alert() or confirm(). Do NOT allow the switch to toggle before the toast appears.
  Parallelization: Wave 4 | Blocked by: T1.1 (ChannelNode data needs provider name) | Blocks: T6.2
  References: `project/web/src/pages/TopologyPage.tsx:300-324` (loadData flow), `project/web/src/nodes/ChannelNode.tsx:74-79` (Switch onCheckedChange), shadcn toast documentation
  Acceptance criteria (agent-executable): Unit test: 2 providers same name, one active. Toggle second → returns false (no toggle), toast called. `npm test` passes.
  QA scenarios: Happy — toast appears, switch stays off. Failure — toggle succeeds despite conflict → test fails.
  Evidence: .omo/evidence/task-4.3-provider-slot-workflow.txt (vitest output)
  Commit: Y | feat(web): add Provider same-name only-one-active rule with toast

 - [ ] 18. Simplify ModelHubNode for provider model groups
  What to do: Either add a prop `simplified?: boolean` to existing `ModelHubNode` or create a wrapper. When simplified mode: hide the "模型中心" title span (line 30 in ModelHubNode.tsx), hide the footer with model count (line 56-58). Keep the model list with colored dots. Each model still has its own source Handle (line 45-50).
  Must NOT do: Do NOT remove model Handles — they still connect to Provider via the same handle IDs.
  Parallelization: Wave 4 | Blocked by: T1.1 | Blocks: T4.5
  References: `project/web/src/nodes/ModelHubNode.tsx:26-60` (current component)
  Acceptance criteria (agent-executable): Unit test: renders with `simplified={true}` → no title text, no "N models" footer, but model list visible. `npm test` passes.
  QA scenarios: Happy — simplified mode hides title and footer. Failure — simplified mode accidentally hides model list or handles.
  Evidence: .omo/evidence/task-4.4-provider-slot-workflow.txt (vitest output)
  Commit: Y | feat(web): add simplified mode to ModelHubNode

 - [ ] 19. Implement model group drag and cross-Provider dedup
  What to do: When dragging any model node within a Provider's ModelGroup, all sibling model nodes within that same group move by the same delta X/Y. Use React Flow's `onNodesChange` to detect position changes, then apply the same delta to other model nodes in the same group. For dedup: when building model nodes for Provider B, check if any model name already exists in Provider A's group — if yes, reuse the existing node ID instead of creating a duplicate. This means a single model node can have connections to multiple Providers.
  Must NOT do: Do NOT create duplicate model nodes with different IDs for the same model name. Dedup is by model name.
  Parallelization: Wave 4 | Blocked by: T4.4 | Blocks: —
  References: `project/web/src/pages/TopologyPage.tsx:114-147` (model building in buildNodes), `project/web/src/pages/TopologyPage.tsx:341-353` (nodes state + onNodesChange)
  Acceptance criteria (agent-executable): Unit test: create 2 Providers sharing model "gpt-4" → only 1 "gpt-4" model node with 2 edges to 2 Providers. Drag one model in group → all models in same group move by same delta. `npm test` passes.
  QA scenarios: Happy — shared model gets 2 outgoing edges. Drag test: model Y moves 50px right → model X also moves 50px right. Failure — duplicate model nodes created.
  Evidence: .omo/evidence/task-4.5-provider-slot-workflow.txt (vitest output)
  Commit: Y | feat(web): implement model group drag and cross-Provider dedup

 - [ ] 20. Implement topology slot persistence (load/save from topology_configs)
  What to do: Add `dashboardApi.getTopologyConfig()` and `dashboardApi.saveTopologyConfig(nodes)` methods. On initial load (in `loadData()`), fetch config alongside providers+rules. On any slot node addition/deletion/reorder, persist the updated slot config to `topology_configs` via the save API. Format: use the `TopologySlotConfig` type from T0.3. Use debounce (300ms) to avoid excessive saves. For the backend, add a simple GET/PUT endpoint for `/api/topology-config` that reads/writes the `topology_configs` table row (or creates one if absent).
  Must NOT do: Do NOT save on every keystroke — debounce.
  Parallelization: Wave 4 | Blocked by: T0.3, T4.1 | Blocks: T6.x
  References: `project/backend/internal/model/models.go:166-173` (TopologyConfig), `project/web/src/stores/types.ts:100-126`, `project/web/src/pages/TopologyPage.tsx:306-324` (loadData)
  Acceptance criteria (agent-executable): Unit test: save slot config → GET returns same data. Load on page init → correct slot data populates nodes. `npm test` passes.
  QA scenarios: Happy — add node to slot, refresh page, node still there. Failure — corrupted JSON in topology_configs returns empty slots gracefully.
  Evidence: .omo/evidence/task-4.6-provider-slot-workflow.txt (vitest output + curl)
  Commit: Y | feat: add topology slot persistence via topology_configs

### Wave 5: Node Addition UX

 - [ ] 21. Create categorized node menu component
  What to do: Create `project/web/src/components/topology/NodeMenu.tsx`. Renders a popup menu with category groups (headings + items). Categories: "请求处理" (items: 请求改写), "响应处理" (items: 响应改写), "流程控制" (items: 心跳回复, 并发控制, 故障转移), "监控" (items: 日志输出). Each item shows icon + label. Clicking an item calls `onSelect(nodeType, slotType)`. Uses shadcn `DropdownMenu` or custom portal-based popup. Position: absolute, at `{x, y}` from props.
  Must NOT do: Do NOT embed the menu inside the React Flow canvas as a portal-less div — use a portal to avoid Flow clipping.
  Parallelization: Wave 5 | Blocked by: T4.1 | Blocks: T5.2, T5.3
  References: `project/web/src/components/ui/dropdown-menu.tsx` (shadcn dropdown pattern), `project/web/src/components/Sidebar.tsx:47-104` (category structure inspiration)
  Acceptance criteria (agent-executable): Unit test: renders 4 category headings + 6 items. Clicking "请求改写" calls onSelect with slotType='requestModify'. `npm test` passes.
  QA scenarios: Happy — menu appears at specified coordinates with correct categories. Failure — clicking outside menu calls onClose.
  Evidence: .omo/evidence/task-5.1-provider-slot-workflow.txt (vitest output)
  Commit: Y | feat(web): add categorized NodeMenu component

 - [ ] 22. Implement canvas onDoubleClick → popup at click position
  What to do: In `TopologyPage.tsx`, add `onDoubleClick` handler to React Flow's wrapper div or use React Flow's `onPaneClick` with double-click detection. On double-click: capture the React Flow viewport coordinates (`screenToFlowPosition`), open `NodeMenu` at that position. When user selects a node type: determine which Provider's slot should receive this node (based on proximity or explicit target), then call `addNodeToSlot(providerId, slotType, ruleData)`. Menu closes on selection or click-away.
  Must NOT do: Do NOT open menu on single-click. Do NOT use `onNodeDoubleClick` (that's for existing nodes).
  Parallelization: Wave 5 | Blocked by: T5.1 | Blocks: T6.1
  References: `project/web/src/pages/TopologyPage.tsx:442-478` (ReactFlow props), React Flow `useReactFlow()` hook for `screenToFlowPosition`
  Acceptance criteria (agent-executable): Component test: double-click empty canvas → menu appears at click coordinates. Select item → menu closes, onSelect called. `npm test` passes.
  QA scenarios: Happy — double click opens menu at correct position. Failure — double-click on existing node does NOT open menu.
  Evidence: .omo/evidence/task-5.2-provider-slot-workflow.png (Playwright screenshot of menu)
  Commit: Y | feat(web): add canvas double-click → node menu popup

 - [ ] 23. Add bottom-right "+" button → popup at center
  What to do: In `TopologyPage.tsx`, add a second `<Panel position="bottom-right">` (below the existing wand2 button). Contains a `<Button variant="outline" size="icon">` with `Plus` icon (from lucide-react). On click: opens same `NodeMenu` at the viewport center (`screenToFlowPosition` with center coordinates derived from viewport). Same selection flow as T5.2.
  Must NOT do: Do NOT replace the existing wand2 (auto-layout) button. Place the new button above or below it.
  Parallelization: Wave 5 | Blocked by: T5.1 | Blocks: T6.1
  References: `project/web/src/pages/TopologyPage.tsx:465-474` (existing Panel + wand2 button), `project/web/src/pages/TopologyPage.tsx:463-464` (Controls position)
  Acceptance criteria (agent-executable): Component test: "+" button renders. Click → menu at center. `npm test` passes.
  QA scenarios: Happy — button visible in bottom-right, click opens menu at viewport center. Failure — button overlaps wand2 button.
  Evidence: .omo/evidence/task-5.3-provider-slot-workflow.png (Playwright screenshot)
  Commit: Y | feat(web): add bottom-right "+" node addition button

### Wave 6: Integration + E2E

 - [ ] 24. E2E: create Provider → verify 6 slots → add nodes → reorder → verify flow
  What to do: Playwright test: navigate to `/provider`, create a test Provider (name: "TestAI", 1 model "gpt-4"). Navigate to `/` (topology). Assert: 1 Provider node + 1 ModelGroup + 6 slot containers visible. Click "+" on "请求改写" slot → add a node. Assert: Slot now shows 1 node with index "1". Double-click canvas → node menu appears → add 2nd node to same slot. Assert: 2 nodes visible, indices 1 and 2. Drag node 2 above node 1 → indices swap. Check no console errors. Check build passes.
  Must NOT do: Do NOT skip the reorder assertion.
  Parallelization: Wave 6 | Blocked by: T5.2, T5.3 | Blocks: —
  References: Playwright MCP, existing screenshots in repo: `hapiy-provider.png`, `hapiy-table-borders-fixed.png`
  Acceptance criteria (agent-executable): Playwright test script runs end-to-end via `browser_run_code_unsafe`. All assertions pass.
  QA scenarios: Happy — full flow works. Failure — any assertion fails, test fails.
  Evidence: .omo/evidence/task-6.1-provider-slot-workflow.png (screenshots at each step)
  Commit: Y | test(web): add E2E for Provider slot workflow

 - [ ] 25. E2E: Provider conflict → toast → switch rejection
  What to do: Playwright test: create 2 Providers both named "OpenAI". Enable Provider 1 → enabled. Click Switch on Provider 2 → assert: toast appears with text "当前已有一个同名渠道在启用", Switch stays OFF. Dismiss toast. Disable Provider 1. Enable Provider 2 → enabled.
  Must NOT do: Do NOT test this via unit test only — verify toast actually renders in the browser.
  Parallelization: Wave 6 | Blocked by: T4.3 | Blocks: —
  References: Playwright MCP, `project/web/src/nodes/ChannelNode.tsx:74-79` (Switch)
  Acceptance criteria (agent-executable): Playwright test: toast visible after clicking Switch on conflicting Provider. Switch not toggled.
  QA scenarios: Happy — toast appears, switch stays off. Failure — switch toggles despite conflict.
  Evidence: .omo/evidence/task-6.2-provider-slot-workflow.png (screenshot of toast)
  Commit: Y | test(web): add E2E for Provider conflict toast

 - [ ] 26. E2E: Response rewrite tab in PolicyPage
  What to do: Playwright test: navigate to `/policy/rewrite-response`. Assert: page renders with "响应改写" header. Create a new response rewrite rule: fill name + script, click save. Assert: new rule appears in table. Toggle status. Delete rule. Assert: rule removed.
  Must NOT do: Do NOT test via unit test only — verify the full page flow in browser.
  Parallelization: Wave 6 | Blocked by: T2.2 | Blocks: —
  References: Playwright MCP, `project/web/src/pages/PolicyPage.tsx` (rewrite page pattern as reference), `project/web/src/pages/ProviderPage.tsx:126-186` (similar CRUD table pattern)
  Acceptance criteria (agent-executable): Playwright test: create + list + toggle + delete cycle passes.
  QA scenarios: Happy — full CRUD cycle. Failure — save with empty name returns validation error.
  Evidence: .omo/evidence/task-6.3-provider-slot-workflow.png (screenshot)
  Commit: Y | test(web): add E2E for response rewrite PolicyPage tab

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit — verify every todo is done, no scope creep
- [ ] F2. Code quality review — `npm run typecheck && npm run build` passes, no console errors
- [ ] F3. Real manual QA — Playwright full-flow: Provider creation → 6 slots visible → add/remove/reorder nodes → conflict toast → response rewrite tab full CRUD
- [ ] F4. Scope fidelity — verify no unintended changes to existing pages (Monitor, Logs, Token, Price, Settings, Profile)

## Commit strategy
- One commit per todo (22 commits total)
- Commit format: `<type>(<scope>): <summary>` as specified in each todo
- Backend commits: `feat(backend): ...`
- Frontend commits: `feat(web): ...`, `test(web): ...`, `refactor(web): ...`
- Final wave: `test(web): add E2E suite`

## Success criteria
1. User creates a Provider → 6 fixed slots appear in correct order with ant-line frames
2. Clicking "+" in a slot adds a node of that type; adding multiple creates indexed nodes
3. Dragging nodes within a slot reorders their indices
4. Double-click empty canvas → menu at click point; bottom-right "+" button → menu at center
5. Enabling a same-name Provider shows toast and rejects the switch
6. Model group nodes are simplified (no title/count), drag as a group, shared across Providers
7. Log output node shows 4 record content checkboxes; unavailable options are greyed out
8. Response rewrite tab appears in PolicyPage with full CRUD
9. Slot configuration persists across page reloads
10. `npm run typecheck` and `npm run build` pass with 0 errors
11. All E2E Playwright tests pass
