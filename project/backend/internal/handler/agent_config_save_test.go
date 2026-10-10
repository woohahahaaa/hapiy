package handler

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// TestAgentConfigFileSaveIgnoresUnreadableTarget 回归两件事：
//  1. 保存时读取只是内容缓存，目标文件不存在/读不到不再拒绝保存（连通性与
//     路径校验由「测试 SSH 读写能力」按钮负责）；
//  2. 更新接口曾先加密凭据再拨号读取，导致每次保存都以
//     “读取失败: unable to authenticate” 失败 —— 加密必须发生在读取之后。
func TestAgentConfigFileSaveIgnoresUnreadableTarget(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	key := bytes.Repeat([]byte{1}, 32)
	r.POST("/files", CreateAgentConfigFile(db, key))
	r.PUT("/files/:id", UpdateAgentConfigFile(db, key))

	missing := filepath.Join(t.TempDir(), "missing.json")
	createBody, _ := json.Marshal(map[string]any{
		"record_name": "missing-file",
		"agent_type":  "opencode-v1",
		"mode":        "local",
		"target_os":   "mac",
		"path":        missing,
	})
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/files", bytes.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("create with unreadable target must still save: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Data model.AgentConfigFile `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	var row model.AgentConfigFile
	if err := db.First(&row, "id = ?", created.Data.ID).Error; err != nil {
		t.Fatal(err)
	}
	if row.Content != "" {
		t.Fatalf("failed read must cache an empty body, got %q", row.Content)
	}

	// 更新：文件依然读不到，但记录必须保存成功，且沿用上一次的内容缓存。
	row.Content = "cached-before"
	if err := db.Save(&row).Error; err != nil {
		t.Fatal(err)
	}
	updateBody, _ := json.Marshal(map[string]any{
		"record_name": "missing-file",
		"agent_type":  "opencode-v1",
		"mode":        "local",
		"target_os":   "mac",
		"path":        filepath.Join(t.TempDir(), "still-missing.json"),
	})
	w = httptest.NewRecorder()
	req = httptest.NewRequest("PUT", "/files/"+created.Data.ID, bytes.NewReader(updateBody))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("update with unreadable target must still save: %d %s", w.Code, w.Body.String())
	}
	var updated model.AgentConfigFile
	if err := db.First(&updated, "id = ?", created.Data.ID).Error; err != nil {
		t.Fatal(err)
	}
	if updated.Content != "cached-before" {
		t.Fatalf("failed update read must keep the previous cache, got %q", updated.Content)
	}
}

// TestAgentConfigFileSaveKeepsYAMLVerbatim 回归：保存内容时只有 JSON 系文件
// 才重新缩进/校验；YAML（dsh 的 cordis.patch.yml）按原文写盘 —— 此前所有内容
// 都被按 JSON 重排，YAML 直接报“JSON 格式化失败”，注释也会被丢掉。
func TestAgentConfigFileSaveKeepsYAMLVerbatim(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	key := bytes.Repeat([]byte{1}, 32)
	r.POST("/files", CreateAgentConfigFile(db, key))
	r.PUT("/files/:id/content", PutAgentConfigFileContent(db, key))

	dir := t.TempDir()
	yamlPath := filepath.Join(dir, "cordis.patch.yml")
	if err := os.WriteFile(yamlPath, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	createBody, _ := json.Marshal(map[string]any{
		"record_name": "yaml-file",
		"agent_type":  "DeepSeek Harness (Desktop)",
		"mode":        "local",
		"target_os":   "mac",
		"path":        yamlPath,
	})
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/files", bytes.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Data model.AgentConfigFile `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	yaml := "# comment\n- id: llm-pi-ai\n  config:\n    providers:\n      hapiy:\n        api: openai-completions\n"
	putBody, _ := json.Marshal(map[string]any{"content": yaml})
	w = httptest.NewRecorder()
	req = httptest.NewRequest("PUT", "/files/"+created.Data.ID+"/content", bytes.NewReader(putBody))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("yaml save must not be forced through JSON: %d %s", w.Code, w.Body.String())
	}
	onDisk, err := os.ReadFile(yamlPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != yaml {
		t.Fatalf("yaml must be written verbatim, got %q", string(onDisk))
	}

	// 对照：JSON 文件仍会重新缩进；非法 JSON 仍被拒绝。
	jsonPath := filepath.Join(dir, "config.json")
	if err := os.WriteFile(jsonPath, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	createBody, _ = json.Marshal(map[string]any{
		"record_name": "json-file",
		"agent_type":  "opencode-v1",
		"mode":        "local",
		"target_os":   "mac",
		"path":        jsonPath,
	})
	w = httptest.NewRecorder()
	req = httptest.NewRequest("POST", "/files", bytes.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("create json record: %d %s", w.Code, w.Body.String())
	}
	var jsonRecord struct {
		Data model.AgentConfigFile `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &jsonRecord); err != nil {
		t.Fatal(err)
	}
	putBody, _ = json.Marshal(map[string]any{"content": `{"a":1}`})
	w = httptest.NewRecorder()
	req = httptest.NewRequest("PUT", "/files/"+jsonRecord.Data.ID+"/content", bytes.NewReader(putBody))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("json save: %d %s", w.Code, w.Body.String())
	}
	onDisk, err = os.ReadFile(jsonPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != "{\n  \"a\": 1\n}\n" {
		t.Fatalf("json must be re-indented, got %q", string(onDisk))
	}

	putBody, _ = json.Marshal(map[string]any{"content": "{not json"})
	w = httptest.NewRecorder()
	req = httptest.NewRequest("PUT", "/files/"+jsonRecord.Data.ID+"/content", bytes.NewReader(putBody))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != 400 {
		t.Fatalf("invalid json must still be rejected, got %d %s", w.Code, w.Body.String())
	}
}
