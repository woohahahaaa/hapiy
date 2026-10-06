// Package selfupdate 负责 hapiy 的自升级：从公开发行仓
// woohahahaaa/hapiy-releases 读取最新版本号，下载对应平台资产，校验 SHA256
// 后原地替换二进制与 webdist 目录。
//
// 版本号放在 release 资产 version.txt 里（而不是 GitHub API）：检查只是对
// releases/latest/download/version.txt 的一次普通 GET，不消耗匿名 API 配额，
// 也不会因为限流把"检查更新"变成红色报错。
//
// 资产名固定不带版本号（hapiy-darwin-universal.tar.gz 等），所以下载地址永远
// 是 .../releases/latest/download/<资产名>。
package selfupdate

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	releaseRepo = "woohahahaaa/hapiy-releases"
	baseURL     = "https://github.com/" + releaseRepo + "/releases/latest/download"

	// maxDownloadBytes 是对单个资产的体积上限（防御异常响应把磁盘写满）。
	maxDownloadBytes = 1 << 30
	// maxManifestBytes 是 version.txt / SHA256SUMS 这类小文件的读取上限。
	maxManifestBytes = 1 << 20

	// webDistDirName 是发行资产里前端静态目录的名字，随二进制一起替换。
	webDistDirName = "webdist"
)

// httpClient 不设全局 Timeout：资产可能有几十 MB，慢网络下 60s 根本下不完。
// 超时统一由各请求的 context 控制——清单文件 60s，升级整体不设时长，停滞由
// 无进展看门狗负责。
var httpClient = &http.Client{}

// AssetName 返回当前平台对应的发布资产名；不支持自动升级的平台返回 false。
func AssetName() (string, bool) {
	switch runtime.GOOS {
	case "darwin":
		// 发行的是 lipo 出来的 universal 二进制，arm64/amd64 同一个资产。
		return "hapiy-darwin-universal.tar.gz", true
	case "windows":
		if runtime.GOARCH == "amd64" {
			return "hapiy-windows-amd64.zip", true
		}
	case "linux":
		switch runtime.GOARCH {
		case "amd64":
			return "hapiy-linux-amd64.tar.gz", true
		case "arm64":
			return "hapiy-linux-arm64.tar.gz", true
		}
	}
	return "", false
}

// ExeName 是资产里可执行文件的名字。
func ExeName() string {
	if runtime.GOOS == "windows" {
		return "hapiy.exe"
	}
	return "hapiy"
}

// LatestVersion 拉取最新版本号（version.txt）。
func LatestVersion(ctx context.Context) (string, error) {
	raw, err := fetch(ctx, baseURL+"/version.txt")
	if err != nil {
		return "", fmt.Errorf("selfupdate: fetch latest version: %w", err)
	}
	v := strings.TrimSpace(string(raw))
	if _, ok := parseVersion(v); !ok {
		return "", fmt.Errorf("selfupdate: malformed latest version %q", v)
	}
	return v, nil
}

// Compare 比较两个点分数字版本（"1.2.0" vs "1.1.0"）：返回 -1/0/1。
// 任一侧不是 x.y[.z] 形式时 ok=false，调用方应当放弃比较。
func Compare(a, b string) (int, bool) {
	av, okA := parseVersion(a)
	bv, okB := parseVersion(b)
	if !okA || !okB {
		return 0, false
	}
	for i := 0; i < len(av) || i < len(bv); i++ {
		var x, y int
		if i < len(av) {
			x = av[i]
		}
		if i < len(bv) {
			y = bv[i]
		}
		if x != y {
			if x < y {
				return -1, true
			}
			return 1, true
		}
	}
	return 0, true
}

func parseVersion(s string) ([]int, bool) {
	s = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s), "v"))
	parts := strings.Split(s, ".")
	if len(parts) < 2 || len(parts) > 4 {
		return nil, false
	}
	out := make([]int, 0, len(parts))
	for _, p := range parts {
		if p == "" {
			return nil, false
		}
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return nil, false
		}
		out = append(out, n)
	}
	return out, true
}

// ProgressFunc 报告下载进度：done 是已接收字节，total 为 0 表示服务端未给出
// 总大小。回调在下载 goroutine 上同步执行，需自行保证并发安全。
type ProgressFunc func(done, total int64)

// Upgrade 下载并安装最新版本。exePath 必须已经解析过符号链接（安装布局里
// 用户敲的 hapiy 是 ~/.local/bin 下的链接，替换链接本身是错的）；webDistDir
// 是前端 dist 目录的目标位置（通常与 exePath 所在目录下的 webdist）。
// progress 可为 nil。current 是调用方所在二进制的版本：latest 不比它新时
// 直接返回 updated=false。
func Upgrade(ctx context.Context, current, exePath, webDistDir string, progress ProgressFunc) (version string, updated bool, err error) {
	latest, err := LatestVersion(ctx)
	if err != nil {
		return "", false, err
	}
	cmp, ok := Compare(latest, current)
	if !ok {
		return latest, false, fmt.Errorf("selfupdate: cannot compare %q with %q", latest, current)
	}
	if cmp <= 0 {
		return latest, false, nil
	}
	asset, ok := AssetName()
	if !ok {
		return latest, false, fmt.Errorf("selfupdate: no release asset for %s/%s", runtime.GOOS, runtime.GOARCH)
	}

	work, err := os.MkdirTemp("", "hapiy-update-*")
	if err != nil {
		return latest, false, fmt.Errorf("selfupdate: create work dir: %w", err)
	}
	defer os.RemoveAll(work)

	archivePath := filepath.Join(work, asset)
	if err := download(ctx, baseURL+"/"+asset, archivePath, progress); err != nil {
		return latest, false, fmt.Errorf("selfupdate: download %s: %w", asset, err)
	}
	sums, err := fetch(ctx, baseURL+"/SHA256SUMS")
	if err != nil {
		return latest, false, fmt.Errorf("selfupdate: fetch SHA256SUMS: %w", err)
	}
	if err := verifySHA256(archivePath, asset, string(sums)); err != nil {
		return latest, false, err
	}

	// 解压到目标同目录的暂存点：后面的 rename 必须同文件系统才原子。
	stage := filepath.Join(filepath.Dir(exePath), fmt.Sprintf(".hapiy-update-%d", os.Getpid()))
	_ = os.RemoveAll(stage)
	if err := os.MkdirAll(stage, 0o755); err != nil {
		return latest, false, fmt.Errorf("selfupdate: create stage dir: %w", err)
	}
	defer os.RemoveAll(stage)
	if err := extractArchive(archivePath, stage); err != nil {
		return latest, false, fmt.Errorf("selfupdate: extract %s: %w", asset, err)
	}
	newExe := filepath.Join(stage, ExeName())
	if _, err := os.Stat(newExe); err != nil {
		return latest, false, fmt.Errorf("selfupdate: archive has no %s: %w", ExeName(), err)
	}
	if err := replaceFile(newExe, exePath); err != nil {
		return latest, false, err
	}
	if webDistDir != "" {
		if newDist := filepath.Join(stage, webDistDirName); dirExists(newDist) {
			if err := replaceDir(newDist, webDistDir); err != nil {
				return latest, false, err
			}
		}
	}
	return latest, true, nil
}

// Status 是给 /api/update 的状态快照。Error 记录版本检查的失败原因，
// UpgradeError 只记录升级流程本身的失败原因（避免两者互相覆盖）。
// DownloadDone/Total 是升级下载的实时进度（total 0 表示未知）。
type Status struct {
	Current       string `json:"current"`
	Latest        string `json:"latest"`
	Available     bool   `json:"available"`
	Checking      bool   `json:"checking"`
	Upgrading     bool   `json:"upgrading"`
	CheckedAtMs   int64  `json:"checkedAtMs"`
	Error         string `json:"error"`
	UpgradeError  string `json:"upgradeError"`
	DownloadDone  int64  `json:"downloadDone"`
	DownloadTotal int64  `json:"downloadTotal"`
}

// Checker 周期性地把当前版本和线上最新版本做对比，结果缓存在内存里。
type Checker struct {
	current    string
	firstDelay time.Duration
	interval   time.Duration

	mu     sync.Mutex
	status Status
}

// NewChecker 创建检查器；Run 启动前 Status 只有 Current 字段。
func NewChecker(current string) *Checker {
	return &Checker{
		current:    current,
		firstDelay: 5 * time.Second,
		interval:   6 * time.Hour,
		status:     Status{Current: current},
	}
}

// Run 在 firstDelay 后做首次检查，之后每 interval 一次，直到 ctx 取消。
func (c *Checker) Run(ctx context.Context) {
	select {
	case <-ctx.Done():
		return
	case <-time.After(c.firstDelay):
	}
	c.check(ctx)
	t := time.NewTicker(c.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c.check(ctx)
		}
	}
}

func (c *Checker) check(ctx context.Context) {
	c.mu.Lock()
	if c.status.Checking {
		// 已有检查在跑（周期检查与手动"检查更新"撞车时），让调用方直接看
		// 当前状态，结果稍后由轮询拿到。
		c.mu.Unlock()
		return
	}
	c.status.Checking = true
	c.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	latest, err := LatestVersion(ctx)

	c.mu.Lock()
	defer c.mu.Unlock()
	c.status.Checking = false
	c.status.CheckedAtMs = time.Now().UnixMilli()
	if err != nil {
		c.status.Error = err.Error()
		return
	}
	c.status.Error = ""
	c.status.Latest = latest
	if cmp, ok := Compare(latest, c.current); ok && cmp > 0 {
		c.status.Available = true
	} else {
		c.status.Available = false
	}
}

// CheckNow 立即执行一次版本检查（设置页"检查更新"按钮用）。
func (c *Checker) CheckNow(ctx context.Context) {
	c.check(ctx)
}

// Status 返回当前状态快照。
func (c *Checker) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.status
}

// BeginUpgrade 标记升级开始；已有升级在进行时返回 false。
func (c *Checker) BeginUpgrade() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.status.Upgrading {
		return false
	}
	c.status.Upgrading = true
	c.status.UpgradeError = ""
	c.status.DownloadDone = 0
	c.status.DownloadTotal = 0
	return true
}

// SetDownloadProgress 记录当前升级下载的字节进度（total 0 表示未知）；
// 作为 selfupdate.ProgressFunc 传给下载器。
func (c *Checker) SetDownloadProgress(done, total int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.status.DownloadDone = done
	c.status.DownloadTotal = total
}

// EndUpgrade 结束升级标记并记录错误（err 为 nil 表示替换完成，等待重启）。
func (c *Checker) EndUpgrade(err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.status.Upgrading = false
	if err != nil {
		c.status.UpgradeError = err.Error()
	}
}

// --- 下载 / 校验 / 解压 / 替换 ------------------------------------------------

func fetch(ctx context.Context, url string) ([]byte, error) {
	// 小型清单文件（version.txt / SHA256SUMS）：60s 足够，避免卡死。
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cacheBust(url), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "hapiy-selfupdate")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, maxManifestBytes))
}

func download(ctx context.Context, url, dest string, progress ProgressFunc) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cacheBust(url), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "hapiy-selfupdate")
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	total := resp.ContentLength
	if total < 0 {
		total = 0
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()

	// 无进展看门狗：只要还在收字节就允许一直下（慢网络不掐）；连续
	// downloadStallTimeout 一个字节都没到（连接假死/半开）才取消请求。
	var lastProgress atomic.Int64
	lastProgress.Store(time.Now().UnixNano())
	var stalled atomic.Bool
	stopWatch := make(chan struct{})
	defer close(stopWatch)
	go watchStall(ctx, cancel, &lastProgress, &stalled, stopWatch)

	// 进度上报：每 200ms 最多一次，避免高频回调；结束再补一次终值。
	var done atomic.Int64
	lastReport := time.Now()
	onRead := func(n int) {
		lastProgress.Store(time.Now().UnixNano())
		d := done.Add(int64(n))
		if progress != nil && time.Since(lastReport) >= 200*time.Millisecond {
			lastReport = time.Now()
			progress(d, total)
		}
	}
	if progress != nil {
		progress(0, total)
	}

	written, err := io.Copy(f, io.LimitReader(progressReader{r: resp.Body, onRead: onRead}, maxDownloadBytes+1))
	if err != nil {
		if stalled.Load() {
			return fmt.Errorf("selfupdate: 下载中断：连续 %s 没有收到任何数据（网络假死或已断开）", downloadStallTimeout)
		}
		return err
	}
	if written > maxDownloadBytes {
		return fmt.Errorf("selfupdate: download exceeds %d bytes", int64(maxDownloadBytes))
	}
	if progress != nil {
		progress(done.Load(), total)
	}
	return f.Sync()
}

// downloadStallTimeout 是"毫无进展"的判定窗口；变量而非常量，方便测试
// 缩短。生产环境 3 分钟没有任何字节到达才中断。
var downloadStallTimeout = 3 * time.Minute

// watchStall 周期性检查最近一次收到字节的时间，超过 downloadStallTimeout
// 就取消下载并把 stalled 置位（供 download 生成可读的错误）。
func watchStall(ctx context.Context, cancel context.CancelFunc, last *atomic.Int64, stalled *atomic.Bool, stop <-chan struct{}) {
	interval := downloadStallTimeout / 3
	if interval > 10*time.Second {
		interval = 10 * time.Second
	}
	if interval < 50*time.Millisecond {
		interval = 50 * time.Millisecond
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-stop:
			return
		case <-t.C:
			if time.Since(time.Unix(0, last.Load())) > downloadStallTimeout {
				stalled.Store(true)
				cancel()
				return
			}
		}
	}
}

// progressReader 在每次读到数据后刷新"最近进展"并上报进度。
type progressReader struct {
	r      io.Reader
	onRead func(n int)
}

func (p progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	if n > 0 && p.onRead != nil {
		p.onRead(n)
	}
	return n, err
}

func cacheBust(url string) string {
	sep := "?"
	if strings.Contains(url, "?") {
		sep = "&"
	}
	return url + sep + "ts=" + strconv.FormatInt(time.Now().Unix(), 10)
}

// verifySHA256 用 SHA256SUMS 清单（`<hash>  <name>` 行）校验文件。
func verifySHA256(path, name, sums string) error {
	want := ""
	for _, line := range strings.Split(sums, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[1] == name {
			want = strings.ToLower(fields[0])
			break
		}
	}
	if want == "" {
		return fmt.Errorf("selfupdate: %s not listed in SHA256SUMS", name)
	}
	f, err := os.Open(path) // #nosec G304 -- path 来自本进程创建的临时文件
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	got := hex.EncodeToString(h.Sum(nil))
	if got != want {
		return fmt.Errorf("selfupdate: checksum mismatch for %s: got %s, want %s", name, got, want)
	}
	return nil
}

// extractArchive 解压 tar.gz 或 zip 到 dest，拒绝路径穿越条目。
func extractArchive(archivePath, dest string) error {
	if strings.HasSuffix(archivePath, ".zip") {
		return extractZip(archivePath, dest)
	}
	return extractTarGz(archivePath, dest)
}

func extractTarGz(archivePath, dest string) error {
	f, err := os.Open(archivePath) // #nosec G304 -- 本进程下载的临时文件
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		target, ok := safeJoin(dest, hdr.Name)
		if !ok {
			return fmt.Errorf("unsafe path in archive: %q", hdr.Name)
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := writeFileFromReader(target, tr, os.FileMode(hdr.Mode)|0o200); err != nil {
				return err
			}
		}
	}
}

func extractZip(archivePath, dest string) error {
	zr, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer zr.Close()
	for _, f := range zr.File {
		target, ok := safeJoin(dest, f.Name)
		if !ok {
			return fmt.Errorf("unsafe path in archive: %q", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		err = writeFileFromReader(target, rc, f.Mode()|0o200)
		_ = rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func safeJoin(dest, name string) (string, bool) {
	clean := filepath.Clean(strings.ReplaceAll(name, "\\", "/"))
	if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") {
		return "", false
	}
	target := filepath.Join(dest, clean)
	if target != dest && !strings.HasPrefix(target, dest+string(filepath.Separator)) {
		return "", false
	}
	return target, true
}

func writeFileFromReader(target string, r io.Reader, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, r); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

// replaceFile 用 src 替换 dst（同文件系统的 rename，原子）。Windows 上
// 运行中的 exe 不能直接覆盖，先把它改名为 .old（下次升级会清理）。
func replaceFile(src, dst string) error {
	if _, err := os.Stat(src); err != nil {
		return err
	}
	if err := os.Chmod(src, 0o755); err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		old := dst + ".old"
		_ = os.Remove(old)
		if _, err := os.Stat(dst); err == nil {
			if err := os.Rename(dst, old); err != nil {
				return fmt.Errorf("selfupdate: set aside old binary: %w", err)
			}
		}
	}
	if err := os.Rename(src, dst); err != nil {
		return fmt.Errorf("selfupdate: replace binary: %w", err)
	}
	return nil
}

// replaceDir 用 src 替换 dst 目录；失败时尽力还原旧目录。
func replaceDir(src, dst string) error {
	old := dst + ".old"
	_ = os.RemoveAll(old)
	if dirExists(dst) {
		if err := os.Rename(dst, old); err != nil {
			return fmt.Errorf("selfupdate: set aside old webdist dir: %w", err)
		}
	}
	if err := os.Rename(src, dst); err != nil {
		_ = os.Rename(old, dst)
		return fmt.Errorf("selfupdate: replace webdist dir: %w", err)
	}
	_ = os.RemoveAll(old)
	return nil
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
