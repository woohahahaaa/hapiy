package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"github.com/tidwall/gjson"
	"gorm.io/gorm"
)

// Agent type rules ("管理规则") and config file takeover ("接管配置文件")
// handlers. All file reads/writes go through the live filesystem on every
// request — the Content column is only a display cache.

// ListAgentTypes returns the names of all agent-type rules ordered by
// creation time, for the frontend dropdown.
func ListAgentTypes(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var rules []model.AgentTypeRule
		if err := db.Order("created_at asc").Find(&rules).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		names := make([]string, 0, len(rules))
		for _, r := range rules {
			names = append(names, r.Name)
		}
		c.JSON(http.StatusOK, gin.H{"data": names})
	}
}

func ListAgentTypeRules(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		limit := parseInt(c.Query("limit"), 50)
		offset := parseInt(c.Query("offset"), 0)
		var rules []model.AgentTypeRule
		var total int64
		if err := db.Model(&model.AgentTypeRule{}).Count(&total).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := db.Order("created_at asc").Limit(limit).Offset(offset).Find(&rules).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": rules, "total": total})
	}
}

type updateAgentTypeRuleRequest struct {
	Name         string `json:"name"`
	Windows      string `json:"windows"`
	Mac          string `json:"mac"`
	ProviderPath string `json:"provider_path"`
	ModelPath    string `json:"model_path"`
}

// UpdateAgentTypeRule edits an existing rule's display name and/or its
// per-OS path templates and gjson paths. A duplicated name is rejected.
func UpdateAgentTypeRule(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var rule model.AgentTypeRule
		if err := db.First(&rule, "id = ?", c.Param("id")).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "规则不存在"})
			return
		}
		var req updateAgentTypeRuleRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if name := strings.TrimSpace(req.Name); name != "" && name != rule.Name {
			var count int64
			if err := db.Model(&model.AgentTypeRule{}).Where("name = ? AND id <> ?", name, rule.ID).Count(&count).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if count > 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "该软件类型已存在"})
				return
			}
			rule.Name = name
		}
		paths := model.AgentOsPaths{Windows: strings.TrimSpace(req.Windows), Mac: strings.TrimSpace(req.Mac)}
		if err := rule.SetOsPaths(paths); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		jpaths := model.AgentJsonPaths{
			Provider: strings.TrimSpace(req.ProviderPath),
			Model:    strings.TrimSpace(req.ModelPath),
		}
		if err := rule.SetJsonPaths(jpaths); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := db.Save(&rule).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": rule})
	}
}

func CreateAgentTypeRule(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Name         string `json:"name"`
			ProviderPath string `json:"provider_path"`
			ModelPath    string `json:"model_path"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		name := strings.TrimSpace(req.Name)
		if name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "软件类型名称不能为空"})
			return
		}
		var count int64
		if err := db.Model(&model.AgentTypeRule{}).Where("name = ?", name).Count(&count).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if count > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该软件类型已存在"})
			return
		}
		rule := model.AgentTypeRule{Name: name}
		if err := rule.SetJsonPaths(model.AgentJsonPaths{
			Provider: strings.TrimSpace(req.ProviderPath),
			Model:    strings.TrimSpace(req.ModelPath),
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := db.Create(&rule).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"data": rule})
	}
}

func DeleteAgentTypeRule(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var rule model.AgentTypeRule
		if err := db.First(&rule, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "规则不存在"})
			return
		}
		if err := db.Delete(&rule).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "rule deleted"})
	}
}

func ListAgentConfigFiles(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		limit := parseInt(c.Query("limit"), 50)
		offset := parseInt(c.Query("offset"), 0)
		var files []model.AgentConfigFile
		var total int64
		if err := db.Model(&model.AgentConfigFile{}).Count(&total).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := db.Order("updated_at desc").Limit(limit).Offset(offset).Find(&files).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// Credentials must never leave the server: replace each SSH blob
		// with its sanitized form before responding.
		for i := range files {
			if files[i].Mode != "ssh" || files[i].SshConfig == "" {
				continue
			}
			var cfg service.SshConfig
			if err := cfg.Unmarshal(files[i].SshConfig); err != nil {
				files[i].SshConfig = ""
				continue
			}
			blob, err := cfg.Sanitized().Marshal()
			if err != nil {
				files[i].SshConfig = ""
				continue
			}
			files[i].SshConfig = blob
		}
		c.JSON(http.StatusOK, gin.H{"data": files, "total": total})
	}
}

type createAgentConfigFileRequest struct {
	RecordName string          `json:"record_name"`
	AgentType  string          `json:"agent_type"`
	Mode       string          `json:"mode"`      // "local" | "ssh"
	TargetOS   string          `json:"target_os"` // "windows" | "mac" | "other"
	Path       string          `json:"path"`
	SshConfig  json.RawMessage `json:"ssh_config"`
}

func CreateAgentConfigFile(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req createAgentConfigFileRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		req.RecordName = strings.TrimSpace(req.RecordName)
		req.AgentType = strings.TrimSpace(req.AgentType)
		req.TargetOS = strings.TrimSpace(req.TargetOS)
		if req.RecordName == "" || req.AgentType == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "记录名称和软件类型不能为空"})
			return
		}
		var dupCount int64
		if err := db.Model(&model.AgentConfigFile{}).
			Where("record_name = ?", req.RecordName).
			Count(&dupCount).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if dupCount > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "记录名称已存在，请使用其他名称"})
			return
		}

		var sshCfg service.SshConfig
		switch req.Mode {
		case "local":
			// Any file extension is allowed (builtin templates include
			// .json and .toml); existence is verified by caller.
			if req.TargetOS != "windows" && req.TargetOS != "mac" && req.TargetOS != "other" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "本机系统必须是 windows、mac 或 other"})
				return
			}
		case "ssh":
			if len(req.SshConfig) == 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "SSH 配置不能为空"})
				return
			}
			if err := parseSshConfig(req.SshConfig, &sshCfg); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "SSH 配置解析失败: " + err.Error()})
				return
			}
			if msg := validateSshConfig(sshCfg); msg != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": msg})
				return
			}
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "模式必须是 local 或 ssh"})
			return
		}

		// Read-validate: refuse to store a record whose file cannot be
		// read right now, so the frontend gets immediate feedback.
		var content string
		var err error
		if req.Mode == "local" {
			content, err = service.ReadLocalFile(service.ExpandPath(req.Path))
		} else {
			content, err = service.ReadRemoteFile(sshCfg, req.Path)
		}
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "读取失败: " + err.Error()})
			return
		}

		var sshBlob string
		if req.Mode == "ssh" {
			sshBlob, err = sshCfg.Marshal()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		row := model.AgentConfigFile{
			RecordName: req.RecordName,
			AgentType:  req.AgentType,
			Mode:       req.Mode,
			TargetOS:   req.TargetOS,
			Path:       req.Path,
			SshConfig:  sshBlob,
			Content:    content,
		}
		if err := db.Create(&row).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if req.Mode == "ssh" {
			// Respond with the sanitized blob so credentials never echo back.
			var sanitized service.SshConfig
			if err := sanitized.Unmarshal(row.SshConfig); err != nil {
				row.SshConfig = ""
			} else if blob, err := sanitized.Sanitized().Marshal(); err != nil {
				row.SshConfig = ""
			} else {
				row.SshConfig = blob
			}
		}
		c.JSON(http.StatusCreated, gin.H{"data": row})
	}
}

func GetAgentConfigFileContent(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		var row model.AgentConfigFile
		if err := db.First(&row, "id = ?", c.Param("id")).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "配置不存在"})
			return
		}
		content, err := readAgentConfigFileContent(&row, key)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "读取失败: " + err.Error()})
			return
		}
		if err := db.Model(&row).Update("content", content).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"content": content}})
	}
}

func PutAgentConfigFileContent(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		var row model.AgentConfigFile
		if err := db.First(&row, "id = ?", c.Param("id")).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "配置不存在"})
			return
		}
		var req struct {
			Content string `json:"content"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := writeAgentConfigFileContent(&row, req.Content, key); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "保存失败: " + err.Error()})
			return
		}
		if err := db.Model(&row).Update("content", req.Content).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
	}
}

func DeleteAgentConfigFile(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := db.Delete(&model.AgentConfigFile{}, "id = ?", c.Param("id")).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "deleted"})
	}
}

type updateAgentConfigFileRequest createAgentConfigFileRequest

func UpdateAgentConfigFile(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		var row model.AgentConfigFile
		if err := db.First(&row, "id = ?", c.Param("id")).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "配置不存在"})
			return
		}
		var req updateAgentConfigFileRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		req.RecordName = strings.TrimSpace(req.RecordName)
		req.AgentType = strings.TrimSpace(req.AgentType)
		req.TargetOS = strings.TrimSpace(req.TargetOS)
		if req.RecordName == "" || req.AgentType == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "记录名称和软件类型不能为空"})
			return
		}
		if req.RecordName != row.RecordName {
			var dupCount int64
			if err := db.Model(&model.AgentConfigFile{}).
				Where("record_name = ? AND id <> ?", req.RecordName, row.ID).
				Count(&dupCount).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if dupCount > 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "记录名称已存在，请使用其他名称"})
				return
			}
		}

		var sshCfg service.SshConfig
		switch req.Mode {
		case "local":
			if req.TargetOS != "windows" && req.TargetOS != "mac" && req.TargetOS != "other" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "本机系统必须是 windows、mac 或 other"})
				return
			}
		case "ssh":
			if len(req.SshConfig) == 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "SSH 配置不能为空"})
				return
			}
			if err := parseSshConfig(req.SshConfig, &sshCfg); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "SSH 配置解析失败: " + err.Error()})
				return
			}
			if row.Mode == "ssh" && row.SshConfig != "" {
				var existing service.SshConfig
				if err := existing.Unmarshal(row.SshConfig); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "现有 SSH 配置解析失败: " + err.Error()})
					return
				}
				if err := existing.DecryptSensitive(key); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "现有 SSH 凭据解密失败: " + err.Error()})
					return
				}
				if sshCfg.Password == "" {
					sshCfg.Password = existing.Password
				}
				if sshCfg.PrivateKey == "" {
					sshCfg.PrivateKey = existing.PrivateKey
				}
				if sshCfg.JumpPassword == "" {
					sshCfg.JumpPassword = existing.JumpPassword
				}
				if sshCfg.JumpPrivateKey == "" {
					sshCfg.JumpPrivateKey = existing.JumpPrivateKey
				}
			}
			if msg := validateSshConfig(sshCfg); msg != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": msg})
				return
			}
			if err := sshCfg.EncryptSensitive(key); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "SSH 凭据加密失败: " + err.Error()})
				return
			}
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "模式必须是 local 或 ssh"})
			return
		}

		var content string
		var err error
		if req.Mode == "local" {
			content, err = service.ReadLocalFile(service.ExpandPath(req.Path))
		} else {
			content, err = service.ReadRemoteFile(sshCfg, req.Path)
		}
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "读取失败: " + err.Error()})
			return
		}

		var sshBlob string
		if req.Mode == "ssh" {
			if err := sshCfg.EncryptSensitive(key); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "SSH 凭据加密失败: " + err.Error()})
				return
			}
			sshBlob, err = sshCfg.Marshal()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		row.RecordName = req.RecordName
		row.AgentType = req.AgentType
		row.Mode = req.Mode
		row.TargetOS = req.TargetOS
		row.Path = req.Path
		row.SshConfig = sshBlob
		row.Content = content
		if err := db.Save(&row).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if row.Mode == "ssh" {
			var sanitized service.SshConfig
			if err := sanitized.Unmarshal(row.SshConfig); err != nil {
				row.SshConfig = ""
			} else if blob, err := sanitized.Sanitized().Marshal(); err != nil {
				row.SshConfig = ""
			} else {
				row.SshConfig = blob
			}
		}
		c.JSON(http.StatusOK, gin.H{"data": row})
	}
}

// CheckAgentConfigPath stats a local config path (with ~/$VAR/%VAR%
// placeholders expanded) and reports existence, size, and the OS the
// backend runs on. Used by the takeover dialog to validate paths before a
// record is created.
func CheckAgentConfigPath() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := strings.TrimSpace(c.Query("path"))
		if raw == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 path 参数"})
			return
		}
		expanded := service.ExpandPath(raw)
		exists, size := service.StatLocalFile(expanded)
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"exists":       exists,
			"size":         size,
			"current_os":   runtime.GOOS,
			"expandedPath": expanded,
		}})
	}
}

// ReadAgentConfigPath returns the content of a local file at an expanded
// path. It mirrors GetAgentConfigFileContent but works without a stored
// record, so the takeover dialog can preview a file before saving.
func ReadAgentConfigPath() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := strings.TrimSpace(c.Query("path"))
		if raw == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 path 参数"})
			return
		}
		content, err := service.ReadLocalFile(service.ExpandPath(raw))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "读取失败: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"content": content}})
	}
}

// parseSshConfig accepts the ssh_config field either as a JSON object or
// as a pre-serialized JSON string blob (both match how the field is
// persisted on the row).
func parseSshConfig(raw json.RawMessage, cfg *service.SshConfig) error {
	if len(raw) == 0 {
		return nil
	}
	if raw[0] == '"' {
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return err
		}
		return cfg.Unmarshal(s)
	}
	return json.Unmarshal(raw, cfg)
}

// validateSshConfig returns a Chinese error message when the config is
// incomplete, or "" when it is usable.
func validateSshConfig(cfg service.SshConfig) string {
	if strings.TrimSpace(cfg.Host) == "" {
		return "SSH 主机地址不能为空"
	}
	if strings.TrimSpace(cfg.Username) == "" {
		return "SSH 用户名不能为空"
	}
	switch cfg.AuthType {
	case "password":
		if cfg.Password == "" {
			return "SSH 密码不能为空"
		}
	case "key":
		if strings.TrimSpace(cfg.PrivateKey) == "" {
			return "SSH 私钥不能为空"
		}
	default:
		return "SSH 认证方式必须是 password 或 key"
	}
	if cfg.JumpEnabled {
		if strings.TrimSpace(cfg.JumpHost) == "" {
			return "跳板机主机地址不能为空"
		}
		if strings.TrimSpace(cfg.JumpUsername) == "" {
			return "跳板机用户名不能为空"
		}
		switch cfg.JumpAuthType {
		case "password":
			if cfg.JumpPassword == "" {
				return "跳板机密码不能为空"
			}
		case "key":
			if strings.TrimSpace(cfg.JumpPrivateKey) == "" {
				return "跳板机私钥不能为空"
			}
		default:
			return "跳板机认证方式必须是 password 或 key"
		}
	}
	return ""
}

// readAgentConfigFileContent re-reads the live file (local or SSH) behind
// a config-file row.
func readAgentConfigFileContent(row *model.AgentConfigFile, key []byte) (string, error) {
	switch row.Mode {
	case "local":
		return service.ReadLocalFile(service.ExpandPath(row.Path))
	case "ssh":
		var cfg service.SshConfig
		if err := cfg.Unmarshal(row.SshConfig); err != nil {
			return "", fmt.Errorf("SSH 配置解析失败: %v", err)
		}
		if err := cfg.DecryptSensitive(key); err != nil {
			return "", fmt.Errorf("SSH 凭据解密失败: %v", err)
		}
		return service.ReadRemoteFile(cfg, row.Path)
	default:
		return "", fmt.Errorf("未知模式 %q", row.Mode)
	}
}

// writeAgentConfigFileContent atomically replaces the live file (local or
// SSH) behind a config-file row.
func writeAgentConfigFileContent(row *model.AgentConfigFile, content string, key []byte) error {
	switch row.Mode {
	case "local":
		return service.WriteLocalFileAtomic(service.ExpandPath(row.Path), content)
	case "ssh":
		var cfg service.SshConfig
		if err := cfg.Unmarshal(row.SshConfig); err != nil {
			return fmt.Errorf("SSH 配置解析失败: %v", err)
		}
		if err := cfg.DecryptSensitive(key); err != nil {
			return fmt.Errorf("SSH 凭据解密失败: %v", err)
		}
		return service.WriteRemoteFileAtomic(cfg, row.Path, content)
	default:
		return fmt.Errorf("未知模式 %q", row.Mode)
	}
}

// modelSummary is the JSON sent to the frontend "管理模型" dialog. Each
// provider carries its own non-model fields plus the parsed models list.
type modelSummary struct {
	ProviderID  string          `json:"provider_id"`
	OtherFields json.RawMessage `json:"other_fields"`
	Models      []modelEntry    `json:"models"`
}

type modelEntry struct {
	ID     string          `json:"id"`
	Config json.RawMessage `json:"config"`
}

// GetAgentConfigFileModels re-reads the live config file behind a row,
// looks up the agent-type rule to fetch its provider_path / model_path
// gjson expressions, and returns the parsed providers + models. The
// provider_path must resolve to an object map; model_path is applied to
// each provider value. Per-provider "other fields" is the provider object
// with its model_path key stripped.
func GetAgentConfigFileModels(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		var row model.AgentConfigFile
		if err := db.First(&row, "id = ?", c.Param("id")).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "配置不存在"})
			return
		}
		var rule model.AgentTypeRule
		if err := db.Where("name = ?", row.AgentType).First(&rule).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未找到该软件类型的规则: " + row.AgentType})
			return
		}
		jpaths, err := rule.GetJsonPaths()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if strings.TrimSpace(jpaths.Provider) == "" || strings.TrimSpace(jpaths.Model) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该软件类型尚未配置 json 路径，请先在「接管Agent」中填写 provider/model gjson"})
			return
		}
		content, err := readAgentConfigFileContent(&row, key)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "读取失败: " + err.Error()})
			return
		}
		providers, err := parseAgentModels(content, jpaths.Provider, jpaths.Model)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"agent_type": row.AgentType,
				"providers":  providers,
			},
		})
	}
}

// parseAgentModels walks the config blob with two gjson expressions and
// returns a flat list of provider summaries. provider_path must resolve
// to an object whose keys are provider ids; model_path is applied to each
// provider value (it may return an object map or an array). The per-
// provider "other fields" is the provider object with the model_path key
// removed so the UI can render the non-model config separately.
func parseAgentModels(content, providerPath, modelPath string) ([]modelSummary, error) {
	root := gjson.Parse(stripJSON5Comments(content))
	provResult := root.Get(providerPath)
	if !provResult.Exists() {
		return nil, fmt.Errorf("provider 路径 %q 在配置文件中未命中", providerPath)
	}
	if provResult.Type != gjson.JSON {
		return nil, fmt.Errorf("provider 路径 %q 必须解析为对象，实际类型为 %s", providerPath, provResult.Type)
	}
	out := make([]modelSummary, 0, len(provResult.Map()))
	for id, provVal := range provResult.Map() {
		ms := modelSummary{ProviderID: id, OtherFields: json.RawMessage("{}"), Models: []modelEntry{}}
		if modelPath != "" {
			if sub := provVal.Get(modelPath); sub.Exists() {
				ms.Models = collectModels(sub)
			}
		}
		other := stripJSONKey(provVal, modelPath)
		ms.OtherFields = json.RawMessage(other.Raw)
		out = append(out, ms)
	}
	return out, nil
}

// collectModels turns a gjson.Result (object map or array) into a list of
// {id, config} entries. Object keys become ids; arrays fall back to the
// element's "id" / "name" field, then to the array index.
func collectModels(res gjson.Result) []modelEntry {
	out := make([]modelEntry, 0)
	switch res.Type {
	case gjson.JSON:
		for id, val := range res.Map() {
			out = append(out, modelEntry{ID: id, Config: json.RawMessage(val.Raw)})
		}
	default:
		for _, val := range res.Array() {
			id := val.Get("id").String()
			if id == "" {
				id = val.Get("name").String()
			}
			if id == "" {
				id = fmt.Sprintf("%d", val.Index)
			}
			out = append(out, modelEntry{ID: id, Config: json.RawMessage(val.Raw)})
		}
	}
	return out
}

// stripJSONKey returns a copy of val with one top-level key removed so
// callers can render the provider object minus its models subtree. Only
// single-segment keys are supported (no dots / # / etc) — model_path is
// expected to be a literal key like `models`. Returns val unchanged when
// the key is composite or stripping fails.
func stripJSONKey(val gjson.Result, key string) gjson.Result {
	if key == "" || strings.ContainsAny(key, ".#") || !val.IsObject() {
		return val
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal([]byte(val.Raw), &m); err != nil {
		return val
	}
	delete(m, key)
	raw, err := json.Marshal(m)
	if err != nil {
		return val
	}
	return gjson.Parse(string(raw))
}

// stripJSON5Comments removes // and /* */ comments so gjson can parse
// JSON5 configs (e.g. openclaw). String contents are left alone so a
// URL like "https://foo" or an embedded "// not a comment" survives.
func stripJSON5Comments(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	inString := false
	escape := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if inString {
			b.WriteByte(c)
			if escape {
				escape = false
				continue
			}
			if c == '\\' {
				escape = true
				continue
			}
			if c == '"' {
				inString = false
			}
			continue
		}
		if c == '"' {
			inString = true
			b.WriteByte(c)
			continue
		}
		if c == '/' && i+1 < len(s) {
			next := s[i+1]
			if next == '/' {
				end := strings.IndexByte(s[i:], '\n')
				if end < 0 {
					return b.String()
				}
				i += end
				continue
			}
			if next == '*' {
				end := strings.Index(s[i:], "*/")
				if end < 0 {
					return b.String()
				}
				i += end + 1
				continue
			}
		}
		b.WriteByte(c)
	}
	return b.String()
}
