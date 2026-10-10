# DeepSeek Harness（dsh）配置字段参考（官方 vs 现有 DeepSeek Harness.json 模板）

> 本文件仅供阅读参考，系统不会直接调用。基于 DeepSeek Harness 官方文档（`docs/user/guide/providers.zh.md`、`packages/llm/llm-pi-ai/README.zh.md`、生成的配置目录 `docs/config-catalog.zh.md`）整理，并与本目录下 `DeepSeek Harness.json` 模板逐字段对比。

---

## 一、工具与配置文件

| 项 | 说明 |
|----|------|
| 工具 | DeepSeek Harness（命令 `dsh`），DeepSeek 官方开源 agent harness（Everything is a plugin / Cordis） |
| 启动 | `npx @deepseek-ai/dsh web`，默认 Web UI 在 `http://127.0.0.1:3080` |
| 配置文件 | profile patch：`$DSH_HOME/profiles/<profile>/cordis.patch.yml`（`DSH_HOME` 缺省 `~/.dsh`）｜ Windows `%USERPROFILE%\.dsh\profiles\<profile>\cordis.patch.yml` |
| profile 名 | 随启动方式变化：**桌面版（Desktop App）是 `desktop`**；`dsh web` 是 `web`；自定义 profile 同理替换路径里的 profile 名。接管规则的 os_paths 默认按桌面版 `desktop`，`dsh web` 目标机把路径里的 desktop 换成 web |
| 格式 | **YAML**。`cordis.yml` 是空基线（勿手改），真实配置来自 patch 层；模型页写入的就是 profile 的 `cordis.patch.yml`，改动下一次请求生效、无需重启 |
| 凭据 | `$DSH_HOME/.credentials.yaml` 凭据库；配置里只写 `apiKeyEnv`（环境变量名）引用，不写明文密钥 |
| 其他文件 | `$DSH_HOME/settings.yaml`（运行时可热更设置）、`$DSH_HOME/profiles/<profile>/package.json`（bundle 列表） |
| 官方文档 | https://deepseek-harness.github.io/deepseek-harness/en/guide/providers ｜ 仓库 https://github.com/deepseek-ai/deepseek-harness |

关键事实：**dsh 的 provider / model 配置在 YAML 里，且插件需要同时挂载在 patch 层（`- id: llm-pi-ai`）**。现有接管引擎只读写 JSON/JSONC，无法自动生成 / 写回 provider 块，所以模板 `json_paths` 留空合理，字段只作配置参考；「管理模型」的托管生成对该类型不可用，自动写回等引擎支持 YAML 后再补。

---

## 二、providers 结构（dsh-llm-pi-ai 插件）

模型页 / 手写 patch 都是这段结构，`providers` 字典的键就是 provider id（永久，请求、会话、默认模型、凭据引用都用它）：

```yaml
- id: llm-pi-ai
  config:
    providers:
      hapiy:
        apiKeyEnv: HAPIY_API_KEY        # 凭据引用（环境变量名），经 dsh 凭据系统解析
        displayName: HAPIY              # 选择器显示名，缺省用 provider id
        api: openai-completions         # 线路协议，自定义提供商必填
        baseURL: https://gw.example.com/v1
        models:
          - id: gpt-5.6-sol
          - id: claude-fable-5
            maxTokens: 8192
            input: [text, image]
```

> Cordis 配置覆盖是**整条替换**而不是深合并：编辑已有 `llm-pi-ai` 覆盖项时要保留其他 provider 和字段。

默认模型（新会话）由 `agent-default-model` 插件指定，与 providers 平级：

```yaml
- id: agent-default-model
  config:
    provider: hapiy
    model: gpt-5.6-sol
```

---

## 三、provider 级字段（PiAiProviderProfile）

模板 `recommendations` 里 scope=provider 的即这一组：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `apiKeyEnv` | string | 接入网关建议必填 | 凭据引用（环境变量名），按请求解析；解析不到报 `MISSING_CREDENTIAL`。明文密钥存 `$DSH_HOME/.credentials.yaml` |
| `displayName` | string | 否 | 选择器显示名，缺省用 provider id |
| `api` | string | 自定义必填 | 线路协议：`openai-completions` / `openai-responses` / `anthropic-messages`（模型页下拉就给这三种） |
| `baseURL` | string | 自定义必填 | API 端点；探测模型走 `GET {baseURL}/models`（Anthropic 为 `GET /v1/models?limit=1000`） |
| `models` | array | 自定义必填 | 显式列表会**整体替换**该路由的已装目录；每项缺省字段从同名目录模型继承 |
| `modelOverrides` | object | 否 | 只改已装目录里的个别模型（与 `models` 互斥） |
| `defaultInput` | array | 否 | 未声明输入类型的模型回退值，默认 `[text]`（不得为空） |
| `defaultContextWindow` | number | 否 | 未描述模型的上下文回退，默认 `262144` |
| `defaultMaxTokens` | number | 否 | 未描述模型的输出能力回退，默认 `32768` |
| `compat` | object | 否 | 线路兼容开关（`supportsDeveloperRole`、`maxTokensField`、`thinkingFormat` 等），路由级、模型级逐字段胜出 |
| `reasoning` | string | 否 | 该路由默认思考档位 |
| `retryPolicy` | object | 否 | 重试策略，缺省 normal / 5 次重试 |

---

## 四、model 级字段（PiAiModelProfile）

模板 scope=model 的即这一组：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 精确模型 id，必须与提供商侧一致，否则请求前就报 `UNKNOWN_MODEL` |
| `name` | string | 否 | 显示名；缺省用目录名，再缺省用 id |
| `contextWindow` | number | 否 | 最大上下文 token 数 |
| `maxTokens` | number | 否 | 最大输出 token 数；配置后同时成为该模型每请求的默认上限（Anthropic Messages 协议必填） |
| `input` | array | 否 | 输入模态，仅 `text` / `image`；声明是断言不是校验，端点不支持会在请求时被拒 |
| `reasoningEfforts` | object \| false | 否 | 可选思考档位 `{档位: 线路写法}`，`off` 可为空；`false` 声明非推理模型 |
| `compat` | object | 否 | 模型级兼容开关，逐字段覆盖路由 |

---

## 五、协议取值与归类

模型页「API 协议」只有三种，一个 provider 只能选一种；网关同时提供多种协议时拆成两个 provider：

| 协议 | `api` 取值 | endpoint 关键词归类 |
|------|-----------|--------------------|
| OpenAI Chat Completions | `openai-completions` | `completions` / `chat/comple` / `/v1/chat` |
| OpenAI Responses | `openai-responses` | `responses` |
| Anthropic Messages | `anthropic-messages` | `chat/message` / `/v1/message` / `messages` |

Anthropic Messages 官方要求每次请求带 `max_tokens`，所以该协议下 `maxTokens` 必填——模板里已按协议标注。

---

## 六、现有 `DeepSeek Harness.json` 模板说明

### 1. `json_paths` 留空（格式不匹配，合理）
dsh 是 YAML + 多插件 patch 结构，gjson/sjson 无法定位与写回。模板只保留路径检测（os_paths）与字段参考（recommendations / protocols），与 `ChatGPT.json`（TOML）、`WorkBuddy.json` 同口径。

### 2. `model_info_fields` 只作映射参考
结构上 pi-ai 模型确实有对应字段（`contextWindow` / `maxTokens` / `input`），映射按官方写；但引擎写不进去，暂不参与「同步模型信息」。`thinking_levels` / `reasoning_effort` 不映射：思考档位由 `reasoningEfforts`（档位→线路写法）表达，和统一值的写法不一致。

### 3. 漏配提示
- provider id 永久，写错只能新建再删旧（不要指望改名）；
- 手写模型不声明 `reasoningEfforts` 就没有推理档位菜单；
- `off` 档留空只对「按请求才思考」的模型有效；默认思考的端点要配 `compat.thinkingFormat: deepseek`；
- 探测模型的 `GET {baseURL}/models` 不是所有网关都实现，失败时手动录入模型 id 即可。

---

## 七、参考来源

- DeepSeek Harness 官方模型配置指南：https://deepseek-harness.github.io/deepseek-harness/en/guide/providers
- dsh-llm-pi-ai 包参考：`packages/llm/llm-pi-ai/README.zh.md`
- 生成的插件配置目录（全部字段与默认值）：`docs/config-catalog.zh.md#deepseek-aidsh-llm-pi-ai`
- 仓库：https://github.com/deepseek-ai/deepseek-harness
