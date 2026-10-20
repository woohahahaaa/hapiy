# hapiy

**连接模型、应用与 Agent 的自托管 AI 网关**

一套接口接入所有上游模型，一键把 AI 编程工具接到自己的网关，不用逐个手改客户端配置。

---

## 📖 项目说明

hapiy 是面向应用、Agent 和团队的自托管 AI 网关。它把各家模型服务统一成一个入口，路由、访问、用量和成本在一个控制台里管理；opencode、Codex、openclaw、WorkBuddy 等 AI 编程工具的配置也能接管，直接走 hapiy。

它主要处理 Agent 调用模型时遇到的各种问题：上游变慢、限流、报错、客户端 bug、费用对不上。功能比较多，hapiy 不是装上就会用的软件——建议先照着下面的典型场景跑一遍，理解会快很多。

我们还在开发内置 Agent。以后你不需要先弄懂这些配置，直接让它替你处理就行。

---

## 💡 典型场景

下面这些场景都来自真实使用，按「问题 → 怎么解决 → 效果」整理。

| 场景 | 遇到的问题 | 怎么解决 | 效果 |
| --- | --- | --- | --- |
| 中转站波动 | 多家中转站忽快忽慢、突然限流，手动切配置很麻烦 | 全部加进「供应商」；在「请求处理 → 故障转移」设置触发条件（等太久没返回、速度太慢、上游报错）和自动禁用阈值，再挂到「转发拓扑」的链路上 | 哪家卡自动换下一家；平时仍优先走指定渠道，坏渠道恢复后自动放回 |
| 中转站全挂 | 集体瘫痪，或临时有急活需要更快的线路 | 在「转发拓扑」加「应急请求入口」并绑定官方供应商；普通入口照常优先第三方 | 普通渠道都不可用时才切官方兜底；任何一家恢复就自动切回 |
| 上游报错 | WorkBuddy 调 opencode go 的 GLM-5.3-flash，`max_token` 已按要求设置，上游仍报「太大」 | 在拓扑打开「日志抓取」只抓这次请求，到「日志抓取 / 使用记录」导出请求和响应原文对比 | 确认是客户端把值传错了，几分钟定位 |
| 客户端 bug | 确认是客户端 bug，等它发版遥遥无期 | 在「请求改写」新建规则，把 `max_token` 改成上游接受的范围，挂到链路 | 请求发出前就被修正，任务马上能跑 |
| Agent 卡住 | 一直显示「工作中」，分不清上游慢还是客户端卡 | 打开「活动监视」，看连接状态、已收到第几段数据（chunk）、平均 token 速度 | 定位卡在连接、首字还是流式接收，必要时直接掐断 |
| 算不清花费 | 各家中转站计价方式不同，缓存命中还有差价 | 在「供应商」里给模型单独配价；有公开价的从 Model DB 同步并设倍率，没有的逐个手填；在「系统设置 → 币种汇率」统一换算 | 所有渠道按同一口径统计，钱花在哪一目了然 |
| 多 Agent、多电脑 | 每换一家中转站、每上一个模型都要挨个改 JSON，容易漏参数 | 用「接管 Agent → 托管模型」一键同步已启用的供应商和模型；推荐配置排错；公司电脑开 SSH 远程编辑 | 改一处多处生效，有语法检查，改坏可回滚 |
| 模型报 502 | DeepSeek harness 用 opencode go 的 dsv4.1flash，上游说缺少 `x-opencode-session` | 在「请求改写」新增规则，把 `header.x-opencode-session` 设为已有会话头的值或固定标识，挂到链路 | 请求头补齐，502 消失，模型正常返回 |

---

## 🧩 核心能力

| 方向 | 可以做什么 |
| --- | --- |
| 模型接入 | OpenAI 兼容接口（chat/completions、embeddings、images、audio 等）；客户端只改 BaseURL 和 `hk-` 令牌 |
| 路由调度 | 可视化「转发拓扑」，按权重与条件实时分流 |
| 请求处理 | 请求/响应改写、并发控制、故障转移与自动恢复、渠道亲和性 |
| 用量与成本 | 令牌与额度、用量记录、费用统计 |
| 监控与排障 | 活动监视、使用记录、请求/响应原文抓取 |
| Agent 接管 | 接管 AI 编程工具配置（本机或 SSH），写入 hapiy 地址与 Key |

数据存本地 SQLite，单进程部署。

---

## 📦 安装

### macOS / Linux

先打开「终端」（Terminal）：按 `Command + 空格` 打开聚焦搜索（Spotlight），输入「终端」或「Terminal」，回车即可。

然后把下面这行复制进终端窗口，回车：

```sh
curl -fsSL https://raw.githubusercontent.com/woohahahaaa/hapiy/main/install.sh | sh
```

### Windows

先打开 PowerShell：点「开始」按钮（或按键盘上的 Win 键），输入 `PowerShell`，在结果里点「Windows PowerShell」；Windows 11 也可以搜「终端」（Terminal）。不需要管理员身份。

然后把下面这行复制进窗口，回车：

```powershell
irm https://raw.githubusercontent.com/woohahahaaa/hapiy/main/install.ps1 | iex
```

安装脚本做四件事：下载最新发行版、校验 SHA256、装到固定目录并加入 PATH、注册登录自启（macOS/Linux 用 launchd / systemd --user，Windows 用任务计划程序）。**重复执行即为升级**。想手动安装，可从 [Releases](https://github.com/woohahahaaa/hapiy/releases) 下载对应平台压缩包，解压后保持 `hapiy`（Windows 为 `hapiy.exe`）与 `webdist/` 同目录即可。设 `HAPIY_NO_SERVICE=1`（Windows 为 `$env:HAPIY_NO_SERVICE=1`）可跳过自启注册。

装好后浏览器打开 <http://127.0.0.1:18009>。默认端口 18009，实际端口写在 `~/.hapiy/port`（Windows 在 `%LOCALAPPDATA%\hapiy\port`）。首次启动会自动创建管理员：用户名 `admin`，密码随机生成、只在 `~/.hapiy/log/hapiy.log` 里打印一次（`Default admin created: username="admin" password="..."`），登录后到「个人资料」改密码。

---

## 🚀 快速上手

1. **添加供应商**：「模型接入 → 供应商」，填名称、Base URLs（如 `https://api.openai.com/v1`）、API Keys、模型列表；保存时选「添加到拓扑」自动接线。
2. **创建令牌**：「模型接入 → 令牌」，新建后复制 `hk-` 开头的 Key，客户端就用它调用 hapiy。
3. **搭转发拓扑**：「转发拓扑」右键空白处 →「添加完整工作流」，在供应商插槽里绑定第 1 步的供应商。
4. **调用验证**：

```bash
curl http://<hapiy 地址>/v1/chat/completions \
  -H "Authorization: Bearer hk-你的令牌" \
  -H "Content-Type: application/json" \
  -d '{"model":"你的模型名","messages":[{"role":"user","content":"你好"}]}'
```

客户端接入只需两处：BaseURL 填 `http(s)://<hapiy 地址>/v1`，API Key 换成令牌页生成的 `hk-` Key。完整说明见站内「帮助」（`/help`）。

---

## ⚙️ 运行机制

安装完成后后端即常驻：登录自动启动，进程挂了自动重拉。

- **登录自启**：macOS/Linux 注册用户级服务（launchd LaunchAgent / systemd `--user`），Windows 注册登录任务（任务计划程序）。开机登录后无需手动做任何事。
- **确认自启装好了**：终端运行 `hapiy service status`。退出码 `0`=已安装且运行中、`4`=已安装但暂停（下次登录仍会自启）、`3`=未安装。安装脚本用这个码校验，装不上会直接报错退出。
- **崩溃自动重启**：macOS/Linux 由 launchd / systemd 拉起；Windows 由 `hapiy up --supervise` 守护循环负责（退出 1 秒后重拉）。日志都在 `~/.hapiy/log/hapiy.log`。
- **手动管理**：
  - `hapiy service status | start | stop | uninstall` — 查看、启动、暂停、卸载自启服务；`stop` 只是暂停，下次登录会自动恢复。
  - `hapiy serve` — 前台运行；`hapiy up` — 确保后端在跑（幂等）；`hapiy down` — 先停守护再停后端。
- **局域网**：默认监听 `0.0.0.0`，同一局域网的设备可用 `http://<本机IP>:18009` 打开。想只限本机，把启动时的 `HAPIY_HOST` 设为 `127.0.0.1`。
- **升级**：检测到新版本时，侧边栏「系统设置」会出现更新提示，进设置点「升级」即可（自动下载并重启，页面自动刷新）；也可以在终端运行 `hapiy upgrade`。
- **开发**：在源码仓库用 `./alive/alive.sh` 本地重建并运行（默认把前端构建成 prod 栈跑在 18009；`./alive/alive.sh dev` 切换 Vite 热更新，后端 8080）。构建产物写在 `~/.hapiy/app/`，与安装版、一键升级共用同一位置，互相覆盖。运行时临时暂停已安装的自启服务，下次登录自动恢复。开发细节见 `AGENT_README.md`。

---

## 📄 许可

仓库原有许可。
