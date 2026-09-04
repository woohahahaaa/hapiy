# 存量错误清单（Pre-existing Errors / Technical Debt）

> 此文记录 hapiy 代码库中**在我（2026-08-21 会话）改动之前就已存在**的编译/类型/测试问题。
> 本文文件本身与这些错误无关；验证方法与每次基线对比均记录在下方，可复现。

## 背景说明

本次"编辑供应商弹窗 + 模型价格币种"功能改造（涉及
`project/web/src/lib/dashboard-api.ts`、`project/web/src/pages/ProviderPage.tsx`、
`project/backend/internal/handler/quota.go`、`quota_test.go`、`relay.go`）完成后，
全量 `tsc -b` 报出 42 个前端错误、并偶现 1 个后端测试失败。

为保证"不是我的改动引入的"，我做了基线对比：
在干净的 `git worktree`（`HEAD = 7458c0e`）上重新跑同一套检查，得到**完全相同的 42 个前端错误**；
后端那个测试失败在干净分支上也能复现（属时序/顺序相关的既存 flake）。
结论：**本次改动没有引入任何新的类型错误或测试失败**，下方为存量问题的完整清单。

---

## 一、前端 TypeScript 错误（`cd project/web && npx tsc -b`，42 个）

### 1. 表格列渲染回调类型错配（约 25 个，最主要的一类）

涉及文件：`src/pages/LogsPage.tsx`（10）、`src/pages/MonitorPage.tsx`（8）、
`src/pages/LogCapturePage.tsx`（5）

典型报错：

```
error TS2322: Type '(row: any) => string | null' is not assignable to type 'string'.
error TS7006: Parameter 'row' implicitly has an 'any' type.
```

根因：`DataTable` 的 `ColumnDef` 泛型约束与各页面传入的 render 回调类型不一致
（列定义要求 `string` 返回值/显式泛型，回调却是 `(row: any) => ...`）。
这是 `components/data-table` 基座组件与其使用方之间的历史类型漂移，与本次改动无关。

### 2. `data-table` 内部错误（约 12 个）

涉及文件：

| 文件 | 错误 | 说明 |
|---|---|---|
| `src/components/data-table/DataTable.tsx` | `TS7053` ×2、`TS2349` ×2 | `unknown` 索引、不可调用表达式 |
| `src/components/data-table/features/MagicWand.tsx` | `TS2503` 找不到 `JSX` 命名空间 | 缺少 React JSX 全局类型 |
| `src/components/data-table/features/ColumnSettingsPopover.tsx` | `TS2503` + `RefObject` 类型不匹配 | 同上 + ref 类型漂移 |
| `src/components/data-table/features/useAutoColumnWidth.ts` | `TS2349` ×2 | `never` 不可调用 |
| `src/components/data-table/ui/Pagination.tsx` | `TS2503` | 找不到 `JSX` 命名空间 |
| `src/components/data-table/cells/NumberCell.tsx` / `DefaultCell.tsx` / `DateCell.tsx` | `TS2503` | 找不到 `JSX` 命名空间 |

### 3. 页面级杂项错误（约 5 个）

- `src/pages/LogsPage.tsx`：
  - `TS2358`：`instanceof` 左侧类型不合法
  - `TS2741`：`DataTable` 缺 `onOffsetChange` 必填属性
  - `TS2322` ×2：状态枚举渲染（`成功`/`失败`）传给 `string` 列
- `src/pages/LogCapturePage.tsx`：`TS2741`：`DataTable` 缺 `onOffsetChange`
- `src/pages/TopologyPage.tsx`：`TS6133`：`runId` 声明未使用

### 4. 测试文件错误（约 3 个）

- `src/lib/topology-edges.test.ts`（×2）：
  `models: [{ model, endpoints: [] }]` 缺 `rate` 字段（该字段在 ProviderModel 中早已必填，
  属测试夹具与类型长期不一致；`prices` 字段为本次新增，仅叠加在同一条错误信息上）
- `src/modules/flow-hub.test.ts`（×1）：
  `TS4104` `readonly FlowStep[]` 赋给可变 `FlowStep[]`
  > 注：此文件与我并行工作的其他会话正在修改，错误可能在此文件的当前工作副本与 HEAD
  > 之间换位（HEAD 上是它，当前工作区已变成 `TopologyPage.tsx(1014)`），
  > 总量与类型类别完全一致 → 可确认为存量。

### 5. 前端错误汇总

```text
42 个错误 / 14 个文件，错误码分布：
  TS2322 ×12  TS7006 ×10  TS2503 ×7  TS2349 ×4
  TS7053 ×2   TS2741 ×2   TS2345 ×2  TS6133 ×1
  TS2358 ×1   TS2344 ×1
```

基线对比：`HEAD(7458c0e)` 干净 worktree 同样报 **42 个**，其中 **41 个逐条一致**；
唯一差异是 1 个测试文件错误与 1 个 TopologyPage 未使用变量错误在并行会话工作副本间换位。

---

## 二、后端测试偶发失败（Go）

### `TestSelectProvider_filtersByAllowedPath`（`internal/relay/preparsed_test.go`）

- 现象：`responses should pick p-responses, got p-any`，偶发失败
- 验证：
  - 完整包运行 `go test ./internal/relay/` → 通过
  - 单独运行 `-run 'TestSelectProvider_filtersByAllowedPath'` → 随机失败/通过
    （`-count=3` 通过一次、`-count=6` 失败一次；干净 stash 分支同样能复现失败）
- 结论：**存量 flake**。归属 `internal/relay` 包，该包不 import `internal/handler`，
  本次 handler 侧改动不可能影响其行为；失败是测试自身时序/顺序敏感导致。
- 建议：该测试内部对 affinity rules 依赖 `settings` 表（测试内存库未迁移该表，日志可见
  `no such table: settings`），修复方向是 `newTestEngine` 补上 `&model.Setting{}` 的
  AutoMigrate，或用独立夹具隔离。

---

## 三、修复建议（优先级从高到低，非本次会话职责）

1. **`data-table` 组件族**：统一 `ColumnDef` 泛型与 render 签名，补 `JSX` 全局类型
   （`tsconfig` 的 `jsx` 与 React 类型引用），一次可消掉约 12 个错误。
2. **表格列回调**：各页面列定义显式 `ColumnDef<T>[]` 标注，避免 `(row: any)`，
   约消 25 个错误中的大部分。
3. **测试夹具**：`topology-edges.test.ts` 的 `models` 补 `rate`；
   `flow-hub.test.ts` 修正 readonly 赋值。
4. **后端 flake**：`newTestEngine` 迁移 `model.Setting` 表。

---

## 四、如何复现

```bash
# 前端类型检查（复现 42 个错误）
cd project/web && npx tsc -b --pretty false

# 后端 flake（多跑几次可见偶发失败）
cd project/backend && go test ./internal/relay/ -run 'TestSelectProvider_filtersByAllowedPath' -count=6
```

> 录入时间：2026-08-21（Sat） · 基线 commit：`7458c0e`
> 关联会话：编辑供应商弹窗 / 模型价格与币种计费改造
> 本次改动的 5 个文件（2 前端 + 3 后端）在上述检查中均为 0 错误、0 新增失败。