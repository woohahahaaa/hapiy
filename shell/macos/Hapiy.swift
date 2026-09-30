// Hapiy macOS 壳：确保后端在跑，然后开原生 WKWebView 窗口加载 Hapiy。
// 后端常驻（HAPIY_PORT 固定端口），窗口关闭只退出壳本身；再次双击直接开窗。
// 编译：swiftc Hapiy.swift -O -target x86_64-apple-macos10.15（.app 组装见 ../pack.sh）
import AppKit
import WebKit

let defaultPort = "18099"

func backendReady(_ port: String) -> Bool {
    guard let url = URL(string: "http://127.0.0.1:\(port)/health") else { return false }
    var req = URLRequest(url: url)
    req.timeoutInterval = 2
    let sem = DispatchSemaphore(value: 0)
    nonisolated(unsafe) var ok = false
    URLSession.shared.dataTask(with: req) { _, resp, _ in
        if let http = resp as? HTTPURLResponse, http.statusCode < 500 { ok = true }
        sem.signal()
    }.resume()
    sem.wait()
    return ok
}

// runUp asks the backend binary to ensure a supervised backend is running
// (`hapiy up`): idempotent, detaches a supervisor, and blocks until healthy
// (60s cap). The bespoke Process spawn + retry loop moved into the binary so
// the macOS shell, the Windows shell and alive.sh share one implementation.
func runUp() {
    guard let res = Bundle.main.resourcePath else { return }
    let home = NSHomeDirectory()
    let stateDir = home + "/.hapiy"
    try? FileManager.default.createDirectory(atPath: stateDir + "/logs", withIntermediateDirectories: true)

    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: res + "/hapiy-server")
    proc.arguments = ["up"]
    proc.standardOutput = FileHandle.nullDevice
    proc.standardError = FileHandle.nullDevice
    var env = ProcessInfo.processInfo.environment
    env["HAPIY_ENV"] = "production"
    env["HAPIY_HOST"] = "127.0.0.1"
    env["HAPIY_PORT"] = defaultPort
    env["HAPIY_WEB_DIST"] = res + "/webdist"
    env["HAPIY_DB_PATH"] = stateDir + "/hapiy.db"
    env["HAPIY_LOG_DIR"] = stateDir + "/logs"
    env["HAPIY_ADMIN_USERNAME"] = "admin"
    env["HAPIY_ADMIN_PASSWORD"] = "admin"
    proc.environment = env
    try? proc.run()
    proc.waitUntilExit()
}

func ensureBackend() -> String {
    if backendReady(defaultPort) { return defaultPort }
    runUp()
    for _ in 0..<40 {
        Thread.sleep(forTimeInterval: 0.5)
        if backendReady(defaultPort) { return defaultPort }
    }
    return defaultPort
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let port: String
    var mainWindow: NSWindow?
    init(port: String) { self.port = port }

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        createWindow()
    }

    func createWindow() {
        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        win.title = "Hapiy"
        win.appearance = NSAppearance(named: .darkAqua)
        win.isReleasedWhenClosed = false
        win.center()
        win.delegate = self
        mainWindow = win

        let wv = WKWebView(frame: win.contentView!.bounds)
        wv.autoresizingMask = [.width, .height]
        wv.navigationDelegate = navDelegate
        win.contentView?.addSubview(wv)
        if let url = URL(string: "http://127.0.0.1:\(port)/") {
            wv.load(URLRequest(url: url))
        }
        win.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // 点红点：只隐藏窗口，不销毁；壳与后端常驻
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    // 点击 Dock 图标时重新显示主窗口（若已关闭则重建）
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if let win = mainWindow {
            win.makeKeyAndOrderFront(nil)
        } else {
            createWindow()
        }
        NSApp.activate(ignoringOtherApps: true)
        return true
    }

    @objc private func toggleMainWindow(_ sender: Any?) {
        if let win = mainWindow {
            if win.isVisible {
                win.orderOut(nil)
            } else {
                win.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
            }
        }
    }

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(NSMenuItem(title: "关于 Hapiy", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "退出 Hapiy", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editItem.submenu = editMenu
        editMenu.addItem(NSMenuItem(title: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let viewMenu = NSMenu(title: "显示")
        viewItem.submenu = viewMenu
        viewMenu.addItem(NSMenuItem(title: "重新加载", action: #selector(WKWebView.reload(_:)), keyEquivalent: "r"))
        viewMenu.addItem(NSMenuItem(title: "显示/隐藏窗口", action: #selector(AppDelegate.toggleMainWindow(_:)), keyEquivalent: "h"))

        NSApp.mainMenu = main
    }
}

// 后端掉线时显示提示页，恢复后自动刷新。
final class NavigationDelegate: NSObject, WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showOffline(webView)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showOffline(webView)
    }

    private func showOffline(_ webView: WKWebView) {
        webView.loadHTMLString(
            """
            <html><body style="font-family:-apple-system;display:flex;align-items:center;justify-content:center;height:100vh;color:#666">
            <div style="text-align:center">
            <h2>Hapiy 后端未响应</h2>
            <p>窗口保持打开，后端恢复后自动重连…</p>
            </div>
            <script>
            setInterval(async () => {
              try {
                const r = await fetch('/health', {cache: 'no-store'});
                if (r.ok) location.href = '/';
              } catch (e) {}
            }, 2000);
            </script>
            </body></html>
            """,
            baseURL: URL(string: "http://127.0.0.1:\(port)/"))
    }

    private var port: String { defaultPort }
}

let port = ensureBackend()
let appDelegate = AppDelegate(port: port)
let navDelegate = NavigationDelegate()
let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.delegate = appDelegate
app.run()