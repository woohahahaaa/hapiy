# MCP 工具矩阵

Agent 只能通过 MCP 工具操作 hapiy，不直接读写数据库。写工具统一走 `internal/provider` 等共享操作层，和仪表盘 handler 使用同一套校验、relay 引擎刷新与渠道事件日志。用户名、密码永久不开放。

## 已开放（21）

### 只读（9）

| 工具 | 覆盖 |
| --- | --- |
| `list_providers` | 供应商列表：状态、端点、模型、权重、优先级、分组、Key 数量 |
| `get_provider` | 单个供应商：Base URL、每个模型的端点、Key 尾号与备注、去重开关 |
| `list_models` | 可调用模型、供应商、端点 |
| `query_logs` | 请求日志筛选与分页（含错误信息） |
| `get_usage_stats` | 请求数、Token、费用、缓存命中、平均延迟 |
| `get_topology` | 拓扑节点与连线 |
| `list_disabled_channels` | 当前自动禁用的渠道 |
| `list_agent_configs` | 接管配置记录（仅元数据） |
| `web_search` | 联网搜索公开网页；优先自建 SearXNG，未配置时抓取 Bing |

### 供应商写入（8）

| 工具 | 覆盖 |
| --- | --- |
| `create_provider` | 新建（名称必填，其余可空，默认启用） |
| `update_provider` | 局部更新（只改传入字段，数组整组替换） |
| `delete_provider` | 删除（不可恢复） |
| `set_provider_status` | 渠道级启停（幂等） |
| `set_provider_workflow` | 工作流开关（同名互斥） |
| `set_provider_dedupe_v1` | 拉取模型时的 /v1 去重 |
| `reset_provider_disable` | 恢复单条或单维度自动禁用 |
| `reset_all_provider_disable` | 按维度恢复全部 |

### 禁用记录（4）

| 工具 | 覆盖 |
| --- | --- |
| `list_disabled_records` | 待恢复记录（Key 脱敏） |
| `replay_disabled_record` | 重放请求探测上游后恢复 |
| `restore_disabled_record` | 不探测直接恢复 |
| `extend_disabled_record_countdown` | 推迟定时恢复 |

## 仍缺

| 模块 | 缺口 |
| --- | --- |
| 供应商 | 拉取上游模型列表（`fetch-models`） |
| 令牌 | 列表、详情、新建、编辑、删除、启停、轮换 Key |
| 日志 | 抓包读取、清空日志/用量/抓包、日志源与模型下拉 |
| 规则 | rewrite / failover / rewrite-response 增删改查与试跑 |
| 拓扑 | 节点 config 细节、保存、校验、版本归档/回滚、画布布局 |
| 渠道亲和 | 读 + 保存 |
| 并发 / 活动请求 | 并发窗口、活动请求列表与阈值、kill、运行时指标 |
| Agent 接管 | 内容读写、版本、SSH 测试、路径探测、推荐应用、模型同步、接管供应商 CRUD/同步、来源保存 |
| Agent 规则 | 类型列表、规则增删改查、模板 |
| 设置 | settings 全量、base-url 路径表、汇率刷新/测试、models.dev 快照 |
| 备份 | 列表、创建、路径解析、下载、恢复、删除 |
| 更新 | 状态、检查、应用 |
| MCP 自身 | 状态、开关、轮换 key |
| 用户 | `users/me` 读；改用户名/密码（禁止） |

## 控制台跟随（内置聊天）

内置聊天 Agent 不走直连写工具：写操作变成 `ui_*` 执行工具，由控制台按用户路径完成，再把结果回报给等待中的工具调用。

- 新建 / 修改供应商：跳到供应商页，打开真实编辑弹窗，自动填好字段并在 ≥0.3 秒后点击保存；
- 删除：打开真实的二次确认弹窗，停留约 1.2 秒后点击确认；
- 启停 / 工作流 / 去重 / 恢复禁用：跳到供应商页，停顿后执行行内按钮调用的同一个接口，刷新并高亮；
- 每一步之间至少间隔 300ms；用户中途关闭弹窗会回报「已取消」，工具不会干等；
- 结果通过 `/v1/dashboard/events` 的 `chat_ui_action` 实时下发，控制台执行完后 POST `/v1/dashboard/chat/ui-actions/:id/result`，工具拿到结果才继续。

外部 MCP 客户端仍然使用直连写工具（没有控制台可驱动）。恢复禁用记录的三个写工具暂未接入控制台路径，聊天里先隐藏。

## 约束

- 写工具不得直接写表，必须复用 handler 同源的 service 函数。
- MCP 调用不经过 HTTP 审计中间件；供应商写工具已用 `auditMCP` 写「系统管理」日志，新增写工具要照做。
- 删除、恢复备份、自更新、轮换 key、kill 请求等不可逆操作，调用前先向用户确认。
- 上游 Key、下游令牌只返回尾号；请求头/请求体不通过 MCP 返回。
