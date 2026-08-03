# 改写规则脚本语法

改写规则（请求改写 / 响应改写）的脚本使用 **JSON 操作数组** 格式。每个规则是一个 JSON 数组，数组中的每个对象描述一个对请求体（或响应体）的操作。

底层执行引擎使用 [gjson](https://github.com/tidwall/gjson) / [sjson](https://github.com/tidwall/sjson) 按路径读写 JSON，与 [new-api](https://github.com/QuantumNous/new-api) 的 param override 机制对齐。

## 基本结构

```json
[
  { "path": "model", "mode": "set", "value": "gpt-4" },
  { "path": "temperature", "mode": "delete" }
]
```

- `path`：gjson 路径，定位要操作的字段。例如 `model`、`messages.0.content`、`body.hello`
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
  { "path": "metadata", "mode": "copy", "dst": "original_metadata" }
]
```
