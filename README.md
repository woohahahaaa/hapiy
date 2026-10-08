# hapiy

hapiy 是一套**自托管的 LLM API 网关**。对外提供 OpenAI 兼容接口（`/v1/chat/completions` 等），对内按你在可视化「转发拓扑」里画出的流程，把请求转发到配置好的上游供应商。客户端只要改一个 BaseURL、换一把 `hk-` 令牌，就能接入统一的模型出口。

围绕转发链路还带：供应商与密钥池、令牌签发与额度、请求/响应改写、并发控制、故障转移与自动恢复、渠道亲和性、日志抓取、用量与费用统计，以及把 opencode / Codex / openclaw 等 Agent 接进来的「接管Agent」。数据存本地 SQLite，单进程部署。

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
- **开发**：在源码仓库用 `./alive.sh` 本地重建并运行（默认把前端构建成 prod 栈跑在 18009；`./alive.sh dev` 切换 Vite 热更新，后端 8080）。构建产物写在 `~/.hapiy/app/`，与安装版、一键升级共用同一位置，互相覆盖。运行时临时暂停已安装的自启服务，下次登录自动恢复。开发细节见 `AGENT_README.md`。

## 许可

仓库原有许可。
