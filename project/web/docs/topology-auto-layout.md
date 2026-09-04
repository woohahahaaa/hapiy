# 拓扑自动布局规则

## 一、节点自身尺寸规则

### provider 节点

- 最小宽度 = `nodeMinWidth`（200）
- 最大宽度 = `nodeMaxWidth`（300）
- 宽度由内容决定，超出最大则裁剪（组件内部处理，单行省略）
- 高度由内容 + `padding.y` × 2 撑开

### slot 节点

- 不设宽度限制（内部条目各自有最大宽度约束，slot 由内容撑开）
- 空 slot（0 条目）高度 = 标题行高度 + 添加按钮高度（`buttonHeight` 32） + `padding.y` × 2
- 添加按钮宽度 = slot 当前宽度（空状态时等于 `nodeMinWidth` 200）
- 有条目时高度由内容 + `padding.y` × 2 撑开

**slot 内条目等宽规则**：同一个 slot 内的所有条目取 `max(各条目宽度)`，其余条目拉伸至该最大值，保证视觉对齐。

### modelHub 节点

- 宽度由文字内容 + `modelHub.padding.x` × 2 撑开
- 最大宽度 = `modelHub.maxWidth`（200），超出裁剪
- 高度由文字 + `modelHub.padding.y` × 2 撑开

---

## 二、自动布局计算流程

点击魔法棒（自动布局按钮）时，按以下步骤计算：

### 步骤 1：获取节点实际尺寸

从 ResizeObserver 获取每个节点的实际渲染宽高（DOM 测量值）。若测量值不可用，用配置值兜底：
- provider：`nodeMinWidth` × 预估高度
- slot：`nodeMinWidth` × 预估高度（含标题 + 按钮）
- modelHub：文字宽度 + padding

### 步骤 2：分组

- **modelHub 列**：所有 `type === 'modelHub'` 的节点
- **workflow 行**：每个 provider 和它下属的 6 个 slot 为一组。按 provider ID 排序。

### 步骤 3：计算每行（workflow）内部

同一行内 provider + 6 个 slot 从左到右排列，间距 = `columnGap`。
所有节点顶对齐（y 坐标相同）。
行高 = 该行内最高节点的实际高度。

### 步骤 4：workflow 行纵向堆叠

按 provider ID 排序，从上到下堆叠。
行间距 = `rowGap`：第 N 行的底部 → 第 N+1 行的顶部 = `rowGap`。
所有行左对齐（x 坐标相同 = 0 或 marginX）。

### 步骤 5：modelHub 列纵向堆叠

所有 modelHub 节点垂直堆叠，间距 = `rowGap`（同上：上一个底部 → 下一个顶部）。
右对齐：所有 modelHub 节点的右边缘对齐。

### 步骤 6：水平居中

计算两列的垂直中心线：
- modelHub 列中心 = (列顶 + 列底) / 2
- workflow 列中心 = (列顶 + 列底) / 2

将两列在垂直方向上平移，使两条中心线重合。

两列水平间距 = `columnGap`（modelHub 右边缘 → workflow 左边缘）。

### 步骤 7：保存

将计算出的位置写入 localStorage（`hapiy-layout`），刷新后恢复。

---

## 三、配置阶层表

```json
{
  "autoLayout": {
    "nodeMinWidth": 200,
    "nodeMaxWidth": 300,
    "padding": { "x": 12, "y": 8 },
    "buttonHeight": 32,
    "modelHub": {
      "maxWidth": 200,
      "padding": { "x": 12, "y": 6 }
    },
    "rowGap": 20,
    "columnGap": 20
  }
}
```

| 字段 | 值 | 含义 |
|---|---|---|
| `nodeMinWidth` | 200 | provider 最小宽度；slot 空状态宽度 |
| `nodeMaxWidth` | 300 | provider 最大宽度 |
| `padding.x` | 12 | provider / slot 左右判定值 |
| `padding.y` | 8 | provider / slot 上下判定值 |
| `buttonHeight` | 32 | slot 空状态添加按钮行高 |
| `modelHub.maxWidth` | 200 | modelHub 最大宽度，超出裁剪 |
| `modelHub.padding.x` | 12 | modelHub 左右判定值 |
| `modelHub.padding.y` | 6 | modelHub 上下判定值 |
| `rowGap` | 20 | 行间距（上底部 → 下顶部） |
| `columnGap` | 20 | 列间距（modelHub → workflow；同行走节点间） |