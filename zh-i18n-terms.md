# 待定术语：候选位置清单（你来挑）

> **已定稿**：Endpoint 保持英文（并把 20 处「端点」反向统一为 Endpoint）、workflow → 工作流、Key（令牌实体）→ 令牌、model/key 保持英文。落地记录见 `zh-i18n-audit.md` 第三节；本表保留为当时的候选清单与建议原文。

> 一行一处 UI 文案，`建议` 列是我给的改法；要改的直接回编号，例如 `E1 E2 E7 T2 M1`。
> 输入值/变量名/代码片段已排除在本表外。

## 一、Endpoint → 端点（45 处）

| 编号 | 位置 | 现状 | 建议 |
| --- | --- | --- | --- |
| E1 | `agentConfig.json · toast.noEndpointProvider` | 请至少勾选一个有 Endpoint 的供应商 | 改：请至少勾选一个有端点的供应商 |
| E2 | `agentConfig.json · toast.manualEndpointRequired` | 有未配置 Endpoint 的供应商：请手动填写 Endpoint，或取消勾选它们 | 改：有未配置端点的供应商：请手动填写端点，或取消勾选它们 |
| E3 | `agentConfig.json · toast.mergedIntoGroup` | 未配置 Endpoint 的供应商已并入分组「{{endpoint}}」 | 改：未配置端点的供应商已并入分组「{{endpoint}}」 |
| E4 | `agentConfig.json · toast.suffixRequired` | 有多个 Endpoint 分组，必须为 {{endpoint}} 填写后缀 | 改：有多个端点分组，必须为 {{endpoint}} 填写后缀 |
| E5 | `agentConfig.json · toolbar.addManagedTitle` | 把我们系统里录入的供应商按 Endpoint 分组后生成托管供应商 | 改：把我们系统里录入的供应商按端点分组后生成托管供应商 |
| E6 | `agentConfig.json · managedDialog.selectProvidersSuffix` | （显示名称 / 模型数 / Endpoint 数） | 改：（显示名称 / 模型数 / 端点数） |
| E7 | `agentConfig.json · managedDialog.groupsLabel` | 根据 Endpoint 规则自动归类供应商配置 | 改：根据端点规则自动归类供应商配置 |
| E8 | `agentConfig.json · managedDialog.groupsSuffix` | （命中同一条规则，如 *completion*，的 Endpoint 归为一组） | 改：（命中同一条规则，如 *completion*，的端点归为一组） |
| E9 | `agentConfig.json · managedDialog.providerMeta` | {{models}} 模型 · {{endpoints}} Endpoint | 改：{{models}} 模型 · {{endpoints}} 端点 |
| E10 | `agentConfig.json · managedDialog.noneMergeHint` | 已匹配到同名分组「{{endpoint}}」{{suffixHint}}，此处留空保存将自动合并 | 改：已匹配到同名分组「{{endpoint}}」{{suffixHint}}，此处留空保存将自动合并 |
| E11 | `agentRules.json · dialog.templateApplyDetail` | 默认路径、供应商/模型 gjson 路径、模型信息字段、公共配置（common）与各 Endpoint 规则的字段推荐会全部替换为默认值。确认？ | 改：默认路径、供应商/模型 gjson 路径、模型信息字段、公共配置（common）与各端点规则的字段推荐会全部替换为默认值。确认？ |
| E12 | `agentRules.json · actions.jsonModeForwardTitle` | 把整个弹窗（名称 / 路径 / 模型信息 / 公共配置 / Endpoint 规则）作为一份 JSON 编辑 | 改：把整个弹窗（名称 / 路径 / 模型信息 / 公共配置 / 端点规则）作为一份 JSON 编辑 |
| E13 | `agentRules.json · actions.templateResetTitle` | 将该规则的全部字段（路径 / 模型信息字段 / 公共配置 / 各 Endpoint 规则）重置为系统默认推荐模版 | 改：将该规则的全部字段（路径 / 模型信息字段 / 公共配置 / 各端点规则）重置为系统默认推荐模版 |
| E14 | `agentRules.json · jsonMode.hint` | 整个弹窗的 JSONC（含名称 / 路径 / 模型信息字段 / 公共配置 common / 各 Endpoint 规则 protocols）。顶部与每个区块都带 // 说明注释，方便交给其他 Agent 处理；注释不影响保存。保存与切回表格前都会校验；JSONC 不合法将无法保存，也无法还原成表格。 | 改：整个弹窗的 JSONC（含名称 / 路径 / 模型信息字段 / 公共配置 common / 各端点规则 protocols）。顶部与每个区块都带 // 说明注释，方便交给其他 Agent 处理；注释不影响保存。保存与切回表格前都会校验；JSONC 不合法将无法保存，也无法还原成表格。 |
| E15 | `agentRules.json · errors.protocolMissingTags` | 协议「{{name}}」缺少 endpoint_tags（根据 Endpoint 来判断，必填） | 改：协议「{{name}}」缺少 endpoint_tags（根据端点来判断，必填） |
| E16 | `agentRules.json · errors.endpointRuleMissingName` | Endpoint 规则 #{{n}}：缺少规则名称 | 改：端点规则 #{{n}}：缺少规则名称 |
| E17 | `agentRules.json · errors.endpointRuleTagsEmpty` | Endpoint 规则「{{name}}」：归纳范围为空（endpoint_tags 必填） | 改：端点规则「{{name}}」：归纳范围为空（endpoint_tags 必填） |
| E18 | `agentRules.json · errors.endpointRuleFieldsParseFailed` | Endpoint 规则「{{name}}」的字段 JSON 解析失败： | 改：端点规则「{{name}}」的字段 JSON 解析失败： |
| E19 | `agentRules.json · endpointRules.title` | Endpoint 规则（按 SDK 区分，一个规则一张卡片） | 改：端点规则（按 SDK 区分，一个规则一张卡片） |
| E20 | `agentRules.json · endpointRules.add` | 添加 Endpoint 规则 | 改：添加端点规则 |
| E21 | `agentRules.json · endpointRules.hint` | 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和不带 /v1 的 /chat/completion）；不含 * 的须与 Endp… | 改：每个端点一条规则：归纳范围填端点匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和不带 /v1 的 /chat/completion）；不含 * 的须与端点完全相等（如 responses）… |
| E22 | `agentRules.json · endpointRules.empty` | 尚未添加任何 Endpoint 规则；点击右上「添加 Endpoint 规则」新建。 | 改：尚未添加任何端点规则；点击右上「添加端点规则」新建。 |
| E23 | `agentRules.json · endpointRules.index` | Endpoint 规则 {{n}} | 改：端点规则 {{n}} |
| E24 | `agentRules.json · endpointRules.tagsLabel` | 归纳范围（Endpoint 匹配词，逗号分隔；含 * 通配，不含 * 精确） | 改：归纳范围（端点匹配词，逗号分隔；含 * 通配，不含 * 精确） |
| E25 | `agentRules.json · endpointRules.privateLabel` | 私有配置（该 Endpoint 的字段推荐表） | 改：私有配置（该端点的字段推荐表） |
| E26 | `errorsAgent.json · MANAGED_NO_AVAILABLE_ENDPOINT` | 所选供应商没有可用的 Endpoint | 改：所选供应商没有可用的端点 |
| E27 | `errorsAgent.json · MANAGED_SUFFIX_REQUIRED` | 有多个 Endpoint 分组，必须为 {{endpoint}} 填写后缀 | 改：有多个端点分组，必须为 {{endpoint}} 填写后缀 |
| E28 | `provider.json · form.deleteEndpointAria` | 删除 Endpoint | 改：删除端点 |
| E29 | `handler/agent_managed.go:771` | 所选供应商没有可用的 Endpoint | 改：所选供应商没有可用的端点 |
| E30 | `handler/agent_managed.go:782` | 有多个 Endpoint 分组，必须为 %s 填写后缀 | 改：有多个端点分组，必须为 %s 填写后缀 |
| E31 | `handler/relay.go:50` | 无法为 %s 找到可用供应商：该模型不支持请求路径 %s（模型声明的 Endpoint：%s）。请在供应商页对应模型行补充该 Endpoint，或改用模型支持的路径。 | 改：无法为 %s 找到可用供应商：该模型不支持请求路径 %s（模型声明的端点：%s）。请在供应商页对应模型行补充该端点，或改用模型支持的路径。 |
| E32 | `handler/relay.go:67` | 无法为 %s 找到可用供应商，请检查：模型名（区分大小写）、Endpoints 白名单、供应商/工作流开关、故障转移状态、拓扑接线。 | 改：无法为 %s 找到可用供应商，请检查：模型名（区分大小写）、端点白名单、供应商/工作流开关、故障转移状态、拓扑接线。 |
| E33 | `model/agent_config.go:431` | 接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由 endpoint 关键词自动归类 | 改：接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由端点关键词自动归类 |
| E34 | `model/agent_config.go:438` | AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类 | 改：AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由端点关键词自动归类 |
| E35 | `model/agent_config.go:439` | 运行时适配器包（@opencode/ai/providers/openai-compatible / openai / anthropic），一般由 endpoint 关键词自动归类 | 改：运行时适配器包（@opencode/ai/providers/openai-compatible / openai / anthropic），一般由端点关键词自动归类 |
| E36 | `model/agent_config.go:452` | 接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由 endpoint 关键词自动归类 | 改：接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由端点关键词自动归类 |
| E37 | `model/agent_config.go:1183` | AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类 | 改：AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由端点关键词自动归类 |
| E38 | `model/agent_config.go:1231` | 运行时适配器包（@opencode/ai/providers/openai-compatible / openai / anthropic），一般由 endpoint 关键词自动归类 | 改：运行时适配器包（@opencode/ai/providers/openai-compatible / openai / anthropic），一般由端点关键词自动归类 |
| E39 | `model/agent_config.go:1312` | 接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由 endpoint 关键词自动归类 | 改：接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由端点关键词自动归类 |
| E40 | `model/agent_config.go:1373` | 接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由 endpoint 关键词自动归类 | 改：接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由端点关键词自动归类 |
| E41 | `agent-templates/DeepSeek Harness (Desktop).json:70` | 接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由 endpoint 关键词自动归类 | 改：接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由端点关键词自动归类 |
| E42 | `agent-templates/DeepSeek Harness (Web).json:70` | 接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由 endpoint 关键词自动归类 | 改：接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由端点关键词自动归类 |
| E43 | `agent-templates/openclaw.json:49` | 接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由 endpoint 关键词自动归类 | 改：接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由端点关键词自动归类 |
| E44 | `agent-templates/opencode-v1.json:42` | AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类 | 改：AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由端点关键词自动归类 |
| E45 | `agent-templates/opencode-v2.json:51` | 运行时适配器包（@opencode/ai/providers/openai-compatible / openai / anthropic），一般由 endpoint 关键词自动归类 | 改：运行时适配器包（@opencode/ai/providers/openai-compatible / openai / anthropic），一般由端点关键词自动归类 |

## 二、Key → 令牌（含 Token 的取舍）（35 处）

| 编号 | 位置 | 现状 | 建议 |
| --- | --- | --- | --- |
| T1 | `agentConfig.json · toast.apiKeyRequired` | 请选择接入用的令牌 Key（必填） | 改：请选择接入用的令牌（必填） |
| T2 | `agentConfig.json · managedDialog.apiKeyLabel` | 接入 Key | 改：接入令牌 |
| T3 | `agentConfig.json · managedDialog.apiKeyRequiredSuffix` | （令牌页创建的 Key，必填） | 改：（在令牌页创建，必填） |
| T4 | `agentConfig.json · managedDialog.apiKeyPlaceholder` | 选择接入用的令牌 Key | 改：选择接入用的令牌 |
| T5 | `agentConfig.json · managedDialog.noTokens` | 暂无令牌，请先到令牌页创建 | 保留：已用「令牌」 |
| T6 | `agentConfig.json · managedDialog.apiKeyHint` | 必填：写入生成配置的 apiKey，Agent 用它接入本系统；留空不再自动借用所勾选供应商的 Key。只认凭据引用（apiKeyEnv）的软件（如 dsh）会同步写进其凭据库（.credentials.yaml） | 改：…留空不再自动借用所勾选供应商的令牌。… |
| T7 | `agentRules.json · modelInfoFields.maxOutputToken` | 最大输出 Token | 保留：LLM 用量计数，业界惯例写 Token |
| T8 | `api.json · fields.token` | 令牌 | 保留：已用「令牌」 |
| T9 | `api.json · fields.tokenList` | 令牌列表 | 保留：已用「令牌」 |
| T10 | `common.json · nav.token` | 令牌 | 保留：已用「令牌」 |
| T11 | `common.json · nav.tokenUsage` | 查询 Token 用量 | 保留：LLM 用量计数 |
| T12 | `errorsCore.json · TOKEN_NAME_EXISTS` | 令牌名称已存在 | 保留：已用「令牌」 |
| T13 | `logs.json · columns.token` | 令牌 | 保留：已用「令牌」 |
| T14 | `logs.json · filters.token` | 令牌 | 保留：已用「令牌」 |
| T15 | `logs.json · filters.allTokens` | 全部令牌 | 保留：已用「令牌」 |
| T16 | `logs.json · monitor.metrics.totalTokens` | 总 Token | 保留：LLM 用量计数 |
| T17 | `logs.json · detail.providerKey` | 上游 Key | 保留：指上游供应商密钥，和「令牌」不是一回事 |
| T18 | `logs.json · detail.downstreamKey` | 下游 Key | 保留：指下游密钥，和「令牌」不是一回事 |
| T19 | `node.json · provider.modelKeyCounts` | 模型 {{modelCount}} · Key {{keyCount}} | 改：模型 {{modelCount}} · 令牌 {{keyCount}} |
| T20 | `policy.json · failover.form.speedLabel` | 速度限制（Token/s） | 保留：LLM 速度单位 |
| T21 | `policy.json · failover.form.speedHint` | 填 0 表示不限制；填大于 0 表示请求全程速度（总 Token ÷ 含建连的总耗时）低于 N Token/s 也算一次失败，计入禁用阈值（与匹配字段 OR 关系）。 | 保留：LLM 速度单位 |
| T22 | `provider.json · dialog.endpointUseKey` | 是否传入 Key | 保留：指上游供应商密钥 |
| T23 | `provider.json · dialog.endpointUseKeyHint` | 将使用当前供应商的第一个 Key 作为 Bearer 凭证 | 保留：指上游供应商密钥 |
| T24 | `settings.json · general.ownEndpointHintSuffix` | ），使用 Bearer Token 鉴权，调用方式与其他对外接口一致。 | 保留：指 HTTP Bearer 协议字段 |
| T25 | `settings.json · backup.moduleTokens` | 令牌 | 保留：已用「令牌」 |
| T26 | `settings.json · tokenUsage.pageDescription` | 配置从上游响应体读取 Token 用量的字段路径（gjson），按顺序尝试，命中即停 | 保留：LLM 用量计数 |
| T27 | `settings.json · tokenUsage.dialogTitle` | Token 用量字段配置 | 保留：LLM 用量计数 |
| T28 | `settings.json · tokenUsage.footnote` | 保存后即时生效：系统记录请求的 Token 用量时，将从这些路径依次读取四个计数（输入 / 缓存写入 / 缓存读取 / 输出）。 | 保留：LLM 用量计数 |
| T29 | `token.json · description` | 为客户端签发 API 访问令牌，配置访问额度与允许的模型 | 保留：已用「令牌」 |
| T30 | `token.json · list.statusCount` | {{count}} 个令牌 | 保留：已用「令牌」 |
| T31 | `token.json · list.empty` | 暂无令牌。添加一个令牌开始使用。 | 保留：已用「令牌」 |
| T32 | `token.json · list.add` | 添加令牌 | 保留：已用「令牌」 |
| T33 | `token.json · dialog.editTitle` | 编辑令牌 | 保留：已用「令牌」 |
| T34 | `token.json · dialog.deleteDescription` | 将删除令牌「{{name}}」，使用该令牌的请求将立即失效，删除后不可恢复。 | 保留：已用「令牌」 |
| T35 | `token.json · form.serverGenerates` | 服务端会在保存后生成 Token Key。 | 可改「服务端保存后会生成令牌 Key」；不改也行 |

## 三、workflow → 工作流（5 处）

| 编号 | 位置 | 现状 | 建议 |
| --- | --- | --- | --- |
| W1 | `lib.json · doc.workflowMustBeArray` | 第 {{index}} 条 workflow 必须是数组 | 改：第 {{index}} 条工作流必须是数组 |
| W2 | `lib.json · doc.workflowNotEmpty` | 第 {{index}} 条 workflow 不能为空 | 改：第 {{index}} 条工作流不能为空 |
| W3 | `lib.json · doc.workflowFirstNode` | 第 {{index}} 条 workflow 的第一个节点必须是供应商 | 改：第 {{index}} 条工作流的第一个节点必须是供应商 |
| W4 | `settings.json · debug.nodeInfoDescription` | 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true weight=1\n  ✓ slot:  pslot-test enabled=true… | 保留：console 日志原文样例 |
| W5 | `settings.json · debug.flowLightsDescription` | 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→pslot-test→prov-xxx→…\n[流光Debug] run#12 step 3… | 保留：console 日志原文样例 |

## 四、model → 模型（19 处）

| 编号 | 位置 | 现状 | 建议 |
| --- | --- | --- | --- |
| M1 | `agentRules.json · form.modelPathLabel` | model gjson 路径 | 改：模型 gjson 路径 |
| M2 | `agentRules.json · form.modelPathHint` | 完整 gjson 路径，model 里用 {provider_id} 占位当前供应商键名；YAML 文件（如 dsh）可写 `#(id=="xxx")` 查询段先按 ID 定位插件条目 | 改：完整 gjson 路径，模型路径里用 {provider_id} 占位当前供应商键名；… |
| M3 | `agentRules.json · form.commonHint` | 与请求协议 / SDK 无关的字段推荐值。每行一个字段：路径 / 落在（provider\|model）/ 推荐操作（填 / 不填 / 删除）/ 推荐值 / 值写法（op / sep / 允许值白名单）/ 必填 / 说明。与页面里其余配置用同一套「值 + 写法」规则；整行空白的行保存时自动丢弃。需要直… | 保留：字面量（gjson 路径 / 枚举值 / 请求字段名 / 数据插值） |
| M4 | `agentRules.json · endpointRules.hint` | 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和不带 /v1 的 /chat/completion）；不含 * 的须与 Endp… | 保留：字面量（gjson 路径 / 枚举值 / 请求字段名 / 数据插值） |
| M5 | `errorsAgent.json · AGENT_TYPE_JSON_PATHS_UNCONFIGURED_DETAIL` | 该软件类型尚未配置 JSON 路径，请先在「接管 Agent」中填写 provider/model gjson | 保留：字面量（gjson 路径 / 枚举值 / 请求字段名 / 数据插值） |
| M6 | `errorsAgent.json · MODEL_NOT_FOUND_IN_CONFIG` | 未在配置文件的 {{path}} 中找到模型 {{model}} | 保留：字面量（gjson 路径 / 枚举值 / 请求字段名 / 数据插值） |
| M7 | `provider.json · dialog.syncQuestion` | 确认将模型「{{model}}」的当前价格设置同步到其他供应商的同名模型？ | 保留：字面量（gjson 路径 / 枚举值 / 请求字段名 / 数据插值） |
| M8 | `provider.json · errors.referenceGone` | 参考供应商「{{reference}}」已不在 models.dev 的「{{model}}」供应商列表中，价格快照未更新 | 保留：字面量（gjson 路径 / 枚举值 / 请求字段名 / 数据插值） |
| M9 | `provider.json · errors.priceNotFound` | models.dev 中未查到「{{model}}」在「{{provider}}」下的价格，请点刷新重试 | 保留：字面量（gjson 路径 / 枚举值 / 请求字段名 / 数据插值） |
| M10 | `settings.json · debug.flowLightsDescription` | 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→pslot-test→prov-xxx→…\n[流光Debug] run#12 step 3… | 保留：字面量（gjson 路径 / 枚举值 / 请求字段名 / 数据插值） |
| M11 | `settings.json · affinity.modelFieldsHint` | 在请求体里按 gjson 路径查找模型名；留空时直接用请求的 model 字段（OpenAI 标准）。 | 保留：字面量（gjson 路径 / 枚举值 / 请求字段名 / 数据插值） |
| M12 | `settings.json · affinity.modelFieldsCommon` | 常见路径：model | 保留：字面量（gjson 路径 / 枚举值 / 请求字段名 / 数据插值） |
| M13 | `handler/agent_config.go:945` | 该软件类型尚未配置 JSON 路径，请先在「接管 Agent」中填写 provider/model gjson | 保留：字面量（gjson 路径 / 枚举值 / 请求字段名 / 数据插值） |
| M14 | `handler/agent_config.go:1309` | model %s 字段 %s 删除失败: %v | 改：模型 %s 字段 %s 删除失败: %v |
| M15 | `handler/agent_config.go:1324` | model %s 字段 %s 写入失败: %v | 改：模型 %s 字段 %s 写入失败: %v |
| M16 | `handler/agent_config.go:1528` | model %s 字段 %s 删除失败: %v | 改：模型 %s 字段 %s 删除失败: %v |
| M17 | `handler/agent_config.go:1543` | model %s 字段 %s 写入失败: %v | 改：模型 %s 字段 %s 写入失败: %v |
| M18 | `handler/agent_config.go:1572` | model %s 字段 %s 写入失败: %v | 改：模型 %s 字段 %s 写入失败: %v |
| M19 | `handler/agent_config.go:1770` | model %q 字段 %s: %v | 改：模型 %q 字段 %s: %v |
