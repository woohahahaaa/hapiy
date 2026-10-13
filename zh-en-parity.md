# 中英对照检查：en 是否严格对应 zh

范围：`project/web/src/i18n/locales/{zh,en}` 全部 17 个命名空间 + 后端 Go 的中→英映射表。
方法：逐 key 比对；术语规则校验（令牌↔token、供应商↔provider、工作流↔workflow、Endpoint↔endpoint）；同一条中文对应多种英文的排查；en 中文泄漏；映射表孤儿/缺口。

---

## 一、已修：令牌改了、en 没跟上（4 条）

| key | 中文 | English（旧 → 新） |
| --- | --- | --- |
| `agentConfig · toast.apiKeyRequired` | 请选择接入用的令牌（必填） | Choose an access token **Key** (required) → Choose an access token (required) |
| `agentConfig · managedDialog.apiKeyLabel` | 接入令牌 | **Access Key** → Access token |
| `agentConfig · managedDialog.apiKeyRequiredSuffix` | （在令牌页创建，必填） | (a **Key** created on the Tokens page, required) → (created on the Tokens page, required) |
| `agentConfig · managedDialog.apiKeyPlaceholder` | 选择接入用的令牌 | Choose an access token **Key** → Choose an access token |

依据：en 侧「令牌」的既有叫法是 token（`common.nav.token` = Tokens、`token.list.add` = Add token）。

---

## 二、已修 1：`参考厂商` → `参考供应商`、`reference vendor` → `reference provider`

处理：中文 15 处「参考厂商」全部改「参考供应商」（agentConfig 6、agentRules 7、provider 2）；英文 9 个 vendor 词全部改 provider（agentConfig 8 条：reference vendor → reference provider、reference-vendor → reference-provider、official (lab) vendor → official (lab) provider、reference vendors → reference providers）。改完复查：zh 无「参考厂商」、en 无 vendor，`en-parity2.mjs` 规则校验 0 不匹配。

原状：中文 15 处「参考厂商」、11 处「参考供应商」；英文 8 处 `vendor`（**全在 agentConfig.json**）、17 处 `provider`。

| 位置 | 中文 | English |
| --- | --- | --- |
| `agentConfig · toast.officialAll` | 官方参考厂商 | official reference **vendor** |
| `agentConfig · toolbar.applyRecommendedTitle` | 选择参考**供应商** | Choose a reference **vendor** ⚠️ 同一 key 中英不一致 |
| `agentConfig · toolbar.previewDiffTitle` | 参考**供应商**基础字段 | reference-**vendor** base fields ⚠️ 同一 key 中英不一致 |
| `agentConfig · diffView.staleSupplier` | 参考厂商 | reference **vendor** |
| `agentConfig · diffView.unsetSupplier` | 参考厂商 | reference **vendor** |
| `agentConfig · managedDialog.bulkSetTitle` | 官方（lab）参考厂商 | reference **vendor** / official (lab) **vendor** |
| `agentConfig · managedDialog.bulkSet` | 批量设置参考厂商 | Set reference **vendors** |
| `agentConfig · managedDialog.referencePlaceholder` | 选择参考厂商 | Choose a reference **vendor** |
| `agentRules · match.officialTitle` | 官方（lab）参考厂商 | reference **provider** |
| `agentRules · match.officialButton` | 批量设置参考厂商 | Bulk set reference **providers** |
| `agentRules · match.selectSupplier` | 选择参考厂商 | Select reference **provider** |
| `agentRules · match.selectSupplierFirst` | 请先选择参考厂商 | Select a reference **provider** first |
| `agentRules · match.toast.officialApplied` | 官方参考厂商 | official reference **provider** |
| `agentRules · match.toast.officialAlready` | 最佳参考厂商 | best reference **provider** |
| `agentRules · match.toast.saveSupplierFailed` | 保存参考厂商选择失败 | reference **provider** selection |
| `provider · price.selectReference` | 选择参考厂商 | Select reference **provider** |
| `provider · toast.bulkVendorless` | 官方参考厂商 | official reference **provider** |

建议统一：中文全用「参考供应商」，English 全用 "reference provider"（多数已是）。

---

## 三、已修 2：en 省略号 `...` → `…`

处理：16 处正文省略号改成 `…`（agentConfig 4、agentRules 1、logs 1、policy 1、provider 4、rewrite 1、settings 1、token 1、topology 1、ui 1）；en 现在 `…` 共 38 处，`...` 只剩 `agentRules.form.containerArray` / `containerObject` 两个 JSON 代码示例（保留）。

原状：zh 已统一 `…`；en 有 16 处仍在用 `...`（另有 22 处是 `…`）：

| 文件 | key |
| --- | --- |
| agentConfig | `confirmDelete.busy`（Deleting...）、`form.saving`、`confirm.applyTemplateApplying`、`codeEditor.saving` |
| agentRules | `actions.saving` |
| logs | `preview.loading` |
| policy | `actions.saving` |
| provider | `dialog.syncing`、`actions.saving`、`fetchDialog.adding`、`autocomplete.loading`（Loading models.dev data...） |
| rewrite | `testDialog.running` |
| settings | `savingEllipsis` |
| token | `actions.saving` |
| topology | `jsonEdit.saving` |
| ui | `dataTable.loading` |

（`agentRules.form.containerArray` / `containerObject` 里的 `...` 是 JSON 代码示例，保留。）

| 文件 | key |
| --- | --- |
| agentConfig | `confirmDelete.busy`（Deleting...）、`form.saving`、`confirm.applyTemplateApplying`、`codeEditor.saving` |
| agentRules | `actions.saving` |
| logs | `preview.loading` |
| policy | `actions.saving` |
| provider | `dialog.syncing`、`actions.saving`、`fetchDialog.adding`、`autocomplete.loading`（Loading models.dev data...） |
| rewrite | `testDialog.running` |
| settings | `savingEllipsis` |
| token | `actions.saving` |
| topology | `jsonEdit.saving` |
| ui | `dataTable.loading` |

（`agentRules.form.containerArray` / `containerObject` 里的 `...` 是 JSON 代码示例，保留。）

---

## 四、结构性缺口（不是翻译问题）

1. ~~**帮助页只有中文**~~ → **已做**：新增 `project/web/src/pages/help/help.en.md`（与中文 38 个小节一一对应），`HelpPage.tsx` 按当前语言选文件，并新增 `help` 语言包承载页面外壳（标题、目录、搜索、快速入口、页脚——这些原先硬编码中文）。
   另外：帮助页是在新标签页打开、不套 LanguageProvider，所以 `i18n` 增加了 localStorage 语言缓存（`hapiy_language`，随语言切换写入、启动时读取），否则英文用户点「帮助」会看到中文。
   测试：`HelpPage.test.tsx` 锁定中英两种渲染与锚点 id。
2. **后端运行期文案只有中文**（未做）：使用记录 / 日志预览里的 RuleNotes（例：`[故障转移] 主转移：命中但执行失败（无可用回退供应商）`）与部分 `fmt.Errorf` 没有 en 版本，英文模式下显示中文。带错误码的那批（errorsCore / errorsAgent）前端有 en 文案，不受影响。
   难点：使用记录的 `EventDetail` 是**存下来的中文字符串**，读的时候无法重渲染；日志抓取行有结构化 `RuleNotes` JSON，可读时翻译。
   两个可选方案：(a) 使用记录也存结构化 notes（新增列/JSON），读接口按 `Accept-Language` 渲染；(b) 维持现状。属后端改造，需单独确认。
3. `project/backend/config/agent-templates/*.md`（5 个参考文档）只有中文；不在界面里，可忽略。

### 顺带修掉的 help.md 文案（它是界面内容）

| 位置 | 旧 | 新 |
| --- | --- | --- |
| 从 models.dev 同步 | 选一个参考**厂商** | 选一个参考**供应商** |
| 章节标题 / 全文 5 处 | 接管**Agent** | 接管 **Agent**（含「开启接管 Agent」） |
| 本机规则 | 「同步预设**Agent**信息」 | 「同步预设 **Agent** 信息」 |
| 概览 / 令牌章节 / 管理模型 | 写入 hapiy 地址与 Key、令牌页生成的 `hk-` 开头的 Key、签发…用的 Key、换 Key、填入…创建的 Key | 一律改用「令牌」 |
| 自动恢复 | 按 **Provider** / Base URL / Key 点「恢复」 | 按**供应商** / Base URL / Key 点「恢复」 |

---

## 五、检查通过

- 17 个命名空间 **key 集合一致**（含复数族 `_one`/`_other`），无缺失；`i18n.test.ts` + `check-i18n-keys.mjs` 通过。
- **en 无中文泄漏**：唯一含中文的是 `common.language.zh` = 中文（语言名自身，正确）。
- **后端中→英映射表**（`agentRecommendationDescriptionEn`）：52 条，无孤儿条目；模板里的每条中文说明都有英文（`TestLocalizationCoversTemplates` 通过）；本轮改过的 6 条描述（provider/Endpoint 相关）en 语义对得上。
- 同一条中文 → 多种英文：11 组，逐条核对过，除上面「参考厂商」那组外，其余都是「标签 vs 按钮文案」「单复数」这类合理差异（如 确认删除 = Confirm deletion / Confirm delete）。

验证记录：`node scripts/check-i18n-keys.mjs` OK；`vitest run src/i18n src/lib` 235/235；后端 `go test ./internal/model/... ./internal/handler/...` 通过、`./internal/relay/...` 单跑 3 次通过。
（注：`rewrite-rule-editor/serializer.test.ts` 有 4 条失败，属并行进行中的 `hash(...)` 改造（该目录在工作区有未提交改动），与文案无关。）
