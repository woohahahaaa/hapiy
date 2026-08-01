# topology-magic-layout - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** 节点组件按共享配置渲染真实尺寸，魔法棒读取当前面板每个 React Flow 节点的实际尺寸，只按边缘间距重新排列 Provider workflow 与 modelHub 分组。

**Why this approach:** 将“尺寸渲染”和“位置布局”彻底分开；布局使用实际 DOM 尺寸并在 flow 坐标中校正缩放，避免固定尺寸导致重叠或错误间距。

**What it will NOT do:** 魔法棒不计算内容宽度、不统一插槽项目宽度、不修改节点尺寸；Provider 内部 padding 不进入 JSON；slot 外壳和 modelHub 不增加错误的宽度上限。

**Effort:** Medium
**Risk:** Medium - 涉及组件渲染约束、配置类型和 React Flow 缩放后的 DOM 测量。
**Decisions to sanity-check:** 未测量节点的兜底尺寸；使用未缩放的 `offsetWidth/offsetHeight` 作为 flow 尺寸；slot item 配置层名称保持兼容。

Your next move: worker 按此计划执行；执行后需通过单元测试、类型检查、构建和浏览器布局验证。

---

> TL;DR (machine): Medium effort, medium risk; shared render config, live-size edge-gap layout, regression tests, browser QA.

## Scope
### Must have
- 将 `node.minWidth=200`、`node.maxWidth=300`用于 Provider 与 slot 内部项目；Provider 内部 padding 保持组件内固定。
- slot 外壳不设置 `maxWidth`；slot 组件在渲染时让内部项目和添加按钮取 slot 内最大宽度。
- modelHub 不设置 min/max，只按内容与自身 padding 撑开。
- 魔法棒点击时读取当前面板每个 `.react-flow__node` 的实际尺寸；尺寸必须转换为 flow 坐标，不能使用 zoom 缩放后的 viewport 尺寸。
- 所有横向和竖向间距均为相邻外边缘之间的固定距离；workflow 内顶对齐、workflow 左对齐、modelHub 右对齐、两组垂直中心对齐。
- 修改并补齐布局、配置和组件渲染的测试；记录基线测试失败与修复后的证据。
### Must NOT have (guardrails, anti-slop, scope boundaries)
- 不得让魔法棒参与节点内容宽度计算、slot 内部等宽计算或节点高度计算。
- 不得继续把 slot 的 `maxWidth` 施加到 `SlotContainer` 外壳。
- 不得给 modelHub 保留 minWidth/maxWidth 约束。
- 不得把 Provider 内部 padding 加入自定义 JSON。
- 不得以中心距替代 edge-to-edge 间距。

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after + Vitest unit tests, TypeScript typecheck/build, and Playwright browser QA.
- Evidence: .omo/evidence/task-<N>-topology-magic-layout.<ext>

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

| Wave | Name | Todos | Depends on |
|---|---|---|---|
| 0 | Config and render sizing | T0.1-T0.3 | — |
| 1 | Measured layout and integration | T1.1-T1.3 | Wave 0 |
| 2 | Regression and browser verification | T2.1-T2.3 | Wave 1 |

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| T0.1 | — | T0.2,T1.1 | T0.3 |
| T0.2 | T0.1 | T1.1 | T0.3 |
| T0.3 | — | T1.1 | T0.1,T0.2 |
| T1.1 | T0.1,T0.2,T0.3 | T1.2,T1.3 | — |
| T1.2 | T1.1 | T2.1 | T1.3 |
| T1.3 | T1.1 | T2.2 | T1.2 |
| T2.1 | T1.2 | T2.3 | T2.2 |
| T2.2 | T1.3 | T2.3 | T2.1 |
| T2.3 | T2.1,T2.2 | — | — |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] T0.1. Reshape topology config for shared render and layout rules
  What to do / Must NOT do: Update `project/web/src/config/topology.json` and `topology-config.ts` so node min/max, slot padding/content gap, modelHub padding, and layout edge gaps are typed and sourced from one JSON hierarchy. Keep Provider internal padding out of JSON. Remove modelHub min/max semantics and make any fallback-only dimensions explicit. Do not rename unrelated handle or visual settings.
  Parallelization: Wave 0 | Blocked by: — | Blocks: T0.2,T1.1
  References (executor has NO interview context - be exhaustive): `project/web/src/config/topology.json:2-18`; `project/web/src/config/topology-config.ts:8-64`; `project/web/src/config/topology-config.test.ts`; confirmed rules in `.omo/drafts/topology-magic-layout.md:39-68`.
  Acceptance criteria (agent-executable): Typecheck passes; config exposes node min/max as 200/300, no modelHub min/max, no provider padding field, and distinct edge-gap fields; config tests assert the new contract.
  QA scenarios (name the exact tool + invocation): Happy — `cd project/web && npm test -- --run src/config/topology-config.test.ts`; failure — typecheck rejects modelHub min/max access or missing required gap fields. Evidence `.omo/evidence/task-0.1-topology-magic-layout.txt`.
  Commit: N | config(web): define topology sizing and edge-gap rules

- [ ] T0.2. Apply configurable size rules in Provider and slot item rendering
  What to do / Must NOT do: Update `ProviderNode`, `SlotItemCard`/slot item shell, and `SlotNode` so Provider and each slot item use configured 200-300 bounds, while the slot outer shell has no max width. Preserve Provider's existing internal padding in component code. Make slot children and add button stretch to the slot-local maximum during rendering; do not put this logic in the magic-wand layout function.
  Parallelization: Wave 0 | Blocked by: T0.1 | Blocks: T1.1 | Can parallelize with: T0.3
  References: `project/web/src/nodes/ProviderNode.tsx:55-65`; `project/web/src/nodes/SlotNode.tsx:56-75`; `project/web/src/components/topology/SlotContainer.tsx:23-57`; `project/web/src/components/topology/slot-items/SlotItemCard.tsx:29-58`; slot item callers from codegraph; `.omo/drafts/topology-magic-layout.md:43-57`.
  Acceptance criteria: Provider and every slot item receive min/max 200/300 from config; `SlotNode` does not set shell maxWidth; populated and empty slots render equal-width content; Provider padding remains absent from JSON.
  QA scenarios: Happy — browser inspection shows a long item expands all items in its slot to the same capped width; failure — a slot shell with content over 300 is not clipped by a shell max-width. Evidence `.omo/evidence/task-0.2-topology-magic-layout.png`.
  Commit: N | feat(web): apply shared node and slot-item sizing rules

- [ ] T0.3. Remove modelHub width constraints and use configurable padding
  What to do / Must NOT do: Update `ModelHubNode` to remove minWidth/maxWidth styles and apply only content-driven width plus configured modelHub padding. Do not add any modelHub minimum or maximum width fallback to the component.
  Parallelization: Wave 0 | Blocked by: — | Blocks: T1.1 | Can parallelize with: T0.1,T0.2
  References: `project/web/src/nodes/ModelHubNode.tsx:29-50`; `project/web/src/config/topology-config.ts:23-55`; `.omo/drafts/topology-magic-layout.md:58-60`.
  Acceptance criteria: modelHub DOM width grows with text and has no CSS min/max constraint; padding comes from config; TypeScript passes.
  QA scenarios: Happy — Playwright reads modelHub computed style and sees no min/max constraint; failure — long model text does not force a configured 200px cap. Evidence `.omo/evidence/task-0.3-topology-magic-layout.png`.
  Commit: N | feat(web): make modelHub content-sized

- [ ] T1.1. Make layout consume measured flow-space node sizes
  What to do / Must NOT do: Extend `getLayoutedElements` to accept a per-node measured size map and use it for every node; only use explicit fallback dimensions when a node has no measurement. Wire `useReactFlowNodeSizes` into `TopologyPage` and measure unscaled `offsetWidth/offsetHeight` (or equivalently normalize `getBoundingClientRect` by current zoom). Do not calculate widths from node content or configuration when a measurement exists.
  Parallelization: Wave 1 | Blocked by: T0.1,T0.2,T0.3 | Blocks: T1.2,T1.3
  References: `project/web/src/lib/use-reactflow-node-sizes.ts:3-61`; `project/web/src/lib/topology-auto-layout.ts:34-144`; `project/web/src/pages/TopologyPage.tsx:384-412,478-530`; React Flow node wrapper selector `.react-flow__node[data-id]`.
  Acceptance criteria: `handleAutoLayout` passes the current size map; every node position calculation uses measured width/height; measured sizes are flow-space and therefore unchanged by canvas zoom; missing-size behavior is deterministic fallback only.
  QA scenarios: Happy — with two measured nodes 250x80 and 280x150, the next x equals previous x + previous width + gap; failure — at zoom 0.5/2, layout still produces the same flow coordinates and does not overlap. Evidence `.omo/evidence/task-1.1-topology-magic-layout.txt`.
  Commit: N | feat(web): drive auto layout from live node measurements

- [ ] T1.2. Implement complete grouped edge-gap placement
  What to do / Must NOT do: Replace fixed dimension assumptions in the layout algorithm with measured dimensions while preserving deterministic Provider/slot ordering. Lay out each workflow left-to-right with top alignment, stack workflows using previous row bottom + workflowRowGap, stack modelHub using previous bottom + modelHubRowGap, right-align modelHub to the model group right edge, place the workflow group after model group right edge + groupGap, and vertically center the two groups. Keep all gaps literal edge-to-edge. Do not center-align rows or use center-distance gaps.
  Parallelization: Wave 1 | Blocked by: T1.1 | Blocks: T2.1 | Can parallelize with: T1.3
  References: `project/web/src/lib/topology-auto-layout.ts:15-144`; `project/web/src/lib/topology-auto-layout.test.ts:32-105`; `project/web/src/pages/TopologyPage.tsx:399-412`; `.omo/drafts/topology-magic-layout.md:70-91`.
  Acceptance criteria: Unit assertions prove horizontal `next.x = previous.x + previous.width + gap`, vertical `next.y = previous.y + previous.height + gap`, row top alignment, workflow left alignment, modelHub right alignment, and group center-Y equality using nonuniform measured sizes.
  QA scenarios: Happy — uneven provider/slot/model heights and widths produce exact edge gaps; failure — zero gap makes adjacent edges touch and no node uses center-distance arithmetic. Evidence `.omo/evidence/task-1.2-topology-magic-layout.txt`.
  Commit: N | feat(web): compute grouped edge-to-edge topology layout

- [ ] T1.3. Persist positions without mutating measured dimensions
  What to do / Must NOT do: Keep the existing localStorage position snapshot behavior, update `handleAutoLayout` to save only calculated coordinates, and ensure node `width`/`height` or render data are not rewritten by the layout callback. Preserve drag persistence and unrelated topology state.
  Parallelization: Wave 1 | Blocked by: T1.1 | Blocks: T2.2 | Can parallelize with: T1.2
  References: `project/web/src/pages/TopologyPage.tsx:49-69,399-423`; `project/web/src/lib/topology-auto-layout.ts:139-143`.
  Acceptance criteria: after magic-wand execution localStorage contains each node position; node sizing/render data is unchanged; manual drag still updates only that node's saved position.
  QA scenarios: Happy — click wand then reload and positions remain; failure — click wand never writes config dimensions into Node objects. Evidence `.omo/evidence/task-1.3-topology-magic-layout.txt`.
  Commit: N | fix(web): persist only calculated topology positions

- [ ] T2.1. Rewrite layout and config regression tests around live sizes
  What to do / Must NOT do: Replace stale fixed-size assertions in `topology-auto-layout.test.ts` and config tests with injected measured-size cases, fallback cases, nonuniform dimensions, edge-to-edge gaps, alignment, and missing-node behavior. Add tests for the measurement helper's zoom-safe dimensions using the chosen measurement method. Do not weaken assertions to merely check ordering.
  Parallelization: Wave 2 | Blocked by: T1.2 | Blocks: T2.3 | Can parallelize with: T2.2
  References: `project/web/src/lib/topology-auto-layout.test.ts:1-106`; `project/web/src/lib/use-reactflow-node-sizes.ts:1-61`; `project/web/src/config/topology-config.test.ts`; Metis review findings recorded in task result.
  Acceptance criteria: `npm test -- --run` passes; tests assert exact positions and exact edge gaps with measured dimensions; baseline stale 320/200/100 assumptions are removed rather than hidden.
  QA scenarios: Happy — full Vitest suite passes; failure — intentionally changing a measured width or gap causes the exact position assertion to fail. Evidence `.omo/evidence/task-2.1-topology-magic-layout.txt`.
  Commit: N | test(web): cover measured edge-gap topology layout

- [ ] T2.2. Verify rendering and magic wand in a real browser
  What to do / Must NOT do: Use Playwright against the running web app to verify empty/populated slot sizing, equal-width slot items, content-sized modelHub, live-size magic-wand placement, zoom independence, and persisted positions. Use actual `.react-flow__node[data-id]` bounds and compare edge gaps after normalizing the browser scale. Do not treat a successful button click alone as QA.
  Parallelization: Wave 2 | Blocked by: T1.3 | Blocks: T2.3 | Can parallelize with: T2.1
  References: `project/web/src/pages/TopologyPage.tsx:478-530`; `project/web/src/components/topology/SlotContainer.tsx:23-57`; `project/web/src/nodes/ProviderNode.tsx:55-145`; `project/web/src/nodes/ModelHubNode.tsx:29-75`; `project/web/src/nodes/SlotNode.tsx:44-87`.
  Acceptance criteria: Browser evidence shows every measured pair has configured edge gap, workflow rows are top/left aligned, modelHub is right aligned and group centers match; changing zoom does not alter resulting flow layout.
  QA scenarios: Happy — click Wand2 and inspect all node pairs; failure — zoom canvas, click Wand2 again, and assert no overlap or scaled-gap drift. Evidence `.omo/evidence/task-2.2-topology-magic-layout.png`.
  Commit: N | test(web): verify magic wand layout in browser

- [ ] T2.3. Run final quality gates and review scope
  What to do / Must NOT do: Run typecheck, build, unit tests, and the browser QA evidence; inspect the diff for unrelated changes and confirm all confirmed rules are represented. Do not mark complete based only on compiler success.
  Parallelization: Wave 2 | Blocked by: T2.1,T2.2 | Blocks: —
  References: all changed files above; `project/web/package.json` scripts; `.omo/drafts/topology-magic-layout.md`.
  Acceptance criteria: `npm test -- --run`, `npm run typecheck`, and `npm run build` pass; browser evidence exists; no Must-NOT-Have violation remains.
  QA scenarios: Happy — all commands exit 0 and evidence files are present; failure — any command or review check fails and is reported with its exact output. Evidence `.omo/evidence/task-2.3-topology-magic-layout.txt`.
  Commit: N | chore(web): verify topology magic layout quality gates
- [ ] 1. <title>
  What to do / Must NOT do: <...>
  Parallelization: Wave <N> | Blocked by: <...> | Blocks: <...>
  References (executor has NO interview context - be exhaustive): <src/path:lines>
  Acceptance criteria (agent-executable): <exact command or assertion>
  QA scenarios (name the exact tool + invocation): happy + failure, Evidence .omo/evidence/task-1-topology-magic-layout.<ext>
  Commit: <Y/N> | <type>(<scope>): <summary>

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real manual QA
- [ ] F4. Scope fidelity

## Commit strategy
No commit is requested in the current task. Keep changes in the working tree and stage only implementation files if the user later requests a commit.

## Success criteria
The UI renders sizes from the shared configuration where configured, slot/modelHub rules match the confirmed ownership boundaries, and clicking the magic wand uses every currently rendered node's flow-space dimensions to place groups with exact edge-to-edge gaps and deterministic alignment.
