# hapiy

**连接模型、应用与 Agent 的自托管 AI 网关**

一套接口接入所有上游模型，一键把 AI 编程工具接到自己的网关，不用逐个手改客户端配置。

## 项目说明

hapiy 是面向应用、Agent 和团队的自托管 AI 网关：OpenAI、Anthropic 兼容、自建或三方中转等上游统一接入，路由、访问、用量与成本在一个控制台里管；opencode、Codex、openclaw、WorkBuddy 等 AI 编程工具的配置也能接管，直接走 hapiy。

它主要解决 Agent 调用模型过程中遇到的各种问题：上游波动、限流、报错、客户端 bug、费用对不上……这些都能在这里灵活地配置、监控和修正。也正因为覆盖面广，hapiy 不是零学习成本的软件——有些逻辑需要结合具体场景、用上一段时间才能真正理解。

我们正在开发内置 Agent：以后你不需要先弄懂 hapiy 的这些配置，直接让它替你干活即可。

## 典型场景

### 故事一：中转站总在波动，哪家慢就换哪家

- **背景 & 问题**：在好几家中转站都买了 DeepSeek 的 token，中转站忽快忽慢、突然限流，手动切换配置费时费力。
- **解决办法**：把渠道全部接进「供应商」，在「请求处理 → 故障转移」设置触发条件（首字超时、速度限制、错误关键词）和转移维度（Base URL / Key / 供应商），打开自动禁用并设阈值，再到「转发拓扑」绑定故障转移插槽；同一家的多个 Key、多个 Base URL 一并纳入。
- **解决结果**：哪家卡顿就自动切走，平时仍优先使用指定渠道；坏渠道达到阈值自动禁用，恢复后自动放回。

### 故事二：中转站全挂了，也要有兜底

- **背景 & 问题**：中转站集体瘫痪，或者任务很急、需要更高网速时，容易卡死。
- **解决办法**：在拓扑里添加「应急请求入口」并绑定官方供应商；普通入口优先使用第三方，只有全部找不到可用渠道时才启用应急入口。
- **解决结果**：紧急任务用官方渠道兜底，不会卡在半路；一有中转站恢复就自动切回，不浪费官方额度。

### 故事三：上游报错，抓一份日志看清真相

- **背景 & 问题**：WorkBuddy 调用 opencode go 的 GLM-5.3-flash，`max_token` 已按 GLM 要求设置，上游却持续报「max_token 太大」。
- **解决办法**：打开拓扑里的日志抓取插槽，圈定这次请求，在「日志抓取 / 使用记录」导出完整请求和响应做对比。
- **解决结果**：确认是 WorkBuddy 传错了值，几分钟内定位问题，不再靠猜。

### 故事四：客户端有 bug，自己动手补掉

- **背景 & 问题**：定位到是客户端 bug，但等客户端修遥遥无期。
- **解决办法**：在链路挂一个请求改写节点，用 `max_token` 路径 + set，把值改成上游接受的范围。
- **解决结果**：请求发出前就被修正，客户端 bug 被绕开，任务立刻能跑。

### 故事五：卡着不动，一眼看穿卡在哪

- **背景 & 问题**：Agent 一直显示「工作中」，30 秒到一分钟没反应，分不清是上游卡，还是 Agent 自己卡或切换 endpoint 在内部转换。
- **解决办法**：打开「活动监视」，查看每条响应的实时状态、上游连接是否成功、已收到第几个 chunk、平均 token 速度，必要时直接掐断。
- **解决结果**：卡点能定位到具体阶段（连接、首字或流式接收），该等、该切、该断一目了然。

### 故事六：到底花了多少钱，一笔一笔算清

- **背景 & 问题**：想算清这个月花了多少钱，但各家中转站价格口径不同，缓存命中还有差价，账对不上。
- **解决办法**：在每个供应商里给模型单独配价；系统按实时美元 / 人民币汇率全局换算；有公开价的从 Model DB 同步并设置倍率，没有倍率关系的逐个手填。
- **解决结果**：所有渠道的用量和花费统一口径，随时知道钱花在哪、哪家更划算。

### 故事七：多个 Agent、多台电脑，配置不再挨个改

- **背景 & 问题**：同时用 OpenCode、WorkBuddy 等多个 Agent，家里和公司各一台电脑；每换一家中转站、每上一个新模型，都要挨个改 JSON，还容易漏参数（比如没开缓存导致费用暴涨）。
- **解决办法**：在 hapiy 里配置一次供应商，用「接管 Agent → 托管模型」一键把已启用的供应商和模型同步到各 Agent 配置；用推荐配置排坑；公司电脑开启 SSH 后可远程编辑，支持语法检查和版本回滚。
- **解决结果**：改一处，多台电脑、多款 Agent 同时生效；漏配问题提前暴露，配置改坏了也能回滚。

### 故事八：新款模型报 502，缺一个请求头？补上就好

- **背景 & 问题**：在 DeepSeek harness 里使用 opencode go 的 dsv4.1flash，请求返回 502：上游 400 `MissingSessionID`，缺少 `x-opencode-session`，无法有效路由。
- **解决办法**：在「请求改写」新建规则，用 header 作用域给 `header.x-opencode-session` 做 set，值引用已有的会话头或填固定会话标识，再把规则绑定到「转发拓扑」的请求改写插槽。
- **解决结果**：请求头补齐，502 消失，模型正常返回；同一会话还能配合渠道亲和性固定走同一家。

## 核心能力

| 方向 | 可以做什么 |
| --- | --- |
| 模型接入 | OpenAI 兼容接口（chat/completions、embeddings、images、audio 等）；客户端只改 BaseURL 和 `hk-` 令牌 |
| 路由调度 | 可视化「转发拓扑」，按权重与条件实时分流 |
| 请求处理 | 请求/响应改写、并发控制、故障转移与自动恢复、渠道亲和性 |
| 用量与成本 | 令牌与额度、用量记录、费用统计 |
| 监控与排障 | 活动监视、使用记录、请求/响应原文抓取 |
| Agent 接管 | 接管 AI 编程工具配置（本机或 SSH），写入 hapiy 地址与 Key |

数据存本地 SQLite，单进程部署。

## 安装

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

## 快速上手

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

## 运行机制

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

## 许可

仓库原有许可。
