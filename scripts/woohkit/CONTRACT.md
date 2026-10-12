# woohkit 契约（CONTRACT）

woohkit 是一个「框架 + 规范」：通用逻辑（alive、release、安装器、桌面壳）都在
kit 里，跟技术栈无关；项目只写两个自己的文件：根目录 `woohkit.json`（身份与
默认端口，自己定）和 `scripts/project.sh`（钩子：我是什么栈、怎么构建、怎么
打包）。本文件是那份规范——引用 kit 的项目照着实现即可。

- kit 拥有的文件（**永远不要手改**，`tools/sync.sh` 整文件覆盖）：
  `alive.sh`、`scripts/release.sh`、`scripts/woohkit/**`
- 项目拥有的文件（kit 永不触碰）：
  `woohkit.json`（根目录，身份/端口，kit 只读）、`scripts/project.sh`（钩子）、
  `install.sh` / `install.ps1`（release 时渲染生成）

---

## 一、项目文件（都在项目里；kit 只读不改）

### 1.1 `<项目根>/woohkit.json` — 身份与默认端口（项目自己定）

```json
{ "name": "MyApp", "id": "myapp", "defaultPort": 18799 }
```

- `name`：显示名（消息、release 标题、桌面壳名）。简洁 ASCII。
- `id`：slug，小写字母/数字/`_`/`-`，用作 `~/.<id>`、日志前缀、服务名。
- `defaultPort`：1-65535 的公共端口。**不带 `--port` 时永远用它**；`--port N`
  只对当次运行生效，kit 不记忆、不覆盖、不写回。

### 1.2 `scripts/project.sh` — 项目细节 + 钩子

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `STATE_DIR` | | 状态目录，默认 `$HOME/.$APP_ID` |
| `BIN` | | 已安装二进制路径，默认 `$STATE_DIR/app/$APP_ID`。构建钩子应把产物写到这（与 install.sh / 自升级同路径） |
| `LOG_STEM` | | 主日志名，默认 `$APP_ID`（日志在 `$STATE_DIR/log/$LOG_STEM.log`） |
| `EXTRA_PORTS` | | 停栈时额外收掉的端口（空格分隔） |
| `HEALTH_WAIT` | | prod 健康等待上限（秒），默认 60 |
| `DEV_HEALTH_WAIT` | | dev 健康等待上限（秒），默认 120 |
| `GO_CGO_ENV` | | Go 交叉编译到 darwin 时的附加环境（如 `CGO_ENABLED=1`），供 `kit_go_build` 用 |

框架导出给钩子用的：`PORT`、`MODE`（prod/dev）、`STATE_DIR`、`LOG_DIR`、
`ROOT_DIR`、`KIT_DIR`。

## 二、alive 钩子

| 钩子 | 必填 | 说明 |
| --- | --- | --- |
| `proj_build` | ✓ | prod 构建。在停旧栈之前调用（构建期间旧栈继续服务），产物写到约定位置 |
| `proj_run` | ✓ | prod 前台命令：**阻塞运行、监听 $PORT**。不要后台化；supervisor 负责守护（退出 2s 重拉），停栈时连整个进程组一起收 |
| `proj_health` | ✓ | 就绪探测，0 = 就绪（端口是 `$PORT`） |
| `proj_dev_build` | | dev 启动前的构建（如只编后端） |
| `proj_dev_run` | | dev 前台命令（缺省回退 `proj_run`）。有第二个常驻进程时用 `kit_sidecar`（见下） |
| `proj_dev_health` | | dev 就绪探测（缺省回退 `proj_health`）；有边车时应把它们一起检查 |
| `proj_pre_start` | | 停旧栈之后、启动之前调用（钉端口、生成配置等） |
| `proj_stop_first` | | 停栈最初执行（先于一切）：收拾上一代守望者/历史遗留进程 |
| `proj_stop_extra` | | 停栈最后一步的自定义清理 |
| `proj_service_pause` | | 停栈最先执行：暂停系统自启服务，否则它的管理器会把刚杀掉的进程再拉起来抢端口 |
| `proj_ready` | | 就绪时追加输出 |

### kit 提供的助手（在钩子里调用）

- `kit_sidecar <名字> "<命令>"` — 把辅助常驻进程挂成边车：**死了自动重拉、已在跑
  则复用、停栈一起收**。日志 `$STATE_DIR/log/<名字>.log`，pid 文件
  `$STATE_DIR/<名字>.pid`，端口记得放进 `EXTRA_PORTS`。
  dev 里的前端 dev server 就用它，索引到 `<名字>.pid` 不必自己实现。
- `msg` / `warn` / `die` — `[<APP_ID>]` 前缀输出（die 带退出码 1）。
- `lan_ip` — 本机局域网地址（可能为空）。
- `listen_pids <端口>` / `kill_port_listeners <端口>` — 端口监听者查询/收掉。
- `kit_go_build <包目录> <goos> <goarch> <输出> [包路径=.]` — 交叉编译。
- `kit_go_universal <包目录> <输出> [包路径=.]` — darwin amd64+arm64 lipo。

### 模型约定（别再自己实现这些）

- **supervisor 在 shell 侧**：二进制不需要自己做守护循环；`proj_run` 就是一个
  纯前台命令。系统自启服务（launchd/systemd/任务计划）里跑的仍是二进制自己的
  `up --supervise`，与 alive.sh 互不干扰（alive 运行前会 `proj_service_pause`）。
- 端口只由「项目默认 + 本次参数」决定：`--port`（仅当次）> `woohkit.json`
  的 `defaultPort`；detach 出来的子进程用 kit 内部变量继承，不读环境变量
  `PORT`。启动时会把实际端口写进 `<state>/port`——那只是给桌面壳/外部读者
  的握手输出，不参与决策。
- 状态文件：`<state>/mode`、`<state>/supervisor.pid`、`<state>/*.pid`（边车）、
  `<state>/log/<LOG_STEM>.log`、`<state>/log/supervisor.log`。

### alive 用法

```
./alive.sh [prod|dev] [--port N] [--no-build]
./alive.sh --status | --stop | --version | --help
```

## 三、release 钩子

不发布的项目可以完全不写这一节。

| 变量/钩子 | 必填 | 说明 |
| --- | --- | --- |
| `RELEASE_REPO` | ✓ | 发布到哪个仓库（owner/repo）。`gh` 需已登录并有权限 |
| `RELEASE_PLATFORMS` | | 参与发布的平台，默认 `darwin-universal windows-amd64 linux-amd64 linux-arm64`（顺序即 SHA256SUMS 顺序） |
| `RELEASE_PLATFORM_NOTE` | | release notes 里的一句话平台描述 |
| `INSTALL_MIRROR` | | 非空则发布后把 `install.sh` / `install.ps1` / `README.md` 同步到该仓库 main |
| `proj_version` | ✓ | 输出当前版本号（不带 v） |
| `proj_bump_version` | | 无参数发布时先自增版本号 |
| `proj_build_web` | | 前端构建（在编二进制之前跑——把 web 编译进二进制的项目靠它） |
| `proj_stage` | ✓ | `$1`=平台 `$2`=staging 目录：把该平台归档要装的东西全部放进去（二进制、附加目录、桌面壳……）。**stage 目录里是什么，归档里就是什么** |
| `proj_asset` | ✓ | `$1`=平台，输出归档文件名（固定不带版本号） |
| `proj_release_notes_extra` | | 追加到 release notes 的段落 |

流程：`proj_build_web` → 逐平台 `proj_stage` + 打包（扩展名决定 `tar.gz`/`zip`）
→ `version.txt` + `SHA256SUMS` → 渲染 `install.sh` / `install.ps1` 写回项目根
→ `gh release create`（`--title "$APP_NAME $VERSION"`）→ 可选镜像同步。

### 用法

```
./scripts/release.sh              # 自增（有 proj_bump_version 时）+ 发布
./scripts/release.sh 1.2.0        # 显式版本
./scripts/release.sh --dry-run    # 构建/打包/渲染，不发布
./scripts/release.sh --render-only  # 同上且保留临时产物目录
```

## 四、安装器渲染配置（决定 install.sh / install.ps1）

模板在 kit 的 `installers/`，release 时按下列变量渲染成自包含单文件写回项目
（`curl … | sh` 入口不能依赖外部文件，所以是渲染不是引用）。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `INSTALL_EXTRA_DIR` | 空 | 安装时从归档同步到 `app/` 的附加目录（如 `webdist` / `EYE`）；空则渲染出无此段 |
| `INSTALL_DESKTOP` | `0` | `1` = 安装桌面壳（macOS 装 `<APP_NAME>.app`；无壳时退回 Chrome 启动器；Windows 装快捷方式） |
| `INSTALL_SHELL_DESC` | `<APP_NAME> 控制台` | Windows 快捷方式描述 |
| `INSTALL_HEALTH_PATH` | `/` | Windows 安装器自检路径（有专门健康接口的项目写如 `/api/state`） |
| `INSTALL_EXPORT_PORT_ENV` | `0` | `1` = 安装时 `export <ENV>_PORT=${…:-<DEFAULT_PORT>}`（二进制从环境读端口的项目） |
| `INSTALL_PIN_PORT_SUBCMD` | `0` | `1` = 安装时用 `<bin> port <N>` 固化端口（有 `port` 子命令的项目） |

`<ENV>` = `APP_ID` 大写、非字母数字转 `_`（`openboss` → `OPENBOSS`）。

## 五、桌面壳（INSTALL_DESKTOP=1 时）

- `shell/macapp/build.sh <项目根> <输出目录>` → `<APP_NAME>.app`（WKWebView 通用
  二进制，arm64+x86_64，ad-hoc 签名）
- `shell/winapp/build.sh <项目根> <输出目录>` → `<APP_NAME>.exe` + 3 个 WebView2 dll
- 两者读项目根 `woohkit.json` 的 `name` / `id` / `defaultPort`，可选
  （写在 `project.sh`）：`SHELL_THEME`（`#rrggbb`，默认 `#0a0202`）、
  `SHELL_BUNDLE_ID`、`SHELL_ICON`（默认 `<web|public>/public/icon-512.png`）
- 壳的行为：窗口只打开 `http://127.0.0.1:<端口>`（端口从 `<用户目录>/.<APP_ID>/port`
  读，读不到退回 `DEFAULT_PORT`）；外链交给系统浏览器。这些由 kit 保证，项目
  无需写任何壳代码。

## 六、PWA（框架无关的静态层）

- 任何前端框架都适用：`pwa/manifest.webmanifest`（改名字/主题色）+ 图标 +
  可选 `pwa/sw.js`（只缓存静态资产、不碰 `/api`、不拦导航的保守版）。
- 注册片段与安装按钮（`beforeinstallprompt`）见 `pwa/README.md`。
- 想接构建器（如 vite-plugin-pwa 的版本化缓存）属于可选增强，不在契约内。

## 七、同步与升级

- 新建项目：`tools/init.sh <项目目录>`（同步框架 + 生成 `woohkit.json` 和
  `scripts/project.sh` 骨架）。
- 更新框架：`tools/sync.sh <项目目录>`（整文件覆盖 kit 文件）；
  `tools/sync.sh <项目目录> --check` 只对比不写。
- 契约版本：`scripts/woohkit/VERSION`；kit 升级后看仓库 Release notes /
  `CONTRACT.md` 的 diff，钩子签名变了这里会写清楚。
