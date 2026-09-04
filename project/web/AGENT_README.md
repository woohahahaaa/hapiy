# 💻 hapiy-web

> ⚠️ **这个 README 是 AI 写的，可能有幻觉**。具体行为请以代码为准，描述跟实际对不上的地方欢迎提 issue / 直接改。
>
> *This README is AI-generated and may hallucinate. Code is the source of truth — open an issue or fix directly when descriptions diverge from reality.*

hapiy 项目的 Web 前端，基于 Vite + React + TypeScript + shadcn/ui（base-lyra 预设）。

> *The web frontend for the hapiy project, built with Vite + React + TypeScript + shadcn/ui (base-lyra preset).*

---

## 💡 为什么做这个

需要一个能稳定 detach 启动的前端 dev server，配合反向代理给外部访问。原来的 `pnpm dev` 在 agent session 内运行，进程随会话结束而退出，导致反代频繁失联。

> *The frontend dev server needs a stable detached launch so a reverse proxy can keep reaching it. Running `pnpm dev` inside an agent session ties the process lifetime to the session and causes the proxy to drop frequently.*

---

## 🚀 快速开始

### 📥 下载到本地

```bash
git clone <repo-url>
cd hapiy/project/web
pnpm install --frozen-lockfile
```

### 🤖 让 Agent 帮你启动（推荐）

把项目路径告诉 agent，然后对它说：

> **帮我按 AGENT_README.md 启动 dev**

agent 会执行 `scripts/dev.sh`，把 Vite 放到后台 detach 运行，写入 pid 与日志，并报告监听端口。

后端同理，把项目路径告诉 agent 并说：

> **帮我按 AGENT_README.md 启动后端**

agent 会执行 `project/backend/scripts/backend.sh`，把 Go 后端 detach 启动到 `:8080`，并写入 pid 与日志。

> *Hand the project directory to your agent and say "Start dev per AGENT_README.md". The agent runs `scripts/dev.sh`, launches Vite detached with pid + log files, and reports the listening port. For the backend, say "Start backend per AGENT_README.md" and the agent runs `project/backend/scripts/backend.sh` to launch the Go binary detached on `:8080`.*

### 🌍 打开浏览器

dev server 默认监听 `0.0.0.0:18009`：

```text
http://localhost:18009        # 本机
http://<lan-ip>:18009         # 反代后的局域网地址
```

> *The dev server listens on `0.0.0.0:18009` by default. Access it locally or via your reverse proxy.*

### 🛰️ 后端服务

dev server 必须配合后端才能跑完整链路。后端默认监听 `0.0.0.0:8080`：

```bash
cd project/backend
./scripts/backend.sh             # 后台启动（缺产物时自动 build）
./scripts/backend.sh --status    # 查看 pid / 端口 / 日志
./scripts/backend.sh --stop      # 停止
```

| 命令 | 作用 |
|---|---|
| `scripts/backend.sh` 或 `scripts/backend.sh start` | 缺 `hapiy` 二进制时跑 `go build`；`nohup hapiy` 后台启动；记录 pid 与日志 |
| `scripts/backend.sh --status` | 显示 pid 文件、监听状态、最近 20 行日志 |
| `scripts/backend.sh --stop` | 按 pid 优雅终止，超时则 `kill -9` |

环境变量可覆盖默认行为：`PORT=8080 LOG_FILE=/var/log/hapiy-backend.log PID_FILE=/var/run/hapiy-backend.pid ./scripts/backend.sh`。

> *Backend dev server mirrors `scripts/dev.sh`'s design: detached `nohup` launch of the Go binary, with `--status` / `--stop` subcommands and the same `PORT` / `LOG_FILE` / `PID_FILE` overrides. Listen address defaults to `0.0.0.0:8080`.*

### 🛟 兜底：手动启动

```bash
cd project/web
./scripts/dev.sh             # 后台启动
./scripts/dev.sh --status    # 查看 pid / 端口 / 日志
./scripts/dev.sh --stop      # 停止
```

```bash
cd project/backend
./scripts/backend.sh         # 后台启动
./scripts/backend.sh --status # 查看 pid / 端口 / 日志
./scripts/backend.sh --stop   # 停止
```

> *Manual fallback: run `scripts/dev.sh` for the frontend and `scripts/backend.sh` for the backend in the background, then `--status` to inspect or `--stop` to terminate.*

---

## 🔧 scripts/dev.sh

detached 后台启动脚本，行为：

| 命令 | 作用 |
|---|---|
| `scripts/dev.sh` 或 `scripts/dev.sh start` | 缺依赖时装依赖；缺 `dist/` 时跑一次 `pnpm run build`；`nohup pnpm dev` 后台启动；记录 pid 与日志 |
| `scripts/dev.sh --status` | 显示 pid 文件、监听状态、最近 20 行日志 |
| `scripts/dev.sh --stop` | 按 pid 优雅终止，超时则 `kill -9` |

> *Detached launch script. Run with no args or `start` to install missing deps, do an initial production build if absent, then `nohup pnpm dev` into the background with pid + log files. `--status` reports pid/port/log; `--stop` terminates gracefully (falls back to SIGKILL).*

环境变量可覆盖默认行为：

```bash
PORT=18009 LOG_FILE=/var/log/hapiy-web-dev.log PID_FILE=/var/run/hapiy-web-dev.pid ./scripts/dev.sh
```

> *Override defaults via `PORT`, `LOG_FILE`, `PID_FILE`.*

---

## 📁 项目结构

```text
project/web
├── src/
│   ├── components/        # 业务组件 + Sidebar/AppShell 等布局
│   ├── components/ui/     # shadcn 生成的 UI 组件
│   ├── pages/             # 路由页面
│   ├── layouts/           # AppShell 等外壳
│   ├── lib/               # 工具与 API 封装
│   └── index.css          # Tailwind v4 + 主题变量
├── scripts/dev.sh         # detached 启动脚本
├── start.sh               # 旧版前台启动入口
├── components.json        # shadcn 配置（base-lyra）
├── vite.config.ts         # Vite + Tailwind v4 配置
└── package.json
```

> *Project tree (web/): sources, generated shadcn UI, pages, layouts, lib, theme CSS, dev script, and the legacy `start.sh` for foreground launches.*

---

## ✨ 功能一览

| 功能 | 操作 |
|---|---|
| 后台启动 dev | `./scripts/dev.sh` |
| 查看运行状态 | `./scripts/dev.sh --status` |
| 停止 dev | `./scripts/dev.sh --stop` |
| 重新构建生产产物 | `pnpm run build` |
| 修改主题 | 编辑 `src/index.css` 中 `:root` / `.dark` 的 CSS 变量 |

> *Feature list: detached dev start/status/stop, production build via `pnpm run build`, and theme tweaks via CSS variables in `src/index.css`.*

---

## 📦 依赖

| 组件 | 需要的包 |
|---|---|
| 包管理 | `pnpm` |
| 运行 | Node 22 + Vite 8 + React 19 + Tailwind 4 |
| UI | `@base-ui/react` + shadcn 生成的组件 |

> *Requires pnpm, Node 22, Vite 8, React 19, Tailwind 4, `@base-ui/react`, and the shadcn-generated UI components.*

---

## 📜 License

仓库原有许可。

> *Repository license.*