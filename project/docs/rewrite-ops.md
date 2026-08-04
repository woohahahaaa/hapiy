# 改写规则脚本语法

改写规则（请求改写 / 响应改写）的脚本使用 **JSON 操作数组** 格式。每个规则是一个 JSON 数组，数组中的每个对象描述一个对请求/响应体的 JSON 或 HTTP header 的操作。

底层执行引擎使用 [gjson](https://github.com/tidwall/gjson) / [sjson](https://github.com/tidwall/sjson) 按路径读写 JSON，与 [new-api](https://github.com/QuantumNous/new-api) 的 param override 机制对齐。

## 基本结构

```json
[
  { "path": "model", "mode": "set", "value": "gpt-4" },
  { "path": "temperature", "mode": "delete" }
]
```

- `path`：gjson 路径，定位要操作的字段。例如 `model`、`messages.0.content`、`body.hello`；以 `header.` 开头（如 `header.X-Request-ID`）则操作 HTTP header，见 [Header 改写](#header-改写)
- `mode`：操作类型，见下表
- `value` / `from` / `to` / `dst`：根据 mode 不同，填不同字段

## 操作类型（mode）

| mode | 说明 | 必填字段 | 示例 |
|---|---|---|---|
| `set` | 设置字段值 | path, value | `{"path":"model","mode":"set","value":"gpt-4"}` |
| `delete` | 删除字段 | path | `{"path":"temperature","mode":"delete"}` |
| `append` | 在字符串末尾追加 | path, value | `{"path":"prompt","mode":"append","value":"!"}` |
| `prepend` | 在字符串开头插入 | path, value | `{"path":"prompt","mode":"prepend","value":"Hi "}` |
| `trim_prefix` | 去除指定前缀 | path, value | `{"path":"model","mode":"trim_prefix","value":"gpt-"}` |
| `trim_suffix` | 去除指定后缀 | path, value | `{"path":"url","mode":"trim_suffix","value":"/"}` |
| `ensure_prefix` | 确保字段以指定值开头（已有则跳过） | path, value | `{"path":"url","mode":"ensure_prefix","value":"https://"}` |
| `ensure_suffix` | 确保字段以指定值结尾（已有则跳过） | path, value | `{"path":"url","mode":"ensure_suffix","value":"/"}` |
| `trim_space` | 去除首尾空格 | path | `{"path":"query","mode":"trim_space"}` |
| `to_lower` | 转小写 | path | `{"path":"model","mode":"to_lower"}` |
| `to_upper` | 转大写 | path | `{"path":"model","mode":"to_upper"}` |
| `replace` | 字符串替换 | path, from, to | `{"path":"text","mode":"replace","from":"a","to":"b"}` |
| `regex_replace` | 正则替换 | path, from, to | `{"path":"text","mode":"regex_replace","from":"a+","to":"b"}` |
| `move` | 移动字段到新路径（原路径删除） | path, dst | `{"path":"old_name","mode":"move","dst":"new_name"}` |
| `copy` | 复制字段到新路径（原路径保留） | path, dst | `{"path":"model","mode":"copy","dst":"original_model"}` |

## 条件执行（conditions）

每个操作可以附加 `conditions` 数组，条件全部满足时操作才执行（逻辑 AND）。

```json
[
  {
    "path": "max_tokens",
    "mode": "set",
    "value": "4096",
    "conditions": [
      { "path": "model", "op": "contains", "value": "gpt" }
    ]
  }
]
```

条件对象的字段：

| 字段 | 说明 |
|---|---|
| `path` | 要检查的字段路径（gjson 路径），不填则用操作的 path |
| `op` | 比较运算符，见下表 |
| `value` | 要比较的值 |
| `invert` | 可选，`true` 表示取反结果 |

比较运算符（op）：

| op | 说明 |
|---|---|
| `eq` | 等于 |
| `neq` | 不等于 |
| `contains` | 包含子串 |
| `prefix` | 以指定值开头 |
| `suffix` | 以指定值结尾 |
| `gt` / `gte` | 大于 / 大于等于（数值比较） |
| `lt` / `lte` | 小于 / 小于等于（数值比较） |
| `matches` | 正则匹配 |

### 条件组合（AND / OR）

用 `logic` 字段表示逻辑节点，`children` 放子条件：

```json
{
  "logic": "AND",
  "children": [
    { "path": "model", "op": "contains", "value": "gpt" },
    { "path": "stream", "op": "eq", "value": "true" }
  ]
}
```

支持 `AND` 和 `OR`，可以无限嵌套。

## 路径语法

路径使用 gjson 路径语法：

| 路径 | 含义 |
|---|---|
| `model` | 顶层字段 model |
| `messages.0.content` | messages 数组第 0 项的 content |
| `body.hello` | body 对象的 hello 字段 |
| `choices.-1.message` | choices 数组最后一项的 message（负数索引） |

## Header 改写

使用 `header.` 前缀可以直接操作 HTTP 请求/响应的 header。语法和 body 改写完全一致——同一套 `mode/path/value/conditions` DSL。

```json
[
  { "path": "header.X-Request-ID", "mode": "set", "value": "req-123" },
  { "path": "header.X-Trace", "mode": "append", "value": ":extra" }
]
```

### 支持的 mode

13 种 mode 均支持，语义与 body 改写一致：

`set` / `delete` / `append` / `prepend` / `ensure_prefix` / `ensure_suffix` / `trim_prefix` / `trim_suffix` / `trim_space` / `to_lower` / `to_upper` / `replace` / `regex_replace`

`copy` / `move` 在 header 作用域下会返回错误（不支持跨作用域操作）。

### scope 字段

可选的 `scope` 字段控制操作作用域：

| scope | 说明 |
|---|---|
| `header` | 仅操作 header，path 必须以 `header.` 开头 |
| `body` | 仅操作 body，path 不能以 `header.` 开头 |
| `all`（默认） | 接受任意 path |

```json
[
  { "path": "header.X-Route", "mode": "set", "value": "premium", "scope": "header" },
  { "path": "model", "mode": "set", "value": "gpt-4", "scope": "body" }
]
```

不填 `scope` 等同于 `scope: "all"`，向后兼容所有现有规则。

### 条件支持

条件同样支持 `header.` 前缀路径：

```json
[
  {
    "path": "header.X-Route",
    "mode": "set",
    "value": "premium",
    "conditions": [
      { "path": "header.X-Tenant", "op": "neq", "value": "free" }
    ]
  }
]
```

### 注意事项

- header 名称区分大小写（`header.X-Foo` ≠ `header.x-foo`）。
- `copy` / `move` 不支持跨 header ↔ body 操作，会返回运行时错误。
- **上游请求黑名单**：`Authorization`、`Content-Length`、`Host`、`Connection` 四个 header 在写入上游请求时会被跳过（由引擎内部处理）。改写规则可以修改 `req.Headers` 中的这些值，但修改后的值不会发送到上游——这些 header 由 API key 管理逻辑控制。

## 完整示例

```json
[
  { "path": "model", "mode": "set", "value": "gpt-4" },
  { "path": "temperature", "mode": "delete" },
  {
    "path": "max_tokens",
    "mode": "set",
    "value": "8192",
    "conditions": [
      { "path": "model", "op": "matches", "value": "gpt-4.*" }
    ]
  },
  { "path": "messages.0.role", "mode": "to_lower" },
  { "path": "metadata", "mode": "copy", "dst": "original_metadata" },
  { "path": "header.X-Request-ID", "mode": "set", "value": "generated-id" }
]
```
