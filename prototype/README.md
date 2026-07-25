# Prototype

前端原型目录。当前应用位于 `prototype/app/`，使用 Vite、React 和 `@xyflow/react` 验证 UI 与交互想法。

## 启动开发服务器

**一键启动（热加载）：**

```bash
./start.sh
```

脚本会在 `prototype/app/` 中启动 Vite 开发服务器。服务地址为 `http://0.0.0.0:28001`，并通过 Vite HMR 响应源码修改。

## 当前入口

当前应用入口是 `prototype/app/` 下的 React 应用，节点画布由 `@xyflow/react` 实现。

`prototype/server.py` 和根目录的 `prototype/index.html` 是早期静态 HTML、LiteGraph 原型遗留物，不是当前应用入口，也不由 `./start.sh` 启动。

## 故障排查

**反代报 `connection refused`**

服务器没跑。检查：

```bash
lsof -i :28001          # 有输出 = 在跑，没输出 = 挂了
```

重新启动：

```bash
./start.sh              # 前台运行，Ctrl+C 停止
```

**浏览器 404（改 / 也不对）**

- 确认从 `prototype/` 目录运行 `./start.sh`
- 确认 `prototype/app/index.html` 存在

**`/service-worker.js` 报 404**

浏览器 PWA 探测，无视即可。日志里已自动静默。

**端口被占用**

```bash
lsof -ti :28001 | xargs kill
```

## 当前策略

- 使用 Vite + React 构建界面，使用 `@xyflow/react` 实现节点画布
- 假数据、假流程，纯展示用
- 不连接后端，只画原型

## 业务方向

做一个 API 中转/转发服务，跟 newapi 是同一个大方向，但有自己的设计（很多地方跟 newapi 不一样，只是有部分重叠）。newapi 当作参考仓库之一，后续对接后端时再去看它的接口。
