# openclaw 配置字段参考（官方 vs 现有 openclaw.json 模板）

> 本文件仅供阅读参考，系统不会直接调用。基于 openclaw 官方用法及社区实测整理，并与本目录下 `openclaw.json` 模板逐字段对比。

---

## 一、工具与配置文件

| 项 | 说明 |
|----|------|
| 工具 | openclaw（CLI + Gateway 架构，多代理 / 多频道 / 技能系统） |
| 配置文件 | macOS: `~/.openclaw/openclaw.json` ｜ Windows: `%USERPROFILE%\.openclaw\openclaw.json` |
| 格式 | JSON |
| 官方 CLI | `npm install -g openclaw`，`openclaw config validate` 校验配置 |
| 文档参考 | 博客园《OpenClaw CLI 和 openclaw.json 配置完全指南》、CSDN 系列指南 |

openclaw 配置分 10 个顶层段：`meta` / `wizard` / `auth` / `models` / `agents` / `channels` / `skills` / `gateway` / `plugins` / `commands`。本模板只覆盖 `models` 段下的 provider / model 字段。

---

## 二、官方推荐的 Provider 字段

provider 配置在 `models.providers.{provider_id}` 下：

| 字段 | 类型 | 必填 | 推荐 | 说明 |
|------|------|------|------|------|
| `baseUrl` | string | 是 | 按官方格式，**不要多写不该有的 `/v1`** | API 端点，如 `https://open.bigmodel.cn/api/coding/paas/v4` |
| `api` | string | 否 | 不干预（由 endpoint 规则归类） | 协议类型：`openai-completions` / `anthropic-messages` / `ollama` / `lmstudio` 等 |
| `apiKey` | string | 否 | 推荐放 `auth.profiles` 用环境变量，不写明文 | 认证密钥（见第五节偏差说明） |
| `models` | array | 否 | 自定义模型列表 | 模型对象数组，见下表 |

> `models.mode`（顶层，非 provider）：`merge`（合并内置+自定义，推荐）/ `replace`（只用自定义）。

---

## 三、官方推荐的 Model 字段

model 配置在 `models.providers.{provider_id}.models[]` 数组元素里：

| 字段 | 类型 | 必填 | 推荐 | 说明 |
|------|------|------|------|------|
| `id` | string | 是 | 模型唯一标识 | 如 `glm-5` |
| `name` | string | 否 | 显示名 | 如 `GLM-5` |
| `reasoning` | boolean | 否 | 支持推理的模型填 `true` | 未配按 false 处理（官方 schema 校验） |
| `input` | array | 否 | 输入类型 | 如 `["text"]` / `["text", "image"]` |
| `output` | array | 否 | 输出类型 | 如 `["text"]`（模板未列，建议补） |
| `contextWindow` | number | 否 | 上下文 token 上限 | 如 `204800` |
| `maxTokens` | number | 否（anthropic-messages 协议下必填） | 输出 token 上限 | 如 `131072` |
| `cost` | object | 否 | 成本配置 | `{ input, output, cacheRead, cacheWrite }`（$/1K tokens，模板未列） |
| `supports` | object | 否 | 功能支持 | `{ streaming, functions, vision }`（模板未列，建议补） |

---

## 四、现有 `openclaw.json` 模板问题点评

openclaw 模板字段与官方吻合度较高，主要问题如下：

### 1. `apiKey` 位置偏差（已修正描述）
模板把 `apiKey` 放在 `provider` scope 且 `required: true`。官方实际结构里，`models.providers.{id}` 下**不直接放 apiKey**——apiKey 放在独立的 `auth.profiles` 段，并用环境变量引用（如 `"apiKey": "${ZAI_API_KEY}"`）。**已修正描述**，注明规范位置在 `auth.profiles` 段，不在 `models.providers` 下内联。

### 2. 缺失官方模型字段（已补充）
模板 model scope 原只列了 `id` / `name` / `contextWindow` / `maxTokens` / `input` / `reasoning`，**已补充**官方已有的：
- `output`（输出类型数组）；
- `cost`（成本配置对象，含 input/output/cacheRead/cacheWrite）；
- `supports`（功能支持对象：streaming/functions/vision）。

### 3. `protocols` 按 endpoint 关键词归类 `api`（已修正）
openclaw 通过 `api` 字段直接指定协议类型（openai-completions/anthropic-messages/ollama/lmstudio）。与 opencode 的 `npm` 同理，`api` 是「必须先填、且必须和 endpoint 匹配」的驱动字段 —— 同一个托管 provider 下不同 endpoint 分组（如 `/v1/messages` 与 `/v1/chat/completions`）走的 SDK 不同，不能全默认 `openai-completions`。本模板已为 openclaw 配置 `protocols`：按 endpoint 关键词自动归入对应 `api` 值并作为该分组的推荐（具体关键词优先）；common 里的 `api` 不给推荐值（避免管理模型把 anthropic 端点误判成 openai-completions），未命中时也不写入 `api`，走 openclaw 官方默认。另：**anthropic-messages 协议下每个模型都必须有 `maxTokens`**（Anthropic 官方要求每次请求带 max_tokens），该协议的 model 级推荐已把 `maxTokens` 标为必填。

### 4. `baseUrl` 提醒正确
模板提醒「注意不要多写不该有的 `/v1`」与官方示例（`https://open.bigmodel.cn/api/coding/paas/v4` 不带多余 /v1）一致，这点正确。

---

## 五、推荐配置示例（官方风格）

完整结构（apiKey 放 auth.profiles，用环境变量）：
```json
{
  "auth": {
    "profiles": {
      "zai:default": {
        "provider": "zai",
        "mode": "api_key",
        "apiKey": "${ZAI_API_KEY}"
      }
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "zai": {
        "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
        "api": "openai-completions",
        "models": [
          {
            "id": "glm-5",
            "name": "GLM-5",
            "reasoning": true,
            "input": ["text"],
            "output": ["text"],
            "contextWindow": 204800,
            "maxTokens": 131072,
            "cost": { "input": 0, "output": 0 },
            "supports": { "streaming": true, "functions": true, "vision": false }
          }
        ]
      }
    }
  }
}
```

自定义 provider（无独立 auth 段时，apiKey 也可内联）：
```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "custom": {
        "baseUrl": "https://api.custom-llm.com/v1",
        "api": "openai-completions",
        "models": [
          {
            "id": "custom-model-v1",
            "name": "Custom Model V1",
            "contextWindow": 128000,
            "maxTokens": 4096,
            "input": ["text"],
            "cost": { "input": 0.0005, "output": 0.001 }
          }
        ]
      }
    }
  }
}
```

---

## 六、参考来源

- 博客园《OpenClaw CLI 和 openclaw.json 配置完全指南》：https://www.cnblogs.com/zhaoxxnbsp/p/19793806
- CSDN《OpenClaw 配置完全指南：openclaw.json 详解》：https://blog.csdn.net/liuguizhong/article/details/160632369
- 脚本之家《OpenClaw 配置文件 openclaw.json 完整参数说明》：https://m.jb51.net/ai/1022971.html
- CSDN《使用自定义模型提供商，OpenClaw 安装与配置指南》：https://blog.csdn.net/metaviii/article/details/158205710
