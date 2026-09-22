// Hapiy Windows 壳：确保后端在跑，然后开原生 WebView2 窗口加载 Hapiy。
// 后端常驻（HAPIY_PORT 固定端口），窗口关闭只退出壳本身；再次双击直接开窗。
// 编译：GOOS=windows GOARCH=amd64 go build -ldflags "-H windowsgui"
package main

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2"
)

const defaultPort = "18099"

func backendReady(port string) bool {
	req, err := http.NewRequest(http.MethodGet, "http://127.0.0.1:"+port+"/health", nil)
	if err != nil {
		return false
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode < 500
}

func startBackend(dir string) bool {
	home, err := os.UserHomeDir()
	if err == nil {
		os.MkdirAll(filepath.Join(home, ".hapiy", "logs"), 0o755)
	}
	cmd := exec.Command(filepath.Join(dir, "hapiy-server.exe"))
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"HAPIY_ENV=production",
		"HAPIY_HOST=127.0.0.1",
		"HAPIY_PORT="+defaultPort,
		"HAPIY_WEB_DIST="+filepath.Join(dir, "webdist"),
		"HAPIY_DB_PATH="+filepath.Join(home, ".hapiy", "hapiy.db"),
		"HAPIY_LOG_DIR="+filepath.Join(home, ".hapiy", "logs"),
		"HAPIY_ADMIN_USERNAME=admin",
		"HAPIY_ADMIN_PASSWORD=admin",
	)
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		messageBox("Hapiy", "启动后端失败: "+err.Error())
		return false
	}
	return true
}

func messageBox(title, text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	mb := user32.NewProc("MessageBoxW")
	tp, _ := syscall.UTF16PtrFromString(title)
	mp, _ := syscall.UTF16PtrFromString(text)
	mb.Call(0, uintptr(unsafe.Pointer(mp)), uintptr(unsafe.Pointer(tp)), 0x10)
}

func main() {
	dir, err := os.Executable()
	if err != nil {
		messageBox("Hapiy", "定位程序目录失败: "+err.Error())
		return
	}
	dir = filepath.Dir(dir)

	if !backendReady(defaultPort) {
		if !startBackend(dir) {
			return
		}
		ok := false
		for i := 0; i < 60; i++ {
			time.Sleep(500 * time.Millisecond)
			if backendReady(defaultPort) {
				ok = true
				break
			}
		}
		if !ok {
			messageBox("Hapiy", "后端启动超时，请重新双击 Hapiy.exe 再试")
			return
		}
	}

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "Hapiy",
			Width:  1200,
			Height: 800,
			Center: true,
			IconId: 1,
		},
	})
	if w == nil {
		messageBox("Hapiy", "缺少 WebView2 运行时，请安装后重试:\nhttps://developer.microsoft.com/microsoft-edge/webview2/")
		return
	}
	defer w.Destroy()
	w.Navigate("http://127.0.0.1:" + defaultPort + "/")
	w.Run()
}