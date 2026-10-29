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
    private var retries = 0
    private var currentURL: URL = localConsoleURL()

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
        controllers.removeAll { $0 === self }
    }

    // 后端可能还没起来：加载失败就 1 秒后重试（同一个地址），最多 30 次。
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        retry()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        retry()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        retries = 0
    }

    private func retry() {
        guard retries < 30 else { return }
        retries += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self = self else { return }
            self.load(self.currentURL)
        }
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
