# 🌐 hapiy

> ⚠️ **这个 README 是 AI 写的，可能有幻觉**。具体行为请以代码为准，描述跟实际对不上的地方欢迎提 issue / 直接改。
>
> *This README is AI-generated and may hallucinate. Code is the source of truth — open an issue or fix directly when descriptions diverge from reality.*

hapiy 项目的一站式运行说明：前端 Vite + 后端 Go + 反向代理 + 数据库修复。

> *One-stop operations guide for hapiy: Vite frontend, Go backend, reverse proxy, and DB recovery.*

---

## 💡 为什么做这个

最初只跑 `pnpm dev`，进程在 agent session 内、随会话结束而退出，反代频繁失联。后来又把后端进程也补起来，结果踩了几个坑：

- 后端没启动，前端能打开但所有接口都是网络错。
- 后端在跑，但跑的是旧二进制，路由缺失，前端拿到 `404 page not found`，提示“服务器返回的不是有效 JSON”。
- 默认 admin 用户名被前端“保存用户名”改成了别的名字，旧密码又记错，登录一直 `invalid credentials`。

> *`pnpm dev` ties the process lifetime to the agent session, so reverse proxies drop. After wiring up the backend, the recurring failures were: backend not running, backend running an outdated binary so routes 404 with non-JSON bodies, and the admin username being changed from the default while the password became unknown.*

这一份 README 把“启动前端 + 启动后端 + 反代可达 + 数据库可登录”写成可复用的脚本，避免下次再踩同一个坑。

> *This README packages frontend + backend startup, proxy reachability, and DB recovery into reusable scripts.*

---

## 🚀 一次性启动（推荐）

### 🤖 让 Agent 帮你启动

把项目根目录告诉 agent，然后对它说：

> **按 AGENT_README.md 一次性把前端、后端、反代三件事准备好**

agent 会：

1. 用 `project/web/scripts/dev.sh` 把前端 detach 到后台，监听 `0.0.0.0:28001`。
2. 用 `project/backend/scripts/backend.sh` 把后端 detach 到后台，监听 `0.0.0.0:8080`。
3. 提示你确认前端 dev 端口与后端 API 端口，并在反代里同时转发 `28001 → 28001` 与 `/v1/ → 8080`。

> *Hand the project directory to the agent and say "Prepare frontend, backend, and reverse proxy per AGENT_README.md". It launches both servers detached, then asks for proxy routing on `28001` and `/v1/`.*

### 🛟 兜底：手动启动

```bash
# 前端
cd project/web
./scripts/dev.sh             # 后台启动
./scripts/dev.sh --status    # 查看 pid / 端口 / 日志
./scripts/dev.sh --stop      # 停止

# 后端
cd project/backend
./scripts/backend.sh         # 必要时自动 go build
./scripts/backend.sh --status
./scripts/backend.sh --stop
```

> *Manual fallback: each script writes pid + log to `/tmp`, supports `--status` and `--stop`, and rebuilds the backend automatically if the binary is missing.*

---

## 🌍 反代配置（nginx 示例）

```nginx
# 前端 28001
location / {
    proxy_pass http://127.0.0.1:28001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

# 后端 API /v1/
location /v1/ {
    proxy_pass http://127.0.0.1:8080/v1/;
    proxy_set_header Host $host;
}
```

> *nginx example: proxy `/` to the Vite dev port and `/v1/` to the backend so cookies stay first-party.*

---

## 🔧 故障定位

### 端口没人在听

```bash
lsof -nP -iTCP:28001 -sTCP:LISTEN
lsof -nP -iTCP:8080  -sTCP:LISTEN
```

没有结果就用上面的脚本启动对应服务。

> *If neither port shows a listener, run the matching script.*

### 前端报“服务器返回的不是有效 JSON”

原因通常是后端路由 404，gin 返回纯文本 `404 page not found`，前端 `JSON.parse` 失败。后端日志会看到 `PUT /v1/dashboard/... | 404`。修法：

```bash
cd project/backend
./scripts/backend.sh --stop
FORCE_REBUILD=1 ./scripts/backend.sh
```

`FORCE_REBUILD=1` 强制 `go build`，确保运行的二进制是当前源码。

> *Frontend JSON errors usually mean the backend returned a non-JSON 404 body. Rebuild with `FORCE_REBUILD=1`.*

### 登录 `invalid credentials`

后端 `Login` 逻辑会先按 `username` 查 `users` 表，找不到就直接 401，不会再去校验密码；找到之后再 `bcrypt.CompareHashAndPassword` 比对密码哈希。

```bash
sqlite3 project/backend/hapiy.db "SELECT id, username, substr(password, 1, 7) FROM users;"
```

常见情况：

- 表里只有一个用户，名字是 `wooh` 而登录表单填的是 `admin`：改用数据库里的名字。
- 密码哈希被改过但你记不清明文：直接重置。

```bash
node -e "console.log(require('bcryptjs').hashSync('admin123', 10))"
sqlite3 project/backend/hapiy.db \
  "UPDATE users SET username='wooh', password='\$(node -e \"console.log(require('bcryptjs').hashSync('admin123',10))\")' WHERE username='wooh';"
```

验证：

```bash
curl -sS -i -X POST -H 'Content-Type: application/json' \
  -d '{"username":"wooh","password":"admin123"}' \
  http://127.0.0.1:8080/v1/dashboard/users/login
```

> *Login failures mean either the username no longer matches the DB or the password hash does not match what you type. Reset the hash with bcryptjs and verify with curl.*

### Cookie 与会话

会话存在内存里的 `sessions.tokens`，后端重启即清空。每次 `Login` 会下发新的 `hapiy_admin_session` cookie。前端用的是 `credentials: 'include'`，反代必须转发 cookie 且同源/同站，否则登录也会失效。

> *Sessions are in-memory. Restart the backend and users must log in again. The reverse proxy must forward cookies and keep them same-site, otherwise login fails.*

---

## 📁 项目结构

```text
hapiy/
├── project/
│   ├── web/
│   │   ├── src/                  # Vite + React + TS + shadcn/ui
│   │   ├── scripts/dev.sh        # detached 前端启动
│   │   ├── AGENT_README.md       # 旧的 web 视角 README
│   │   ├── components.json
│   │   └── vite.config.ts
│   └── backend/
│       ├── cmd/hapiy/main.go
│       ├── internal/             # handler / middleware / relay
│       ├── scripts/backend.sh    # detached 后端启动
│       ├── go.mod / go.sum
│       └── hapiy.db              # SQLite 库
└── AGENT_README.md               # 本文件
```

> *Tree of the repo as the script-driven operations layer.*

---

## ✨ 一键命令速查

```bash
# 启动
cd project/web     && ./scripts/dev.sh
cd project/backend && ./scripts/backend.sh

# 状态
cd project/web     && ./scripts/dev.sh --status
cd project/backend && ./scripts/backend.sh --status

# 停止
cd project/web     && ./scripts/dev.sh --stop
cd project/backend && ./scripts/backend.sh --stop

# 重建后端
cd project/backend && FORCE_REBUILD=1 ./scripts/backend.sh

# 重置 admin 账号
cd project/backend
NEW_HASH=$(node -e "console.log(require('bcryptjs').hashSync('admin123',10))")
sqlite3 hapiy.db "UPDATE users SET username='wooh', password='$NEW_HASH';"
```

> *Quick command reference for the lifecycle and recovery operations.*

---

## 📦 依赖

| 组件 | 需要的工具 |
|---|---|
| 前端 | `pnpm` ≥ 9、Node 22 |
| 后端 | Go ≥ 1.22 |
| 数据库 | `sqlite3` CLI |
| 哈希重置 | `node` + `bcryptjs`（项目已有，或临时 `npm i -g bcryptjs`） |

> *Tools required: pnpm + Node 22 for the web app, Go 1.22+ for the backend, sqlite3 CLI for recovery, and bcryptjs (already in the project) for hash generation.*

---

## 📜 License

仓库原有许可。

> *Repository license.*