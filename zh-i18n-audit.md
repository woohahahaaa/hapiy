# 中文界面文案检查报告

范围：`project/web`（zh 语言包 + 硬编码文案）、`project/backend`（Go 中文提示、Agent 模板）
口径：**只改 UI 显示的文案**；填入 input 的值、代码变量名、枚举值、日志样例不动。
统计只算含中文的字符串，纯英文标签（如 `Base URL`）不计入。

验证（每轮都跑）：`go test ./internal/model/... ./internal/handler/...` ✅ · `npm test`（vitest 379 项 + i18n key 校验）✅

---

## 一、第一轮：中文 provider → 供应商

### 前端 zh 语言包（40 行，7 个文件）

| 文件 | 处数 | 典型 |
| --- | --- | --- |
| `zh/agentConfig.json` | 24 | 修改托管 provider → 修改托管供应商；provider 根路径 → 供应商根路径 |
| `zh/errorsAgent.json` | 4 | 托管 provider 不存在 → 托管供应商不存在 |
| `zh/lib.json` | 4 | 未知的 provider 引用 → 未知的供应商引用 |
| `zh/agentRules.json` | 3 | provider gjson 路径 → 供应商 gjson 路径 |
| `zh/provider.json` | 2 | 命中 N 个现有 provider → 个现有供应商 |
| `zh/topology.json` | 2 | 从 provider 创建工作流 → 从供应商创建工作流 |
| `zh/api.json` | 1 | 托管 provider 列表 → 托管供应商列表 |

### 后端（34 行 Go + 7 行模板 JSON）

| 文件 | 处数 | 典型 |
| --- | --- | --- |
| `internal/handler/agent_config.go` | 7 | provider 路径 %q 在配置文件中未命中 → 供应商路径… |
| `internal/handler/agent_managed.go` | 9 | 托管 provider 不存在 → 托管供应商不存在 |
| `internal/model/agent_config.go` | 11 | 在 opencode 界面里的显示名（provider 名称）→（供应商名称） |
| `config/agent-templates/*.json` | 7 | ChatGPT / opencode-v1 / opencode-v2 / DeepSeek Harness (Desktop\|Web) |

⚠️ 后端 `agentRecommendationDescriptionEn`（中→英映射表）用**中文原文当 key**，所以映射表 key 必须与内置模板、磁盘模板同步改；已同步，英文值未动，`TestLocalizationCoversTemplates` 通过。

### 同步更新的测试断言（2 处）

- `src/lib/topology-edges.test.ts` → `/未知的供应商引用/`
- `src/lib/topology-document.test.ts` → `'第一个节点必须是供应商'`

---

## 二、第二轮：其余 UI 文案规范化

### 2.1 术语统一：提供商 / 服务商 → 供应商（14 行）

| 位置 | 原文案 |
| --- | --- |
| `internal/model/agent_config.go` + 映射表 | 选择器里显示的**提供商**名称、自定义**提供商**的 API 端点、已装目录**提供商**省略、自定义**提供商**必填、与**提供商**侧精确一致、**服务商** API 端点 |
| `config/agent-templates/DeepSeek Harness (Desktop\|Web).json` | 同上 4 条 ×2 |
| `config/agent-templates/openclaw.json` | **服务商** API 端点 |

### 2.2 中英之间补空格（10 行）

`接管Agent` → `接管 Agent`（common / settings / errorsAgent / 后端 respondError）、`同步预设Agent信息` → `同步预设 Agent 信息`、`Agent软件配置文件默认路径` → `Agent 软件配置文件默认路径`、`文件名/请求ID` → `文件名/请求 ID`、`整合JSON` → `整合 JSON`。

### 2.3 标点规范化（约 45 行）

| 项 | 处数 | 处理 |
| --- | --- | --- |
| 省略号 `...` | 17 | → `…`（删除中…、保存中…、同步中…、加载中… 等） |
| 中文里的半角冒号 `:` | 20 | → `：`（读取失败：、解析配置失败：、响应状态码：、选择规则： 等） |
| 直引号 `"` | 10 | → `「」`（点击「添加规则」、名称「{{name}}」、来源名「{{name}}」、如「200 px」） |
| 整句半角 `,` `?` | 4 | `topology.json` 的保存确认 + 3 条删除说明 → `，` `？` |
| 半角括号 | 1 | `重命名/移动 (move)` → `（move）` |

### 2.4 修正上一版的一处误判

`ModelInfoFieldLabels`（数组里写着「最大输出token」，与前端「最大输出 Token」不一致）在代码里**没有任何引用**、不参与渲染 —— 属死表，不是 UI 文案，**未改**。将来真要用，记得与前端对齐。

---

## 三、按"只改 UI 文案"的规则，还剩这些（都是纯 UI 文案，未动）

都是**同一概念两种写法**，改哪边需要你定：

| # | 概念 | 现状 | 影响面 |
| --- | --- | --- | --- |
| 1 | 端点 | `Endpoint` 69 处 vs `端点` 14 处（后端已用「API 端点」） | 最大，跨 agentConfig/provider/logs 等多页 |
| 2 | 令牌 | `令牌` 50 / `Token` 30 / `Key` 11（托管弹窗「接入 Key」、日志「总 Token」） | 中 |
| 3 | 工作流 | `工作流` 18 vs `workflow` 12（`zh/lib.json` 的 4 条校验文案） | 小 |
| 4 | 模型 | `模型` 268 vs `model` 109（「供应商 {{id}} 下没有 models」、「model 里用 {provider_id}」） | 小～中 |

大小写/词形差异（可一并统一，也可不动）：`token` / `Token` / `Tokens`、`Endpoint` / `Endpoints` / `endpoint`、`BaseURL` / `Base URL` / `base URL`、`provider id` / `provider_id` / `ID`。

---

## 四、刻意保留（输入值 / 变量名 / 代码 / 日志样例）

- 输入提示里的真值：`例如：provider`、`例如：provider.{provider_id}.models`、`例如：opencode`、`如 %APPDATA%`、`192.168.1.100 或 tcp://host:34604`
- 枚举/字段名/路径：`落在（provider|model）`、`scope（provider|model）`、`provider_id`、`model_id`、`[model_providers]`、`models.providers`、`@opencode/ai/providers/…`、`provider/model gjson`
- 插值变量：`连接上游{{provider}}`、`在「{{provider}}」下`
- 代码/JSON 片段：`数组 [{"id": ...}]`、`对象 map {"模型 ID": {...}}`、`#(id=="xxx")`、`usage.prompt_tokens`
- 日志样例：`settings.json` 的 `debug.nodeInfoDescription` / `debug.flowLightsDescription`（console 原文，含 `provider=deepseek`）
- 代码注释（含后端 `// 接管Agent 页面按…`）：注释不算 UI，未动

---

## 附录：自动扫描全量清单
### 附录 A：中文语言包里出现英文词的位置（自动扫描）

#### `JSON`（47 条）

- `agentConfig.json` · `columns.providerJson` — 供应商 JSON 片段
- `agentConfig.json` · `errors.cannotPrettify` — 内容不是合法 JSON，无法美化
- `agentConfig.json` · `errors.cannotParseJson` — 无法解析 JSON
- `agentConfig.json` · `errors.parseJson` — JSON 解析失败
- `agentConfig.json` · `codeEditor.cannotParseJson` — 无法解析 JSON
- `agentConfig.json` · `codeEditor.notValidJson` — 内容不是合法 JSON：{{message}}
- `agentConfig.json` · `codeEditor.jsonProblemNear` — 第 {{line}} 行第 {{column}} 列附近可能存在 JSON 格式问题：{{message}}
- `agentConfig.json` · `codeEditor.prettifyTitle` — 在编辑器里重新缩进 JSON；需再点击「保存」才会写入文件
- `agentConfig.json` · `codeEditor.jsonWarningTitle` — JSON 格式可能有误
- `agentConfig.json` · `codeEditor.jsonWarningDescription` — 检测到 JSON 格式问题，是否仍要保存对「{{name}}」的修改？
- `agentRules.json` · `actions.switchToJsonMode` — 切换到 JSON 编辑模式
- `agentRules.json` · `actions.jsonModeForwardTitle` — 把整个弹窗（名称 / 路径 / 模型信息 / 公共配置 / Endpoint 规则）作为一份 JSON 编辑
- `agentRules.json` · `actions.jsonModeBackTitle` — 校验 JSON 并还原成表格编辑；不合法则无法切回
- `agentRules.json` · `form.commonHint` — 与请求协议 / SDK 无关的字段推荐值。每行一个字段：路径 / 落在（provider|model）/ 推荐操作（填 / 不填 / 删除）/ 推荐值 / 值写法（op / sep / 允许值白名单）/ 必填 / 说明。
- `agentRules.json` · `errors.commonParseFailed` — 公共配置 JSON 解析失败：
- `agentRules.json` · `errors.jsonToTableFailed` — JSON 无法还原成表格：
- `agentRules.json` · `errors.commonInvalid` — 当前公共配置不是合法数据：{{message}}，可用左下角「切换到 JSON 编辑模式」修正
- `agentRules.json` · `errors.privateInvalid` — 当前私有配置不是合法数据：{{message}}，可用左下角「切换到 JSON 编辑模式」修正
- `agentRules.json` · `errors.topMustBeJsonObject` — 顶层必须是 JSON 对象（含 name / os_paths / json_paths / model_info_fields / common / protocols）
- `agentRules.json` · `errors.fieldsMustBeArray` — 字段必须写成 JSON 数组，每项一个推荐字段对象
- `agentRules.json` · `errors.commonMustBeArray` — 公共配置必须是 JSON 数组
- `agentRules.json` · `errors.endpointRuleFieldsParseFailed` — Endpoint 规则「{{name}}」的字段 JSON 解析失败：
- `agentRules.json` · `errors.commonMustBeJsonArray` — common 必须是 JSON 数组
- `agentRules.json` · `errors.protocolsMustBeJsonArray` — protocols 必须是 JSON 数组
- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和
- `api.json` · `invalidHttpJson` — 请求失败（HTTP {{status}}）：响应不是有效 JSON
- `api.json` · `invalidJson` — 服务端返回的 {{field}} 不是有效 JSON
- `errorsAgent.json` · `AGENT_TYPE_JSON_PATHS_UNCONFIGURED` — 该软件类型尚未配置 JSON 路径
- `errorsAgent.json` · `AGENT_TYPE_JSON_PATHS_UNCONFIGURED_DETAIL` — 该软件类型尚未配置 JSON 路径，请先在「接管 Agent」中填写 provider/model gjson
- `errorsCore.json` · `JSON_FORMAT_FAILED` — JSON 格式化失败：{{error}}
- `logs.json` · `preview.mergeJson` — 整合 JSON
- `policy.json` · `rewrite.description` — 使用 JSON 操作数组修改请求体字段
- `rewrite.json` · `convention.literalHint` — true/false/null/数字 → JSON 字面量
- `rewrite.json` · `testDialog.invalidJson` — JSON 格式无效，请检查输入
- `settings.json` · `billing.exchangeDialogDescription` — 配置在线获取人民币兑美元汇率的接口：通过 GET 方法请求接口地址，从返回的 JSON 中读取人民币汇率字段。
- `settings.json` · `billing.apiUrlHint` — 这是一个通过 GET 方法可以请求到的地址，返回的 JSON 中需包含人民币汇率字段。
- `settings.json` · `billing.fieldHint` — 返回 JSON 中人民币兑美元汇率所在的字段路径，支持点号分隔，例如 rates.CNY。
- `settings.json` · `recovery.handlerButtonTitle` — 被禁用的瞬间保存请求，按 JSON 处理方法简化后再存储
- `settings.json` · `recovery.handlerDescription` — 禁用瞬间保存请求，按下列 JSON 规则简化；字段不存在时自动跳过。
- `settings.json` · `theme.installedDescription` — 粘贴 shadcn 主题的 JSON 地址即可安装；删除后不可恢复。
- `settings.json` · `theme.installDialogDescription` — 粘贴 shadcn 主题的 JSON 地址，例如 https://ui.shadcn.com/r/themes/zinc.json。
- `topology.json` · `jsonEdit.title` — 编辑 JSON
- `topology.json` · `jsonEdit.formatFailed` — 格式化失败：JSON 无效
- `topology.json` · `jsonEdit.saveConfirmTitle` — 保存 JSON
- `topology.json` · `jsonEdit.saveConfirmDescription` — 你修改了 JSON 内容，确认保存到后端吗？JSON 里的 ID 字段与使用记录、历史记录等按 ID 关联的数据强绑定，修改任意一条 ID 都可能导致这些数据匹配失败。请确认你已了解此风险。
- `topology.json` · `jsonEdit.topLevelArray` — JSON 顶层必须是数组
- `topology.json` · `jsonEditor.contentAria` — JSON 内容

#### `Endpoint`（27 条）

- `agentConfig.json` · `toast.noEndpointProvider` — 请至少勾选一个有 Endpoint 的供应商
- `agentConfig.json` · `toast.manualEndpointRequired` — 有未配置 Endpoint 的供应商：请手动填写 Endpoint，或取消勾选它们
- `agentConfig.json` · `toast.mergedIntoGroup` — 未配置 Endpoint 的供应商已并入分组「{{endpoint}}」
- `agentConfig.json` · `toast.suffixRequired` — 有多个 Endpoint 分组，必须为 {{endpoint}} 填写后缀
- `agentConfig.json` · `toolbar.addManagedTitle` — 把我们系统里录入的供应商按 Endpoint 分组后生成托管供应商
- `agentConfig.json` · `managedDialog.selectProvidersSuffix` — （显示名称 / 模型数 / Endpoint 数）
- `agentConfig.json` · `managedDialog.groupsLabel` — 根据 Endpoint 规则自动归类供应商配置
- `agentConfig.json` · `managedDialog.groupsSuffix` — （命中同一条规则，如 *completion*，的 Endpoint 归为一组）
- `agentConfig.json` · `managedDialog.providerMeta` — {{models}} 模型 · {{endpoints}} Endpoint
- `agentRules.json` · `dialog.templateApplyDetail` — 默认路径、供应商/模型 gjson 路径、模型信息字段、公共配置（common）与各 Endpoint 规则的字段推荐会全部替换为默认值。确认？
- `agentRules.json` · `actions.jsonModeForwardTitle` — 把整个弹窗（名称 / 路径 / 模型信息 / 公共配置 / Endpoint 规则）作为一份 JSON 编辑
- `agentRules.json` · `actions.templateResetTitle` — 将该规则的全部字段（路径 / 模型信息字段 / 公共配置 / 各 Endpoint 规则）重置为系统默认推荐模版
- `agentRules.json` · `jsonMode.hint` — 整个弹窗的 JSONC（含名称 / 路径 / 模型信息字段 / 公共配置 common / 各 Endpoint 规则 protocols）。顶部与每个区块都带 // 说明注释，方便交给其他 Agent 处理；注释不影响
- `agentRules.json` · `errors.protocolMissingTags` — 协议「{{name}}」缺少 endpoint_tags（根据 Endpoint 来判断，必填）
- `agentRules.json` · `errors.endpointRuleMissingName` — Endpoint 规则 #{{n}}：缺少规则名称
- `agentRules.json` · `errors.endpointRuleTagsEmpty` — Endpoint 规则「{{name}}」：归纳范围为空（endpoint_tags 必填）
- `agentRules.json` · `errors.endpointRuleFieldsParseFailed` — Endpoint 规则「{{name}}」的字段 JSON 解析失败：
- `agentRules.json` · `endpointRules.title` — Endpoint 规则（按 SDK 区分，一个规则一张卡片）
- `agentRules.json` · `endpointRules.add` — 添加 Endpoint 规则
- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和
- `agentRules.json` · `endpointRules.empty` — 尚未添加任何 Endpoint 规则；点击右上「添加 Endpoint 规则」新建。
- `agentRules.json` · `endpointRules.index` — Endpoint 规则 {{n}}
- `agentRules.json` · `endpointRules.tagsLabel` — 归纳范围（Endpoint 匹配词，逗号分隔；含 * 通配，不含 * 精确）
- `agentRules.json` · `endpointRules.privateLabel` — 私有配置（该 Endpoint 的字段推荐表）
- `errorsAgent.json` · `MANAGED_NO_AVAILABLE_ENDPOINT` — 所选供应商没有可用的 Endpoint
- `errorsAgent.json` · `MANAGED_SUFFIX_REQUIRED` — 有多个 Endpoint 分组，必须为 {{endpoint}} 填写后缀
- `provider.json` · `form.deleteEndpointAria` — 删除 Endpoint

#### `models.dev`（20 条）

- `agentConfig.json` · `columns.syncFromModelsDev` — 从 models.dev 同步模型配置
- `agentRules.json` · `match.columns.syncFromModelsDev` — 从 models.dev 同步模型配置
- `agentRules.json` · `match.modelNotFound` — 未在 models.dev 查到该模型信息
- `errorsCore.json` · `MODELS_DEV_FETCH_FAILED` — 获取 models.dev 数据失败，请稍后重试
- `lib.json` · `modelsDev.invalidFormat` — models.dev 数据格式无效
- `lib.json` · `modelsDev.requestFailed` — models.dev 数据请求失败（{{status}}）
- `provider.json` · `actions.bulkPrice` — 一键设置 models.dev 供应商
- `provider.json` · `actions.bulkPriceTitle` — 一键从 models.dev 设置价格：参考模式的模型按参考厂商更新；未设置价格的模型自动匹配官方（lab）参考厂商。手动单独设置价格的模型不覆盖。
- `provider.json` · `price.modeReference` — 从 models.dev 同步
- `provider.json` · `price.stale` — 参考供应商已从 models.dev 下架
- `provider.json` · `price.notFound` — 未在 models.dev 查到该模型
- `provider.json` · `errors.modelsDevLoad` — models.dev 数据加载失败，请检查网络
- `provider.json` · `errors.referenceGone` — 参考供应商「{{reference}}」已不在 models.dev 的「{{model}}」供应商列表中，价格快照未更新
- `provider.json` · `errors.refreshFailed` — models.dev 数据拉取失败，价格快照未被覆盖
- `provider.json` · `errors.priceNotFound` — models.dev 中未查到「{{model}}」在「{{provider}}」下的价格，请点刷新重试
- `provider.json` · `errors.bulkRefreshFailed` — models.dev 数据拉取失败，价格未设置
- `provider.json` · `toast.snapshotUpdated` — 已从 models.dev 更新价格快照
- `provider.json` · `toast.bulkFilled` — 已为 {{count}} 个模型从 models.dev 设置价格
- `provider.json` · `toast.bulkVendorless` — {{count}} 个模型未在 models.dev 找到官方参考厂商，未自动设置
- `provider.json` · `autocomplete.loading` — models.dev 数据加载中…

#### `Agent`（17 条）

- `agentConfig.json` · `page.description` — 管理被接管 Agent 的配置文件：路径检测、内容修改与解析方法
- `agentConfig.json` · `form.syncPresetButton` — 同步预设 Agent 信息
- `agentConfig.json` · `form.syncPresetHint` — 选择 {{os}} 后会自动填入默认路径；手动改过路径则不再自动覆盖，可点「同步预设 Agent 信息」重新带入
- `agentConfig.json` · `managedDialog.apiKeyHint` — 必填：写入生成配置的 apiKey，Agent 用它接入本系统；留空不再自动借用所勾选供应商的 Key。只认凭据引用（apiKeyEnv）的软件（如 dsh）会同步写进其凭据库（.credentials.yaml）
- `agentRules.json` · `page.description` — 配置各 Agent 默认配置文件的位置、修改与解析规则；通常沿用系统默认，无需手动添加
- `agentRules.json` · `form.defaultPathsGroup` — Agent 软件配置文件默认路径
- `agentRules.json` · `form.modelsContainerHint` — 决定托管同步时 models 写进配置文件的样子。数组每项带 ID；对象以模型名做键。选错会导致 Agent 启动校验失败
- `agentRules.json` · `jsonMode.hint` — 整个弹窗的 JSONC（含名称 / 路径 / 模型信息字段 / 公共配置 common / 各 Endpoint 规则 protocols）。顶部与每个区块都带 // 说明注释，方便交给其他 Agent 处理；注释不影响
- `agentRules.json` · `modelInfoEditor.hint` — 模型信息字段在各 Agent 配置里的写入方式；「同步模型信息」与托管生成按此写回。每行一个字段：路径为写入位置，留空表示该 Agent 没有这个字段（不写入，显示「未配置」）；写法（op）可选 raw（原样，默认）/ 
- `common.json` · `nav.agent` — 接管 Agent
- `errorsAgent.json` · `AGENT_TYPE_JSON_PATHS_UNCONFIGURED_DETAIL` — 该软件类型尚未配置 JSON 路径，请先在「接管 Agent」中填写 provider/model gjson
- `settings.json` · `baseUrl.cardDescription` — 配置系统的对外 BaseURL，用于 Agent 软件接入
- `settings.json` · `baseUrl.sourceMarkerHintSuffix` —  段即可标记请求来源，系统会按该规则自动识别，无需预先登记。也可以不使用来源标记，直接以「最终 BaseURL」作为接入地址，系统同样会正常转发。下面登记的来源仅用于生成并复制完整地址，方便配置 Agent 时直接粘贴。
- `settings.json` · `other.title` — 开启接管 Agent
- `settings.json` · `other.pageDescription` — 开启后侧边栏显示「接管 Agent」入口，管理接管文件与规则
- `settings.json` · `other.toggleDescription` — 开启后侧边栏显示“接管 Agent”入口（含配置文件、管理规则等）。\n关闭后侧边栏隐藏该入口。
- `settings.json` · `backup.moduleAgent` — 接管 Agent

#### `SSH`（17 条）

- `agentConfig.json` · `form.sshPasswordPlaceholder` — SSH 密码
- `agentConfig.json` · `form.jumpSshPasswordPlaceholder` — 跳板机 SSH 密码
- `agentConfig.json` · `form.sshTestButton` — 测试 SSH 读写能力
- `api.json` · `requestTimeout` — 请求超时（{{seconds}} 秒）：后端没在时限内返回。接管记录在 SSH 远端时读取较慢，稍后重试即可。
- `api.json` · `invalidSshProbe` — 服务端返回的 SSH 探测结果无效
- `api.json` · `fields.sshConfig` — SSH 配置
- `api.json` · `fields.sshAuthType` — SSH 认证方式
- `api.json` · `fields.sshTestResult` — SSH 测试结果
- `errorsAgent.json` · `SSH_AUTH_TYPE_INVALID` — SSH 认证方式必须是 password 或 key
- `errorsAgent.json` · `SSH_CONFIG_PARSE_FAILED` — SSH 配置解析失败：{{error}}
- `errorsAgent.json` · `SSH_CONFIG_REQUIRED` — SSH 配置不能为空
- `errorsAgent.json` · `SSH_HOST_REQUIRED` — SSH 主机地址不能为空
- `errorsAgent.json` · `SSH_PASSWORD_REQUIRED` — SSH 密码不能为空
- `errorsAgent.json` · `SSH_PRIVATE_KEY_REQUIRED` — SSH 私钥不能为空
- `errorsAgent.json` · `SSH_USERNAME_REQUIRED` — SSH 用户名不能为空
- `errorsCore.json` · `SSH_CREDENTIALS_DECRYPT_FAILED` — SSH 凭据解密失败：{{error}}
- `errorsCore.json` · `SSH_CREDENTIALS_ENCRYPT_FAILED` — SSH 凭据加密失败：{{error}}

#### `gjson`（15 条）

- `agentRules.json` · `dialog.templateApplyDetail` — 默认路径、供应商/模型 gjson 路径、模型信息字段、公共配置（common）与各 Endpoint 规则的字段推荐会全部替换为默认值。确认？
- `agentRules.json` · `form.providerPathLabel` — 供应商 gjson 路径
- `agentRules.json` · `form.modelPathLabel` — model gjson 路径
- `agentRules.json` · `form.modelPathHint` — 完整 gjson 路径，model 里用 {provider_id} 占位当前供应商键名；YAML 文件（如 dsh）可写 `#(id=="xxx")` 查询段先按 ID 定位插件条目
- `errorsAgent.json` · `AGENT_TYPE_JSON_PATHS_UNCONFIGURED_DETAIL` — 该软件类型尚未配置 JSON 路径，请先在「接管 Agent」中填写 provider/model gjson
- `rewrite.json` · `path.gjsonPlaceholder` — gjson 路径
- `rewrite.json` · `convention.refHint` — 不加引号 → 变量：header 名或 gjson 路径
- `rewrite.json` · `gjson.triggerLabel` — gjson 路径实例
- `rewrite.json` · `gjson.triggerAria` — gjson 路径实例
- `rewrite.json` · `gjson.syntaxTitle` — gjson 路径语法
- `settings.json` · `recovery.pathPlaceholder` — gjson 路径，如 messages.0.content
- `settings.json` · `tokenUsage.pageDescription` — 配置从上游响应体读取 Token 用量的字段路径（gjson），按顺序尝试，命中即停
- `settings.json` · `tokenUsage.pathPlaceholder` — gjson 路径，如 usage.prompt_tokens
- `settings.json` · `affinity.modelFieldsLabel` — Model 字段（gjson 路径，每行一个）
- `settings.json` · `affinity.modelFieldsHint` — 在请求体里按 gjson 路径查找模型名；留空时直接用请求的 model 字段（OpenAI 标准）。

#### `Key`（11 条）

- `agentConfig.json` · `toast.apiKeyRequired` — 请选择接入用的令牌 Key（必填）
- `agentConfig.json` · `managedDialog.apiKeyLabel` — 接入 Key
- `agentConfig.json` · `managedDialog.apiKeyRequiredSuffix` — （令牌页创建的 Key，必填）
- `agentConfig.json` · `managedDialog.apiKeyPlaceholder` — 选择接入用的令牌 Key
- `agentConfig.json` · `managedDialog.apiKeyHint` — 必填：写入生成配置的 apiKey，Agent 用它接入本系统；留空不再自动借用所勾选供应商的 Key。只认凭据引用（apiKeyEnv）的软件（如 dsh）会同步写进其凭据库（.credentials.yaml）
- `logs.json` · `detail.providerKey` — 上游 Key
- `logs.json` · `detail.downstreamKey` — 下游 Key
- `node.json` · `provider.modelKeyCounts` — 模型 {{modelCount}} · Key {{keyCount}}
- `provider.json` · `dialog.endpointUseKey` — 是否传入 Key
- `provider.json` · `dialog.endpointUseKeyHint` — 将使用当前供应商的第一个 Key 作为 Bearer 凭证
- `token.json` · `form.serverGenerates` — 服务端会在保存后生成 Token Key。

#### `ID`（10 条）

- `agentRules.json` · `form.modelPathHint` — 完整 gjson 路径，model 里用 {provider_id} 占位当前供应商键名；YAML 文件（如 dsh）可写 `#(id=="xxx")` 查询段先按 ID 定位插件条目
- `agentRules.json` · `form.containerObject` — 对象 map {"模型 ID": {...}}（opencode）
- `agentRules.json` · `form.modelsContainerHint` — 决定托管同步时 models 写进配置文件的样子。数组每项带 ID；对象以模型名做键。选错会导致 Agent 启动校验失败
- `logs.json` · `columns.fileName` — 文件名/请求 ID
- `logs.json` · `detail.requestId` — 请求 ID
- `settings.json` · `affinity.sessionFieldsLabel` — Session ID 请求头（每行一个，大小写不敏感）
- `settings.json` · `affinity.sessionRequired` — 启用前请至少填写一个 Session ID 请求头
- `topology.json` · `jsonEdit.saveConfirmDescription` — 你修改了 JSON 内容，确认保存到后端吗？JSON 里的 ID 字段与使用记录、历史记录等按 ID 关联的数据强绑定，修改任意一条 ID 都可能导致这些数据匹配失败。请确认你已了解此风险。
- `topology.json` · `jsonEdit.invalidId` — 每条记录的 ID 必须是大于 0 的整数
- `topology.json` · `jsonEdit.duplicateId` — ID {{id}} 重复

#### `BaseURL`（9 条）

- `agentConfig.json` · `managedDialog.baseUrlHint` — 默认填入系统识别的 BaseURL，可直接编辑；清空则恢复系统默认
- `agentConfig.json` · `managedDialog.sourceHint` — 填写后在 BaseURL 后追加 __来源 段；可留空
- `settings.json` · `baseUrl.pageDescription` — 在 BaseURL 后追加来源标记即可区分请求来源，系统自动识别
- `settings.json` · `baseUrl.cardDescription` — 配置系统的对外 BaseURL，用于 Agent 软件接入
- `settings.json` · `baseUrl.originHint` — 系统对外 BaseURL 的域名（含 scheme 与端口）。生成代理配置与托管「跟随系统」用它，默认取当前网页域名，隧道/反代场景请改成公网地址
- `settings.json` · `baseUrl.finalUrlLabel` — 最终 BaseURL
- `settings.json` · `baseUrl.sourceMarkerHintPrefix` — 在 BaseURL 后追加 
- `settings.json` · `baseUrl.sourceMarkerHintSuffix` —  段即可标记请求来源，系统会按该规则自动识别，无需预先登记。也可以不使用来源标记，直接以「最终 BaseURL」作为接入地址，系统同样会正常转发。下面登记的来源仅用于生成并复制完整地址，方便配置 Agent 时直接粘贴。
- `settings.json` · `page.baseUrlDescription` — 在 BaseURL 后追加来源标记即可区分请求来源，系统自动识别

#### `Token`（9 条）

- `agentRules.json` · `modelInfoFields.maxOutputToken` — 最大输出 Token
- `common.json` · `nav.tokenUsage` — 查询 Token 用量
- `logs.json` · `monitor.metrics.totalTokens` — 总 Token
- `policy.json` · `failover.form.speedHint` — 填 0 表示不限制；填大于 0 表示请求全程速度（总 Token ÷ 含建连的总耗时）低于 N Token/s 也算一次失败，计入禁用阈值（与匹配字段 OR 关系）。
- `settings.json` · `general.ownEndpointHintSuffix` — ），使用 Bearer Token 鉴权，调用方式与其他对外接口一致。
- `settings.json` · `tokenUsage.pageDescription` — 配置从上游响应体读取 Token 用量的字段路径（gjson），按顺序尝试，命中即停
- `settings.json` · `tokenUsage.dialogTitle` — Token 用量字段配置
- `settings.json` · `tokenUsage.footnote` — 保存后即时生效：系统记录请求的 Token 用量时，将从这些路径依次读取四个计数（输入 / 缓存写入 / 缓存读取 / 输出）。
- `token.json` · `form.serverGenerates` — 服务端会在保存后生成 Token Key。

#### `hapiy`（7 条）

- `common.json` · `update.title` — hapiy 版本
- `common.json` · `update.upgradeTitle` — 升级 hapiy
- `common.json` · `update.timeout` — 升级等待超时：请稍后重试，或在终端运行 hapiy upgrade
- `settings.json` · `general.ownTitle` — hapiy 模型列表接口
- `settings.json` · `general.ownDescription` — 对外暴露的 hapiy 自身模型列表路径
- `settings.json` · `general.ownEndpointLabel` — hapiy 模型列表接口路径
- `settings.json` · `general.ownEndpointHintPrefix` — 路径必须以斜杠开头（/）。访问该路径时，hapiy 会以 OpenAI 兼容格式返回自身已知的模型列表（

#### `model`（7 条）

- `agentRules.json` · `form.modelPathLabel` — model gjson 路径
- `agentRules.json` · `form.modelPathHint` — 完整 gjson 路径，model 里用 {provider_id} 占位当前供应商键名；YAML 文件（如 dsh）可写 `#(id=="xxx")` 查询段先按 ID 定位插件条目
- `agentRules.json` · `form.commonHint` — 与请求协议 / SDK 无关的字段推荐值。每行一个字段：路径 / 落在（provider|model）/ 推荐操作（填 / 不填 / 删除）/ 推荐值 / 值写法（op / sep / 允许值白名单）/ 必填 / 说明。
- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和
- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl
- `settings.json` · `affinity.modelFieldsHint` — 在请求体里按 gjson 路径查找模型名；留空时直接用请求的 model 字段（OpenAI 标准）。
- `settings.json` · `affinity.modelFieldsCommon` — 常见路径：model

#### `common`（6 条）

- `agentRules.json` · `dialog.templateApplyDetail` — 默认路径、供应商/模型 gjson 路径、模型信息字段、公共配置（common）与各 Endpoint 规则的字段推荐会全部替换为默认值。确认？
- `agentRules.json` · `form.commonLabel` — 公共配置（common）
- `agentRules.json` · `jsonMode.hint` — 整个弹窗的 JSONC（含名称 / 路径 / 模型信息字段 / 公共配置 common / 各 Endpoint 规则 protocols）。顶部与每个区块都带 // 说明注释，方便交给其他 Agent 处理；注释不影响
- `agentRules.json` · `errors.topMustBeObject` — 顶层必须是 { common, protocols } 对象
- `agentRules.json` · `errors.topMustBeJsonObject` — 顶层必须是 JSON 对象（含 name / os_paths / json_paths / model_info_fields / common / protocols）
- `agentRules.json` · `errors.commonMustBeJsonArray` — common 必须是 JSON 数组

#### `HTTP`（5 条）

- `api.json` · `httpError` — 请求失败（HTTP {{status}}）
- `api.json` · `loginFailed` — 登录失败（HTTP {{status}}）
- `api.json` · `invalidHttpJson` — 请求失败（HTTP {{status}}）：响应不是有效 JSON
- `api.json` · `metricsFailed` — 获取指标失败（HTTP {{status}}）
- `rewrite.json` · `gjson.examples.header` — HTTP header（scope=header 时，路径只填名字，如 X-Request-ID）

#### `key`（5 条）

- `agentRules.json` · `errors.fieldMissingKey` — 字段缺少 key（字段路径）
- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和
- `errorsAgent.json` · `JUMP_AUTH_TYPE_INVALID` — 跳板机认证方式必须是 password 或 key
- `errorsAgent.json` · `SSH_AUTH_TYPE_INVALID` — SSH 认证方式必须是 password 或 key
- `errorsCore.json` · `SETTING_KEY_REQUIRED` — 配置项 key 不能为空

#### `protocols`（5 条）

- `agentRules.json` · `jsonMode.hint` — 整个弹窗的 JSONC（含名称 / 路径 / 模型信息字段 / 公共配置 common / 各 Endpoint 规则 protocols）。顶部与每个区块都带 // 说明注释，方便交给其他 Agent 处理；注释不影响
- `agentRules.json` · `errors.topMustBeObject` — 顶层必须是 { common, protocols } 对象
- `agentRules.json` · `errors.topMustBeJsonObject` — 顶层必须是 JSON 对象（含 name / os_paths / json_paths / model_info_fields / common / protocols）
- `agentRules.json` · `errors.protocolItemMustBeObject` — protocols 里每一项必须是对象
- `agentRules.json` · `errors.protocolsMustBeJsonArray` — protocols 必须是 JSON 数组

#### `provider`（5 条）

- `agentRules.json` · `form.providerPathPlaceholder` — 例如：provider
- `agentRules.json` · `form.commonHint` — 与请求协议 / SDK 无关的字段推荐值。每行一个字段：路径 / 落在（provider|model）/ 推荐操作（填 / 不填 / 删除）/ 推荐值 / 值写法（op / sep / 允许值白名单）/ 必填 / 说明。
- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和
- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 
- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `URL`（5 条）

- `errorsAgent.json` · `MODEL_FETCH_URL_INVALID` — 接口地址必须是 http(s) URL
- `logs.json` · `detail.upstreamUrl` — 上游 URL
- `logs.json` · `detail.downstreamUrl` — 下游 URL
- `provider.json` · `dialog.endpointPathHint` — 路径必须以斜杠开头（/），将拼接在 Base URL 之后
- `settings.json` · `general.defaultEndpointHint` — 路径必须以斜杠开头（/），将拼接在供应商的 Base URL 之后。当供应商表单中「从上游获取模型」未单独配置接口地址时，将使用此路径作为回退。

#### `v`（5 条）

- `common.json` · `update.latest` — 检测到新版本 v{{version}}
- `common.json` · `update.upToDate` — 已是最新版本 v{{version}}
- `common.json` · `update.upgradeConfirm` — 将从 v{{from}} 升级到 v{{to}}：下载并替换程序文件后后端会自动重启，大约十几秒不可用，完成后页面自动刷新。
- `common.json` · `update.prepare` — 正在准备下载 v{{version}}…
- `common.json` · `update.downloading` — 正在下载并安装 v{{version}}

#### `workflow`（5 条）

- `lib.json` · `doc.workflowMustBeArray` — 第 {{index}} 条 workflow 必须是数组
- `lib.json` · `doc.workflowNotEmpty` — 第 {{index}} 条 workflow 不能为空
- `lib.json` · `doc.workflowFirstNode` — 第 {{index}} 条 workflow 的第一个节点必须是供应商
- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 
- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `completion`（4 条）

- `agentConfig.json` · `managedDialog.groupsSuffix` — （命中同一条规则，如 *completion*，的 Endpoint 归为一组）
- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和
- `agentRules.json` · `endpointRules.tagsPlaceholder` — 例如：*completion*, *responses*, *message*
- `settings.json` · `tokenUsage.completionHint` — 输出 Tokens（completion tokens）

#### `OR`（4 条）

- `node.json` · `switch.logicOr` — OR（任一满足）
- `policy.json` · `failover.form.speedHint` — 填 0 表示不限制；填大于 0 表示请求全程速度（总 Token ÷ 含建连的总耗时）低于 N Token/s 也算一次失败，计入禁用阈值（与匹配字段 OR 关系）。
- `policy.json` · `failover.form.ttfbHint` — 填 0 表示不启用此条件；填大于 0 表示首字响应超过 N 秒也会触发转移（与匹配字段 OR 关系）。
- `rewrite.json` · `logic.or` — OR（任一满足）

#### `provider_id`（4 条）

- `agentRules.json` · `form.modelPathPlaceholder` — 例如：provider.{provider_id}.models
- `agentRules.json` · `form.modelPathHint` — 完整 gjson 路径，model 里用 {provider_id} 占位当前供应商键名；YAML 文件（如 dsh）可写 `#(id=="xxx")` 查询段先按 ID 定位插件条目
- `errorsAgent.json` · `PROVIDER_AND_MODEL_ID_REQUIRED` — provider_id 与 model_id 不能为空
- `errorsAgent.json` · `PROVIDER_ID_REQUIRED` — provider_id 不能为空

#### `Tokens`（4 条）

- `settings.json` · `tokenUsage.promptHint` — 输入 Tokens（prompt tokens）
- `settings.json` · `tokenUsage.cacheWriteHint` — 写入缓存的 Tokens
- `settings.json` · `tokenUsage.cacheReadHint` — 命中缓存的 Tokens
- `settings.json` · `tokenUsage.completionHint` — 输出 Tokens（completion tokens）

#### `API`（3 条）

- `logs.json` · `page.usage.description` — 查询 API 请求的使用记录、消耗与耗时
- `provider.json` · `description` — 管理上游 API 供应商配置
- `token.json` · `description` — 为客户端签发 API 访问令牌，配置访问额度与允许的模型

#### `Base`（3 条）

- `provider.json` · `dialog.endpointPathHint` — 路径必须以斜杠开头（/），将拼接在 Base URL 之后
- `provider.json` · `errors.baseUrlRequired` — 请先在上方填写 Base URLs
- `settings.json` · `general.defaultEndpointHint` — 路径必须以斜杠开头（/），将拼接在供应商的 Base URL 之后。当供应商表单中「从上游获取模型」未单独配置接口地址时，将使用此路径作为回退。

#### `Debug`（3 条）

- `settings.json` · `debug.nodeInfoTitle` — 节点信息 Debug
- `settings.json` · `debug.flowLightsTitle` — 节点流光 Debug
- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `false`（3 条）

- `agentRules.json` · `modelInfoEditor.hint` — 模型信息字段在各 Agent 配置里的写入方式；「同步模型信息」与托管生成按此写回。每行一个字段：路径为写入位置，留空表示该 Agent 没有这个字段（不写入，显示「未配置」）；写法（op）可选 raw（原样，默认）/ 
- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 
- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `header`（3 条）

- `rewrite.json` · `path.headerPlaceholder` — header 名（不用写 header.）
- `rewrite.json` · `convention.refHint` — 不加引号 → 变量：header 名或 gjson 路径
- `rewrite.json` · `gjson.examples.header` — HTTP header（scope=header 时，路径只填名字，如 X-Request-ID）

#### `lab`（3 条）

- `agentConfig.json` · `managedDialog.bulkSetTitle` — 把全部模型设为官方（lab）参考厂商；没有官方来源的模型取其候选列表第一个
- `agentRules.json` · `match.officialTitle` — 把全部模型设为官方（lab）参考厂商；没有官方来源的取其候选列表第一个
- `provider.json` · `actions.bulkPriceTitle` — 一键从 models.dev 设置价格：参考模式的模型按参考厂商更新；未设置价格的模型自动匹配官方（lab）参考厂商。手动单独设置价格的模型不覆盖。

#### `models`（3 条）

- `agentConfig.json` · `jsonErrors.providerNoModels` — 供应商 {{id}} 下没有 models
- `agentRules.json` · `form.modelPathPlaceholder` — 例如：provider.{provider_id}.models
- `agentRules.json` · `form.modelsContainerHint` — 决定托管同步时 models 写进配置文件的样子。数组每项带 ID；对象以模型名做键。选错会导致 Agent 启动校验失败

#### `N`（3 条）

- `policy.json` · `failover.form.speedHint` — 填 0 表示不限制；填大于 0 表示请求全程速度（总 Token ÷ 含建连的总耗时）低于 N Token/s 也算一次失败，计入禁用阈值（与匹配字段 OR 关系）。
- `policy.json` · `failover.form.ttfbHint` — 填 0 表示不启用此条件；填大于 0 表示首字响应超过 N 秒也会触发转移（与匹配字段 OR 关系）。
- `policy.json` · `failover.form.thresholdHint` — 窗口期内连续命中 N 次才禁用。窗口填 0 表示不限时间；次数填 1 等于「一次就禁」。

#### `name`（3 条）

- `agentRules.json` · `errors.topMustBeJsonObject` — 顶层必须是 JSON 对象（含 name / os_paths / json_paths / model_info_fields / common / protocols）
- `agentRules.json` · `errors.protocolMissingName` — 协议块缺少 name
- `agentRules.json` · `errors.dialogNameRequired` — 缺少 name（规则名称）

#### `op`（3 条）

- `agentRules.json` · `form.commonHint` — 与请求协议 / SDK 无关的字段推荐值。每行一个字段：路径 / 落在（provider|model）/ 推荐操作（填 / 不填 / 删除）/ 推荐值 / 值写法（op / sep / 允许值白名单）/ 必填 / 说明。
- `agentRules.json` · `modelInfoEditor.hint` — 模型信息字段在各 Agent 配置里的写入方式；「同步模型信息」与托管生成按此写回。每行一个字段：路径为写入位置，留空表示该 Agent 没有这个字段（不写入，显示「未配置」）；写法（op）可选 raw（原样，默认）/ 
- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和

#### `OpenAI`（3 条）

- `agentRules.json` · `endpointRules.namePlaceholder` — 例如：OpenAI 兼容 Chat Completions
- `settings.json` · `general.ownEndpointHintPrefix` — 路径必须以斜杠开头（/）。访问该路径时，hapiy 会以 OpenAI 兼容格式返回自身已知的模型列表（
- `settings.json` · `affinity.modelFieldsHint` — 在请求体里按 gjson 路径查找模型名；留空时直接用请求的 model 字段（OpenAI 标准）。

#### `opencode`（3 条）

- `agentRules.json` · `form.namePlaceholder` — 例如：opencode
- `agentRules.json` · `form.windowsPathPlaceholder` — 例如：%USERPROFILE%\.config\opencode\opencode.json
- `agentRules.json` · `form.containerObject` — 对象 map {"模型 ID": {...}}（opencode）

#### `path`（3 条）

- `agentRules.json` · `errors.modelInfoPathRequiredAt` — model_info_fields.{{key}}：请先填写 path（{{label}} 的写入位置）
- `errorsAgent.json` · `PATH_PARAM_REQUIRED` — 缺少 path 参数
- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `SDK`（3 条）

- `agentRules.json` · `form.commonHint` — 与请求协议 / SDK 无关的字段推荐值。每行一个字段：路径 / 落在（provider|model）/ 推荐操作（填 / 不填 / 删除）/ 推荐值 / 值写法（op / sep / 允许值白名单）/ 必填 / 说明。
- `agentRules.json` · `endpointRules.title` — Endpoint 规则（按 SDK 区分，一个规则一张卡片）
- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和

#### `sep`（3 条）

- `agentRules.json` · `form.commonHint` — 与请求协议 / SDK 无关的字段推荐值。每行一个字段：路径 / 落在（provider|model）/ 推荐操作（填 / 不填 / 删除）/ 推荐值 / 值写法（op / sep / 允许值白名单）/ 必填 / 说明。
- `agentRules.json` · `modelInfoEditor.hint` — 模型信息字段在各 Agent 配置里的写入方式；「同步模型信息」与托管生成按此写回。每行一个字段：路径为写入位置，留空表示该 Agent 没有这个字段（不写入，显示「未配置」）；写法（op）可选 raw（原样，默认）/ 
- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和

#### `Session`（3 条）

- `settings.json` · `affinity.pageDescription` — 同一会话（Session + 模型）的请求优先复用上次用过的渠道，避免多渠道轮换把上下文拆散
- `settings.json` · `affinity.sessionFieldsLabel` — Session ID 请求头（每行一个，大小写不敏感）
- `settings.json` · `affinity.sessionRequired` — 启用前请至少填写一个 Session ID 请求头

#### `shadcn`（3 条）

- `settings.json` · `theme.pageDescription` — 配置深色/浅色模式使用的主题，并安装 shadcn 主题
- `settings.json` · `theme.installedDescription` — 粘贴 shadcn 主题的 JSON 地址即可安装；删除后不可恢复。
- `settings.json` · `theme.installDialogDescription` — 粘贴 shadcn 主题的 JSON 地址，例如 https://ui.shadcn.com/r/themes/zinc.json。

#### `true`（3 条）

- `agentRules.json` · `modelInfoEditor.hint` — 模型信息字段在各 Agent 配置里的写入方式；「同步模型信息」与托管生成按此写回。每行一个字段：路径为写入位置，留空表示该 Agent 没有这个字段（不写入，显示「未配置」）；写法（op）可选 raw（原样，默认）/ 
- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 
- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `admin`（2 条）

- `auth.json` · `login.usernamePlaceholder` — 请输入用户名，默认 admin
- `auth.json` · `login.passwordPlaceholder` — 请输入密码，默认 admin

#### `AND`（2 条）

- `node.json` · `switch.logicAnd` — AND（都满足）
- `rewrite.json` · `logic.and` — AND（都满足）

#### `autoDisabled`（2 条）

- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 
- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `Bearer`（2 条）

- `provider.json` · `dialog.endpointUseKeyHint` — 将使用当前供应商的第一个 Key 作为 Bearer 凭证
- `settings.json` · `general.ownEndpointHintSuffix` — ），使用 Bearer Token 鉴权，调用方式与其他对外接口一致。

#### `Ctrl/Cmd`（2 条）

- `topology.json` · `toolbar.undoTitle` — 撤销 (Ctrl/Cmd+Z)
- `topology.json` · `toolbar.redoTitle` — 重做 (Ctrl/Cmd+Shift+Z)

#### `data`（2 条）

- `errorsAgent.json` · `UPSTREAM_BODY_INVALID` — 上游响应缺少 data 数组
- `logs.json` · `preview.noData` — （无 data）

#### `delete`（2 条）

- `rewrite.json` · `mode.delete` — 删除字段 (delete)
- `rewrite.json` · `respMode.delete` — 删除字段 (delete)

#### `dsh`（2 条）

- `agentConfig.json` · `managedDialog.apiKeyHint` — 必填：写入生成配置的 apiKey，Agent 用它接入本系统；留空不再自动借用所勾选供应商的 Key。只认凭据引用（apiKeyEnv）的软件（如 dsh）会同步写进其凭据库（.credentials.yaml）
- `agentRules.json` · `form.modelPathHint` — 完整 gjson 路径，model 里用 {provider_id} 占位当前供应商键名；YAML 文件（如 dsh）可写 `#(id=="xxx")` 查询段先按 ID 定位插件条目

#### `endpoint_tags`（2 条）

- `agentRules.json` · `errors.protocolMissingTags` — 协议「{{name}}」缺少 endpoint_tags（根据 Endpoint 来判断，必填）
- `agentRules.json` · `errors.endpointRuleTagsEmpty` — Endpoint 规则「{{name}}」：归纳范围为空（endpoint_tags 必填）

#### `entry-test`（2 条）

- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 
- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `first_prepend`（2 条）

- `rewrite.json` · `mode.firstPrepend` — 流式首段前置 (first_prepend)
- `rewrite.json` · `respMode.firstPrepend` — 加前缀 (first_prepend)

#### `GET`（2 条）

- `settings.json` · `billing.exchangeDialogDescription` — 配置在线获取人民币兑美元汇率的接口：通过 GET 方法请求接口地址，从返回的 JSON 中读取人民币汇率字段。
- `settings.json` · `billing.apiUrlHint` — 这是一个通过 GET 方法可以请求到的地址，返回的 JSON 中需包含人民币汇率字段。

#### `http`（2 条）

- `errorsAgent.json` · `MODEL_FETCH_URL_INVALID` — 接口地址必须是 http(s) URL
- `settings.json` · `billing.invalidUrl` — 接口地址必须以 http:// 或 https:// 开头

#### `https`（2 条）

- `settings.json` · `billing.invalidUrl` — 接口地址必须以 http:// 或 https:// 开头
- `settings.json` · `theme.installDialogDescription` — 粘贴 shadcn 主题的 JSON 地址，例如 https://ui.shadcn.com/r/themes/zinc.json。

#### `id`（2 条）

- `agentRules.json` · `form.modelPathHint` — 完整 gjson 路径，model 里用 {provider_id} 占位当前供应商键名；YAML 文件（如 dsh）可写 `#(id=="xxx")` 查询段先按 ID 定位插件条目
- `agentRules.json` · `form.containerArray` — 数组 [{"id": ...}]（openclaw）

#### `JSONC`（2 条）

- `agentRules.json` · `jsonMode.hint` — 整个弹窗的 JSONC（含名称 / 路径 / 模型信息字段 / 公共配置 common / 各 Endpoint 规则 protocols）。顶部与每个区块都带 // 说明注释，方便交给其他 Agent 处理；注释不影响
- `errorsCore.json` · `JSONC_PARSE_FAILED` — JSONC 解析失败：{{error}}

#### `last_append`（2 条）

- `rewrite.json` · `mode.lastAppend` — 流式末段追加 (last_append)
- `rewrite.json` · `respMode.lastAppend` — 加后缀 (last_append)

#### `mac`（2 条）

- `errorsAgent.json` · `SYSTEM_OS_INVALID` — 本机系统必须是 windows、mac 或 other
- `errorsAgent.json` · `TARGET_OS_INVALID` — 目标系统必须是 windows、mac 或 other

#### `model_info_fields`（2 条）

- `agentRules.json` · `errors.topMustBeJsonObject` — 顶层必须是 JSON 对象（含 name / os_paths / json_paths / model_info_fields / common / protocols）
- `agentRules.json` · `errors.modelInfoFieldsMustBeObject` — model_info_fields 必须是对象

#### `move`（2 条）

- `rewrite.json` · `mode.move` — 重命名/移动（move）
- `rewrite.json` · `respMode.move` — 重命名字段 (move)

#### `openclaw`（2 条）

- `agentRules.json` · `form.containerArray` — 数组 [{"id": ...}]（openclaw）
- `agentRules.json` · `modelInfoEditor.hint` — 模型信息字段在各 Agent 配置里的写入方式；「同步模型信息」与托管生成按此写回。每行一个字段：路径为写入位置，留空表示该 Agent 没有这个字段（不写入，显示「未配置」）；写法（op）可选 raw（原样，默认）/ 

#### `other`（2 条）

- `errorsAgent.json` · `SYSTEM_OS_INVALID` — 本机系统必须是 windows、mac 或 other
- `errorsAgent.json` · `TARGET_OS_INVALID` — 目标系统必须是 windows、mac 或 other

#### `password`（2 条）

- `errorsAgent.json` · `JUMP_AUTH_TYPE_INVALID` — 跳板机认证方式必须是 password 或 key
- `errorsAgent.json` · `SSH_AUTH_TYPE_INVALID` — SSH 认证方式必须是 password 或 key

#### `pslot-test`（2 条）

- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 
- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `px`（2 条）

- `ui.json` · `dataTable.widthFormatInvalid` — 必须以 % 或 pt/px 结尾（如「200 px」或「30 %」）
- `ui.json` · `columns.widthPlaceholder` — 如 200 px 或 30 %

#### `rates.CNY`（2 条）

- `settings.json` · `billing.fieldPlaceholder` — rates.CNY 或 conversion_rates.CNY
- `settings.json` · `billing.fieldHint` — 返回 JSON 中人民币兑美元汇率所在的字段路径，支持点号分隔，例如 rates.CNY。

#### `responses`（2 条）

- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和
- `agentRules.json` · `endpointRules.tagsPlaceholder` — 例如：*completion*, *responses*, *message*

#### `scope`（2 条）

- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和
- `rewrite.json` · `gjson.examples.header` — HTTP header（scope=header 时，路径只填名字，如 X-Request-ID）

#### `status`（2 条）

- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 
- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `think`（2 条）

- `rewrite.json` · `respValue.firstPrependPlaceholder` — 要加的前缀（如 \n<think>）
- `rewrite.json` · `respValue.lastAppendPlaceholder` — 要加的后缀（如 \n</think>）

#### `Token/s`（2 条）

- `policy.json` · `failover.form.speedLabel` — 速度限制（Token/s）
- `policy.json` · `failover.form.speedHint` — 填 0 表示不限制；填大于 0 表示请求全程速度（总 Token ÷ 含建连的总耗时）低于 N Token/s 也算一次失败，计入禁用阈值（与匹配字段 OR 关系）。

#### `tokens`（2 条）

- `settings.json` · `tokenUsage.promptHint` — 输入 Tokens（prompt tokens）
- `settings.json` · `tokenUsage.completionHint` — 输出 Tokens（completion tokens）

#### `USERPROFILE`（2 条）

- `agentRules.json` · `form.windowsPathPlaceholder` — 例如：%USERPROFILE%\.config\opencode\opencode.json
- `agentRules.json` · `form.windowsPathHint` — 支持 %APPDATA%、%USERPROFILE% 等环境变量

#### `v1/chat/completions`（2 条）

- `agentConfig.json` · `managedDialog.manualEndpointPlaceholder` — 手动输入，例如 /v1/chat/completions
- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和

#### `Vite`（2 条）

- `settings.json` · `reverseProxy.pageDescription` — 配置允许通过 Vite 开发服务器访问的反代域名。
- `settings.json` · `reverseProxy.description` — 添加后允许通过这些域名访问开发服务器。修改后请重启 Vite 服务。

#### `windows`（2 条）

- `errorsAgent.json` · `SYSTEM_OS_INVALID` — 本机系统必须是 windows、mac 或 other
- `errorsAgent.json` · `TARGET_OS_INVALID` — 目标系统必须是 windows、mac 或 other

#### `Windows`（2 条）

- `agentConfig.json` · `form.osWarning` — 请选择目标机器的真实系统：Windows 用 cmd.exe 命令测试，Mac/其他 用 POSIX 命令测试，选错会导致测试失败
- `agentRules.json` · `form.windowsPathLabel` — Windows 默认路径

#### `YAML`（2 条）

- `agentConfig.json` · `columns.providerYaml` — 供应商 YAML 片段
- `agentRules.json` · `form.modelPathHint` — 完整 gjson 路径，model 里用 {provider_id} 占位当前供应商键名；YAML 文件（如 dsh）可写 `#(id=="xxx")` 查询段先按 ID 定位插件条目

#### `Z`（2 条）

- `topology.json` · `toolbar.undoTitle` — 撤销 (Ctrl/Cmd+Z)
- `topology.json` · `toolbar.redoTitle` — 重做 (Ctrl/Cmd+Shift+Z)

#### `ABC`（1 条）

- `settings.json` · `baseUrl.sourceNamePlaceholder` — 来源名，如 ABC

#### `ade80`（1 条）

- `topology.json` · `colors.placeholder` — HEX 色值，空格分隔多个，如 #4ade80 #38bdf8

#### `AI`（1 条）

- `agentConfig.json` · `confirm.applyTemplateBody` — 将根据 AI 软件官方的配置文档，对页面中全部供应商（托管供应商除外）及其模型的字段进行调整，并把结果直接写入文件生效。确认？

#### `ai-sdk/openai-compatible`（1 条）

- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和

#### `apiKey`（1 条）

- `agentConfig.json` · `managedDialog.apiKeyHint` — 必填：写入生成配置的 apiKey，Agent 用它接入本系统；留空不再自动借用所勾选供应商的 Key。只认凭据引用（apiKeyEnv）的软件（如 dsh）会同步写进其凭据库（.credentials.yaml）

#### `apiKeyEnv`（1 条）

- `agentConfig.json` · `managedDialog.apiKeyHint` — 必填：写入生成配置的 apiKey，Agent 用它接入本系统；留空不再自动借用所勾选供应商的 Key。只认凭据引用（apiKeyEnv）的软件（如 dsh）会同步写进其凭据库（.credentials.yaml）

#### `APPDATA`（1 条）

- `agentRules.json` · `form.windowsPathHint` — 支持 %APPDATA%、%USERPROFILE% 等环境变量

#### `append`（1 条）

- `rewrite.json` · `mode.append` — 追加字符串 (append)

#### `b3f2..`（1 条）

- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `backup`（1 条）

- `settings.json` · `backup.pathPlaceholder` — 例如：backups 或 ../../.backup

#### `backups`（1 条）

- `settings.json` · `backup.pathPlaceholder` — 例如：backups 或 ../../.backup

#### `bdf8`（1 条）

- `topology.json` · `colors.placeholder` — HEX 色值，空格分隔多个，如 #4ade80 #38bdf8

#### `body`（1 条）

- `settings.json` · `affinity.sessionFieldsHint` — 只在请求头里查找（不读 body），第一个有值的生效。

#### `bool`（1 条）

- `agentRules.json` · `modelInfoEditor.hint` — 模型信息字段在各 Agent 配置里的写入方式；「同步模型信息」与托管生成按此写回。每行一个字段：路径为写入位置，留空表示该 Agent 没有这个字段（不写入，显示「未配置」）；写法（op）可选 raw（原样，默认）/ 

#### `capture`（1 条）

- `api.json` · `invalidCaptureStageHeaders` — capture stage headers 格式无效

#### `Chat`（1 条）

- `agentRules.json` · `endpointRules.namePlaceholder` — 例如：OpenAI 兼容 Chat Completions

#### `chat/completion`（1 条）

- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和

#### `chunk`（1 条）

- `logs.json` · `monitor.active.stageReceivingStream` — 接收中·第{{chunk}}chunk·已收{{bytes}}

#### `cmd.exe`（1 条）

- `agentConfig.json` · `form.osWarning` — 请选择目标机器的真实系统：Windows 用 cmd.exe 命令测试，Mac/其他 用 POSIX 命令测试，选错会导致测试失败

#### `CNY`（1 条）

- `settings.json` · `billing.currencyCny` — 人民币 (CNY)

#### `Completions`（1 条）

- `agentRules.json` · `endpointRules.namePlaceholder` — 例如：OpenAI 兼容 Chat Completions

#### `conditions`（1 条）

- `agentRules.json` · `errors.protocolConditionInvalid` — 协议「{{name}}」的 conditions 项格式错误

#### `config`（1 条）

- `agentRules.json` · `form.windowsPathPlaceholder` — 例如：%USERPROFILE%\.config\opencode\opencode.json

#### `config/opencode/opencode.json`（1 条）

- `agentRules.json` · `form.macPathPlaceholder` — 例如：~/.config/opencode/opencode.json

#### `console`（1 条）

- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 

#### `conversion_rates.CNY`（1 条）

- `settings.json` · `billing.fieldPlaceholder` — rates.CNY 或 conversion_rates.CNY

#### `copy`（1 条）

- `rewrite.json` · `mode.copy` — 复制 (copy)

#### `credentials.yaml`（1 条）

- `agentConfig.json` · `managedDialog.apiKeyHint` — 必填：写入生成配置的 apiKey，Agent 用它接入本系统；留空不再自动借用所勾选供应商的 Key。只认凭据引用（apiKeyEnv）的软件（如 dsh）会同步写进其凭据库（.credentials.yaml）

#### `deadline`（1 条）

- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 

#### `deepseek`（1 条）

- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `deepseek-v4-flash`（1 条）

- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `Delete`（1 条）

- `topology.json` · `toolbar.deleteSelectedTitle` — 删除选中节点 (Delete)

#### `dst`（1 条）

- `rewrite.json` · `field.dstPlaceholder` — dst 目标路径

#### `enabled`（1 条）

- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 

#### `ensure_prefix`（1 条）

- `rewrite.json` · `mode.ensurePrefix` — 确保前缀 (ensure_prefix)

#### `ensure_suffix`（1 条）

- `rewrite.json` · `mode.ensureSuffix` — 确保后缀 (ensure_suffix)

#### `entry`（1 条）

- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 

#### `ExecutorDebug`（1 条）

- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 

#### `fields`（1 条）

- `errorsAgent.json` · `FIELDS_REQUIRED` — fields 不能为空

#### `first`（1 条）

- `agentRules.json` · `modelInfoEditor.hint` — 模型信息字段在各 Agent 配置里的写入方式；「同步模型信息」与托管生成按此写回。每行一个字段：路径为写入位置，留空表示该 Agent 没有这个字段（不写入，显示「未配置」）；写法（op）可选 raw（原样，默认）/ 

#### `HAPIY`（1 条）

- `agentConfig.json` · `managedDialog.ruleNamePlaceholder` — 例如：HAPIY

#### `hapiy.example.com`（1 条）

- `settings.json` · `reverseProxy.placeholder` — 例如 hapiy.example.com

#### `header.`（1 条）

- `rewrite.json` · `path.headerPlaceholder` — header 名（不用写 header.）

#### `headers`（1 条）

- `api.json` · `invalidCaptureStageHeaders` — capture stage headers 格式无效

#### `HEX`（1 条）

- `topology.json` · `colors.placeholder` — HEX 色值，空格分隔多个，如 #4ade80 #38bdf8

#### `HOME`（1 条）

- `agentRules.json` · `form.macPathHint` — 支持 ~ 和 $HOME

#### `host`（1 条）

- `agentConfig.json` · `form.hostPlaceholder` — 例如：192.168.1.100 或 tcp://host:34604（不填端口默认 22）

#### `image`（1 条）

- `agentRules.json` · `recTable.valuesPlaceholder` — text, image, video（逗号分隔）

#### `input`（1 条）

- `agentRules.json` · `modelInfoEditor.hint` — 模型信息字段在各 Agent 配置里的写入方式；「同步模型信息」与托管生成按此写回。每行一个字段：路径为写入位置，留空表示该 Agent 没有这个字段（不写入，显示「未配置」）；写法（op）可选 raw（原样，默认）/ 

#### `insufficient_quota`（1 条）

- `policy.json` · `failover.form.patternsPlaceholder` — 每行一个关键词或错误码\n429\nrate_limit_exceeded\ninsufficient_quota

#### `join`（1 条）

- `agentRules.json` · `modelInfoEditor.hint` — 模型信息字段在各 Agent 配置里的写入方式；「同步模型信息」与托管生成按此写回。每行一个字段：路径为写入位置，留空表示该 Agent 没有这个字段（不写入，显示「未配置」）；写法（op）可选 raw（原样，默认）/ 

#### `json`（1 条）

- `agentConfig.json` · `form.sshJsonOnlyHint` — 支持 .json / .jsonc / .yml / .yaml / .toml 等文本配置文件

#### `json_paths`（1 条）

- `agentRules.json` · `errors.topMustBeJsonObject` — 顶层必须是 JSON 对象（含 name / os_paths / json_paths / model_info_fields / common / protocols）

#### `jsonc`（1 条）

- `agentConfig.json` · `form.sshJsonOnlyHint` — 支持 .json / .jsonc / .yml / .yaml / .toml 等文本配置文件

#### `local`（1 条）

- `errorsAgent.json` · `MODE_INVALID` — 模式必须是 local 或 ssh

#### `logOutput-..`（1 条）

- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `loop`（1 条）

- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `Mac`（1 条）

- `agentRules.json` · `form.macPathLabel` — Mac 默认路径

#### `Mac/`（1 条）

- `agentConfig.json` · `form.osWarning` — 请选择目标机器的真实系统：Windows 用 cmd.exe 命令测试，Mac/其他 用 POSIX 命令测试，选错会导致测试失败

#### `map`（1 条）

- `agentRules.json` · `form.containerObject` — 对象 map {"模型 ID": {...}}（opencode）

#### `message`（1 条）

- `agentRules.json` · `endpointRules.tagsPlaceholder` — 例如：*completion*, *responses*, *message*

#### `messages.0.content`（1 条）

- `settings.json` · `recovery.pathPlaceholder` — gjson 路径，如 messages.0.content

#### `messages.0.text`（1 条）

- `rewrite.json` · `respValue.movePlaceholder` — 新字段路径（如 messages.0.text）

#### `minutes`（1 条）

- `errorsAgent.json` · `MINUTES_INVALID` — minutes 必须为正数

#### `mktemp`（1 条）

- `agentConfig.json` · `sshProbe.writeProbe` — 写入（临时文件 mktemp → 写 → 删除）

#### `Model`（1 条）

- `settings.json` · `affinity.modelFieldsLabel` — Model 字段（gjson 路径，每行一个）

#### `model_id`（1 条）

- `errorsAgent.json` · `PROVIDER_AND_MODEL_ID_REQUIRED` — provider_id 与 model_id 不能为空

#### `model_info_fields.`（1 条）

- `agentRules.json` · `errors.modelInfoPathRequiredAt` — model_info_fields.{{key}}：请先填写 path（{{label}} 的写入位置）

#### `models_container`（1 条）

- `agentRules.json` · `form.modelsContainerLabel` — 模型列表容器格式（models_container）

#### `npm`（1 条）

- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和

#### `null`（1 条）

- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和

#### `OpenCode`（1 条）

- `agentConfig.json` · `form.recordNamePlaceholder` — 例如：OpenCode 配置

#### `opencode.json`（1 条）

- `agentRules.json` · `form.windowsPathPlaceholder` — 例如：%USERPROFILE%\.config\opencode\opencode.json

#### `os_paths`（1 条）

- `agentRules.json` · `errors.topMustBeJsonObject` — 顶层必须是 JSON 对象（含 name / os_paths / json_paths / model_info_fields / common / protocols）

#### `POSIX`（1 条）

- `agentConfig.json` · `form.osWarning` — 请选择目标机器的真实系统：Windows 用 cmd.exe 命令测试，Mac/其他 用 POSIX 命令测试，选错会导致测试失败

#### `prepend`（1 条）

- `rewrite.json` · `mode.prepend` — 前置字符串 (prepend)

#### `prompt`（1 条）

- `settings.json` · `tokenUsage.promptHint` — 输入 Tokens（prompt tokens）

#### `prov-test`（1 条）

- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 

#### `prov-xxx`（1 条）

- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `provider.`（1 条）

- `agentRules.json` · `form.modelPathPlaceholder` — 例如：provider.{provider_id}.models

#### `provider/model`（1 条）

- `errorsAgent.json` · `AGENT_TYPE_JSON_PATHS_UNCONFIGURED_DETAIL` — 该软件类型尚未配置 JSON 路径，请先在「接管 Agent」中填写 provider/model gjson

#### `pt/px`（1 条）

- `ui.json` · `dataTable.widthFormatInvalid` — 必须以 % 或 pt/px 结尾（如「200 px」或「30 %」）

#### `pv-`（1 条）

- `lib.json` · `edge.chainRefMustStart` — 连线链 {{chain}}：引用 {{ref}} 必须以 pv- 或 slot- 开头

#### `rate_limit_exceeded`（1 条）

- `policy.json` · `failover.form.patternsPlaceholder` — 每行一个关键词或错误码\n429\nrate_limit_exceeded\ninsufficient_quota

#### `raw`（1 条）

- `agentRules.json` · `modelInfoEditor.hint` — 模型信息字段在各 Agent 配置里的写入方式；「同步模型信息」与托管生成按此写回。每行一个字段：路径为写入位置，留空表示该 Agent 没有这个字段（不写入，显示「未配置」）；写法（op）可选 raw（原样，默认）/ 

#### `recommended`（1 条）

- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和

#### `regex_replace`（1 条）

- `rewrite.json` · `mode.regexReplace` — 正则替换 (regex_replace)

#### `replace`（1 条）

- `rewrite.json` · `mode.replace` — 字符串替换 (replace)

#### `required`（1 条）

- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和

#### `response_count`（1 条）

- `api.json` · `invalidResponseCount` — response_count 不能为负

#### `retention_minutes`（1 条）

- `errorsCore.json` · `RETENTION_MINUTES_OUT_OF_RANGE` — retention_minutes 必须在 0-1440 之间

#### `root`（1 条）

- `agentConfig.json` · `form.usernamePlaceholder` — 例如：root

#### `run`（1 条）

- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `s`（1 条）

- `errorsAgent.json` · `MODEL_FETCH_URL_INVALID` — 接口地址必须是 http(s) URL

#### `scheme`（1 条）

- `settings.json` · `baseUrl.originHint` — 系统对外 BaseURL 的域名（含 scheme 与端口）。生成代理配置与托管「跟随系统」用它，默认取当前网页域名，隧道/反代场景请改成公网地址

#### `Session/Model`（1 条）

- `settings.json` · `affinity.enableHint` — 关闭时不读取 Session/Model 字段，正常走拓扑选择。

#### `set`（1 条）

- `rewrite.json` · `mode.set` — 设置值 (set)

#### `Shift`（1 条）

- `topology.json` · `toolbar.redoTitle` — 重做 (Ctrl/Cmd+Shift+Z)

#### `slot`（1 条）

- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 

#### `slot-`（1 条）

- `lib.json` · `edge.chainRefMustStart` — 连线链 {{chain}}：引用 {{ref}} 必须以 pv- 或 slot- 开头

#### `ssh`（1 条）

- `errorsAgent.json` · `MODE_INVALID` — 模式必须是 local 或 ssh

#### `stage`（1 条）

- `api.json` · `invalidCaptureStageHeaders` — capture stage headers 格式无效

#### `step`（1 条）

- `settings.json` · `debug.flowLightsDescription` — 每次输出以下三类信息（示例）：\n\n[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→psl

#### `tcp`（1 条）

- `agentConfig.json` · `form.hostPlaceholder` — 例如：192.168.1.100 或 tcp://host:34604（不填端口默认 22）

#### `text`（1 条）

- `agentRules.json` · `recTable.valuesPlaceholder` — text, image, video（逗号分隔）

#### `text/image/video/audio`（1 条）

- `agentRules.json` · `modelInfoEditor.hint` — 模型信息字段在各 Agent 配置里的写入方式；「同步模型信息」与托管生成按此写回。每行一个字段：路径为写入位置，留空表示该 Agent 没有这个字段（不写入，显示「未配置」）；写法（op）可选 raw（原样，默认）/ 

#### `to_lower`（1 条）

- `rewrite.json` · `mode.toLower` — 转小写 (to_lower)

#### `to_upper`（1 条）

- `rewrite.json` · `mode.toUpper` — 转大写 (to_upper)

#### `toml`（1 条）

- `agentConfig.json` · `form.sshJsonOnlyHint` — 支持 .json / .jsonc / .yml / .yaml / .toml 等文本配置文件

#### `trim_prefix`（1 条）

- `rewrite.json` · `mode.trimPrefix` — 去除前缀 (trim_prefix)

#### `trim_space`（1 条）

- `rewrite.json` · `mode.trimSpace` — 去首尾空白 (trim_space)

#### `trim_suffix`（1 条）

- `rewrite.json` · `mode.trimSuffix` — 去除后缀 (trim_suffix)

#### `true/false/null/`（1 条）

- `rewrite.json` · `convention.literalHint` — true/false/null/数字 → JSON 字面量

#### `ui.shadcn.com/r/themes/zinc.json`（1 条）

- `settings.json` · `theme.installDialogDescription` — 粘贴 shadcn 主题的 JSON 地址，例如 https://ui.shadcn.com/r/themes/zinc.json。

#### `upgrade`（1 条）

- `common.json` · `update.timeout` — 升级等待超时：请稍后重试，或在终端运行 hapiy upgrade

#### `URLs`（1 条）

- `provider.json` · `errors.baseUrlRequired` — 请先在上方填写 Base URLs

#### `usage.prompt_tokens`（1 条）

- `settings.json` · `tokenUsage.pathPlaceholder` — gjson 路径，如 usage.prompt_tokens

#### `USD`（1 条）

- `settings.json` · `billing.currencyUsd` — 美元 (USD)

#### `v1`（1 条）

- `agentRules.json` · `endpointRules.hint` — 每个 Endpoint 一条规则：归纳范围填 Endpoint 匹配词（逗号分隔）。含 * 的按通配匹配（* 匹配任意字符，忽略大小写，如 *completion* 同时命中 /v1/chat/completions 和

#### `V2`（1 条）

- `agentRules.json` · `modelInfoEditor.variantShape.array` — 数组（V2）

#### `value`（1 条）

- `rewrite.json` · `field.valuePlaceholder` — value 或变量名

#### `video`（1 条）

- `agentRules.json` · `recTable.valuesPlaceholder` — text, image, video（逗号分隔）

#### `weight`（1 条）

- `settings.json` · `debug.nodeInfoDescription` — 选中节点/插槽后 console 输出其信息（示例）：\n\n[ExecutorDebug] slot pslot-test (provider)\n  ✓ entry: entry-test enabled=true 

#### `X-Claude-Code-Session-Id`（1 条）

- `settings.json` · `affinity.sessionFieldsCommon` — 常见字段名：X-Session-Id、X-Conversation-Id、x-litellm-session-id、X-Request-Id、X-Client-Session-Id、X-Claude-Code-Sessi

#### `X-Client-Session-Id`（1 条）

- `settings.json` · `affinity.sessionFieldsCommon` — 常见字段名：X-Session-Id、X-Conversation-Id、x-litellm-session-id、X-Request-Id、X-Client-Session-Id、X-Claude-Code-Sessi

#### `X-Conversation-Id`（1 条）

- `settings.json` · `affinity.sessionFieldsCommon` — 常见字段名：X-Session-Id、X-Conversation-Id、x-litellm-session-id、X-Request-Id、X-Client-Session-Id、X-Claude-Code-Sessi

#### `x-litellm-session-id`（1 条）

- `settings.json` · `affinity.sessionFieldsCommon` — 常见字段名：X-Session-Id、X-Conversation-Id、x-litellm-session-id、X-Request-Id、X-Client-Session-Id、X-Claude-Code-Sessi

#### `X-Request-Id`（1 条）

- `settings.json` · `affinity.sessionFieldsCommon` — 常见字段名：X-Session-Id、X-Conversation-Id、x-litellm-session-id、X-Request-Id、X-Client-Session-Id、X-Claude-Code-Sessi

#### `X-Request-ID`（1 条）

- `rewrite.json` · `gjson.examples.header` — HTTP header（scope=header 时，路径只填名字，如 X-Request-ID）

#### `X-Session-Id`（1 条）

- `settings.json` · `affinity.sessionFieldsCommon` — 常见字段名：X-Session-Id、X-Conversation-Id、x-litellm-session-id、X-Request-Id、X-Client-Session-Id、X-Claude-Code-Sessi

#### `xxx`（1 条）

- `agentRules.json` · `form.modelPathHint` — 完整 gjson 路径，model 里用 {provider_id} 占位当前供应商键名；YAML 文件（如 dsh）可写 `#(id=="xxx")` 查询段先按 ID 定位插件条目

#### `yaml`（1 条）

- `agentConfig.json` · `form.sshJsonOnlyHint` — 支持 .json / .jsonc / .yml / .yaml / .toml 等文本配置文件

#### `yml`（1 条）

- `agentConfig.json` · `form.sshJsonOnlyHint` — 支持 .json / .jsonc / .yml / .yaml / .toml 等文本配置文件


### 附录 B：后端中文提示里出现英文词的位置（自动扫描）

#### `API`（30 条）

- `project/backend/internal/model/agent_config.go:414` — API 端点，必须是完整路径且一般以 /chat/completions 结尾
- `project/backend/internal/model/agent_config.go:415` — API 端点（不填则走适配器默认）
- `project/backend/internal/model/agent_config.go:416` — 供应商 API 端点（按官方格式，注意不要多写不该有的 /v1）
- `project/backend/internal/model/agent_config.go:433` — Messages API 使用 anthropic-messages 协议
- `project/backend/internal/model/agent_config.go:434` — Chat Completions API 使用 openai-completions 协议
- `project/backend/internal/model/agent_config.go:441` — Responses API 使用 OpenAI SDK
- `project/backend/internal/model/agent_config.go:442` — Messages API 使用 Anthropic SDK
- `project/backend/internal/model/agent_config.go:443` — Chat Completions API 使用 OpenAI 兼容 SDK
- `project/backend/internal/model/agent_config.go:446` — 该供应商的 API base URL（如 https://api.example.com/v1）
- `project/backend/internal/model/agent_config.go:447` — 提供 API key 的环境变量名（官方推荐用环境变量，不写明文 key）
- `project/backend/internal/model/agent_config.go:451` — 自定义供应商的 API 端点（如 https://gateway.example.com/v1；已装目录供应商省略则用目录端点）
- `project/backend/internal/model/agent_config.go:458` — Responses API 使用 openai-responses 协议
- `project/backend/internal/model/agent_config.go:1184` — API 端点（不填则走适配器默认）
- `project/backend/internal/model/agent_config.go:1204` — Responses API 使用 OpenAI SDK
- `project/backend/internal/model/agent_config.go:1211` — Messages API 使用 Anthropic SDK
- `project/backend/internal/model/agent_config.go:1221` — Chat Completions API 使用 OpenAI 兼容 SDK
- `project/backend/internal/model/agent_config.go:1232` — API 端点（不填则走适配器默认）
- `project/backend/internal/model/agent_config.go:1246` — Responses API 使用 OpenAI SDK
- `project/backend/internal/model/agent_config.go:1253` — Messages API 使用 Anthropic SDK
- `project/backend/internal/model/agent_config.go:1261` — Chat Completions API 使用 OpenAI 兼容 SDK
- `project/backend/internal/model/agent_config.go:1274` — 该供应商的 API base URL（如 https://api.example.com/v1）
- `project/backend/internal/model/agent_config.go:1278` — 提供 API key 的环境变量名（官方推荐用环境变量，不写明文 key）
- `project/backend/internal/model/agent_config.go:1293` — API 端点，必须是完整路径且一般以 /chat/completions 结尾
- `project/backend/internal/model/agent_config.go:1307` — 供应商 API 端点（按官方格式，注意不要多写不该有的 /v1）
- `project/backend/internal/model/agent_config.go:1331` — Messages API 使用 anthropic-messages 协议
- `project/backend/internal/model/agent_config.go:1339` — Chat Completions API 使用 openai-completions 协议
- `project/backend/internal/model/agent_config.go:1369` — 自定义供应商的 API 端点（如 https://gateway.example.com/v1；已装目录供应商省略则用目录端点）
- `project/backend/internal/model/agent_config.go:1390` — Responses API 使用 openai-responses 协议
- `project/backend/internal/model/agent_config.go:1397` — Messages API 使用 anthropic-messages 协议
- `project/backend/internal/model/agent_config.go:1407` — Chat Completions API 使用 openai-completions 协议

#### `SSH`（27 条）

- `project/backend/internal/handler/agent_config.go:380` — SSH 配置不能为空
- `project/backend/internal/handler/agent_config.go:384` — SSH 配置解析失败: 
- `project/backend/internal/handler/agent_config.go:593` — SSH 配置不能为空
- `project/backend/internal/handler/agent_config.go:597` — SSH 配置解析失败: 
- `project/backend/internal/handler/agent_config.go:603` — 现有 SSH 配置解析失败: 
- `project/backend/internal/handler/agent_config.go:607` — 现有 SSH 凭据解密失败: 
- `project/backend/internal/handler/agent_config.go:652` — SSH 凭据加密失败: 
- `project/backend/internal/handler/agent_config.go:750` — SSH 配置解析失败: 
- `project/backend/internal/handler/agent_config.go:786` — SSH 配置解析失败: 
- `project/backend/internal/handler/agent_config.go:828` — SSH 主机地址不能为空
- `project/backend/internal/handler/agent_config.go:831` — SSH 用户名不能为空
- `project/backend/internal/handler/agent_config.go:836` — SSH 密码不能为空
- `project/backend/internal/handler/agent_config.go:840` — SSH 私钥不能为空
- `project/backend/internal/handler/agent_config.go:843` — SSH 认证方式必须是 password 或 key
- `project/backend/internal/handler/agent_config.go:877` — SSH 配置解析失败: %v
- `project/backend/internal/handler/agent_config.go:880` — SSH 凭据解密失败: %v
- `project/backend/internal/handler/agent_config.go:897` — SSH 配置解析失败: %v
- `project/backend/internal/handler/agent_config.go:900` — SSH 凭据解密失败: %v
- `project/backend/internal/handler/agent_credentials.go:112` — SSH 配置解析失败: %v
- `project/backend/internal/handler/agent_credentials.go:115` — SSH 凭据解密失败: %v
- `project/backend/internal/service/agent_file.go:347` — 解析 SSH 私钥失败: %w
- `project/backend/internal/service/agent_file.go:351` — 不支持的 SSH 认证方式 %q
- `project/backend/internal/service/agent_file.go:591` — SSH 连接失败: %w
- `project/backend/internal/service/agent_file.go:607` — 跳板机 SSH 连接失败: %w
- `project/backend/internal/service/agent_file.go:620` — SSH 连接失败: %w
- `project/backend/internal/service/agent_file.go:727` — 创建 SSH 会话失败: 
- `project/backend/internal/service/agent_file.go:751` — 创建 SSH 会话失败: 

#### `token`（18 条）

- `project/backend/internal/model/agent_config.go:395` — 最大输出token
- `project/backend/internal/model/agent_config.go:417` — 最大输入 token 数
- `project/backend/internal/model/agent_config.go:418` — 最大输出 token 数
- `project/backend/internal/model/agent_config.go:419` — 上下文 token 上限
- `project/backend/internal/model/agent_config.go:420` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:455` — 最大上下文 token 数（缺省走路由 defaultContextWindow，默认 262144）
- `project/backend/internal/model/agent_config.go:456` — 最大输出 token 数（配置后同时成为该模型每请求的默认输出上限）
- `project/backend/internal/model/agent_config.go:1188` — 上下文 token 上限
- `project/backend/internal/model/agent_config.go:1214` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:1236` — 上下文 token 上限
- `project/backend/internal/model/agent_config.go:1254` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:1294` — 最大输入 token 数
- `project/backend/internal/model/agent_config.go:1295` — 最大输出 token 数
- `project/backend/internal/model/agent_config.go:1315` — 上下文 token 上限
- `project/backend/internal/model/agent_config.go:1332` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:1376` — 最大上下文 token 数（缺省走路由 defaultContextWindow，默认 262144）
- `project/backend/internal/model/agent_config.go:1377` — 最大输出 token 数（配置后同时成为该模型每请求的默认输出上限）
- `project/backend/internal/model/agent_config.go:1400` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）

#### `Chat`（13 条）

- `project/backend/internal/model/agent_config.go:432` — 接口协议（2026.02 起 Codex 强制 responses，不再支持 Chat Completions）
- `project/backend/internal/model/agent_config.go:434` — Chat Completions API 使用 openai-completions 协议
- `project/backend/internal/model/agent_config.go:443` — Chat Completions API 使用 OpenAI 兼容 SDK
- `project/backend/internal/model/agent_config.go:463` — OpenAI 兼容 Chat Completions
- `project/backend/internal/model/agent_config.go:1218` — OpenAI 兼容 Chat Completions
- `project/backend/internal/model/agent_config.go:1221` — Chat Completions API 使用 OpenAI 兼容 SDK
- `project/backend/internal/model/agent_config.go:1258` — OpenAI 兼容 Chat Completions
- `project/backend/internal/model/agent_config.go:1261` — Chat Completions API 使用 OpenAI 兼容 SDK
- `project/backend/internal/model/agent_config.go:1277` — 接口协议（2026.02 起 Codex 强制 responses，不再支持 Chat Completions）
- `project/backend/internal/model/agent_config.go:1336` — OpenAI 兼容 Chat Completions
- `project/backend/internal/model/agent_config.go:1339` — Chat Completions API 使用 openai-completions 协议
- `project/backend/internal/model/agent_config.go:1404` — OpenAI 兼容 Chat Completions
- `project/backend/internal/model/agent_config.go:1407` — Chat Completions API 使用 openai-completions 协议

#### `Completions`（13 条）

- `project/backend/internal/model/agent_config.go:432` — 接口协议（2026.02 起 Codex 强制 responses，不再支持 Chat Completions）
- `project/backend/internal/model/agent_config.go:434` — Chat Completions API 使用 openai-completions 协议
- `project/backend/internal/model/agent_config.go:443` — Chat Completions API 使用 OpenAI 兼容 SDK
- `project/backend/internal/model/agent_config.go:463` — OpenAI 兼容 Chat Completions
- `project/backend/internal/model/agent_config.go:1218` — OpenAI 兼容 Chat Completions
- `project/backend/internal/model/agent_config.go:1221` — Chat Completions API 使用 OpenAI 兼容 SDK
- `project/backend/internal/model/agent_config.go:1258` — OpenAI 兼容 Chat Completions
- `project/backend/internal/model/agent_config.go:1261` — Chat Completions API 使用 OpenAI 兼容 SDK
- `project/backend/internal/model/agent_config.go:1277` — 接口协议（2026.02 起 Codex 强制 responses，不再支持 Chat Completions）
- `project/backend/internal/model/agent_config.go:1336` — OpenAI 兼容 Chat Completions
- `project/backend/internal/model/agent_config.go:1339` — Chat Completions API 使用 openai-completions 协议
- `project/backend/internal/model/agent_config.go:1404` — OpenAI 兼容 Chat Completions
- `project/backend/internal/model/agent_config.go:1407` — Chat Completions API 使用 openai-completions 协议

#### `JSON`（12 条）

- `project/backend/internal/handler/agent_config.go:490` — JSON 格式化失败: 
- `project/backend/internal/handler/agent_config.go:945` — 该软件类型尚未配置 JSON 路径，请先在「接管 Agent」中填写 provider/model gjson
- `project/backend/internal/handler/agent_config.go:1125` — 该软件类型尚未配置 JSON 路径
- `project/backend/internal/handler/agent_config.go:1203` — 该软件类型尚未配置 JSON 路径
- `project/backend/internal/handler/agent_config.go:1417` — 该软件类型尚未配置 JSON 路径
- `project/backend/internal/handler/agent_config.go:1658` — 该软件类型尚未配置 JSON 路径
- `project/backend/internal/handler/agent_managed.go:374` — 该软件类型尚未配置 JSON 路径
- `project/backend/internal/handler/agent_managed.go:654` — 该软件类型尚未配置 JSON 路径
- `project/backend/internal/handler/yaml_config.go:110` — YAML 转 JSON 失败: %w
- `project/backend/internal/relay/disabled_record.go:381` — 上游响应体不是合法 JSON
- `project/backend/internal/service/exchange.go:116` — 汇率接口返回的不是有效 JSON
- `project/backend/internal/service/recovery.go:122` — 响应体不是合法 JSON：%v

#### `anthropic-messages`（12 条）

- `project/backend/internal/model/agent_config.go:420` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:431` — 接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:433` — Messages API 使用 anthropic-messages 协议
- `project/backend/internal/model/agent_config.go:452` — 接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1214` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:1254` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:1312` — 接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1331` — Messages API 使用 anthropic-messages 协议
- `project/backend/internal/model/agent_config.go:1332` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:1373` — 接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1397` — Messages API 使用 anthropic-messages 协议
- `project/backend/internal/model/agent_config.go:1400` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）

#### `SDK`（11 条）

- `project/backend/internal/model/agent_config.go:438` — AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:441` — Responses API 使用 OpenAI SDK
- `project/backend/internal/model/agent_config.go:442` — Messages API 使用 Anthropic SDK
- `project/backend/internal/model/agent_config.go:443` — Chat Completions API 使用 OpenAI 兼容 SDK
- `project/backend/internal/model/agent_config.go:1183` — AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1204` — Responses API 使用 OpenAI SDK
- `project/backend/internal/model/agent_config.go:1211` — Messages API 使用 Anthropic SDK
- `project/backend/internal/model/agent_config.go:1221` — Chat Completions API 使用 OpenAI 兼容 SDK
- `project/backend/internal/model/agent_config.go:1246` — Responses API 使用 OpenAI SDK
- `project/backend/internal/model/agent_config.go:1253` — Messages API 使用 Anthropic SDK
- `project/backend/internal/model/agent_config.go:1261` — Chat Completions API 使用 OpenAI 兼容 SDK

#### `OpenAI`（11 条）

- `project/backend/internal/model/agent_config.go:441` — Responses API 使用 OpenAI SDK
- `project/backend/internal/model/agent_config.go:443` — Chat Completions API 使用 OpenAI 兼容 SDK
- `project/backend/internal/model/agent_config.go:463` — OpenAI 兼容 Chat Completions
- `project/backend/internal/model/agent_config.go:1204` — Responses API 使用 OpenAI SDK
- `project/backend/internal/model/agent_config.go:1218` — OpenAI 兼容 Chat Completions
- `project/backend/internal/model/agent_config.go:1221` — Chat Completions API 使用 OpenAI 兼容 SDK
- `project/backend/internal/model/agent_config.go:1246` — Responses API 使用 OpenAI SDK
- `project/backend/internal/model/agent_config.go:1258` — OpenAI 兼容 Chat Completions
- `project/backend/internal/model/agent_config.go:1261` — Chat Completions API 使用 OpenAI 兼容 SDK
- `project/backend/internal/model/agent_config.go:1336` — OpenAI 兼容 Chat Completions
- `project/backend/internal/model/agent_config.go:1404` — OpenAI 兼容 Chat Completions

#### `Anthropic`（8 条）

- `project/backend/internal/model/agent_config.go:420` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:442` — Messages API 使用 Anthropic SDK
- `project/backend/internal/model/agent_config.go:1211` — Messages API 使用 Anthropic SDK
- `project/backend/internal/model/agent_config.go:1214` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:1253` — Messages API 使用 Anthropic SDK
- `project/backend/internal/model/agent_config.go:1254` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:1332` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:1400` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）

#### `endpoint`（8 条）

- `project/backend/internal/model/agent_config.go:431` — 接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:438` — AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:439` — 运行时适配器包（@opencode/ai/providers/openai-compatible / openai / anthropic），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:452` — 接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1183` — AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1231` — 运行时适配器包（@opencode/ai/providers/openai-compatible / openai / anthropic），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1312` — 接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1373` — 接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由 endpoint 关键词自动归类

#### `openai-completions`（7 条）

- `project/backend/internal/model/agent_config.go:431` — 接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:434` — Chat Completions API 使用 openai-completions 协议
- `project/backend/internal/model/agent_config.go:452` — 接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1312` — 接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1339` — Chat Completions API 使用 openai-completions 协议
- `project/backend/internal/model/agent_config.go:1373` — 接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1407` — Chat Completions API 使用 openai-completions 协议

#### `model`（6 条）

- `project/backend/internal/handler/agent_config.go:1309` — model %s 字段 %s 删除失败: %v
- `project/backend/internal/handler/agent_config.go:1324` — model %s 字段 %s 写入失败: %v
- `project/backend/internal/handler/agent_config.go:1528` — model %s 字段 %s 删除失败: %v
- `project/backend/internal/handler/agent_config.go:1543` — model %s 字段 %s 写入失败: %v
- `project/backend/internal/handler/agent_config.go:1572` — model %s 字段 %s 写入失败: %v
- `project/backend/internal/handler/agent_config.go:1770` — model %q 字段 %s: %v

#### `ollama`（6 条）

- `project/backend/internal/model/agent_config.go:411` — 认证密钥（实际密钥值，非环境变量名；Ollama 本地填占位符 ollama）
- `project/backend/internal/model/agent_config.go:431` — 接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:435` — Ollama 本地推理使用 ollama 协议
- `project/backend/internal/model/agent_config.go:1292` — 认证密钥（实际密钥值，非环境变量名；Ollama 本地填占位符 ollama）
- `project/backend/internal/model/agent_config.go:1312` — 接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1346` — Ollama 本地推理使用 ollama 协议

#### `Messages`（6 条）

- `project/backend/internal/model/agent_config.go:433` — Messages API 使用 anthropic-messages 协议
- `project/backend/internal/model/agent_config.go:442` — Messages API 使用 Anthropic SDK
- `project/backend/internal/model/agent_config.go:1211` — Messages API 使用 Anthropic SDK
- `project/backend/internal/model/agent_config.go:1253` — Messages API 使用 Anthropic SDK
- `project/backend/internal/model/agent_config.go:1331` — Messages API 使用 anthropic-messages 协议
- `project/backend/internal/model/agent_config.go:1397` — Messages API 使用 anthropic-messages 协议

#### `id`（6 条）

- `project/backend/internal/model/agent_config.go:444` — 顶层默认供应商 id，取自 [model_providers] 的键（官方默认 openai）
- `project/backend/internal/model/agent_config.go:450` — 选择器里显示的供应商名称（缺省用供应商 id）
- `project/backend/internal/model/agent_config.go:454` — 模型显示名（缺省用安装目录名，再缺省用 id）
- `project/backend/internal/model/agent_config.go:1272` — 顶层默认供应商 id，取自 [model_providers] 的键（官方默认 openai）
- `project/backend/internal/model/agent_config.go:1368` — 选择器里显示的供应商名称（缺省用供应商 id）
- `project/backend/internal/model/agent_config.go:1375` — 模型显示名（缺省用安装目录名，再缺省用 id）

#### `key`（5 条）

- `project/backend/internal/handler/agent_config.go:843` — SSH 认证方式必须是 password 或 key
- `project/backend/internal/handler/agent_config.go:862` — 跳板机认证方式必须是 password 或 key
- `project/backend/internal/handler/settings.go:35` — 配置项 key 不能为空
- `project/backend/internal/model/agent_config.go:447` — 提供 API key 的环境变量名（官方推荐用环境变量，不写明文 key）
- `project/backend/internal/model/agent_config.go:1278` — 提供 API key 的环境变量名（官方推荐用环境变量，不写明文 key）

#### `max_tokens`（5 条）

- `project/backend/internal/model/agent_config.go:420` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:1214` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:1254` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:1332` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）
- `project/backend/internal/model/agent_config.go:1400` — 输出 token 上限（anthropic-messages 协议必填，Anthropic 官方要求每请求带 max_tokens）

#### `false`（5 条）

- `project/backend/internal/model/agent_config.go:427` — 是否支持思考模式（官方 schema 校验，未配按 false 处理）
- `project/backend/internal/model/agent_config.go:440` — 启用 promptCacheKey 缓存优化（官方默认 false，建议开启）
- `project/backend/internal/model/agent_config.go:1186` — 启用 promptCacheKey 缓存优化（官方默认 false，建议开启）
- `project/backend/internal/model/agent_config.go:1234` — 启用 promptCacheKey 缓存优化（官方默认 false，建议开启）
- `project/backend/internal/model/agent_config.go:1317` — 是否支持思考模式（官方 schema 校验，未配按 false 处理）

#### `Responses`（5 条）

- `project/backend/internal/model/agent_config.go:441` — Responses API 使用 OpenAI SDK
- `project/backend/internal/model/agent_config.go:458` — Responses API 使用 openai-responses 协议
- `project/backend/internal/model/agent_config.go:1204` — Responses API 使用 OpenAI SDK
- `project/backend/internal/model/agent_config.go:1246` — Responses API 使用 OpenAI SDK
- `project/backend/internal/model/agent_config.go:1390` — Responses API 使用 openai-responses 协议

#### `Ollama`（4 条）

- `project/backend/internal/model/agent_config.go:411` — 认证密钥（实际密钥值，非环境变量名；Ollama 本地填占位符 ollama）
- `project/backend/internal/model/agent_config.go:435` — Ollama 本地推理使用 ollama 协议
- `project/backend/internal/model/agent_config.go:1292` — 认证密钥（实际密钥值，非环境变量名；Ollama 本地填占位符 ollama）
- `project/backend/internal/model/agent_config.go:1346` — Ollama 本地推理使用 ollama 协议

#### `lmstudio`（4 条）

- `project/backend/internal/model/agent_config.go:431` — 接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:436` — LM Studio 本地推理使用 lmstudio 协议
- `project/backend/internal/model/agent_config.go:1312` — 接口协议类型（openai-completions / anthropic-messages / ollama / lmstudio ...），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1353` — LM Studio 本地推理使用 lmstudio 协议

#### `openai`（4 条）

- `project/backend/internal/model/agent_config.go:439` — 运行时适配器包（@opencode/ai/providers/openai-compatible / openai / anthropic），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:444` — 顶层默认供应商 id，取自 [model_providers] 的键（官方默认 openai）
- `project/backend/internal/model/agent_config.go:1231` — 运行时适配器包（@opencode/ai/providers/openai-compatible / openai / anthropic），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1272` — 顶层默认供应商 id，取自 [model_providers] 的键（官方默认 openai）

#### `https`（4 条）

- `project/backend/internal/model/agent_config.go:446` — 该供应商的 API base URL（如 https://api.example.com/v1）
- `project/backend/internal/model/agent_config.go:451` — 自定义供应商的 API 端点（如 https://gateway.example.com/v1；已装目录供应商省略则用目录端点）
- `project/backend/internal/model/agent_config.go:1274` — 该供应商的 API base URL（如 https://api.example.com/v1）
- `project/backend/internal/model/agent_config.go:1369` — 自定义供应商的 API 端点（如 https://gateway.example.com/v1；已装目录供应商省略则用目录端点）

#### `openai-responses`（4 条）

- `project/backend/internal/model/agent_config.go:452` — 接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:458` — Responses API 使用 openai-responses 协议
- `project/backend/internal/model/agent_config.go:1373` — 接口协议（openai-completions / openai-responses / anthropic-messages），自定义供应商必填，一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1390` — Responses API 使用 openai-responses 协议

#### `windows`（3 条）

- `project/backend/internal/handler/agent_config.go:375` — 本机系统必须是 windows、mac 或 other
- `project/backend/internal/handler/agent_config.go:588` — 本机系统必须是 windows、mac 或 other
- `project/backend/internal/handler/agent_config.go:795` — 目标系统必须是 windows、mac 或 other

#### `mac`（3 条）

- `project/backend/internal/handler/agent_config.go:375` — 本机系统必须是 windows、mac 或 other
- `project/backend/internal/handler/agent_config.go:588` — 本机系统必须是 windows、mac 或 other
- `project/backend/internal/handler/agent_config.go:795` — 目标系统必须是 windows、mac 或 other

#### `other`（3 条）

- `project/backend/internal/handler/agent_config.go:375` — 本机系统必须是 windows、mac 或 other
- `project/backend/internal/handler/agent_config.go:588` — 本机系统必须是 windows、mac 或 other
- `project/backend/internal/handler/agent_config.go:795` — 目标系统必须是 windows、mac 或 other

#### `path`（3 条）

- `project/backend/internal/handler/agent_config.go:694` — 缺少 path 参数
- `project/backend/internal/handler/agent_config.go:715` — 缺少 path 参数
- `project/backend/internal/handler/agent_config.go:745` — 缺少 path 参数

#### `managed`（3 条）

- `project/backend/internal/handler/agent_managed.go:279` — managed: 回滚托管行 %s 失败: %v
- `project/backend/internal/handler/agent_managed.go:305` — managed: 删除托管行时清理配置块失败: %v
- `project/backend/internal/handler/agent_managed.go:586` — managed: 读取同文件其他托管行失败: %v

#### `Endpoint`（3 条）

- `project/backend/internal/handler/agent_managed.go:771` — 所选供应商没有可用的 Endpoint
- `project/backend/internal/handler/agent_managed.go:782` — 有多个 Endpoint 分组，必须为 %s 填写后缀
- `project/backend/internal/handler/relay.go:50` — 无法为 %s 找到可用供应商：该模型不支持请求路径 %s（模型声明的 Endpoint：%s）。请在供应商页对应模型行补充该 Endpoint，或改用模型支持的路径。

#### `s`（3 条）

- `project/backend/internal/handler/model_fetch.go:46` — 接口地址必须是 http(s) URL
- `project/backend/internal/relay/failover.go:579` — 首字速度不满足（实测 %dms，阈值 %ds）
- `project/backend/internal/relay/failover.go:581` — 首字速度不满足（阈值 %ds）

#### `URL`（3 条）

- `project/backend/internal/handler/model_fetch.go:46` — 接口地址必须是 http(s) URL
- `project/backend/internal/model/agent_config.go:446` — 该供应商的 API base URL（如 https://api.example.com/v1）
- `project/backend/internal/model/agent_config.go:1274` — 该供应商的 API base URL（如 https://api.example.com/v1）

#### `f`（3 条）

- `project/backend/internal/handler/update.go:117` — \r下载中 %3.0f%%  %.1f/%.1f MB   
- `project/backend/internal/handler/update.go:120` — \r下载中 %.1f MB   
- `project/backend/internal/relay/failover.go:321` — 响应速度 %.1f token/s 低于规则限制 %d token/s

#### `opencode`（3 条）

- `project/backend/internal/model/agent_config.go:437` — 在 opencode 界面里的显示名（供应商名称）
- `project/backend/internal/model/agent_config.go:1182` — 在 opencode 界面里的显示名（供应商名称）
- `project/backend/internal/model/agent_config.go:1230` — 在 opencode 界面里的显示名（供应商名称）

#### `promptCacheKey`（3 条）

- `project/backend/internal/model/agent_config.go:440` — 启用 promptCacheKey 缓存优化（官方默认 false，建议开启）
- `project/backend/internal/model/agent_config.go:1186` — 启用 promptCacheKey 缓存优化（官方默认 false，建议开启）
- `project/backend/internal/model/agent_config.go:1234` — 启用 promptCacheKey 缓存优化（官方默认 false，建议开启）

#### `JSONC`（2 条）

- `project/backend/internal/handler/agent_config.go:166` — JSONC 解析失败: 
- `project/backend/internal/handler/agent_config.go:248` — JSONC 解析失败: 

#### `local`（2 条）

- `project/backend/internal/handler/agent_config.go:392` — 模式必须是 local 或 ssh
- `project/backend/internal/handler/agent_config.go:628` — 模式必须是 local 或 ssh

#### `ssh`（2 条）

- `project/backend/internal/handler/agent_config.go:392` — 模式必须是 local 或 ssh
- `project/backend/internal/handler/agent_config.go:628` — 模式必须是 local 或 ssh

#### `password`（2 条）

- `project/backend/internal/handler/agent_config.go:843` — SSH 认证方式必须是 password 或 key
- `project/backend/internal/handler/agent_config.go:862` — 跳板机认证方式必须是 password 或 key

#### `provider_id`（2 条）

- `project/backend/internal/handler/agent_config.go:1135` — provider_id 不能为空
- `project/backend/internal/handler/agent_config.go:1667` — provider_id 与 model_id 不能为空

#### `mapping`（2 条）

- `project/backend/internal/handler/agent_credentials.go:192` — 凭据文件顶层必须是映射（mapping）
- `project/backend/internal/handler/agent_credentials.go:282` — 凭据文件顶层必须是映射（mapping）

#### `r`（2 条）

- `project/backend/internal/handler/update.go:117` — \r下载中 %3.0f%%  %.1f/%.1f MB   
- `project/backend/internal/handler/update.go:120` — \r下载中 %.1f MB   

#### `MB`（2 条）

- `project/backend/internal/handler/update.go:117` — \r下载中 %3.0f%%  %.1f/%.1f MB   
- `project/backend/internal/handler/update.go:120` — \r下载中 %.1f MB   

#### `YAML`（2 条）

- `project/backend/internal/handler/yaml_config.go:70` — YAML 解析失败: %w
- `project/backend/internal/handler/yaml_config.go:110` — YAML 转 JSON 失败: %w

#### `chat/completions`（2 条）

- `project/backend/internal/model/agent_config.go:414` — API 端点，必须是完整路径且一般以 /chat/completions 结尾
- `project/backend/internal/model/agent_config.go:1293` — API 端点，必须是完整路径且一般以 /chat/completions 结尾

#### `v1`（2 条）

- `project/backend/internal/model/agent_config.go:416` — 供应商 API 端点（按官方格式，注意不要多写不该有的 /v1）
- `project/backend/internal/model/agent_config.go:1307` — 供应商 API 端点（按官方格式，注意不要多写不该有的 /v1）

#### `schema`（2 条）

- `project/backend/internal/model/agent_config.go:427` — 是否支持思考模式（官方 schema 校验，未配按 false 处理）
- `project/backend/internal/model/agent_config.go:1317` — 是否支持思考模式（官方 schema 校验，未配按 false 处理）

#### `bool`（2 条）

- `project/backend/internal/model/agent_config.go:428` — 模型是否支持思考模式（思考程度统一值→bool）
- `project/backend/internal/model/agent_config.go:1189` — 模型是否支持思考模式（思考程度统一值→bool）

#### `text/image/video/audio`（2 条）

- `project/backend/internal/model/agent_config.go:429` — 支持的输入类型（text/image/video/audio）
- `project/backend/internal/model/agent_config.go:1316` — 支持的输入类型（text/image/video/audio）

#### `text/image/video/audio/pdf`（2 条）

- `project/backend/internal/model/agent_config.go:430` — 支持的输入类型（text/image/video/audio/pdf）
- `project/backend/internal/model/agent_config.go:1238` — 支持的输入类型（text/image/video/audio/pdf）

#### `Codex`（2 条）

- `project/backend/internal/model/agent_config.go:432` — 接口协议（2026.02 起 Codex 强制 responses，不再支持 Chat Completions）
- `project/backend/internal/model/agent_config.go:1277` — 接口协议（2026.02 起 Codex 强制 responses，不再支持 Chat Completions）

#### `responses`（2 条）

- `project/backend/internal/model/agent_config.go:432` — 接口协议（2026.02 起 Codex 强制 responses，不再支持 Chat Completions）
- `project/backend/internal/model/agent_config.go:1277` — 接口协议（2026.02 起 Codex 强制 responses，不再支持 Chat Completions）

#### `LM`（2 条）

- `project/backend/internal/model/agent_config.go:436` — LM Studio 本地推理使用 lmstudio 协议
- `project/backend/internal/model/agent_config.go:1353` — LM Studio 本地推理使用 lmstudio 协议

#### `Studio`（2 条）

- `project/backend/internal/model/agent_config.go:436` — LM Studio 本地推理使用 lmstudio 协议
- `project/backend/internal/model/agent_config.go:1353` — LM Studio 本地推理使用 lmstudio 协议

#### `AI`（2 条）

- `project/backend/internal/model/agent_config.go:438` — AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1183` — AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类

#### `ai-sdk/openai-compatible`（2 条）

- `project/backend/internal/model/agent_config.go:438` — AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1183` — AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类

#### `ai-sdk/openai`（2 条）

- `project/backend/internal/model/agent_config.go:438` — AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1183` — AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类

#### `ai-sdk/anthropic`（2 条）

- `project/backend/internal/model/agent_config.go:438` — AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1183` — AI SDK 适配器包名（@ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic），一般由 endpoint 关键词自动归类

#### `opencode/ai/providers/openai-compatible`（2 条）

- `project/backend/internal/model/agent_config.go:439` — 运行时适配器包（@opencode/ai/providers/openai-compatible / openai / anthropic），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1231` — 运行时适配器包（@opencode/ai/providers/openai-compatible / openai / anthropic），一般由 endpoint 关键词自动归类

#### `anthropic`（2 条）

- `project/backend/internal/model/agent_config.go:439` — 运行时适配器包（@opencode/ai/providers/openai-compatible / openai / anthropic），一般由 endpoint 关键词自动归类
- `project/backend/internal/model/agent_config.go:1231` — 运行时适配器包（@opencode/ai/providers/openai-compatible / openai / anthropic），一般由 endpoint 关键词自动归类

#### `model_providers`（2 条）

- `project/backend/internal/model/agent_config.go:444` — 顶层默认供应商 id，取自 [model_providers] 的键（官方默认 openai）
- `project/backend/internal/model/agent_config.go:1272` — 顶层默认供应商 id，取自 [model_providers] 的键（官方默认 openai）

#### `base`（2 条）

- `project/backend/internal/model/agent_config.go:446` — 该供应商的 API base URL（如 https://api.example.com/v1）
- `project/backend/internal/model/agent_config.go:1274` — 该供应商的 API base URL（如 https://api.example.com/v1）

#### `api.example.com/v1`（2 条）

- `project/backend/internal/model/agent_config.go:446` — 该供应商的 API base URL（如 https://api.example.com/v1）
- `project/backend/internal/model/agent_config.go:1274` — 该供应商的 API base URL（如 https://api.example.com/v1）

#### `dsh`（2 条）

- `project/backend/internal/model/agent_config.go:449` — 认证引用（环境变量名，经 dsh 凭据系统按请求解析）；明文密钥存在 $DSH_HOME/.credentials.yaml，不写进配置文件
- `project/backend/internal/model/agent_config.go:1367` — 认证引用（环境变量名，经 dsh 凭据系统按请求解析）；明文密钥存在 $DSH_HOME/.credentials.yaml，不写进配置文件

#### `DSH_HOME/.credentials.yaml`（2 条）

- `project/backend/internal/model/agent_config.go:449` — 认证引用（环境变量名，经 dsh 凭据系统按请求解析）；明文密钥存在 $DSH_HOME/.credentials.yaml，不写进配置文件
- `project/backend/internal/model/agent_config.go:1367` — 认证引用（环境变量名，经 dsh 凭据系统按请求解析）；明文密钥存在 $DSH_HOME/.credentials.yaml，不写进配置文件

#### `gateway.example.com/v1`（2 条）

- `project/backend/internal/model/agent_config.go:451` — 自定义供应商的 API 端点（如 https://gateway.example.com/v1；已装目录供应商省略则用目录端点）
- `project/backend/internal/model/agent_config.go:1369` — 自定义供应商的 API 端点（如 https://gateway.example.com/v1；已装目录供应商省略则用目录端点）

#### `UNKNOWN_MODEL`（2 条）

- `project/backend/internal/model/agent_config.go:453` — 模型唯一标识（必须与供应商侧精确一致，否则请求前报 UNKNOWN_MODEL）
- `project/backend/internal/model/agent_config.go:1374` — 模型唯一标识（必须与供应商侧精确一致，否则请求前报 UNKNOWN_MODEL）

#### `defaultContextWindow`（2 条）

- `project/backend/internal/model/agent_config.go:455` — 最大上下文 token 数（缺省走路由 defaultContextWindow，默认 262144）
- `project/backend/internal/model/agent_config.go:1376` — 最大上下文 token 数（缺省走路由 defaultContextWindow，默认 262144）

#### `text`（2 条）

- `project/backend/internal/model/agent_config.go:457` — 支持的输入类型（仅 text / image；声明是断言不是校验，端点不支持会在请求时被拒）
- `project/backend/internal/model/agent_config.go:1378` — 支持的输入类型（仅 text / image；声明是断言不是校验，端点不支持会在请求时被拒）

#### `image`（2 条）

- `project/backend/internal/model/agent_config.go:457` — 支持的输入类型（仅 text / image；声明是断言不是校验，端点不支持会在请求时被拒）
- `project/backend/internal/model/agent_config.go:1378` — 支持的输入类型（仅 text / image；声明是断言不是校验，端点不支持会在请求时被拒）

#### `choices`（2 条）

- `project/backend/internal/relay/disabled_record.go:388` — 上游响应缺少 choices 字段
- `project/backend/internal/service/recovery.go:125` — 响应缺少 choices 字段

#### `AES`（2 条）

- `project/backend/internal/service/agent_crypto.go:31` — 创建 AES 加密器失败: %w
- `project/backend/internal/service/agent_crypto.go:63` — 创建 AES 解密器失败: %w

#### `GCM`（2 条）

- `project/backend/internal/service/agent_crypto.go:35` — 创建 GCM 加密器失败: %w
- `project/backend/internal/service/agent_crypto.go:67` — 创建 GCM 解密器失败: %w

#### `nonce`（2 条）

- `project/backend/internal/service/agent_crypto.go:39` — 生成随机 nonce 失败: %w
- `project/backend/internal/service/agent_crypto.go:75` — 解密数据不完整（缺少 nonce 或密文）

#### `log`（2 条）

- `project/backend/internal/service/logwriter.go:307` — rename legacy 自动禁用 log sources: %w
- `project/backend/internal/service/logwriter.go:310` — migrated %d log rows from source 自动禁用 to 故障转移

#### `HAPIY_ENCRYPTION_KEY`（1 条）

- `project/backend/internal/config/config.go:64` — HAPIY_ENCRYPTION_KEY 必须是 32 字节的 hex 或 base64 编码

#### `hex`（1 条）

- `project/backend/internal/config/config.go:64` — HAPIY_ENCRYPTION_KEY 必须是 32 字节的 hex 或 base64 编码

#### `base64`（1 条）

- `project/backend/internal/config/config.go:64` — HAPIY_ENCRYPTION_KEY 必须是 32 字节的 hex 或 base64 编码

#### `Agent`（1 条）

- `project/backend/internal/handler/agent_config.go:945` — 该软件类型尚未配置 JSON 路径，请先在「接管 Agent」中填写 provider/model gjson

#### `provider/model`（1 条）

- `project/backend/internal/handler/agent_config.go:945` — 该软件类型尚未配置 JSON 路径，请先在「接管 Agent」中填写 provider/model gjson

#### `gjson`（1 条）

- `project/backend/internal/handler/agent_config.go:945` — 该软件类型尚未配置 JSON 路径，请先在「接管 Agent」中填写 provider/model gjson

#### `model_id`（1 条）

- `project/backend/internal/handler/agent_config.go:1667` — provider_id 与 model_id 不能为空

#### `fields`（1 条）

- `project/backend/internal/handler/agent_config.go:1671` — fields 不能为空

#### `BaseURL`（1 条）

- `project/backend/internal/handler/audit.go:56` — 更新 BaseURL 路径

#### `minutes`（1 条）

- `project/backend/internal/handler/disabled_record.go:161` — minutes 必须为正数

#### `http`（1 条）

- `project/backend/internal/handler/model_fetch.go:46` — 接口地址必须是 http(s) URL

#### `data`（1 条）

- `project/backend/internal/handler/model_fetch.go:85` — 上游响应缺少 data 数组

#### `models.dev`（1 条）

- `project/backend/internal/handler/models_dev_proxy.go:243` — 获取 models.dev 数据失败，请稍后重试

#### `Endpoints`（1 条）

- `project/backend/internal/handler/relay.go:67` — 无法为 %s 找到可用供应商，请检查：模型名（区分大小写）、Endpoints 白名单、供应商/工作流开关、故障转移状态、拓扑接线。

#### `retention_minutes`（1 条）

- `project/backend/internal/handler/runtime.go:57` — retention_minutes 必须在 0-1440 之间

#### `f/`（1 条）

- `project/backend/internal/handler/update.go:117` — \r下载中 %3.0f%%  %.1f/%.1f MB   

#### `auth.profiles`（1 条）

- `project/backend/internal/model/agent_config.go:413` — 认证密钥。规范位置在 auth.profiles 段（用环境变量引用如 ${ZAI_API_KEY}），不在 models.providers 下内联

#### `ZAI_API_KEY`（1 条）

- `project/backend/internal/model/agent_config.go:413` — 认证密钥。规范位置在 auth.profiles 段（用环境变量引用如 ${ZAI_API_KEY}），不在 models.providers 下内联

#### `models.providers`（1 条）

- `project/backend/internal/model/agent_config.go:413` — 认证密钥。规范位置在 auth.profiles 段（用环境变量引用如 ${ZAI_API_KEY}），不在 models.providers 下内联

#### `token/s`（1 条）

- `project/backend/internal/relay/failover.go:321` — 响应速度 %.1f token/s 低于规则限制 %d token/s

#### `ms`（1 条）

- `project/backend/internal/relay/failover.go:579` — 首字速度不满足（实测 %dms，阈值 %ds）

#### `HTTP`（1 条）

- `project/backend/internal/relay/failover.go:606` — HTTP 错误（实际 %d）

#### `selfupdate`（1 条）

- `project/backend/internal/selfupdate/selfupdate.go:419` — selfupdate: 下载中断：连续 %s 没有收到任何数据（网络假死或已断开）

#### `CNY`（1 条）

- `project/backend/internal/service/exchange.go:125` — 汇率接口响应中未找到 CNY 汇率字段

#### `rename`（1 条）

- `project/backend/internal/service/logwriter.go:307` — rename legacy 自动禁用 log sources: %w

#### `legacy`（1 条）

- `project/backend/internal/service/logwriter.go:307` — rename legacy 自动禁用 log sources: %w

#### `sources`（1 条）

- `project/backend/internal/service/logwriter.go:307` — rename legacy 自动禁用 log sources: %w

#### `migrated`（1 条）

- `project/backend/internal/service/logwriter.go:310` — migrated %d log rows from source 自动禁用 to 故障转移

#### `rows`（1 条）

- `project/backend/internal/service/logwriter.go:310` — migrated %d log rows from source 自动禁用 to 故障转移

#### `from`（1 条）

- `project/backend/internal/service/logwriter.go:310` — migrated %d log rows from source 自动禁用 to 故障转移

#### `source`（1 条）

- `project/backend/internal/service/logwriter.go:310` — migrated %d log rows from source 自动禁用 to 故障转移

#### `to`（1 条）

- `project/backend/internal/service/logwriter.go:310` — migrated %d log rows from source 自动禁用 to 故障转移
