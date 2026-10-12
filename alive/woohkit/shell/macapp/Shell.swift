// Shell.swift — woohkit 通用 macOS 极简外壳：一个只打开本机服务的窗口。
//
// 用 WKWebView(系统自带 WebKit)而不是 Chrome:进程属于自己,程序坞/切换器
// 里显示的就是本应用图标，窗口没有浏览器工具栏。端口每次启动时从用户目录
// 下的 <PortRelPath> 读取，读不到退回 DefaultPort。
//
// 本文件只写通用逻辑；应用名/端口/主题色来自构建时生成的 Config.swift
// （shell/macapp/build.sh），项目不要去改这里。

import Cocoa
import WebKit

func consoleURL() -> URL {
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

/// 活着的窗口控制器（window.open 出来的新窗口也要被持有）。
var controllers: [MainWindowController] = []

final class MainWindowController: NSWindowController, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate {
    let webView: WKWebView
    private var retries = 0

    init(request: URLRequest) {
        let config = WKWebViewConfiguration()
        let wv = WKWebView(frame: NSRect(x: 0, y: 0, width: 1380, height: 880), configuration: config)
        webView = wv

        let win = NSWindow(contentRect: wv.frame,
                           styleMask: [.titled, .closable, .miniaturizable, .resizable],
                           backing: .buffered,
                           defer: false)
        win.title = kAppName
        win.minSize = NSSize(width: 720, height: 480)
        win.appearance = NSAppearance(named: .darkAqua)
        // 纯深色边框：背景、标题栏都与界面主题色一致，加载瞬间不闪灰/白。
        // 标题栏透明后正文从底下透出，整个窗口一块深色。
        let theme = NSColor(calibratedRed: CGFloat(kThemeRed) / 255.0,
                            green: CGFloat(kThemeGreen) / 255.0,
                            blue: CGFloat(kThemeBlue) / 255.0,
                            alpha: 1)
        win.backgroundColor = theme
        win.titlebarAppearsTransparent = true
        win.contentView = wv
        win.isReleasedWhenClosed = false
        win.center()
        super.init(window: win)

        win.delegate = self
        wv.uiDelegate = self
        wv.navigationDelegate = self
        wv.allowsMagnification = true
        wv.load(request)
    }

    required init?(coder: NSCoder) { nil }

    func windowWillClose(_ notification: Notification) {
        controllers.removeAll { $0 === self }
    }

    // 后端可能还没起来：加载失败就 1 秒后重试，最多 30 次。
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
            self?.webView.load(URLRequest(url: consoleURL()))
        }
    }

    // window.open / target=_blank：本机页面开独立窗口；外部链接交给默认浏览器。
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if isLocalURL(url) {
            let controller = MainWindowController(request: URLRequest(url: url))
            controllers.append(controller)
            controller.showWindow(nil)
            return controller.webView
        }
        NSWorkspace.shared.open(url)
        return nil
    }

    // 顶层导航到外部地址：也交给默认浏览器，外壳只服务本机控制台。
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           navigationAction.targetFrame?.isMainFrame == true,
           let scheme = url.scheme, scheme == "http" || scheme == "https",
           !isLocalURL(url) {
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
        let controller = MainWindowController(request: URLRequest(url: consoleURL()))
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
