# Codex (ChatGPT) 配置字段参考（官方 vs 现有 ChatGPT.json 模板）

> 本文件仅供阅读参考，系统不会直接调用。基于 OpenAI Codex CLI 官方用法及社区实测整理，并与本目录下 `ChatGPT.json` 模板逐字段对比，标出乱写 / 缺失 / 表述偏弱之处。

---

## 一、工具与配置文件

| 项 | 说明 |
|----|------|
| 工具 | OpenAI Codex CLI（`@openai/codex`），桌面端称 Codex Desktop |
| 配置文件 | macOS: `~/.codex/config.toml` ｜ Windows: `%USERPROFILE%\.codex\config.toml` |
| 格式 | **TOML**（不是 JSON，所以 `json_paths` 无法映射，模板里留空合理） |
| 凭证 | `~/.codex/auth.json` 或环境变量；Key 读取顺序：环境变量 > 配置文件 |
| 官方仓库 | https://github.com/openai/codex |

关键事实：**2026 年 2 月起 Codex 强制 `wire_api = "responses"`（Responses API），不再支持 Chat Completions**。接入第三方模型时，网关必须原生支持 Responses API。

---

## 二、官方推荐的顶层全局字段

这些是 Codex 实际最常用、但 `ChatGPT.json` 模板**完全缺失**的字段：

| 字段 | 类型 | 推荐 | 说明 |
|------|------|------|------|
| `model` | string | 必填，默认模型 | 如 `gpt-5.6-sol` / `claude-fable-5` |
| `model_provider` | string | 多 provider 时填 | 指向 `[model_providers.{id}]` 的 key |
| `model_reasoning_effort` | string | `low`/`medium`/`high` | 推理强度；**别写 `xhigh`（已不支持）** |
| `model_context_window` | number | 按模型填 | 上下文窗口 token 数 |
| `model_auto_compact_token_limit` | number | 如 `200000` | 超过即压缩历史 |
| `model_reasoning_summary` | string | 网关不支持就写 `"none"` | 否则报 `Unsupported parameter` |
| `model_supports_reasoning_summaries` | boolean | 按网关能力填 | 是否支持推理摘要 |
| `preferred_auth_method` | string | `"apikey"` | 鉴权方式 |
| `openai_base_url` | string | 方式一最省事 | 直接换 OpenAI 兼容端点（含 `/v1`） |

---

## 三、官方推荐的 `[model_providers.{id}]` 字段

模板 `recommendations` 列的就是这一组，字段本身基本与官方吻合：

| 字段 | 类型 | 必填 | 推荐 | 说明 |
|------|------|------|------|------|
| `name` | string | 否 | 自定义显示名 | provider 名称 |
| `base_url` | string | 是 | 必须含 `/v1` | API 端点；漏 `/v1` 是 401 高发原因 |
| `wire_api` | string | 否 | `"responses"` | **2026.2 起强制 responses，不再支持 Chat Completions** |
| `env_key` | string | 否 | **官方推荐用环境变量** | 提供 API key 的环境变量名，不写明文 |
| `env_key_instructions` | string | 否 | 可选 | API key 配置提示 |
| `http_headers` | object | 否 | 需要静态头时 | 静态请求头 |
| `env_http_headers` | object | 否 | 需要环境变量注入头时 | 由环境变量注入的请求头 |
| `query_params` | object | 否 | Azure 等用 | 如 Azure 的 `api-version` |
| `request_max_retries` | number | 否 | 官方默认 4 | HTTP 请求重试次数 |
| `stream_max_retries` | number | 否 | 官方默认 5 | SSE 流中断重试次数 |
| `stream_idle_timeout_ms` | number | 否 | 官方默认 300000 | SSE 流空闲超时（毫秒） |
| `supports_websockets` | boolean | 否 | 可选 | Responses API WebSocket 传输 |
| `requires_openai_auth` | boolean | 否 | 仅官方认证后端用 | 是否用 OpenAI 认证 |
| `experimental_bearer_token` | string | 否 | **官方提醒优先用 env_key** | 直接写死 bearer token，不推荐 |

> 保留名限制：自定义 provider 名**不能叫 `openai` / `ollama` / `lmstudio`**（模板未提醒）。

---

## 四、现有 `ChatGPT.json` 模板问题点评

### 1. `model_info_fields` 全空字符串（结构不匹配）
Codex 用 TOML，模型能力（max_context / max_output_token / reasoning 等）通过**顶层全局字段**（`model_context_window` / `model_auto_compact_token_limit` / `model_supports_reasoning_summaries`）配置，不在 provider/model 嵌套结构里。模板把四个映射目标留空字符串，无法实际映射——这是模板结构与 Codex 实际用法的根本不匹配。

### 2. `protocols` 为 null（合理）；`wire_api` 描述已修正
Codex 只支持 Responses API，`protocols: null` 合理。`wire_api` 字段原描述偏弱，**已修正**为：「2026 年 2 月起强制 responses（Responses API），不再支持 Chat Completions；网关必须原生支持 Responses API」。

### 3. 缺失全部顶层全局字段（严重）
模板 `recommendations` 只列了 `[model_providers.{id}]` 下的字段，**完全没有**上面第二节那些实际最常用的顶层字段（`model` / `model_reasoning_effort` / `model_context_window` / `model_auto_compact_token_limit` / `preferred_auth_method` / `openai_base_url`）。这些才是配 Codex 时最先要填的。

### 4. 未提醒保留名与超时坑
- provider 名不能用 `openai`/`ollama`/`lmstudio`；
- 接中转/第三方时默认超时偏短，建议显式加 `request_timeout`；
- `model_reasoning_effort` 别写 `xhigh`。

---

## 五、推荐配置示例（官方风格，TOML）

方式一（只改 base_url，最省事）：
```toml
openai_base_url = "https://api.example.com/v1"
model = "gpt-5.6-sol"
```

方式二（自定义 provider，多模型 / 多 Key）：
```toml
model = "claude-fable-5"
model_provider = "genvis"
model_reasoning_effort = "high"
model_context_window = 256000
model_auto_compact_token_limit = 200000
model_reasoning_summary = "none"
preferred_auth_method = "apikey"

[model_providers.genvis]
name = "Genvís AI"
base_url = "https://api.example.com/v1"
env_key = "GENVIS_API_KEY"
wire_api = "responses"
request_max_retries = 4
stream_max_retries = 5
stream_idle_timeout_ms = 300000
```

环境变量（新版 0.18.x+ 优先读 `OPENAI_BASE_URL`，旧版 ≤0.16 用 `OPENAI_API_BASE`，两个都设最稳）：
```bash
export OPENAI_BASE_URL="https://api.example.com/v1"
export OPENAI_API_BASE="$OPENAI_BASE_URL"
export OPENAI_API_KEY="your-key"
export CODEX_MODEL="claude-fable-5"
```

---

## 六、参考来源

- OpenAI Codex CLI 仓库：https://github.com/openai/codex
- 掘金《别再乱改 config.toml！Codex CLI 接第三方模型的正确姿势》：https://juejin.cn/post/7666368669444194356
- 脚本之家《Codex config.toml 配置实战指南》：https://www.jb51.net/ai/1035096.html
- CSDN《Codex CLI 模型路由方法论：用 config.toml 统一接入 OpenAI 兼容 API》：https://bbs.csdn.net/weixin_31293685/article/details/100160924
