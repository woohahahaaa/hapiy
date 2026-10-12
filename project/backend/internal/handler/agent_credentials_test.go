package handler

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// TestUpsertCredentialRef 锁定凭据文档的三种布局处理：空文件写 version 1 +
// refs；version 1 文档写 refs.<name> 且其余内容/注释保留；旧扁平布局保持扁平
// （dsh 启动时会自行迁移）。dsh 的解析器拒绝无法识别的文档，所以非映射文档
// 必须报错而不是覆盖。
func TestUpsertCredentialRef(t *testing.T) {
	fresh, err := upsertCredentialRef("", "HAPIY_API_KEY", "sk-1")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"version: 1", "refs:", "HAPIY_API_KEY: sk-1"} {
		if !strings.Contains(fresh, want) {
			t.Fatalf("fresh document missing %q:\n%s", want, fresh)
		}
	}

	existing := "# my keys\nversion: 1\nrefs:\n  OTHER_KEY: sk-old\nrecords:\n  client-connection/browser-session:\n    kind: grant\n"
	updated, err := upsertCredentialRef(existing, "HAPIY_API_KEY", "sk-2")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"# my keys", "OTHER_KEY: sk-old", "HAPIY_API_KEY: sk-2", "client-connection/browser-session"} {
		if !strings.Contains(updated, want) {
			t.Fatalf("versioned document missing %q:\n%s", want, updated)
		}
	}

	// 已存在的引用原地替换，不追加重复键。
	replaced, err := upsertCredentialRef(updated, "HAPIY_API_KEY", "sk-3")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(replaced, "HAPIY_API_KEY") != 1 || !strings.Contains(replaced, "sk-3") {
		t.Fatalf("existing ref must be replaced in place:\n%s", replaced)
	}

	flat, err := upsertCredentialRef("DEEPSEEK_API_KEY: sk-plain\n", "HAPIY_API_KEY", "sk-4")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(flat, "version:") || strings.Contains(flat, "refs:") {
		t.Fatalf("flat layout must stay flat:\n%s", flat)
	}
	for _, want := range []string{"DEEPSEEK_API_KEY: sk-plain", "HAPIY_API_KEY: sk-4"} {
		if !strings.Contains(flat, want) {
			t.Fatalf("flat document missing %q:\n%s", want, flat)
		}
	}

	if _, err := upsertCredentialRef("- not\n- a\n- mapping\n", "HAPIY_API_KEY", "sk-5"); err == nil {
		t.Fatal("non-mapping document must be refused, not overwritten")
	}
	if _, err := upsertCredentialRef("", "not-a-ref!", "sk-6"); err == nil {
		t.Fatal("invalid reference name must be refused")
	}
	if _, err := upsertCredentialRef("", "HAPIY_API_KEY", ""); err == nil {
		t.Fatal("empty credential value must be refused")
	}
}

// TestResolveConfigDirPath: 凭据路径以配置文件目录为基准，Windows 反斜杠
// 记录路径在 macOS 上也要正确切分（本地 windows 目标场景）。
func TestResolveConfigDirPath(t *testing.T) {
	cases := []struct {
		configPath string
		template   string
		want       string
	}{
		{`/home/u/.dsh/profiles/desktop/cordis.patch.yml`, `{config_dir}/../../.credentials.yaml`, `/home/u/.dsh/profiles/desktop/../../.credentials.yaml`},
		{`C:\Users\u\.dsh\profiles\desktop\cordis.patch.yml`, `{config_dir}\..\..\.credentials.yaml`, `C:\Users\u\.dsh\profiles\desktop\..\..\.credentials.yaml`},
		{`cordis.patch.yml`, `{config_dir}/../../.credentials.yaml`, `./../../.credentials.yaml`},
		{`/x/cordis.patch.yml`, ``, ``},
	}
	for _, c := range cases {
		if got := resolveConfigDirPath(c.configPath, c.template); got != c.want {
			t.Fatalf("resolveConfigDirPath(%q, %q) = %q, want %q", c.configPath, c.template, got, c.want)
		}
	}
}

// TestManagedSyncWritesCredentialStore 端到端：dsh（Desktop）规则声明了凭据库，
// 托管同步必须把弹窗选的令牌写进 <DSH_HOME>/.credentials.yaml 的 refs 里 ——
// 生成的块只放 apiKeyEnv 引用，凭据库缺条目时 dsh 请求报 MISSING_CREDENTIAL。
// 第二次同步换令牌时，用户已有的其他引用 / records / 注释都要保留。
func TestManagedSyncWritesCredentialStore(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	if err := model.EnsureDefaultAgentTypes(db); err != nil {
		t.Fatal(err)
	}

	// DSH_HOME = dir；profile 补丁在 <DSH_HOME>/profiles/desktop/ 下，
	// 凭据库按规则的 {config_dir}/../../ 落在 dir 里（不碰真实 home）。
	home := t.TempDir()
	path := filepath.Join(home, "profiles", "desktop", "cordis.patch.yml")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("# keep\n[]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	file := model.AgentConfigFile{
		RecordName: "dsh-creds", AgentType: "DeepSeek Harness (Desktop)",
		Mode: "local", TargetOS: "mac", Path: path,
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	p := model.Provider{Name: "HAPIY-A", Endpoints: `[{"pathSuffix":"/v1/chat/completions"}]`, Models: `[{"model":"gpt-x"}]`, Keys: `["sk-a"]`}
	if err := db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	modelsDev.mu.Lock()
	modelsDev.cached = &modelsDevSnapshot{fetchedAt: time.Now()}
	modelsDev.mu.Unlock()

	r := newRouterForManaged(db)
	create := func(token string) string {
		t.Helper()
		body := `{"name":"hapiy","provider_ids":["` + p.ID + `"],"api_key":"` + token + `","groups":[{"endpoint":"/v1/chat/completions","suffix":"_c","model_sources":{"gpt-x":"OpenRouter"}}]}`
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/agent-config-files/"+file.ID+"/managed-providers", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		if w.Code != 201 {
			t.Fatalf("create: %d %s", w.Code, w.Body.String())
		}
		return managedProviderID(db)
	}
	sync := func(mid string) {
		t.Helper()
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/agent-config-files/"+file.ID+"/managed-providers/"+mid+"/sync", nil)
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("sync: %d %s", w.Code, w.Body.String())
		}
	}
	update := func(mid, token string) {
		t.Helper()
		body := `{"name":"hapiy","provider_ids":["` + p.ID + `"],"api_key":"` + token + `","groups":[{"endpoint":"/v1/chat/completions","suffix":"_c","model_sources":{"gpt-x":"OpenRouter"}}]}`
		w := httptest.NewRecorder()
		req := httptest.NewRequest("PUT", "/agent-config-files/"+file.ID+"/managed-providers/"+mid, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("update: %d %s", w.Code, w.Body.String())
		}
	}
	readCred := func() string {
		t.Helper()
		data, err := os.ReadFile(filepath.Join(home, ".credentials.yaml"))
		if err != nil {
			t.Fatalf("credentials document: %v", err)
		}
		return string(data)
	}

	mid := create("sk-token-1")
	sync(mid)

	config, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(config), "apiKeyEnv: HAPIY_API_KEY") {
		t.Fatalf("config must reference the credential:\n%s", config)
	}
	cred := readCred()
	for _, want := range []string{"version: 1", "HAPIY_API_KEY: sk-token-1"} {
		if !strings.Contains(cred, want) {
			t.Fatalf("fresh credential document missing %q:\n%s", want, cred)
		}
	}
	// dsh 拒绝组/其他用户可读的凭据文档（mode 必须无 0o077 位）。
	if info, err := os.Stat(filepath.Join(home, ".credentials.yaml")); err != nil {
		t.Fatal(err)
	} else if perm := info.Mode().Perm(); perm&0o077 != 0 {
		t.Fatalf("credential document must stay owner-only, got mode %o", perm)
	}

	// 用户已有凭据库：换令牌重存，其余内容（其他引用 / records / 注释）保留。
	existing := "# mine\nversion: 1\nrefs:\n  OTHER_KEY: sk-keep\nrecords:\n  client-connection/browser-session:\n    kind: grant\n    payload:\n      v: 1\n"
	if err := os.WriteFile(filepath.Join(home, ".credentials.yaml"), []byte(existing), 0o600); err != nil {
		t.Fatal(err)
	}
	update(mid, "sk-token-2")
	sync(mid)
	cred = readCred()
	for _, want := range []string{"# mine", "OTHER_KEY: sk-keep", "HAPIY_API_KEY: sk-token-2", "client-connection/browser-session"} {
		if !strings.Contains(cred, want) {
			t.Fatalf("existing credential document lost %q:\n%s", want, cred)
		}
	}
	if strings.Contains(cred, "sk-token-1") {
		t.Fatalf("rotated credential must replace the old value:\n%s", cred)
	}
}
