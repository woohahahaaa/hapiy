package service

import (
	"crypto/ed25519"
	"crypto/rand"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// fakeSSHServer is a minimal in-process SSH server good enough for the
// remote-file helpers: it accepts password auth and answers every exec with a
// fixed stdout body + exit status 0. It counts dials and tracks live
// connections so the tests can pin pooling, idle eviction and recovery from a
// connection the peer dropped.
type fakeSSHServer struct {
	addr     string
	port     int
	body     string
	dials    int32
	mu       sync.Mutex
	conns    map[net.Conn]bool
	listener net.Listener
}

func startFakeSSHServer(t *testing.T, body string) *fakeSSHServer {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	config := &ssh.ServerConfig{
		PasswordCallback: func(ssh.ConnMetadata, []byte) (*ssh.Permissions, error) { return nil, nil },
	}
	config.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	srv := &fakeSSHServer{addr: ln.Addr().String(), port: port, body: body, conns: map[net.Conn]bool{}, listener: ln}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			atomic.AddInt32(&srv.dials, 1)
			srv.track(conn, true)
			go srv.serve(conn, config)
		}
	}()
	t.Cleanup(func() {
		_ = ln.Close()
		srv.dropConnections()
	})
	return srv
}

func (s *fakeSSHServer) track(conn net.Conn, open bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if open {
		s.conns[conn] = true
		return
	}
	delete(s.conns, conn)
}

func (s *fakeSSHServer) dropConnections() {
	s.mu.Lock()
	open := make([]net.Conn, 0, len(s.conns))
	for conn := range s.conns {
		open = append(open, conn)
	}
	s.conns = map[net.Conn]bool{}
	s.mu.Unlock()
	for _, conn := range open {
		_ = conn.Close()
	}
}

func (s *fakeSSHServer) liveConnections() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.conns)
}

func (s *fakeSSHServer) serve(conn net.Conn, config *ssh.ServerConfig) {
	defer s.track(conn, false)
	serverConn, chans, reqs, err := ssh.NewServerConn(conn, config)
	if err != nil {
		_ = conn.Close()
		return
	}
	defer serverConn.Close()
	go ssh.DiscardRequests(reqs)
	for newCh := range chans {
		if newCh.ChannelType() != "session" {
			_ = newCh.Reject(ssh.UnknownChannelType, "unsupported")
			continue
		}
		ch, chReqs, err := newCh.Accept()
		if err != nil {
			continue
		}
		go func() {
			for req := range chReqs {
				if req.Type != "exec" {
					_ = req.Reply(false, nil)
					continue
				}
				_ = req.Reply(true, nil)
				// 写入路径会带 stdin：先把 stdin 读完（客户端 CloseWrite 后
				// 得到 EOF），再回 stdout + exit-status；反过来写会让客户端
				// 撞在已关闭的 channel 上拿到 EOF。
				_, _ = io.Copy(io.Discard, ch)
				_, _ = ch.Write([]byte(s.body))
				_, _ = ch.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{0}))
				_ = ch.Close()
			}
		}()
	}
}

func (s *fakeSSHServer) config(password string) SshConfig {
	return SshConfig{
		Host: "127.0.0.1", Port: s.port,
		Username: "tester", AuthType: "password", Password: password,
	}
}

// TestReadRemoteFileReusesOneConnection pins the reason the pool exists:
// 「管理模型」一次要读同一个远端文件三遍，三次调用只能有一次握手。
func TestReadRemoteFileReusesOneConnection(t *testing.T) {
	srv := startFakeSSHServer(t, "remote-content")
	cfg := srv.config("secret")

	for i := 0; i < 3; i++ {
		content, err := ReadRemoteFile(cfg, "/tmp/target.yml", "mac")
		if err != nil {
			t.Fatalf("read %d: %v", i, err)
		}
		if content != "remote-content" {
			t.Fatalf("read %d: unexpected content %q", i, content)
		}
	}
	if got := atomic.LoadInt32(&srv.dials); got != 1 {
		t.Fatalf("three reads must share one SSH connection, dialed %d times", got)
	}
}

// TestSSHWriteAndReadShareConnection covers the other pooled caller.
func TestSSHWriteAndReadShareConnection(t *testing.T) {
	srv := startFakeSSHServer(t, "content")
	cfg := srv.config("secret")

	if err := WriteRemoteFileAtomic(cfg, "/tmp/target.yml", "new\n", "mac"); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := ReadRemoteFileIfExists(cfg, "/tmp/target.yml", "mac"); err != nil {
		t.Fatalf("read: %v", err)
	}
	if got := atomic.LoadInt32(&srv.dials); got != 1 {
		t.Fatalf("write + read must share one connection, dialed %d times", got)
	}
}

// TestSSHPoolRecoversFromDroppedConnection: 空闲被对端关掉的连接不能让读取
// 失败 —— 丢弃死连接、重拨一次，用户无感。
func TestSSHPoolRecoversFromDroppedConnection(t *testing.T) {
	srv := startFakeSSHServer(t, "after-drop")
	cfg := srv.config("secret")

	if _, err := ReadRemoteFile(cfg, "/tmp/target.yml", "mac"); err != nil {
		t.Fatalf("first read: %v", err)
	}
	srv.dropConnections()

	content, err := ReadRemoteFile(cfg, "/tmp/target.yml", "mac")
	if err != nil {
		t.Fatalf("read after the peer dropped the connection: %v", err)
	}
	if content != "after-drop" {
		t.Fatalf("unexpected content %q", content)
	}
	if got := atomic.LoadInt32(&srv.dials); got != 2 {
		t.Fatalf("recovery must redial once, dialed %d times", got)
	}
}

// TestSSHPoolClosesIdleConnections: 没人再用的连接按 TTL 自动关闭。
func TestSSHPoolClosesIdleConnections(t *testing.T) {
	oldTTL := sshPoolIdleTTL
	sshPoolIdleTTL = 40 * time.Millisecond
	t.Cleanup(func() { sshPoolIdleTTL = oldTTL })

	srv := startFakeSSHServer(t, "idle")
	cfg := srv.config("secret")

	if _, err := ReadRemoteFile(cfg, "/tmp/target.yml", "mac"); err != nil {
		t.Fatalf("read: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for srv.liveConnections() > 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := srv.liveConnections(); got != 0 {
		t.Fatalf("idle connection must be closed, %d still open", got)
	}
	if _, err := ReadRemoteFile(cfg, "/tmp/target.yml", "mac"); err != nil {
		t.Fatalf("read after eviction: %v", err)
	}
	if got := atomic.LoadInt32(&srv.dials); got != 2 {
		t.Fatalf("evicted connection must be redialed, dialed %d times", got)
	}
}

// TestSSHConnKeyTracksConnectionParameters: 改了主机 / 用户 / 密码 / 密钥
// 就是另一把钥匙，绝不能复用旧连接（否则旧凭据下的连接会继续被使用）。
func TestSSHConnKeyTracksConnectionParameters(t *testing.T) {
	base := SshConfig{Host: "host-a", Port: 22, Username: "woo", AuthType: "password", Password: "p1"}
	key := sshConnKey(base)
	if sshConnKey(base) != key {
		t.Fatal("key must be stable for identical configs")
	}
	variants := map[string]SshConfig{
		"host":     {Host: "host-b", Port: 22, Username: "woo", AuthType: "password", Password: "p1"},
		"port":     {Host: "host-a", Port: 2222, Username: "woo", AuthType: "password", Password: "p1"},
		"user":     {Host: "host-a", Port: 22, Username: "other", AuthType: "password", Password: "p1"},
		"password": {Host: "host-a", Port: 22, Username: "woo", AuthType: "password", Password: "p2"},
		"key":      {Host: "host-a", Port: 22, Username: "woo", AuthType: "key", PrivateKey: "PEM"},
		"jump":     {Host: "host-a", Port: 22, Username: "woo", AuthType: "password", Password: "p1", JumpEnabled: true, JumpHost: "jump"},
	}
	for name, cfg := range variants {
		if sshConnKey(cfg) == key {
			t.Fatalf("%s change must produce a different key", name)
		}
	}
}
