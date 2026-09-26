# opencode 配置字段参考（官方 vs 现有 opencode.json 模板）

> 本文件仅供阅读参考，系统不会直接调用。基于 opencode 官方 JSON schema（opencode.ai/config.json）及文档整理，与本目录下 `opencode.json` 模板逐字段对比，标注推荐值是否得当、字段是否齐全。

---

## 一、工具与配置文件

| 项 | 说明 |
|----|------|
| 工具 | opencode（开源版 Claude Code 风格 CLI，支持 75+ LLM provider） |
| 配置文件 | macOS: `~/.config/opencode/opencode.json` ｜ Windows: `%USERPROFILE%\.config\opencode\opencode.json` |
| 格式 | JSON（也支持 `.jsonc`） |
| 凭证 | `/connect` 命令录入的 API Key 存在 `~/.local/share/opencode/auth.json`，不在 opencode.json 里 |
| 官方文档 | https://opencode.ai/docs/providers/ ｜ https://opencode.ai/docs/models/ |

opencode 基于 [AI SDK](https://ai-sdk.dev/)，provider 配置本质是「给 AI SDK 适配器传 options」。内置 provider（Anthropic/OpenAI 等）无需写 `npm`；自定义 provider 必须显式指定 `npm` 包名。

---

## 二、官方推荐的 Provider 字段

provider 配置在 `provider.{provider_id}` 下：

| 字段 | 类型 | 必填 | 推荐 | 说明 |
|------|------|------|------|------|
| `npm` | string | 自定义 provider 必填 | `@ai-sdk/openai-compatible`（通用）/ `@ai-sdk/openai`（Responses API）/ `@ai-sdk/anthropic`（Messages API） | AI SDK 适配器包名。内置 provider 不用写 |
| `name` | string | 否 | 自定义显示名 | UI 里显示的 provider 名称 |
| `options` | object | 否 | 透传给 AI SDK 适配器的任意选项 | 见下表 options 子字段 |
| `options.baseURL` | string | 自定义 provider 必填 | 完整端点，如 `http://127.0.0.1:1234/v1` | 自定义端点（代理 / 本地模型） |
| `options.apiKey` | string | 否 | 推荐用 `/connect` 录入，不写明文 | 认证密钥 |
| `options.headers` | object | 否 | 需要自定义头时填 | 如 Helicone 的 `Helicone-Cache-Enabled` 等 |
| `options.region` / `options.profile` | string | 否 | 云厂商专用 | 如 Bedrock 的 AWS region / profile |
| `blacklist` | array | 否 | 需隐藏某些模型时用 | 从 `/models` 选择器移除指定模型 ID |
| `whitelist` | array | 否 | 只保留指定模型 | 保留列出的、隐藏其余；可与 blacklist 组合 |
| `models` | map | 否 | 自定义模型时用 | 模型 ID -> 配置对象，见 model 字段表 |

---

## 三、官方推荐的 Model 字段

model 配置在 `provider.{provider_id}.models.{model_id}` 下（key 即模型 ID）：

| 字段 | 类型 | 必填 | 推荐 | 说明 |
|------|------|------|------|------|
| `name` | string | 否 | 自定义显示名 | UI 显示名（不填则用 key） |
| `id` | string | 否 | Azure 等需覆盖时填 | 覆盖实际请求的模型 ID（如 Azure 部署名 / Bedrock ARN） |
| `limit.context` | number | 否 | 自定义/本地模型建议写 | 上下文 token 上限，如 `128000` |
| `limit.output` | number | 否 | 自定义/本地模型建议写 | 输出 token 上限，如 `65536` |
| `options` | object | 否 | 按模型调参 | 透传给该模型的选项，如 `reasoningEffort`/`thinking`/`textVerbosity` |
| `variants` | object | 否 | 同模型多档配置 | 自定义变体（high/low 等），详见官方 |
| `disabled` | boolean | 否 | 想禁用某变体时 | 设为 true 禁用该条目 |

> `reasoning` / `tool_call` 都是 schema 里真实存在的可选顶层 model boolean，模板把两者作为「已知字段」列入（不设推荐值也不标必填）；本项目的「模型通用信息」会把思考档位按 bool 写进 `reasoning`。请求级思考调参才走 `options.thinking`（Anthropic）/ `options.reasoningEffort`（OpenAI）或 `variants`。

---

## 四、现有 `opencode.json` 模板问题点评

> 经 opencode 官方 JSON schema（https://opencode.ai/config.json）逐字段核验，更正如下。此前"编造/张冠李戴"判断作废——下列字段均经 schema 确认真实存在。

### 1. 可选字段与推荐值（与当前模板一致）
- `options.setCacheKey`：模板保留且 recommended `true`（官方默认 false；开启 promptCacheKey 缓存优化。注意：管理模型会把没写该字段的 provider 标为缺字段，一键套用会补 `true`）；
- `options.timeout` / `options.headerTimeout` / `options.chunkTimeout` / `options.enterpriseUrl` / `blacklist` / `whitelist` 等可选调优/隐藏项已从模板移除，不推荐、不干预（需要时在规则里手动加）。

### 2. 字段真实性确认（更正此前误判）
官方 schema 证实以下字段全部真实存在，此前"编造/张冠李戴"判断作废：
- `options.setCacheKey`（boolean，"Enable promptCacheKey for this provider, default false"）
- `options.headerTimeout`（number/boolean，default 300000，可设 false 禁用）
- `options.chunkTimeout`（number/boolean，default 300000，可设 false 禁用）
- `options.enterpriseUrl`（string，"GitHub Enterprise URL for copilot authentication"）
- `model.reasoning`（boolean）
- `model.tool_call`（boolean）
- `model.attachment`（boolean）

### 3. 缺失字段（schema 有但模板未列）
官方 schema 确认存在、模板未列出的字段：
- provider：`api`、`env`、`id`
- model：`family`、`release_date`、`temperature`、`interleaved`、`cost`、`modalities`、`experimental`、`status`、`provider`、`options`、`headers`、`variants`、`limit.input`

### 4. npm 归类逻辑
模板 `protocols` 按端点关键词自动归类 npm 包，思路合理；内置 provider 无需 `npm`，仅自定义 provider 需要，模板未区分。（注：common 里 `npm` 标 `required=true`、各 endpoint 规则里的 `npm` 标 `required=false` —— 后者只负责给推荐值，必填口径以 common 为准。）

### 5. `limit.output` 只在 Anthropic 协议规则里声明必填（有意）
Anthropic Messages API 官方要求每请求带 `max_tokens`，对应 opencode 的模型 `limit.output`（`model_info_fields.max_output_token` 也指向它）。因此该字段只在 Anthropic Messages 协议的 endpoint 规则里标 `required=true`，common 不再重复列一条（同键重复时后出现的 endpoint 条目生效，common 的重复行没有实际作用）。非 Anthropic 端点不强制。


### 6. 思考档位（reasoning_effort，第五个模型信息字段）
opencode 的多档位表达是模型级 `variants`（每个档位一个 `{"options":{"reasoningEffort":档位}}` 预设）；
Anthropic 系模型官方走 `options.thinking`（`{type, budgetTokens}` 形状），且 models.dev 对 Claude 系给的是
`budget_tokens` 选项、没有 effort 枚举，因此交集为空、不会写 variants。
统一值是 models.dev `reasoning_options` 里 `type:effort` 的枚举数组（该模型支持哪些档位，8173 个模型里约 3700 个带此枚举）。
`values`（允许值）= opencode 支持的档位全集，无默认档位；写值时先取 models.dev 枚举 ∩ 允许值的交集，
`op=variants` 把交集里的每个档位写成一条 variants 预设。模型无 effort 枚举、或交集为空时不写。

---

## 五、推荐配置示例（官方风格）

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "lmstudio/google/gemma-3n-e4b",
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (local)",
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1"
      },
      "models": {
        "google/gemma-3n-e4b": {
          "name": "Gemma 3n-e4b (local)"
        }
      }
    },
    "anthropic": {
      "blacklist": ["claude-opus-4-20250514"],
      "models": {
        "claude-sonnet-4-20250514": {
          "options": {
            "thinking": { "type": "enabled", "budgetTokens": 16000 }
          }
        }
      }
    }
  }
}
```

本地模型带 limit 示例：
```json
"models": {
  "qwen3-coder:a3b": {
    "name": "Qwen3-Coder: a3b-30b (local)",
    "limit": { "context": 128000, "output": 65536 }
  }
}
```

---

## 六、参考来源

- 官方 Providers 文档：https://opencode.ai/docs/providers/
- 官方 Models 文档：https://opencode.ai/docs/models/
- 官方 Config 文档：https://opencode.ai/docs/config/
- Models.dev（内置 provider/model 目录）：https://models.dev
- AI SDK：https://ai-sdk.dev/
