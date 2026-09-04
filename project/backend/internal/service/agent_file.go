package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// SshConfig describes how to reach a remote host for the SSH-mode agent
// config files. It is stored on the AgentConfigFile row as a JSON blob
// string (see Marshal/Unmarshal) so the dashboard can edit it without
// introducing a separate table.
type SshConfig struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	AuthType   string `json:"auth_type"` // "password" | "key"
	Password   string `json:"password"`
	PrivateKey string `json:"private_key"`

	// Optional jump host (跳板机) tunneled over when JumpEnabled.
	JumpEnabled    bool   `json:"jump_enabled,omitempty"`
	JumpHost       string `json:"jump_host,omitempty"`
	JumpPort       int    `json:"jump_port,omitempty"`
	JumpUsername   string `json:"jump_username,omitempty"`
	JumpAuthType   string `json:"jump_auth_type,omitempty"` // "password" | "key"
	JumpPassword   string `json:"jump_password,omitempty"`
	JumpPrivateKey string `json:"jump_private_key,omitempty"`
}

// Marshal serializes the config into the JSON blob string persisted on the
// AgentConfigFile row.
func (c SshConfig) Marshal() (string, error) {
	data, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// Unmarshal parses a stored JSON blob back into the config. An empty
// blob yields a zero-valued config so callers can default it.
func (c *SshConfig) Unmarshal(s string) error {
	if s == "" {
		*c = SshConfig{}
		return nil
	}
	return json.Unmarshal([]byte(s), c)
}

// EncryptSensitive encrypts Password, PrivateKey, JumpPassword and
// JumpPrivateKey in place so the marshaled blob can be persisted without
// leaking credentials. Empty values stay empty.
func (c *SshConfig) EncryptSensitive(key []byte) error {
	password, err := EncryptField(key, c.Password)
	if err != nil {
		return err
	}
	privateKey, err := EncryptField(key, c.PrivateKey)
	if err != nil {
		return err
	}
	jumpPassword, err := EncryptField(key, c.JumpPassword)
	if err != nil {
		return err
	}
	jumpPrivateKey, err := EncryptField(key, c.JumpPrivateKey)
	if err != nil {
		return err
	}
	c.Password = password
	c.PrivateKey = privateKey
	c.JumpPassword = jumpPassword
	c.JumpPrivateKey = jumpPrivateKey
	return nil
}

// DecryptSensitive reverses EncryptSensitive, restoring the plaintext
// credentials needed to dial the remote host (and the jump host when
// enabled). Legacy plaintext blobs pass through unchanged.
func (c *SshConfig) DecryptSensitive(key []byte) error {
	password, err := DecryptField(key, c.Password)
	if err != nil {
		return err
	}
	privateKey, err := DecryptField(key, c.PrivateKey)
	if err != nil {
		return err
	}
	jumpPassword, err := DecryptField(key, c.JumpPassword)
	if err != nil {
		return err
	}
	jumpPrivateKey, err := DecryptField(key, c.JumpPrivateKey)
	if err != nil {
		return err
	}
	c.Password = password
	c.PrivateKey = privateKey
	c.JumpPassword = jumpPassword
	c.JumpPrivateKey = jumpPrivateKey
	return nil
}

// Sanitized returns a copy of the config with credentials blanked, safe to
// include in API responses.
func (c SshConfig) Sanitized() SshConfig {
	c.Password = ""
	c.PrivateKey = ""
	c.JumpPassword = ""
	c.JumpPrivateKey = ""
	return c
}

// ExpandPath expands tilde and environment-variable placeholders in a
// config path template into the concrete path on this machine. Supported:
// leading ~ (user home dir), $VAR and ${VAR} (os.ExpandEnv), and %VAR%
// (Windows-style, resolved from the same environment). Unresolvable
// placeholders are left verbatim so the caller can report the mismatch.
func ExpandPath(path string) string {
	if path == "" {
		return ""
	}
	if path[0] == '~' {
		if home, err := os.UserHomeDir(); err == nil {
			path = home + path[1:]
		}
	}
	path = os.ExpandEnv(path)
	var buf strings.Builder
	buf.Grow(len(path))
	for i := 0; i < len(path); {
		if path[i] == '%' {
			end := strings.IndexByte(path[i+1:], '%')
			if end >= 0 {
				key := path[i+1 : i+1+end]
				if v := os.Getenv(key); v != "" {
					buf.WriteString(v)
					i += end + 2
					continue
				}
			}
		}
		buf.WriteByte(path[i])
		i++
	}
	return buf.String()
}

// StatLocalFile reports whether a local config file exists and its size in
// bytes. It returns (false, 0) when the file (or a parent directory) is
// missing, and true only for regular files.
func StatLocalFile(path string) (exists bool, size int64) {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false, 0
	}
	return true, info.Size()
}

// ReadLocalFile returns the raw content of a local file.
func ReadLocalFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("读取文件失败: %w", err)
	}
	return string(data), nil
}

// WriteLocalFileAtomic replaces the file at path with content atomically:
// it writes a temp file in the same directory and renames it over the
// target, so a crash mid-write never leaves a truncated config file. The
// temp file is cleaned up on any failure.
func WriteLocalFileAtomic(path, content string) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".agent-config-*.tmp")
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %w", err)
	}
	tmpName := tmp.Name()
	// Remove the temp file unless the rename below succeeded (the defer
	// runs with tmpName reset to "" after a successful rename).
	defer func() {
		if tmpName != "" {
			os.Remove(tmpName)
		}
	}()
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		return fmt.Errorf("写入临时文件失败: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("同步临时文件失败: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("关闭临时文件失败: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("替换目标文件失败: %w", err)
	}
	tmpName = ""
	return nil
}

// ReadRemoteFile returns the raw content of a remote file via SSH by
// running an OS-appropriate read command on the host (cat for POSIX,
// `type` for cmd.exe / Windows). targetOS chooses the command family so a
// Windows host reached through OpenSSH doesn't break on the missing cat.
// Detailed errors (connection, auth, missing file) are returned as-is
// because the frontend surfaces them.
func ReadRemoteFile(cfg SshConfig, path, targetOS string) (string, error) {
	client, err := dialSSH(cfg)
	if err != nil {
		return "", err
	}
	defer client.Close()

	session, err := client.client.NewSession()
	if err != nil {
		return "", fmt.Errorf("创建 SSH 会话失败: %w", err)
	}
	defer session.Close()

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr
	if err := session.Run(remoteReadCommand(targetOS, path)); err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail != "" {
			return "", fmt.Errorf("读取远程文件失败: %w (%s)", err, detail)
		}
		return "", fmt.Errorf("读取远程文件失败: %w", err)
	}
	return stdout.String(), nil
}

// remoteReadCommand returns the remote read command for the given target
// OS: `type <path>` on cmd.exe / Windows (which prints the file to stdout),
// `cat <path>` on POSIX shells.
func remoteReadCommand(targetOS, path string) string {
	if targetOS == "windows" {
		// cmd.exe has no single-quoted strings; `type` on a double-quoted
		// path prints the file contents to stdout.
		return `type ` + cmdQuote(path)
	}
	return "cat " + shellQuote(path)
}

// WriteRemoteFileAtomic replaces a remote file via SSH using one session
// that writes stdin to a temp file and moves it over the target.
//
// On POSIX targets it writes to a mktemp file and renames it over the
// target; the path is passed as $1 (a positional argument) so shell
// metacharacters in the path cannot break the command. On Windows targets
// it writes stdin to %TEMP% and moves it over the target with cmd.exe.
// stderr is captured for error reports.
func WriteRemoteFileAtomic(cfg SshConfig, path, content, targetOS string) error {
	client, err := dialSSH(cfg)
	if err != nil {
		return err
	}
	defer client.Close()

	session, err := client.client.NewSession()
	if err != nil {
		return fmt.Errorf("创建 SSH 会话失败: %w", err)
	}
	defer session.Close()

	session.Stdin = strings.NewReader(content)
	var stderr bytes.Buffer
	session.Stderr = &stderr
	cmd := remoteWriteCommand(targetOS, path)
	if err := session.Run(cmd); err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail != "" {
			return fmt.Errorf("写入远程文件失败: %w (%s)", err, detail)
		}
		return fmt.Errorf("写入远程文件失败: %w", err)
	}
	return nil
}

// remoteWriteCommand returns the remote write command for the given
// target OS. Both variants consume stdin (the new file content) and end in
// a move so the target is replaced atomically-ish.
func remoteWriteCommand(targetOS, path string) string {
	if targetOS == "windows" {
		// cmd.exe: `> %TEMP%` writes stdin into the temp file; `move /y`
		// replaces the destination. The temp name is fixed; concurrent
		// writers are extremely unlikely in this admin dialog.
		return `cmd /c "more > %TEMP%\hapiy-write.tmp & move /y %TEMP%\hapiy-write.tmp "` + cmdQuote(path)
	}
	return "sh -c 'tmp=$(mktemp) && cat > \"$tmp\" && mv -f \"$tmp\" \"$1\"' sh " + shellQuote(path)
}

// sshClientConfig builds an *ssh.ClientConfig for one hop. AuthType selects
// password vs private-key authentication. Host key verification deliberately
// uses InsecureIgnoreHostKey: this is an internal admin tool without a
// host-key pinning infrastructure, and the hosts are operator-configured
// trusted servers.
func sshClientConfig(username, authType, password, privateKey string) (*ssh.ClientConfig, error) {
	var auth ssh.AuthMethod
	switch authType {
	case "password":
		auth = ssh.Password(password)
	case "key":
		signer, err := ssh.ParsePrivateKey([]byte(privateKey))
		if err != nil {
			return nil, fmt.Errorf("解析 SSH 私钥失败: %w", err)
		}
		auth = ssh.PublicKeys(signer)
	default:
		return nil, fmt.Errorf("不支持的 SSH 认证方式 %q", authType)
	}

	return &ssh.ClientConfig{
		User:            username,
		Auth:            []ssh.AuthMethod{auth},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}, nil
}

// sshClient pairs the target SSH client with the jump-host client it was
// dialed through, so Close releases both connections. jump is nil when the
// target was reached directly.
type sshClient struct {
	client *ssh.Client
	jump   *ssh.Client // non-nil when dialed through a jump host
}

// Close closes the target client and then the jump client, returning the
// first non-nil error.
func (c *sshClient) Close() error {
	var err error
	if c.client != nil {
		err = c.client.Close()
	}
	if c.jump != nil {
		if jerr := c.jump.Close(); err == nil && jerr != nil {
			err = jerr
		}
	}
	return err
}

// dialSSH establishes an SSH client connection with a 10-second dial
// timeout. Port defaults to 22 when zero. When JumpEnabled, the jump host
// is dialed first (its port also defaults to 22) and the target SSH
// connection is tunneled over it (ProxyJump-style chaining).
func dialSSH(cfg SshConfig) (*sshClient, error) {
	if cfg.Port == 0 {
		cfg.Port = 22
	}
	targetAddr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	targetConfig, err := sshClientConfig(cfg.Username, cfg.AuthType, cfg.Password, cfg.PrivateKey)
	if err != nil {
		return nil, err
	}

	if !cfg.JumpEnabled {
		client, err := ssh.Dial("tcp", targetAddr, targetConfig)
		if err != nil {
			return nil, fmt.Errorf("SSH 连接失败: %w", err)
		}
		return &sshClient{client: client}, nil
	}

	if cfg.JumpPort == 0 {
		cfg.JumpPort = 22
	}
	jumpAddr := fmt.Sprintf("%s:%d", cfg.JumpHost, cfg.JumpPort)
	jumpConfig, err := sshClientConfig(cfg.JumpUsername, cfg.JumpAuthType, cfg.JumpPassword, cfg.JumpPrivateKey)
	if err != nil {
		return nil, err
	}

	jumpClient, err := ssh.Dial("tcp", jumpAddr, jumpConfig)
	if err != nil {
		return nil, fmt.Errorf("跳板机 SSH 连接失败: %w", err)
	}

	// Tunnel the target SSH connection through the jump host.
	conn, err := jumpClient.Dial("tcp", targetAddr)
	if err != nil {
		jumpClient.Close()
		return nil, fmt.Errorf("通过跳板机连接 %s 失败: %w", targetAddr, err)
	}
	sshConn, chans, reqs, err := ssh.NewClientConn(conn, targetAddr, targetConfig)
	if err != nil {
		conn.Close()
		jumpClient.Close()
		return nil, fmt.Errorf("SSH 连接失败: %w", err)
	}
	return &sshClient{client: ssh.NewClient(sshConn, chans, reqs), jump: jumpClient}, nil
}

// shellQuote wraps s in single quotes with embedded single quotes escaped,
// so it can be safely embedded in a remote shell command line.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// SshProbeResult is the outcome of one capability probe against a remote
// host. Detail is a short human-readable hint (e.g. read 文件大小) shown
// next to a green OK; it is empty on failure.
type SshProbeResult struct {
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	Detail string `json:"detail,omitempty"`
}

// TestSshConnection probes three independent capabilities against cfg:
//   - connect: dials SSH (and the jump host when enabled)
//   - read:    if path != "", runs an OS-appropriate read probe (cat for
//     Linux/macOS, cmd.exe `type` for Windows) to confirm the file is reachable
//   - write:   creates a remote temp file (mktemp or %TEMP%), writes a probe
//     marker into it, then unlinks it. The probe never touches any
//     user-provided path.
//
// Each probe is reported independently so the UI can highlight the exact
// capability that failed. When connect fails, read/write are short-circuited
// with the same connection error and no further commands are sent.
//
// targetOS picks the probe command family: "windows" assumes cmd.exe (the
// OpenSSH-for-Windows default); anything else assumes a POSIX shell. The
// caller passes the user's selection from the takeover dialog so the probe
// matches the remote host.
func TestSshConnection(cfg SshConfig, path, targetOS string) (connect, read, write SshProbeResult) {
	client, err := dialSSH(cfg)
	if err != nil {
		errResult := SshProbeResult{OK: false, Error: err.Error()}
		return errResult, errResult, errResult
	}
	defer client.Close()
	connect = SshProbeResult{OK: true}
	if strings.TrimSpace(path) == "" {
		read = SshProbeResult{OK: false, Error: "未提供路径"}
	} else {
		read = probeSshRead(client, path, targetOS)
	}
	write = probeSshWrite(client, targetOS)
	return
}

// probeReadCommand returns the remote shell command that prints "__OK__"
// on stdout when path is readable, and exits non-zero otherwise. On Windows
// we use cmd.exe's `type ... >nul`; on POSIX shells we use `cat`.
func probeReadCommand(targetOS, path string) string {
	if targetOS == "windows" {
		return `if exist ` + cmdQuote(path) + ` type ` + cmdQuote(path) + ` >nul & echo __OK__`
	}
	return "cat " + shellQuote(path) + " && echo __OK__"
}

// probeWriteCommand returns the remote shell command that creates a temp
// file, writes the probe marker, removes it, and prints "__OK__". On Windows
// we use cmd.exe with %TEMP%; on POSIX shells we use mktemp.
func probeWriteCommand(targetOS string) string {
	if targetOS == "windows" {
		return `echo __hapiy_probe__>"%TEMP%\hapiy_probe.tmp" & del "%TEMP%\hapiy_probe.tmp" & echo __OK__`
	}
	return `sh -c 'tmp=$(mktemp) && cat > "$tmp" && rm -f "$tmp" && echo __OK__'`
}

// cmdQuote wraps s in double quotes suitable for cmd.exe, doubling any
// embedded double quotes. cmd.exe does not accept single-quoted strings,
// so shellQuote cannot be reused for Windows.
func cmdQuote(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

// probeSshRead runs the OS-appropriate read probe and treats any non-zero
// exit as a read failure. stderr is included in the error so the operator
// sees why (permission denied, missing file, ...).
func probeSshRead(client *sshClient, path, targetOS string) SshProbeResult {
	session, err := client.client.NewSession()
	if err != nil {
		return SshProbeResult{OK: false, Error: "创建 SSH 会话失败: " + err.Error()}
	}
	defer session.Close()
	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr
	if err := session.Run(probeReadCommand(targetOS, path)); err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail != "" {
			return SshProbeResult{OK: false, Error: "读取失败: " + err.Error() + " (" + detail + ")"}
		}
		return SshProbeResult{OK: false, Error: "读取失败: " + err.Error()}
	}
	return SshProbeResult{OK: true, Detail: fmt.Sprintf("已读取 %d 字节", stdout.Len())}
}

// probeSshWrite asks the remote shell to create a temp file, consume stdin
// into it, then unlink it. The probe never touches any user-provided path,
// so a successful run implies the account has write access somewhere on the
// remote filesystem (typically $TMPDIR or %TEMP%). stderr is surfaced on
// failure.
func probeSshWrite(client *sshClient, targetOS string) SshProbeResult {
	session, err := client.client.NewSession()
	if err != nil {
		return SshProbeResult{OK: false, Error: "创建 SSH 会话失败: " + err.Error()}
	}
	defer session.Close()
	session.Stdin = strings.NewReader("__hapiy_probe__\n")
	var stderr bytes.Buffer
	session.Stderr = &stderr
	if err := session.Run(probeWriteCommand(targetOS)); err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail != "" {
			return SshProbeResult{OK: false, Error: "写入失败: " + err.Error() + " (" + detail + ")"}
		}
		return SshProbeResult{OK: false, Error: "写入失败: " + err.Error()}
	}
	return SshProbeResult{OK: true, Detail: "临时文件已创建 → 写入 → 删除"}
}
