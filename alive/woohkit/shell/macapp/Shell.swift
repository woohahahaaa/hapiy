// Shell.swift — woohkit 通用 macOS 极简外壳：一个只打开本机服务的窗口。
//
// 用 WKWebView(系统自带 WebKit)而不是 Chrome:进程属于自己,程序坞/切换器
// 里显示的就是本应用图标，窗口没有浏览器工具栏。端口每次启动时从用户目录
// 下的 <PortRelPath> 读取，读不到退回 DefaultPort。
//
// 外观两个开关（kGlass / kFrameless，来自项目 alive/woohkit.json 的 shell 块）：
//   - kGlass：整窗一块透明玻璃——NSVisualEffectView(.hudWindow, behindWindow)
//     当底，WKWebView 透明叠在上面（做法照搬 Zen Browser 的 macOS 实现
//     ZenWindowMaterialView）。页面自己用半透明背景（rgba/transparent）就能
//     透出玻璃；页面不透明时玻璃只在标题栏/露出处显形。
//   - kFrameless：隐藏标题栏只剩红绿灯，页面顶到红绿灯下面——顶部约 28px 是
//     拖窗口区，页面点不到。false 就是系统原生标题栏（带应用名）。
//
// 本文件只写通用逻辑；应用名/端口/主题色/外观来自构建时生成的 Config.swift
// （shell/macapp/build.sh），项目不要去改这里。

import Cocoa
import WebKit

// 透明 WKWebView：underPageBackgroundColor 永远返回 clear（WebKit 每次导航后
// 会重设它），配合 drawsBackground=false 让页面底色透明，玻璃才能透出来。
final class GlassWebView: WKWebView {
    override var underPageBackgroundColor: NSColor? {
        get { .clear }
        set { }
    }
}

/// 本机服务地址：端口文件优先（alive 启动时写的实际端口），读不到退回默认端口。
func localConsoleURL() -> URL {
    let portFile = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(kPortRelPath)
    if let raw = try? String(contentsOf: portFile, encoding: .utf8),
       let port = Int(raw.trimmingCharacters(in: .whitespacesAndNewlines)),
       port > 0, port < 65536 {
        return URL(string: "http://127.0.0.1:\(port)/")!
    }
    return URL(string: "http://127.0.0.1:\(kDefaultPort)/")!
}

func isLocalURL(_ url: URL) -> Bool {
    guard let host = url.host else { return false }
    return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

/// 外壳「内部」的地址：本机，或 shell.url 预设的那个站（含 file:// 单页）。
/// 内部的留在窗口里；外部的交给系统浏览器。
func isInternalURL(_ url: URL) -> Bool {
    if isLocalURL(url) { return true }
    guard !kAppUrl.isEmpty, let preset = URL(string: kAppUrl) else { return false }
    if preset.scheme == "file" { return url.scheme == "file" }
    guard let host = url.host, let presetHost = preset.host else { return false }
    return url.scheme == preset.scheme && host == presetHost
}

/// 活着的窗口控制器（window.open 出来的新窗口也要被持有）。
var controllers: [MainWindowController] = []

final class MainWindowController: NSWindowController, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate {
    let webView: WKWebView
    private var currentURL: URL = localConsoleURL()

    // 后端没起来时不白屏：壳自己显示状态页，调用 `hapiy up` 拉起服务并轮询
    // /health，服务恢复后自动刷新回控制台。
    private var fallbackShown = false
    private var fallbackReady = false
    private var fallbackTitle = ""
    private var fallbackStatus = ""
    private var fallbackSpinner = true
    private var healthTimer: Timer?
    private var restartProcess: Process?
    private var lastRestartAttempt = Date.distantPast
    private var backendMissing = false

    init(initialURL: URL? = nil) {
        let config = WKWebViewConfiguration()
        let wv: WKWebView
        if kGlass {
            wv = GlassWebView(frame: NSRect(x: 0, y: 0, width: 1380, height: 880), configuration: config)
            // drawsBackground 是 WKWebView 的私有 KVC 开关，业界通用做法；
            // 只靠 underPageBackgroundColor 挡不住 WebKit 自己的底色。
            wv.setValue(false, forKey: "drawsBackground")
        } else {
            wv = WKWebView(frame: NSRect(x: 0, y: 0, width: 1380, height: 880), configuration: config)
        }
        webView = wv

        var style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable]
        // fullSizeContentView：内容铺到标题栏底下。无边框时页面顶到红绿灯下面
        // （那 28px 是拖窗口区）；原生标题栏 + 毛玻璃时玻璃要铺到标题栏底下，
        // 页面本身用 safe area 让开标题栏高度。
        if kFrameless || kGlass { style.insert(.fullSizeContentView) }

        let win = NSWindow(contentRect: wv.frame,
                           styleMask: style,
                           backing: .buffered,
                           defer: false)
        win.title = kAppName
        win.minSize = NSSize(width: 720, height: 480)
        win.appearance = NSAppearance(named: .darkAqua)

        let theme = NSColor(calibratedRed: CGFloat(kThemeRed) / 255.0,
                            green: CGFloat(kThemeGreen) / 255.0,
                            blue: CGFloat(kThemeBlue) / 255.0,
                            alpha: 1)

        if kFrameless {
            // 无边框：标题栏只留红绿灯，正文从底下透出。
            win.titleVisibility = .hidden
            win.titlebarAppearsTransparent = true
            win.titlebarSeparatorStyle = .none
        }

        if kGlass {
            // 毛玻璃：窗口本身透明，内容全在 NSVisualEffectView 上。
            win.isOpaque = false
            win.backgroundColor = .clear
            if !kFrameless { win.titlebarAppearsTransparent = true }

            let effect = NSVisualEffectView(frame: NSRect(origin: .zero, size: wv.frame.size))
            effect.material = .hudWindow                 // Zen 默认材质
            effect.blendingMode = .behindWindow          // 采样窗口背后的桌面
            effect.state = .followsWindowActiveState     // 非激活时跟随系统变暗
            effect.autoresizingMask = [.width, .height]

            // 无边框：页面铺满（顶部 28px 拖窗口区）；原生标题栏：页面让开
            // 标题栏（safe area 就是标题栏高度），玻璃仍铺到标题栏底下。
            wv.translatesAutoresizingMaskIntoConstraints = false
            effect.addSubview(wv)
            var constraints = [
                wv.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
                wv.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
                wv.bottomAnchor.constraint(equalTo: effect.bottomAnchor),
            ]
            if kFrameless {
                constraints.append(wv.topAnchor.constraint(equalTo: effect.topAnchor))
            } else {
                constraints.append(wv.topAnchor.constraint(equalTo: effect.safeAreaLayoutGuide.topAnchor))
            }
            NSLayoutConstraint.activate(constraints)
            win.contentView = effect
        } else {
            // 不透明：背景、标题栏都与界面主题色一致，加载瞬间不闪灰/白。
            win.backgroundColor = theme
            win.titlebarAppearsTransparent = true
            win.contentView = wv
        }

        win.isReleasedWhenClosed = false
        win.center()
        super.init(window: win)

        win.delegate = self
        wv.uiDelegate = self
        wv.navigationDelegate = self
        wv.allowsMagnification = true
        if let start = initialURL {
            load(start)
        } else {
            resolveStartupURL()
        }
    }

    required init?(coder: NSCoder) { nil }

    private func load(_ url: URL) {
        currentURL = url
        webView.load(URLRequest(url: url))
    }

    /// 开机决定打开哪个地址：shell.url 预设先探一次（4 秒），通就用它，
    /// 不通退回本机服务。**不能**在窗口里来回切：WKWebView 在 SSL 失败之后
    /// 再 load 会卡住（实测回调都不再触发），所以这件事只在启动时做一次。
    private func resolveStartupURL() {
        guard !kAppUrl.isEmpty, let preset = URL(string: kAppUrl) else {
            load(localConsoleURL())
            return
        }
        if preset.scheme == "file" {          // 本地单页：直接开，不用探
            load(preset)
            return
        }
        var probe = URLRequest(url: preset)
        probe.timeoutInterval = 4
        probe.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: probe) { [weak self] _, response, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if error == nil, response is HTTPURLResponse {
                    self.load(preset)
                } else {
                    self.load(localConsoleURL())
                }
            }
        }.resume()
    }

    func windowWillClose(_ notification: Notification) {
        healthTimer?.invalidate()
        healthTimer = nil
        controllers.removeAll { $0 === self }
    }

    // 后端可能还没起来：不再空白重试，改为显示状态页并主动拉起服务，
    // 服务恢复（/health 可访问）后自动刷新回控制台。
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showUnavailable()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showUnavailable()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if fallbackShown {
            fallbackReady = true
            applyFallbackStatus()
        }
    }

    // MARK: - 服务未启动时的状态页

    private func showUnavailable() {
        guard !fallbackShown else { return }
        // 预设为远端地址时不在本机拉起服务，只显示连接失败。
        guard kAppUrl.isEmpty || isLocalURL(currentURL) else {
            showFallback(
                title: localized("无法连接服务", "Cannot reach the service"),
                status: currentURL.absoluteString,
                spinner: false
            )
            return
        }
        currentURL = localConsoleURL()
        showFallback(
            title: localized("hapiy 服务未启动", "hapiy service is not running"),
            status: localized("正在重启…", "Restarting…"),
            spinner: true
        )
        startBackend()
        startHealthPolling()
    }

    private func showFallback(title: String, status: String, spinner: Bool) {
        fallbackShown = true
        fallbackReady = false
        setFallbackStatus(title: title, status: status, spinner: spinner)
        webView.loadHTMLString(fallbackHTML(title: title, status: status, spinner: spinner), baseURL: nil)
    }

    private func setFallbackStatus(title: String, status: String, spinner: Bool) {
        fallbackTitle = title
        fallbackStatus = status
        fallbackSpinner = spinner
        applyFallbackStatus()
    }

    private func applyFallbackStatus() {
        guard fallbackReady else { return }
        let script = "window.setStatus(\(jsLiteral(fallbackTitle)), \(jsLiteral(fallbackStatus)), \(fallbackSpinner ? "true" : "false"))"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    private func startBackend() {
        if let process = restartProcess, process.isRunning { return }
        let exe = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".hapiy/app/hapiy")
        guard FileManager.default.isExecutableFile(atPath: exe.path) else {
            backendMissing = true
            setFallbackStatus(
                title: localized("hapiy 服务未安装", "hapiy is not installed"),
                status: localized("请先运行 install.sh 安装 hapiy。", "Run install.sh to install hapiy first."),
                spinner: false
            )
            return
        }
        backendMissing = false
        let process = Process()
        process.executableURL = URL(fileURLWithPath: exe.path)
        process.arguments = ["up"]
        var env = ProcessInfo.processInfo.environment
        if let port = localConsoleURL().port {
            env["HAPIY_PORT"] = String(port)
        }
        process.environment = env
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] finished in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.restartProcess = nil
                guard self.fallbackShown, finished.terminationStatus != 0 else { return }
                self.setFallbackStatus(
                    title: self.localized("hapiy 服务未启动", "hapiy service is not running"),
                    status: self.localized("重启失败，正在重试…", "Restart failed, retrying…"),
                    spinner: true
                )
            }
        }
        do {
            try process.run()
            restartProcess = process
            lastRestartAttempt = Date()
        } catch {
            setFallbackStatus(
                title: localized("hapiy 服务未启动", "hapiy service is not running"),
                status: localized("重启失败，正在重试…", "Restart failed, retrying…"),
                spinner: true
            )
        }
    }

    private func startHealthPolling() {
        healthTimer?.invalidate()
        let timer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.checkHealth()
        }
        RunLoop.main.add(timer, forMode: .common)
        healthTimer = timer
        checkHealth()
    }

    private func checkHealth() {
        guard fallbackShown else { return }
        let base = localConsoleURL()
        if base != currentURL { currentURL = base }
        guard let healthURL = URL(string: "/health", relativeTo: base) else { return }
        var request = URLRequest(url: healthURL)
        request.timeoutInterval = 2
        request.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            DispatchQueue.main.async {
                guard let self = self, self.fallbackShown else { return }
                if let http = response as? HTTPURLResponse, http.statusCode < 500 {
                    self.recover()
                    return
                }
                // `up` 已经退出但服务仍没起来：隔 10 秒再拉一次，避免刷屏。
                if self.restartProcess?.isRunning != true,
                   !self.backendMissing,
                   Date().timeIntervalSince(self.lastRestartAttempt) > 10 {
                    self.startBackend()
                }
            }
        }.resume()
    }

    private func recover() {
        healthTimer?.invalidate()
        healthTimer = nil
        fallbackShown = false
        fallbackReady = false
        let url = localConsoleURL()
        currentURL = url
        load(url)
    }

    private func localized(_ chinese: String, _ english: String) -> String {
        let language = Locale.preferredLanguages.first?.lowercased() ?? ""
        return language.hasPrefix("zh") ? chinese : english
    }

    private func jsLiteral(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
              let encoded = String(data: data, encoding: .utf8) else {
            return "\"\""
        }
        return encoded
    }

    private func fallbackHTML(title: String, status: String, spinner: Bool) -> String {
        let spinnerClass = spinner ? "spinner" : "spinner hidden"
        return """
        <!doctype html>
        <html lang="zh-CN">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          :root { color-scheme: dark; }
          * { box-sizing: border-box; }
          html, body { height: 100%; }
          body {
            margin: 0;
            background: #101010;
            color: #f4f4f5;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .card { width: min(360px, calc(100vw - 48px)); text-align: center; }
          .logo { font-family: "Cookie", "Snell Roundhand", cursive; font-size: 40px; line-height: 1; }
          .spinner {
            width: 20px; height: 20px; margin: 24px auto 0;
            border: 2px solid rgba(255,255,255,.16);
            border-top-color: rgba(255,255,255,.9);
            border-radius: 50%;
            animation: spin .8s linear infinite;
          }
          .spinner.hidden { display: none; }
          @keyframes spin { to { transform: rotate(360deg); } }
          h1 { margin: 14px 0 6px; font-size: 15px; font-weight: 600; letter-spacing: -.01em; }
          p { margin: 0; color: #a1a1aa; font-size: 12px; line-height: 1.6; }
        </style>
        </head>
        <body>
          <main class="card">
            <div class="logo">hapiy</div>
            <div class="\(spinnerClass)"></div>
            <h1 id="title">\(title)</h1>
            <p id="status">\(status)</p>
          </main>
          <script>
            window.setStatus = function (title, status, spin) {
              document.getElementById('title').textContent = title;
              document.getElementById('status').textContent = status;
              document.querySelector('.spinner').classList.toggle('hidden', !spin);
            };
          </script>
        </body>
        </html>
        """
    }

    // window.open / target=_blank：内部地址（本机 / shell.url 的站）开独立窗口；
    // 外部链接交给默认浏览器。
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if isInternalURL(url) {
            let controller = MainWindowController(initialURL: url)
            controllers.append(controller)
            controller.showWindow(nil)
            return controller.webView
        }
        NSWorkspace.shared.open(url)
        return nil
    }

    // 顶层导航到外部地址：交给默认浏览器，外壳只服务自己那个站。
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           navigationAction.targetFrame?.isMainFrame == true,
           let scheme = url.scheme, scheme == "http" || scheme == "https",
           !isInternalURL(url) {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let controller = MainWindowController()
        controllers.append(controller)
        controller.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    @objc private func reloadActive() { activeWebView()?.reload() }
    @objc private func zoomIn() { activeWebView()?.pageZoom += 0.1 }
    @objc private func zoomOut() { activeWebView()?.pageZoom = max(0.5, (activeWebView()?.pageZoom ?? 1) - 0.1) }
    @objc private func zoomReset() { activeWebView()?.pageZoom = 1 }

    private func activeWebView() -> WKWebView? {
        NSApp.keyWindow?.contentView as? WKWebView
    }

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 \(kAppName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 \(kAppName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 \(kAppName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let viewMenu = NSMenu(title: "显示")
        func add(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String) {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.target = self
            menu.addItem(item)
        }
        add(viewMenu, "重新加载", #selector(reloadActive), "r")
        viewMenu.addItem(.separator())
        add(viewMenu, "放大", #selector(zoomIn), "=")
        add(viewMenu, "缩小", #selector(zoomOut), "-")
        add(viewMenu, "实际大小", #selector(zoomReset), "0")
        viewItem.submenu = viewMenu

        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "关闭", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu

        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
