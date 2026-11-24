<div align="center">

<img src="project/web/public/logo.svg" alt="hapiy" width="96" />

# hapiy

**连接模型、应用与 Agent 的自托管 AI 网关**

<p align="center">
  <a href="#-项目说明">项目说明</a> •
  <a href="#capabilities">核心能力</a> •
  <a href="#install">安装</a> •
  <a href="#quick-start">快速开始</a> •
  <a href="#operations">运行与维护</a> •
  <a href="#documentation">文档与社区</a>
</p>

<p align="center">
  <a href="https://github.com/woohahahaaa/hapiy/releases/latest">
    <img src="https://img.shields.io/github/v/release/woohahahaaa/hapiy?color=brightgreen&include_prereleases" alt="release">
  </a>
</p>

</div>

---

## 📝 项目说明

hapiy 是自托管的 AI 网关，运行在你自己的电脑或服务器上。将官方 API、中转站、自建服务等各类模型服务接入统一入口，对外提供统一的模型接口；你的 AI 工具（Claude Code、opencode、Codex、openclaw 等）只需连接一个地址，配置一次，后续无需改动。

密钥、日志与花费记录全部保存在本机，数据存放在本地 SQLite 文件中，单进程运行，无需注册任何账号。

hapiy 主要解决 Agent 调用模型时常见的问题：上游变慢、限流报错、客户端 bug、花费算不清。功能较多，建议先浏览下方的「典型场景」与「核心能力」；如不想逐项了解，也可以让内置助手直接完成配置。

> 与目前市面上最火的两个同类工具对比：**NewAPI** 面向搭建中转站的多人分发场景，侧重渠道聚合与接口格式转换；**cc-switch** 只负责客户端切换，通过修改 Claude Code、Codex 的配置文件更换供应商，请求不经过它。**hapiy** 沿用同样的聚合思路，面向单人多机使用，并覆盖请求全过程（请求改写、并发控制、故障转移、请求抓取、花费统计、Agent 配置文件接管）；请求实际经由 hapiy，各渠道的快慢、报错与花销均有记录。

> [!TIP]
> 控制台默认监听 `0.0.0.0`，同一局域网内可直接访问。如需通过公网或隧道访问，请自行配置 HTTPS 与访问控制，并在「系统设置 → Base URL」中填写正确的对外地址。

---

<a id="capabilities"></a>

## 核心能力

| 方向 | 可以做什么 |
| --- | --- |
| 接口兼容 | 对外提供 OpenAI 兼容的接口（`/v1/chat/completions`、`/v1/embeddings`、`/v1/images/generations`、`/v1/audio/*` 等），客户端只需替换 Base URL 与 Key |
| 模型接入 | 接入官方 API、中转站与自建服务；一家供应商支持多个 Base URL 和多把 Key（按顺序 / 均衡轮换）、Endpoints 白名单、从上游拉取模型、按模型单独定价 |
| 转发规则 | 用节点图描述请求路径，包含请求入口（开关 + 权重）、供应商插槽、条件开关与应急入口；支持自动保存、撤销重做和历史版本 |
| 请求改写 | 按请求头或请求体条件匹配，串行执行设置值、删除字段、加前后缀、正则替换、复制/移动、大小写转换等十余种动作；可先在页面中测试再绑定 |
| 响应改写 | 重命名字段、加前后缀、删除字段；非流式响应整体改写，流式响应按 SSE 事件逐个改写 |
| 故障转移 | 按 Base URL / Key / 供应商三个维度转移；支持首字超时、速度过慢、错误关键词等触发条件与自动禁用阈值 |
| 自动恢复 | 用保存的请求复测上游，通过后恢复；也支持不探测的定时恢复 |
| 渠道亲和性 | 同一会话优先复用上次的供应商 + Base URL + Key；会话头、模型字段、缓存时长均可配置 |
| 并发控制 | 在链路上限速：每 X 分钟内最多通过 N 条，超出部分排队等待 |
| 日志与监视 | 活跃请求面板（阶段、chunk、掐断）、使用记录（分阶段耗时、Token、消耗）、请求抓取（请求 / 响应原文与改写前后对比） |
| 用量与花费 | 令牌额度按 Token 用量扣减；按模型定价统计消耗，支持 models.dev 参考价与倍率、全局币种与在线汇率 |
| 接管 Agent | 将 opencode、Codex、openclaw、WorkBuddy、DeepSeek Harness 等客户端配置纳入管理；支持本机与 SSH、格式校验、历史版本、托管模型一键同步 |
| 内置助手 | 控制台右下角对话式操作；聊天模式仅查询，执行模式可代为新建、修改、启停配置 |
| 系统设置 | 配置对外地址与来源标记、模型列表与 Token 用量字段路径、币种汇率；支持按模块的数据备份（定时 / 手动）与主题配置 |
| Web 控制台 | 配置供应商与令牌、查看用量与日志、调试模型；界面与站内帮助支持中英双语 |

### 典型场景

以下场景均来自实际使用。

| 场景 | 问题 | 解决方式 | 效果 |
| --- | --- | --- | --- |
| 中转站波动 | 多家中转站忽快忽慢、突然限流，手动切配置很麻烦 | 全部加进「供应商」；在「故障转移」里设置触发条件（等太久没返回、速度太慢、上游报错）和自动禁用阈值，再挂到「转发规则」的链路上 | 哪家卡自动换下一家；平时仍优先走指定渠道，坏渠道恢复后自动放回 |
| 中转站全挂 | 集体瘫痪，或临时有急活需要更快的线路 | 在「转发规则」加「应急请求入口」并绑定官方供应商；普通入口照常优先第三方 | 普通渠道都不可用时才切官方兜底；任何一家恢复就自动切回 |
| 上游报错 | WorkBuddy 调 opencode go 的 GLM-5.3-flash，`max_token` 已按要求设置，上游仍报「太大」 | 在转发规则把「请求抓取」插槽打开、只抓这次请求，到「日志中心 → 请求抓取」导出请求和响应原文对比 | 确认是客户端把值传错了，几分钟定位 |
| 客户端 bug | 确认是客户端 bug，等它发版遥遥无期 | 在「请求改写」新建规则，把 `max_token` 改成上游接受的范围，挂到链路 | 请求发出前就被修正，任务马上能跑 |
| Agent 卡住 | 一直显示「工作中」，分不清上游慢还是客户端卡 | 看「转发规则」页面底部的活跃请求面板：连接状态、已收到第几段数据（chunk）、总耗时与首字耗时 | 定位卡在连接、首字还是流式接收，必要时直接掐断 |
| 算不清花费 | 各家中转站计价方式不同，缓存命中还有差价 | 在「供应商」里给模型单独配价；有公开价的从 models.dev 同步并设倍率，没有的逐个手填；在「系统设置 → 币种汇率」统一换算 | 所有渠道按同一口径统计，钱花在哪一目了然 |
| 多 Agent、多电脑 | 每换一家中转站、每上一个模型都要挨个改 JSON，容易漏参数 | 用「接管 Agent → 托管模型」一键同步已启用的供应商和模型；推荐配置排错；公司电脑开 SSH 远程编辑 | 改一处多处生效，有语法检查，改坏可回滚 |
| 模型报 502 | DeepSeek harness 用 opencode go 的 dsv4.1flash，上游说缺少 `x-opencode-session` | 在「请求改写」新增规则，把 `header.x-opencode-session` 设为已有会话头的值或固定标识，挂到链路 | 请求头补齐，502 消失，模型正常返回 |

本 README 描述当前源码的行为，部署时请同时查看所用版本的发布说明。

---

<a id="install"></a>

## 安装

### macOS / Linux

打开终端（macOS 可按 `Command + 空格` 搜索「终端」或 Terminal），执行：

```sh
curl -fsSL https://raw.githubusercontent.com/woohahahaaa/hapiy/main/install.sh | sh
```

### Windows

打开 PowerShell（Windows 11 也可使用「终端」；在开始菜单搜索 `PowerShell` 即可）。无需管理员权限，执行：

```powershell
irm https://raw.githubusercontent.com/woohahahaaa/hapiy/main/install.ps1 | iex
```

安装脚本会下载最新发行版、校验 SHA256、安装到固定目录并加入 PATH，同时注册登录自启（macOS/Linux 使用 launchd / systemd --user，Windows 使用任务计划程序）。**重复执行即为升级**。手动安装可从 [Releases](https://github.com/woohahahaaa/hapiy/releases) 下载对应平台压缩包，解压后保持 `hapiy`（Windows 为 `hapiy.exe`）与 `webdist/` 同目录即可。设置 `HAPIY_NO_SERVICE=1`（Windows 为 `$env:HAPIY_NO_SERVICE=1`）可跳过自启注册。

安装完成后在浏览器打开 <http://127.0.0.1:18009>。默认端口为 18009，实际端口记录在 `~/.hapiy/port`（Windows 为 `%LOCALAPPDATA%\hapiy\port`）。首次启动会自动创建管理员账号，用户名 `admin`，密码随机生成且只在 `~/.hapiy/log/hapiy.log` 打印一次（`Default admin created: username="admin" password="..."`）；登录后请在「个人资料」中修改密码。

---

<a id="quick-start"></a>

## 快速开始

首次打开会进入一个两步配置向导（可跳过）：接入一个供应商并选择模型，完成后即可转发请求。完整流程如下：

1. 添加供应商：在「模型接入 → 供应商」填写名称、Base URLs（如 `https://api.openai.com/v1`）、API Keys 与模型列表；保存时选择「添加到转发规则」。
2. 创建令牌：在「模型接入 → 令牌」新建令牌，复制 `hk-` 开头的 Key。
3. 搭建转发规则：在「转发规则」右键空白处选择「添加完整工作流」，将第 1 步的供应商绑定到供应商插槽。
4. 发起第一次请求。将 `hk-你的令牌` 替换为令牌 Key，`你的模型名` 替换为已启用模型：

```bash
curl http://<hapiy 地址>/v1/chat/completions \
  -H "Authorization: Bearer hk-你的令牌" \
  -H "Content-Type: application/json" \
  -d '{"model":"你的模型名","messages":[{"role":"user","content":"你好"}]}'
```

客户端只需配置两处：Base URL 设为 `http(s)://<hapiy 地址>/v1`，API Key 使用令牌页生成的 `hk-` Key。完整说明见站内帮助（`/help`）。

---

<a id="operations"></a>

## 运行与维护

安装完成后，后端会常驻后台：登录自动启动，异常退出后自动重启。

- **登录自启**：macOS/Linux 注册用户级服务（launchd LaunchAgent / systemd `--user`），Windows 注册登录任务（任务计划程序）；开机登录后无需手动操作。
- **核对自启状态**：运行 `hapiy service status`。退出码 `0`=已安装且运行中、`4`=已安装但暂停（下次登录仍会自启）、`3`=未安装。安装脚本以该退出码校验，失败会直接报错退出。
- **崩溃自动重启**：macOS/Linux 由 launchd / systemd 拉起；Windows 由 `hapiy up --supervise` 守护循环负责（退出 1 秒后重拉）。日志统一写入 `~/.hapiy/log/hapiy.log`。
- **局域网访问**：默认监听 `0.0.0.0`，同一局域网内的设备可通过 `http://<本机IP>:18009` 访问；仅限本机时，将 `HAPIY_HOST` 设为 `127.0.0.1`。
- **升级**：检测到新版本时，侧边栏「系统设置」会出现更新提示，在设置页点击「升级」即可（自动下载并重启，页面自动刷新）；也可在终端运行 `hapiy upgrade`。

常用命令：

| 命令 | 用途 |
| --- | --- |
| `hapiy serve` | 前台运行 |
| `hapiy up` | 确保后端在运行（幂等） |
| `hapiy down` | 先停守护进程，再停后端 |
| `hapiy service status \| start \| stop \| uninstall` | 查看、启动、暂停、卸载自启服务；`stop` 仅为暂停，下次登录仍会自动恢复 |
| `hapiy upgrade` | 升级到最新版本，等同设置页的「升级」 |

### 开发

在源码仓库运行 `./alive/alive.sh` 重建并启动（默认以 prod 栈运行在 18009；`./alive/alive.sh dev` 切换为 Vite 热更新，后端 8080）。构建产物写入 `~/.hapiy/app/`，与安装版共用同一位置。开发细节见 `AGENT_README.md`。

---

<a id="documentation"></a>

## 文档与社区

| 资源 | 入口 |
| --- | --- |
| 站内帮助 | 控制台侧边栏「帮助文档」（`/help`），中英双语 |
| 发布与升级 | [Releases](https://github.com/woohahahaaa/hapiy/releases) |
| 问题反馈 | [GitHub Issues](https://github.com/woohahahaaa/hapiy/issues) |

---

## 📜 许可证

仓库原有许可。
