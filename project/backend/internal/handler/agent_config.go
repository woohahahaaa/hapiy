package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
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

func CreateAgentTypeRule(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Name string `json:"name"`
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
	Mode       string          `json:"mode"` // "local" | "ssh"
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
		if req.RecordName == "" || req.AgentType == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "记录名称和软件类型不能为空"})
			return
		}

		var sshCfg service.SshConfig
		switch req.Mode {
		case "local":
			if !strings.HasSuffix(strings.ToLower(req.Path), ".json") {
				c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持 .json 配置文件"})
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
			if err := sshCfg.EncryptSensitive(key); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "SSH 凭据加密失败: " + err.Error()})
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
			content, err = service.ReadLocalFile(req.Path)
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
		return service.ReadLocalFile(row.Path)
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
		return service.WriteLocalFileAtomic(row.Path, content)
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
