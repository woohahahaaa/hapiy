# WorkBuddy 配置字段参考（官方 vs 现有 WorkBuddy.json 模板）

> 本文件仅供阅读参考，系统不会直接调用。基于 WorkBuddy 官方文档及社区实测整理，并与本目录下 `WorkBuddy.json` 模板逐字段对比。

---

## 一、工具与配置文件

| 项 | 说明 |
|----|------|
| 工具 | WorkBuddy（腾讯系 AI 编程助手，旧版路径在 `~/.codebuddy/`，新版统一在 `~/.workbuddy/`） |
| 配置文件 | macOS: `~/.workbuddy/models.json` ｜ Windows: `%USERPROFILE%\.workbuddy\models.json` |
| 格式 | JSON |
| 协议 | 仅支持 OpenAI 兼容协议 API（`/chat/completions` 端点） |
| 官方文档 | https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model |

WorkBuddy 自定义模型本质是「兼容 OpenAI 协议的 API 转接层」：只要给标准 `chat/completions` 端点 + API Key 即可接入。配置仅存本地、不上传云端。自定义模型费用由你直接向提供商支付，与 WorkBuddy 积分独立。

---

## 二、官方推荐的 Model 字段

WorkBuddy 的配置结构是 `models` 数组，每个对象是一个模型（没有独立 provider 层，provider 信息内联在模型对象里）：

| 字段 | 类型 | 必填 | 推荐 | 说明 |
|------|------|------|------|------|
| `id` | string | 是 | 传给 API 的 `model` 参数值 | 如 `deepseek-chat` / `moonshot-v1-8k` |
| `name` | string | 否 | 自定义显示名 | 下拉列表显示，自行定义 |
| `vendor` | string | 否 | 厂商标识 | 如 `DeepSeek` / `Ollama`；自定义模型 UI 会标 custom |
| `apiKey` | string | 否 | 明文 key；Ollama 本地填 `"ollama"` | API 密钥（实际密钥值，非环境变量名） |
| `url` | string | 否 | 完整路径，**必须以 `/chat/completions` 结尾** | 如 `https://api.deepseek.com/v1/chat/completions` |
| `supportsToolCall` | boolean | 否 | 模型支持 Function Calling 才开 | 默认 false；模型不支持时勾了会报错 |
| `supportsImages` | boolean | 否 | 多模态视觉模型才开 | 默认 false；纯文本模型开了会报错 |
| `supportsReasoning` | boolean | 否 | 支持推理链的模型才开 | 如 DeepSeek Reasoner / 某些 Kimi 版本 |

> 必填性以腾讯云官方字段表为准：**仅 `id` 必填**，其余均"否"（覆盖内置模型时不必重填）。

### 顶层字段 `availableModels`（白名单过滤器）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `availableModels` | `Array<string>` | 否 | 顶层字段（与 `models` 数组平级）。控制下拉列表只显示列出的模型 ID；不配或空数组则显示全部。配置后会隐藏未列出的内置模型，**推荐不干预**（火山云教程明确建议不要配置，否则内置模型全被隐藏） |

> 「高级配置」还有「自定义协议」（跳过自动路径补全，用于网关封装的非标准端点）和「上下文窗口」（手动指定输入/输出 token 上限）。文件保存后约 1 秒热重载，无需重启。

---

## 三、官方平台接口地址速查

| 提供商 | 接口地址 | 模型名称示例 |
|--------|----------|--------------|
| DeepSeek 官方 | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `glm-5-plus` |
| Kimi 中国版 | `https://api.moonshot.cn/v1/chat/completions` | `moonshot-v1-8k` |
| MiniMax | `https://api.minimax.chat/v1/text/chatcompletion_v2` | `MiniMax-Text-01` |
| Ollama 本地 | `http://localhost:11434/v1/chat/completions` | 与 `ollama list` 一致 |
| 七牛云多模型 | `https://api.qnaigc.com/v1/chat/completions` | 参考平台模型列表 |

---

## 四、现有 `WorkBuddy.json` 模板问题点评

WorkBuddy 模板字段与官方吻合度较高，主要问题如下：

### 1. `availableModels` 是真实字段（模板未列入，不干预）
> 更正：此前判断"疑似编造并删除"是错的。腾讯云官方《CodeBuddy model.json 配置指南》有 `availableModels` 专节——类型 `Array<string>`，**顶层字段**（与 `models` 数组平级），控制下拉列表只显示列出的模型 ID（白名单过滤器），不配则显示全部。配置后会隐藏未列出的内置模型（火山云教程明确建议"不要配置，否则内置模型会被全部隐藏"）。当前模板**未列入**该字段（不推荐、不干预），需要白名单时在规则里手动加。

### 2. `maxInputTokens` / `maxOutputTokens` 字段（官方字段表已确认）
腾讯云官方字段表确认这两个字段真实存在（类型 number，非必填）。`model_info_fields` 把它们映射给 `max_context` / `max_output_token` 合理。

### 3. `model_info_fields` 的 bool 映射（设计取舍，非乱写）
`input_types` 映射到 `supportsImages`(bool)、`thinking_levels` 映射到 `supportsReasoning`(bool)——官方 `input_types` 概念上是数组（text/image），这里用 bool 简化。属于系统统一读取模型信息的设计取舍，不算乱写，但会丢失「支持哪些输入类型」的细节。

### 4. 必填性（已按腾讯云官方字段表核对）
腾讯云官方字段表明确：**仅 `id` 必填**，`name` / `vendor` / `apiKey` / `url` 均标"否"（非必填，因覆盖内置模型时不必重填）。本项目模板有意偏离官方字段表：`url` 与 `apiKey` 标 `required=true` —— 前者是自定义模型接入必需（且须是完整 `/chat/completions` 路径），后者与 opencode/openclaw 的 apiKey 口径一致；注意 WorkBuddy 是平铺 `models` 结构且 `json_paths` 为空，`apiKeyFieldFor` 只扫描 provider 级推荐，因此该标记当前只作文档/字段追踪，不参与托管生成。`name` / `maxInputTokens` / `maxOutputTokens` / `supportsToolCall` / `supportsImages` / `supportsReasoning` 仍为 false。

### 5. `supportsToolCall` 描述（与现状一致）
现描述为「是否支持工具调用」，未给推荐值（不干预）；原"推荐开启"的表述已不存在，不再与 recommended `null` 矛盾。

---

## 五、推荐配置示例（官方风格）

```json
{
  "models": [
    {
      "id": "deepseek-chat",
      "name": "DeepSeek Chat",
      "vendor": "DeepSeek",
      "apiKey": "sk-你的密钥",
      "url": "https://api.deepseek.com/v1/chat/completions",
      "supportsToolCall": true,
      "supportsImages": false,
      "supportsReasoning": false
    },
    {
      "id": "qwen2.5:7b",
      "name": "Qwen 2.5 7B（本地）",
      "vendor": "Ollama",
      "apiKey": "ollama",
      "url": "http://localhost:11434/v1/chat/completions",
      "supportsToolCall": false,
      "supportsImages": false,
      "supportsReasoning": false
    }
  ]
}
```

---

## 六、常见踩坑

1. **URL 缺 `/v1`**：必须填完整路径如 `https://.../v1/chat/completions`，否则 404；
2. **`name` 陷阱**：`name` 会被当作 API 的 `model` 参数发送？——实际 `id` 才是 model 参数值，`name` 仅显示用；
3. **接口地址末尾不是 `/chat/completions`**：需勾选「自定义协议」跳过自动补全；
4. **工具调用 / 图片输入与模型能力不对齐**：勾了模型不支持的会报错。

---

## 七、参考来源

- **腾讯云官方《CodeBuddy model.json 配置指南》（字段表权威来源）：https://cloud.tencent.com/document/product/1749/116119**
- WorkBuddy 官方模型配置文档：https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model
- 腾讯云《WorkBuddy 接入第三方大模型全攻略：以火山云 Ark 为例》：https://cloud.tencent.com/developer/article/2715846
- CSDN《WorkBuddy 接自定义模型完整教程：models.json 字段全解 + 8 家平台接口地址速查》：https://blog.csdn.net/aidoudoulong/article/details/163638039
- 腾讯云《WorkBuddy 关于 Models.json 的问题》：https://cloud.tencent.com/developer/ask/2211564
- 腾讯云《WorkBuddy 内网 DeepSeek 模型配置实战教程》：https://cloud.tencent.com/developer/article/2693066
