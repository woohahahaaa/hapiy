package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/i18n"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
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
		out := make([]map[string]any, 0, len(rules))
		for _, r := range rules {
			marshaled, err := r.MarshalJSON()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			var row map[string]any
			if err := json.Unmarshal(marshaled, &row); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			row["has_template"] = model.HasAgentTemplate(r.Name)
			out = append(out, row)
		}
		c.JSON(http.StatusOK, gin.H{"data": out, "total": total})
	}
}

// GetAgentTypeRuleTemplate returns the default recommendation template for
// the named agent type (from config/agent-templates/<name>.json, falling
// back to built-ins). The frontend「使用默认推荐模版」button loads this to
// prefill the rule editor. 404 when no template exists.
func GetAgentTypeRuleTemplate() gin.HandlerFunc {
	return func(c *gin.Context) {
		tmpl, ok := model.LoadAgentTemplate(c.Param("name"))
		if !ok {
			respondError(c, http.StatusNotFound, "AGENT_TYPE_TEMPLATE_NOT_FOUND", "该软件类型没有默认推荐模版")
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": tmpl})
	}
}

type updateAgentTypeRuleRequest struct {
	Name            string                          `json:"name"`
	Windows         string                          `json:"windows"`
	Mac             string                          `json:"mac"`
	ProviderPath    string                          `json:"provider_path"`
	ModelPath       string                          `json:"model_path"`
	ModelsContainer string                          `json:"models_container"`
	Recommendations []model.AgentRecommendation     `json:"recommendations"`
	Protocols       []model.AgentProtocol           `json:"protocols"`
	ModelInfoFields *model.AgentModelInfoFieldPaths `json:"model_info_fields"`
	ConfigJsonc     string                          `json:"config_jsonc"`
}

// UpdateAgentTypeRule edits an existing rule's display name and/or its
// per-OS path templates and gjson paths. A duplicated name is rejected.
func UpdateAgentTypeRule(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var rule model.AgentTypeRule
		if err := db.First(&rule, "id = ?", c.Param("id")).Error; err != nil {
			respondError(c, http.StatusNotFound, "AGENT_TYPE_RULE_NOT_FOUND", "规则不存在")
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
				respondError(c, http.StatusBadRequest, "AGENT_TYPE_EXISTS", "该软件类型已存在")
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
			Provider:        strings.TrimSpace(req.ProviderPath),
			Model:           strings.TrimSpace(req.ModelPath),
			ModelsContainer: normalizeModelsContainer(req.ModelsContainer),
		}
		if err := rule.SetJsonPaths(jpaths); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := rule.SetRecommendations(req.Recommendations); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := rule.SetProtocols(req.Protocols); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		rule.SetConfigJsonc(req.ConfigJsonc)
		// When the dialog edits via JSONC, the parsed doc is authoritative;
		// re-derive recommendations / protocols from it so the two stay in
		// sync even if the client didn't send explicit arrays.
		if strings.TrimSpace(req.ConfigJsonc) != "" {
			cleaned := stripJSON5Comments(req.ConfigJsonc)
			common, protocols, err := model.ParseRuleConfigJsonc([]byte(cleaned))
			if err != nil {
				respondErrorWithParams(c, http.StatusBadRequest, "JSONC_PARSE_FAILED", "JSONC 解析失败: "+err.Error(), gin.H{"error": err.Error()})
				return
			}
			if err := rule.SetRecommendations(common); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if err := rule.SetProtocols(protocols); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		rule.SetModelInfoFieldsOrZero(req.ModelInfoFields)
		// 保存后重新判定是否仍是「默认模板原样」：内容与默认模板一致时
		// 清掉 customized 标记，启动种子继续跟随默认；不一致（包括未配置
		// 默认模板的自建类型）标记为用户自定义，种子永不再覆盖。
		rule.Customized = true
		if tmpl, ok := model.TemplateForRuleName(rule.Name); ok {
			rule.Customized = !rule.MatchesTemplate(tmpl)
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
			Name            string                          `json:"name"`
			ProviderPath    string                          `json:"provider_path"`
			ModelPath       string                          `json:"model_path"`
			ModelsContainer string                          `json:"models_container"`
			Recommendations []model.AgentRecommendation     `json:"recommendations"`
			Protocols       []model.AgentProtocol           `json:"protocols"`
			ModelInfoFields *model.AgentModelInfoFieldPaths `json:"model_info_fields"`
			ConfigJsonc     string                          `json:"config_jsonc"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		name := strings.TrimSpace(req.Name)
		if name == "" {
			respondError(c, http.StatusBadRequest, "AGENT_TYPE_NAME_REQUIRED", "软件类型名称不能为空")
			return
		}
		var count int64
		if err := db.Model(&model.AgentTypeRule{}).Where("name = ?", name).Count(&count).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if count > 0 {
			respondError(c, http.StatusBadRequest, "AGENT_TYPE_EXISTS", "该软件类型已存在")
			return
		}
		rule := model.AgentTypeRule{
			Name: name,
		}
		if err := rule.SetJsonPaths(model.AgentJsonPaths{
			Provider:        strings.TrimSpace(req.ProviderPath),
			Model:           strings.TrimSpace(req.ModelPath),
			ModelsContainer: normalizeModelsContainer(req.ModelsContainer),
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := rule.SetRecommendations(req.Recommendations); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := rule.SetProtocols(req.Protocols); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		rule.SetConfigJsonc(req.ConfigJsonc)
		if strings.TrimSpace(req.ConfigJsonc) != "" {
			cleaned := stripJSON5Comments(req.ConfigJsonc)
			common, protocols, err := model.ParseRuleConfigJsonc([]byte(cleaned))
			if err != nil {
				respondErrorWithParams(c, http.StatusBadRequest, "JSONC_PARSE_FAILED", "JSONC 解析失败: "+err.Error(), gin.H{"error": err.Error()})
				return
			}
			if err := rule.SetRecommendations(common); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if err := rule.SetProtocols(protocols); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		rule.SetModelInfoFieldsOrZero(req.ModelInfoFields)
		// 新建规则：同名默认模板存在（如常见 agent 类型）时按模板预置并
		// 保持未自定义（跟随默认）；否则视为用户自建数据。
		rule.Customized = true
		if tmpl, ok := model.TemplateForRuleName(name); ok {
			if err := model.ApplyTemplateToRule(&rule, tmpl); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			rule.Customized = false
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
			respondError(c, http.StatusNotFound, "AGENT_TYPE_RULE_NOT_FOUND", "规则不存在")
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
			respondError(c, http.StatusBadRequest, "RECORD_NAME_AND_TYPE_REQUIRED", "记录名称和软件类型不能为空")
			return
		}
		var dupCount int64
		if err := db.Model(&model.AgentConfigFile{}).
			Where("LOWER(record_name) = LOWER(?)", req.RecordName).
			Count(&dupCount).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if dupCount > 0 {
			respondError(c, http.StatusBadRequest, "RECORD_NAME_EXISTS", "记录名称已存在（同名不区分大小写），请使用其他名称")
			return
		}

		var sshCfg service.SshConfig
		switch req.Mode {
		case "local":
			// Any file extension is allowed (builtin templates include
			// .json and .toml); existence is verified by caller.
			if req.TargetOS != "windows" && req.TargetOS != "mac" && req.TargetOS != "other" {
				respondError(c, http.StatusBadRequest, "SYSTEM_OS_INVALID", "本机系统必须是 windows、mac 或 other")
				return
			}
		case "ssh":
			if len(req.SshConfig) == 0 {
				respondError(c, http.StatusBadRequest, "SSH_CONFIG_REQUIRED", "SSH 配置不能为空")
				return
			}
			if err := parseSshConfig(req.SshConfig, &sshCfg); err != nil {
				respondErrorWithParams(c, http.StatusBadRequest, "SSH_CONFIG_PARSE_FAILED", "SSH 配置解析失败: "+err.Error(), gin.H{"error": err.Error()})
				return
			}
			if code, msg := validateSshConfig(sshCfg); msg != "" {
				respondError(c, http.StatusBadRequest, code, msg)
				return
			}
		default:
			respondError(c, http.StatusBadRequest, "MODE_INVALID", "模式必须是 local 或 ssh")
			return
		}

		// Read-validate: refuse to store a record whose file cannot be
		// read right now, so the frontend gets immediate feedback.
		var content string
		var err error
		if req.Mode == "local" {
			content, err = service.ReadLocalFile(service.ExpandPath(req.Path))
		} else {
			content, err = service.ReadRemoteFile(sshCfg, req.Path, req.TargetOS)
		}
		if err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "READ_FAILED", "读取失败: "+err.Error(), gin.H{"error": err.Error()})
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
			respondError(c, http.StatusNotFound, "CONFIG_NOT_FOUND", "配置不存在")
			return
		}
		content, err := readAgentConfigFileContent(&row, key)
		if err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "READ_FAILED", "读取失败: "+err.Error(), gin.H{"error": err.Error()})
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
			respondError(c, http.StatusNotFound, "CONFIG_NOT_FOUND", "配置不存在")
			return
		}
		var req struct {
			Content string `json:"content"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		formatted, err := prettifyJSON(req.Content)
		if err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "JSON_FORMAT_FAILED", "JSON 格式化失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		if err := writeAgentConfigFileContent(&row, formatted, key); err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "SAVE_FAILED", "保存失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		if err := db.Model(&row).Update("content", formatted).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		recordAgentConfigVersion(db, row.ID, formatted)
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true, "content": formatted}})
	}
}

// prettifyJSON returns the supplied content indented with two spaces and
// terminated by a newline. The raw blob must be valid JSON (or JSON5-
// compatible — comments are tolerated via stripJSON5Comments so the
// previewed content from apply/sync endpoints round-trips cleanly).
// Inputs that already start as compact or non-standard JSON are still
// reformatted; non-JSON inputs pass through untouched so a misconfigured
// caller gets a readable error instead of silently mangled bytes.
func prettifyJSON(content string) (string, error) {
	cleaned := stripJSON5Comments(content)
	var any any
	if err := json.Unmarshal([]byte(cleaned), &any); err != nil {
		return "", err
	}
	out, err := json.MarshalIndent(any, "", "  ")
	if err != nil {
		return "", err
	}
	return string(out) + "\n", nil
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
			respondError(c, http.StatusNotFound, "CONFIG_NOT_FOUND", "配置不存在")
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
			respondError(c, http.StatusBadRequest, "RECORD_NAME_AND_TYPE_REQUIRED", "记录名称和软件类型不能为空")
			return
		}
		if !strings.EqualFold(req.RecordName, row.RecordName) {
			var dupCount int64
			if err := db.Model(&model.AgentConfigFile{}).
				Where("LOWER(record_name) = LOWER(?) AND id <> ?", req.RecordName, row.ID).
				Count(&dupCount).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if dupCount > 0 {
				respondError(c, http.StatusBadRequest, "RECORD_NAME_EXISTS", "记录名称已存在（同名不区分大小写），请使用其他名称")
				return
			}
		}

		var sshCfg service.SshConfig
		switch req.Mode {
		case "local":
			if req.TargetOS != "windows" && req.TargetOS != "mac" && req.TargetOS != "other" {
				respondError(c, http.StatusBadRequest, "SYSTEM_OS_INVALID", "本机系统必须是 windows、mac 或 other")
				return
			}
		case "ssh":
			if len(req.SshConfig) == 0 {
				respondError(c, http.StatusBadRequest, "SSH_CONFIG_REQUIRED", "SSH 配置不能为空")
				return
			}
			if err := parseSshConfig(req.SshConfig, &sshCfg); err != nil {
				respondErrorWithParams(c, http.StatusBadRequest, "SSH_CONFIG_PARSE_FAILED", "SSH 配置解析失败: "+err.Error(), gin.H{"error": err.Error()})
				return
			}
			if row.Mode == "ssh" && row.SshConfig != "" {
				var existing service.SshConfig
				if err := existing.Unmarshal(row.SshConfig); err != nil {
					respondErrorWithParams(c, http.StatusInternalServerError, "SSH_CONFIG_PARSE_FAILED", "现有 SSH 配置解析失败: "+err.Error(), gin.H{"error": err.Error()})
					return
				}
				if err := existing.DecryptSensitive(key); err != nil {
					respondErrorWithParams(c, http.StatusInternalServerError, "SSH_CREDENTIALS_DECRYPT_FAILED", "现有 SSH 凭据解密失败: "+err.Error(), gin.H{"error": err.Error()})
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
			if code, msg := validateSshConfig(sshCfg); msg != "" {
				respondError(c, http.StatusBadRequest, code, msg)
				return
			}
			if err := sshCfg.EncryptSensitive(key); err != nil {
				respondErrorWithParams(c, http.StatusInternalServerError, "SSH_CREDENTIALS_ENCRYPT_FAILED", "SSH 凭据加密失败: "+err.Error(), gin.H{"error": err.Error()})
				return
			}
		default:
			respondError(c, http.StatusBadRequest, "MODE_INVALID", "模式必须是 local 或 ssh")
			return
		}

		var content string
		var err error
		if req.Mode == "local" {
			content, err = service.ReadLocalFile(service.ExpandPath(req.Path))
		} else {
			content, err = service.ReadRemoteFile(sshCfg, req.Path, req.TargetOS)
		}
		if err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "READ_FAILED", "读取失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}

		var sshBlob string
		if req.Mode == "ssh" {
			if err := sshCfg.EncryptSensitive(key); err != nil {
				respondErrorWithParams(c, http.StatusInternalServerError, "SSH_CREDENTIALS_ENCRYPT_FAILED", "SSH 凭据加密失败: "+err.Error(), gin.H{"error": err.Error()})
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
			respondError(c, http.StatusBadRequest, "PATH_PARAM_REQUIRED", "缺少 path 参数")
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
			respondError(c, http.StatusBadRequest, "PATH_PARAM_REQUIRED", "缺少 path 参数")
			return
		}
		content, err := service.ReadLocalFile(service.ExpandPath(raw))
		if err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "READ_FAILED", "读取失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"content": content}})
	}
}

// ReadAgentConfigRemotePath returns the content of a remote file via SSH
// using the supplied (unsaved) ssh_config. The path, credentials and target
// OS travel in the POST body because the dashboard's takeover dialog builds
// them up before the AgentConfigFile row exists.
func ReadAgentConfigRemotePath() gin.HandlerFunc {
	type request struct {
		SshConfig json.RawMessage `json:"ssh_config"`
		Path      string          `json:"path"`
		TargetOS  string          `json:"target_os"`
	}
	return func(c *gin.Context) {
		var req request
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		path := strings.TrimSpace(req.Path)
		if path == "" {
			respondError(c, http.StatusBadRequest, "PATH_PARAM_REQUIRED", "缺少 path 参数")
			return
		}
		var cfg service.SshConfig
		if err := parseSshConfig(req.SshConfig, &cfg); err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "SSH_CONFIG_PARSE_FAILED", "SSH 配置解析失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		if code, msg := validateSshConfig(cfg); msg != "" {
			respondError(c, http.StatusBadRequest, code, msg)
			return
		}
		content, err := service.ReadRemoteFile(cfg, path, strings.TrimSpace(req.TargetOS))
		if err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "READ_FAILED", "读取失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"content": content}})
	}
}

// TestAgentSshConnection probes an in-progress SSH config (i.e. one not
// yet stored on an AgentConfigFile row) for connect / read / write. The
// read probe runs only when path is non-empty; the write probe always
// runs and uses a mktemp + rm sequence so no user file is touched. The
// full capability report is always returned so the UI can flag exactly
// which step failed.
func TestAgentSshConnection() gin.HandlerFunc {
	type request struct {
		SshConfig json.RawMessage `json:"ssh_config"`
		Path      string          `json:"path"`
		TargetOS  string          `json:"target_os"` // "windows" | "mac" | "other"; selects the probe command family
	}
	return func(c *gin.Context) {
		var req request
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		var cfg service.SshConfig
		if err := parseSshConfig(req.SshConfig, &cfg); err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "SSH_CONFIG_PARSE_FAILED", "SSH 配置解析失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		if code, msg := validateSshConfig(cfg); msg != "" {
			respondError(c, http.StatusBadRequest, code, msg)
			return
		}
		targetOS := strings.TrimSpace(req.TargetOS)
		if targetOS != "" && targetOS != "windows" && targetOS != "mac" && targetOS != "other" {
			respondError(c, http.StatusBadRequest, "TARGET_OS_INVALID", "目标系统必须是 windows、mac 或 other")
			return
		}
		connect, read, write := service.TestSshConnection(cfg, strings.TrimSpace(req.Path), targetOS, i18n.Lang(c.Request))
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"connect": connect,
			"read":    read,
			"write":   write,
		}})
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

// validateSshConfig returns a stable code plus a Chinese error message when
// the config is incomplete, or ("", "") when it is usable.
func validateSshConfig(cfg service.SshConfig) (string, string) {
	if strings.TrimSpace(cfg.Host) == "" {
		return "SSH_HOST_REQUIRED", "SSH 主机地址不能为空"
	}
	if strings.TrimSpace(cfg.Username) == "" {
		return "SSH_USERNAME_REQUIRED", "SSH 用户名不能为空"
	}
	switch cfg.AuthType {
	case "password":
		if cfg.Password == "" {
			return "SSH_PASSWORD_REQUIRED", "SSH 密码不能为空"
		}
	case "key":
		if strings.TrimSpace(cfg.PrivateKey) == "" {
			return "SSH_PRIVATE_KEY_REQUIRED", "SSH 私钥不能为空"
		}
	default:
		return "SSH_AUTH_TYPE_INVALID", "SSH 认证方式必须是 password 或 key"
	}
	if cfg.JumpEnabled {
		if strings.TrimSpace(cfg.JumpHost) == "" {
			return "JUMP_HOST_REQUIRED", "跳板机主机地址不能为空"
		}
		if strings.TrimSpace(cfg.JumpUsername) == "" {
			return "JUMP_USERNAME_REQUIRED", "跳板机用户名不能为空"
		}
		switch cfg.JumpAuthType {
		case "password":
			if cfg.JumpPassword == "" {
				return "JUMP_PASSWORD_REQUIRED", "跳板机密码不能为空"
			}
		case "key":
			if strings.TrimSpace(cfg.JumpPrivateKey) == "" {
				return "JUMP_PRIVATE_KEY_REQUIRED", "跳板机私钥不能为空"
			}
		default:
			return "JUMP_AUTH_TYPE_INVALID", "跳板机认证方式必须是 password 或 key"
		}
	}
	return "", ""
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
		return service.ReadRemoteFile(cfg, row.Path, row.TargetOS)
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
		return service.WriteRemoteFileAtomic(cfg, row.Path, content, row.TargetOS)
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
			respondError(c, http.StatusNotFound, "CONFIG_NOT_FOUND", "配置不存在")
			return
		}
		var rule model.AgentTypeRule
		if err := db.Where("name = ?", row.AgentType).First(&rule).Error; err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "AGENT_TYPE_RULE_MISSING", "未找到该软件类型的规则: "+row.AgentType, gin.H{"name": row.AgentType})
			return
		}
		jpaths, err := rule.GetJsonPaths()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if strings.TrimSpace(jpaths.Provider) == "" || strings.TrimSpace(jpaths.Model) == "" {
			respondError(c, http.StatusBadRequest, "AGENT_TYPE_JSON_PATHS_UNCONFIGURED_DETAIL", "该软件类型尚未配置 json 路径，请先在「接管Agent」中填写 provider/model gjson")
			return
		}
		content, err := readAgentConfigFileContent(&row, key)
		if err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "READ_FAILED", "读取失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		providers, err := parseAgentModels(content, jpaths.Provider, jpaths.Model)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		recs, _ := rule.GetRecommendations()
		protocols, _ := rule.GetProtocols()
		mif, _ := rule.GetModelInfoFields()
		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"agent_type":        row.AgentType,
				"providers":         providers,
				"recommendations":   recs,
				"protocols":         protocols,
				"model_info_fields": mif,
				"json_paths":        jpaths,
			},
		})
	}
}

// parseAgentModels walks the config blob with two gjson expressions and
// returns a flat list of provider summaries. provider_path must resolve
// to an object whose keys are provider ids. model_path is a full gjson
// path from the document root with `{provider_id}` substituted per
// provider — writing the full path lets the schema handle agents whose
// models live anywhere reachable from the root, not just under each
// provider object. The per-provider "other fields" is the provider
// object with the leaf key of model_path stripped.
func parseAgentModels(content, providerPath, modelPath string) ([]modelSummary, error) {
	root := gjson.Parse(stripJSON5Comments(content))
	provResult := root.Get(providerPath)
	if !provResult.Exists() {
		return nil, fmt.Errorf("provider 路径 %q 在配置文件中未命中", providerPath)
	}
	if provResult.Type != gjson.JSON {
		return nil, fmt.Errorf("provider 路径 %q 必须解析为对象，实际类型为 %s", providerPath, provResult.Type)
	}
	modelLeaf := lastPathSegment(modelPath)
	out := make([]modelSummary, 0, len(provResult.Map()))
	for id, provVal := range provResult.Map() {
		ms := modelSummary{ProviderID: id, OtherFields: json.RawMessage("{}"), Models: []modelEntry{}}
		if modelPath != "" {
			resolved := strings.ReplaceAll(modelPath, "{provider_id}", id)
			if sub := root.Get(resolved); sub.Exists() {
				ms.Models = collectModels(sub)
			}
		}
		other := stripJSONKey(provVal, modelLeaf)
		ms.OtherFields = json.RawMessage(other.Raw)
		out = append(out, ms)
	}
	return out, nil
}

// lastPathSegment returns the trailing key of a dotted gjson path so the
// caller can strip the same leaf key from the provider object —
// `provider.{provider_id}.models` → `models`. A path with no dot is
// returned verbatim.
func lastPathSegment(path string) string {
	if i := strings.LastIndex(path, "."); i >= 0 {
		return path[i+1:]
	}
	return path
}

// normalizeModelsContainer maps the user-facing ModelsContainer value
// from the rule dialog to the canonical form persisted in the json_paths
// blob. Empty / unknown values fall back to "object" so legacy rules
// keep their pre-existing write behaviour.
func normalizeModelsContainer(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "array":
		return "array"
	case "object", "":
		return ""
	}
	return ""
}

// collectModels turns a gjson.Result (object map or array) into a list of
// {id, config} entries. gjson returns Type=JSON for both objects and
// arrays, so we branch on IsArray / IsObject explicitly — openclaw's
// `models` is an array while opencode's is an object map. Object keys
// become ids; arrays fall back to the element's "id" / "name" field,
// then to the array index.
func collectModels(res gjson.Result) []modelEntry {
	out := make([]modelEntry, 0)
	if res.IsArray() {
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
		return out
	}
	if res.IsObject() {
		for id, val := range res.Map() {
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

// ApplyAgentRecommendations returns the file content it *would* write
// when the rule's Recommended values were applied for the given
// provider (and model, when model_id is provided). It does NOT touch
// the file on disk — the caller previews, and on confirmation writes
// the returned content back via PUT /:id/content. Recommendations
// with a null Recommended value are skipped (no value to fill in).
func ApplyAgentRecommendations(db *gorm.DB, key []byte) gin.HandlerFunc {
	type applyReq struct {
		ProviderID string `json:"provider_id"`
		ModelID    string `json:"model_id"`
	}
	return func(c *gin.Context) {
		var row model.AgentConfigFile
		if err := db.First(&row, "id = ?", c.Param("id")).Error; err != nil {
			respondError(c, http.StatusNotFound, "CONFIG_NOT_FOUND", "配置不存在")
			return
		}
		var rule model.AgentTypeRule
		if err := db.Where("name = ?", row.AgentType).First(&rule).Error; err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "AGENT_TYPE_RULE_MISSING", "未找到该软件类型的规则: "+row.AgentType, gin.H{"name": row.AgentType})
			return
		}
		jpaths, err := rule.GetJsonPaths()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if strings.TrimSpace(jpaths.Provider) == "" || strings.TrimSpace(jpaths.Model) == "" {
			respondError(c, http.StatusBadRequest, "AGENT_TYPE_JSON_PATHS_UNCONFIGURED", "该软件类型尚未配置 json 路径")
			return
		}
		var req applyReq
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		providerID := strings.TrimSpace(req.ProviderID)
		if providerID == "" {
			respondError(c, http.StatusBadRequest, "PROVIDER_ID_REQUIRED", "provider_id 不能为空")
			return
		}
		recs, _ := rule.GetRecommendations()
		protocols, _ := rule.GetProtocols()
		if len(recs) == 0 && len(protocols) == 0 {
			respondError(c, http.StatusBadRequest, "AGENT_TYPE_NO_RECOMMENDATIONS", "该规则尚未配置推荐项")
			return
		}

		content, err := readAgentConfigFileContent(&row, key)
		if err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "READ_FAILED", "读取失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		// sjson needs valid JSON, so strip JSON5 comments before mutating.
		// The round-trip drops comments, which is fine — both opencode and
		// openclaw accept plain JSON.
		cleaned := stripJSON5Comments(content)
		effective := append([]model.AgentRecommendation(nil), recs...)
		for _, p := range protocols {
			if protocolMatchesProvider(cleaned, jpaths, providerID, p) {
				effective = append(effective, p.Recommendations...)
			}
		}
		updated, applied, err := applyRecommendationsToContent(cleaned, jpaths.Provider, jpaths.Model, providerID, strings.TrimSpace(req.ModelID), effective)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		// Preview only — do NOT write here. Caller writes via PUT /:id/content.
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"applied": applied, "content": updated}})
	}
}

// ApplyRecommendationTemplate applies the rule's recommendations (common +
// matched protocols) to every NON-managed provider and every model under
// it in the config file, returning the previewed content plus a
// per-provider / per-model change tally. Providers whose names belong to
// a managed provider group (托管供应商) are skipped — their blocks are
// system-generated and read-only. Preview only; caller writes via PUT.
// Note: 只有显式 action=delete 的推荐项才删除字段；recommended == nil
// （推荐不填）以及模板未声明的字段一律「不干预」保留，绝不自动清理。
func ApplyRecommendationTemplate(db *gorm.DB, key []byte) gin.HandlerFunc {
	type tally struct {
		ProviderID string         `json:"provider_id"`
		Count      int            `json:"count"` // provider fields + all models' fields
		Models     map[string]int `json:"models"`
	}
	return func(c *gin.Context) {
		var row model.AgentConfigFile
		if err := db.First(&row, "id = ?", c.Param("id")).Error; err != nil {
			respondError(c, http.StatusNotFound, "CONFIG_NOT_FOUND", "配置不存在")
			return
		}
		var rule model.AgentTypeRule
		if err := db.Where("name = ?", row.AgentType).First(&rule).Error; err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "AGENT_TYPE_RULE_MISSING", "未找到该软件类型的规则: "+row.AgentType, gin.H{"name": row.AgentType})
			return
		}
		jpaths, err := rule.GetJsonPaths()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if strings.TrimSpace(jpaths.Provider) == "" || strings.TrimSpace(jpaths.Model) == "" {
			respondError(c, http.StatusBadRequest, "AGENT_TYPE_JSON_PATHS_UNCONFIGURED", "该软件类型尚未配置 json 路径")
			return
		}
		recs, _ := rule.GetRecommendations()
		protocols, _ := rule.GetProtocols()
		if len(recs) == 0 && len(protocols) == 0 {
			respondError(c, http.StatusBadRequest, "AGENT_TYPE_NO_RECOMMENDATIONS", "该规则尚未配置推荐项")
			return
		}
		content, err := readAgentConfigFileContent(&row, key)
		if err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "READ_FAILED", "读取失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		cleaned := stripJSON5Comments(content)

		// Managed provider block names to skip.
		skip := map[string]bool{}
		var managed []model.ManagedAgentProvider
		if err := db.Where("agent_config_file_id = ?", row.ID).Find(&managed).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		for _, m := range managed {
			groups, _ := m.GetGroups()
			for _, g := range groups {
				skip[strings.TrimSpace(m.Name)+strings.TrimSpace(g.Suffix)] = true
			}
		}

		provResult := gjson.Parse(cleaned).Get(jpaths.Provider)
		var providerIDs []string
		if provResult.IsObject() {
			for id := range provResult.Map() {
				if !skip[id] {
					providerIDs = append(providerIDs, id)
				}
			}
		}
		buf := []byte(cleaned)
		total := 0
		tallies := make([]tally, 0, len(providerIDs))
		for _, pid := range providerIDs {
			effective := append([]model.AgentRecommendation(nil), recs...)
			for _, p := range protocols {
				if protocolMatchesProvider(string(buf), jpaths, pid, p) {
					effective = append(effective, p.Recommendations...)
				}
			}
			// provider scope：只按规则的显式操作执行 —— "delete" 删除、
			// "skip" 不干预、默认 "set" 仅在推荐有值（Recommended != nil）
			// 时写入；推荐无值的字段（recommended=null）一律不干预保留，
			// 模板未声明的字段不动。
			providerFields := 0
			for _, r := range effective {
				if r.Scope != "provider" {
					continue
				}
				full := jpaths.Provider + "." + pid + "." + r.Key
				switch r.RecommendAction() {
				case "delete":
					if gjson.Parse(string(buf)).Get(full).Exists() {
						next, err := sjson.DeleteBytes(buf, full)
						if err != nil {
							respondErrorWithParams(c, http.StatusBadRequest, "FIELD_DELETE_FAILED", fmt.Sprintf("provider %s 字段 %s 删除失败: %v", pid, r.Key, err), gin.H{"scope": "provider", "id": pid, "field": r.Key, "error": err})
							return
						}
						buf = next
						providerFields++
					}
				case "skip":
					continue
				default:
					if r.Recommended == nil {
						continue
					}
					next, err := sjson.SetBytes(buf, full, r.Recommended)
					if err != nil {
						respondErrorWithParams(c, http.StatusBadRequest, "FIELD_WRITE_FAILED", fmt.Sprintf("provider %s 字段 %s 写入失败: %v", pid, r.Key, err), gin.H{"scope": "provider", "id": pid, "field": r.Key, "error": err})
						return
					}
					buf = next
					providerFields++
				}
			}
			// model scope
			modelTally := map[string]int{}
			resolved := strings.ReplaceAll(jpaths.Model, "{provider_id}", pid)
			if sub := gjson.Parse(string(buf)).Get(resolved); sub.Exists() {
				for _, me := range modelsFromResult(sub) {
					// 数组容器（openclaw）：按元素 id 定位到索引，避免把模型名
					// 当对象 key 写入 sjson（"cannot set array element"）。
					base, found := modelEntryPath(buf, resolved, me)
					if !found {
						continue
					}
					count := 0
					for _, r := range effective {
						if r.Scope != "model" {
							continue
						}
						full := base + "." + r.Key
						switch r.RecommendAction() {
						case "delete":
							if gjson.Parse(string(buf)).Get(full).Exists() {
								next, err := sjson.DeleteBytes(buf, full)
								if err != nil {
									respondErrorWithParams(c, http.StatusBadRequest, "FIELD_DELETE_FAILED", fmt.Sprintf("model %s 字段 %s 删除失败: %v", me, r.Key, err), gin.H{"scope": "model", "id": me, "field": r.Key, "error": err})
									return
								}
								buf = next
								count++
							}
						case "skip":
							continue
						default:
							// 推荐不填（recommended=nil）：模型字段多为能力/规格
							// 数据，模板没提供值就「不干预」保留用户字段。
							if r.Recommended == nil {
								continue
							}
							next, err := sjson.SetBytes(buf, full, r.Recommended)
							if err != nil {
								respondErrorWithParams(c, http.StatusBadRequest, "FIELD_WRITE_FAILED", fmt.Sprintf("model %s 字段 %s 写入失败: %v", me, r.Key, err), gin.H{"scope": "model", "id": me, "field": r.Key, "error": err})
								return
							}
							buf = next
							count++
						}
					}
					if count > 0 {
						modelTally[me] = count
						providerFields += count
					}
				}
			}
			if providerFields > 0 || len(modelTally) > 0 {
				tallies = append(tallies, tally{ProviderID: pid, Count: providerFields, Models: modelTally})
			}
			total += providerFields
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"applied":   total,
			"content":   string(buf),
			"providers": tallies,
		}})
	}
}

// modelsFromResult lists model ids for an object map or array result.
func modelsFromResult(res gjson.Result) []string {
	if !res.Exists() {
		return nil
	}
	var out []string
	if res.IsArray() {
		for _, v := range res.Array() {
			id := v.Get("id").String()
			if id == "" {
				id = v.Get("name").String()
			}
			if id == "" {
				id = fmt.Sprintf("%d", v.Index)
			}
			out = append(out, id)
		}
		return out
	}
	if res.IsObject() {
		for id := range res.Map() {
			out = append(out, id)
		}
	}
	return out
}

// checkedApplyReq — 「使用推荐配置」弹窗的应用请求：只对勾选的
// provider（及其勾选模型）套用规则推荐模板，返回预览内容。模型级
// 推荐只会应用到 checked provider 下勾选的（或全部）模型。不写盘，
// 由前端预览后经 PUT 保存。
type checkedApplyReq struct {
	// Checked: provider_id → 勾选的模型 id 列表。空列表 = 勾选该
	// provider 全部模型（provider 级字段总是应用）。
	Checked map[string][]string `json:"checked"`
	// ModelFields: provider_id → model_id → 路径→值。来自 models.dev 参考
	// 供应商的四个基础字段，在模板推荐之后写入（勾选模型才生效）。
	ModelFields map[string]map[string]map[string]any `json:"model_fields"`
}

// ApplyRecommendationConfig applies the rule's recommendations to ONLY the
// checked providers (+ their checked models). Same semantics as
// ApplyRecommendationTemplate (action=delete only deletes; recommended nil
// and undeclared fields are 不干预) but scoped by 勾选. Returns preview
// content only.
func ApplyRecommendationConfig(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		var row model.AgentConfigFile
		if err := db.First(&row, "id = ?", c.Param("id")).Error; err != nil {
			respondError(c, http.StatusNotFound, "CONFIG_NOT_FOUND", "配置不存在")
			return
		}
		var rule model.AgentTypeRule
		if err := db.Where("name = ?", row.AgentType).First(&rule).Error; err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "AGENT_TYPE_RULE_MISSING", "未找到该软件类型的规则: "+row.AgentType, gin.H{"name": row.AgentType})
			return
		}
		jpaths, err := rule.GetJsonPaths()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if strings.TrimSpace(jpaths.Provider) == "" || strings.TrimSpace(jpaths.Model) == "" {
			respondError(c, http.StatusBadRequest, "AGENT_TYPE_JSON_PATHS_UNCONFIGURED", "该软件类型尚未配置 json 路径")
			return
		}
		recs, _ := rule.GetRecommendations()
		protocols, _ := rule.GetProtocols()
		var req checkedApplyReq
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if len(req.Checked) == 0 {
			respondError(c, http.StatusBadRequest, "CHECKED_PROVIDER_OR_MODEL_REQUIRED", "请至少勾选一个供应商或模型")
			return
		}
		content, err := readAgentConfigFileContent(&row, key)
		if err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "READ_FAILED", "读取失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		buf := []byte(stripJSON5Comments(content))
		total := 0

		// Managed provider block names to skip.
		skip := map[string]bool{}
		var managed []model.ManagedAgentProvider
		if err := db.Where("agent_config_file_id = ?", row.ID).Find(&managed).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		for _, m := range managed {
			groups, _ := m.GetGroups()
			for _, g := range groups {
				skip[strings.TrimSpace(m.Name)+strings.TrimSpace(g.Suffix)] = true
			}
		}

		for pid, modelIDs := range req.Checked {
			pid = strings.TrimSpace(pid)
			if pid == "" || skip[pid] {
				continue
			}
			effective := append([]model.AgentRecommendation(nil), recs...)
			for _, p := range protocols {
				if protocolMatchesProvider(string(buf), jpaths, pid, p) {
					effective = append(effective, p.Recommendations...)
				}
			}
			// Provider scope 推荐：按显式操作执行 —— "delete" 删除、"skip"
			// 不干预、默认 "set" 仅在推荐有值时写入；recommended=null 与
			// 模板未声明的字段一律不干预。
			for _, r := range effective {
				if r.Scope != "provider" {
					continue
				}
				full := jpaths.Provider + "." + pid + "." + r.Key
				switch r.RecommendAction() {
				case "delete":
					if gjson.Parse(string(buf)).Get(full).Exists() {
						next, err := sjson.DeleteBytes(buf, full)
						if err != nil {
							respondErrorWithParams(c, http.StatusBadRequest, "FIELD_DELETE_FAILED", fmt.Sprintf("provider %s 字段 %s 删除失败: %v", pid, r.Key, err), gin.H{"scope": "provider", "id": pid, "field": r.Key, "error": err})
							return
						}
						buf = next
						total++
					}
				case "skip":
					continue
				default:
					if r.Recommended == nil {
						continue
					}
					next, err := sjson.SetBytes(buf, full, r.Recommended)
					if err != nil {
						respondErrorWithParams(c, http.StatusBadRequest, "FIELD_WRITE_FAILED", fmt.Sprintf("provider %s 字段 %s 写入失败: %v", pid, r.Key, err), gin.H{"scope": "provider", "id": pid, "field": r.Key, "error": err})
						return
					}
					buf = next
					total++
				}
			}

			// Model scope：全模型（勾选 provider 即应用该下全部模型，
			// 前端会在 checked 里显式列出勾选模型 id）。
			matchAll := len(modelIDs) == 0
			want := map[string]bool{}
			for _, mid := range modelIDs {
				want[strings.TrimSpace(mid)] = true
			}
			resolved := strings.ReplaceAll(jpaths.Model, "{provider_id}", pid)
			if sub := gjson.Parse(string(buf)).Get(resolved); sub.Exists() {
				for _, me := range modelsFromResult(sub) {
					if !matchAll && !want[me] {
						continue
					}
					// 数组容器（openclaw）：按元素 id 定位到索引，避免把模型名
					// 当对象 key 写入 sjson（"cannot set array element"）。
					base, found := modelEntryPath(buf, resolved, me)
					if !found {
						continue
					}
					for _, r := range effective {
						if r.Scope != "model" {
							continue
						}
						full := base + "." + r.Key
						switch r.RecommendAction() {
						case "delete":
							if gjson.Parse(string(buf)).Get(full).Exists() {
								next, err := sjson.DeleteBytes(buf, full)
								if err != nil {
									respondErrorWithParams(c, http.StatusBadRequest, "FIELD_DELETE_FAILED", fmt.Sprintf("model %s 字段 %s 删除失败: %v", me, r.Key, err), gin.H{"scope": "model", "id": me, "field": r.Key, "error": err})
									return
								}
								buf = next
								total++
							}
						case "skip":
							continue
						default:
							// 推荐不填（recommended=nil）：模型字段多为能力/规格
							// 数据，模板没提供值就「不干预」保留用户字段。
							if r.Recommended == nil {
								continue
							}
							next, err := sjson.SetBytes(buf, full, r.Recommended)
							if err != nil {
								respondErrorWithParams(c, http.StatusBadRequest, "FIELD_WRITE_FAILED", fmt.Sprintf("model %s 字段 %s 写入失败: %v", me, r.Key, err), gin.H{"scope": "model", "id": me, "field": r.Key, "error": err})
								return
							}
							buf = next
							total++
						}
					}
				}
			}
		}
		// models.dev 基础字段（勾选模型，参考供应商选出来的四个字段）。
		if len(req.ModelFields) > 0 {
			for pid, models := range req.ModelFields {
				if strings.TrimSpace(pid) == "" || skip[pid] {
					continue
				}
				resolved := strings.ReplaceAll(jpaths.Model, "{provider_id}", strings.TrimSpace(pid))
				for mid, fields := range models {
					if strings.TrimSpace(mid) == "" {
						continue
					}
					// 数组容器（openclaw）：按元素 id 定位到索引，避免把模型名
					// 当对象 key 写入 sjson（"cannot set array element"）。
					base, found := modelEntryPath(buf, resolved, strings.TrimSpace(mid))
					if !found {
						continue
					}
					for path, val := range fields {
						full := base + "." + path
						next, err := sjson.SetBytes(buf, full, val)
						if err != nil {
							respondErrorWithParams(c, http.StatusBadRequest, "FIELD_WRITE_FAILED", fmt.Sprintf("model %s 字段 %s 写入失败: %v", mid, path, err), gin.H{"scope": "model", "id": mid, "field": path, "error": err})
							return
						}
						buf = next
						total++
					}
				}
			}
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"applied": total,
			"content": string(buf),
		}})
	}
}

// protocolMatchesProvider reports whether at least one condition of the
// protocol matches the provider's config fields in the live document.
// Conditions read provider-level gjson paths (e.g. "options.baseURL" or
// "api") and are ORed. A protocol without conditions matches nothing,
// so it never applies to an existing file provider.
func protocolMatchesProvider(content string, jpaths model.AgentJsonPaths, providerID string, p model.AgentProtocol) bool {
	prov := gjson.Parse(content).Get(jpaths.Provider + "." + providerID)
	for _, cond := range p.Conditions {
		field := strings.TrimSpace(cond.Field)
		if field == "" {
			continue
		}
		val := prov.Get(field).String()
		want := strings.TrimSpace(cond.Value)
		switch cond.Op {
		case "equals":
			if val == want {
				return true
			}
		case "not_equals":
			if val != want {
				return true
			}
		case "contains":
			if strings.Contains(val, want) {
				return true
			}
case "not_contains":
			if !strings.Contains(val, want) {
				return true
			}
		}
	}
	return false
}

// SyncAgentConfigFileModelFields returns the file content it *would*
// write when caller-supplied fields were merged into a single model's
// config block. The path map is built on the client (e.g. from
// models.dev → opencode paths) and merged via sjson. The caller
// previews, then writes the returned content via PUT /:id/content.
// Fields whose path matches the existing model keys overwrite; new
// paths are inserted.
func SyncAgentConfigFileModelFields(db *gorm.DB, key []byte) gin.HandlerFunc {
	type syncReq struct {
		ProviderID string            `json:"provider_id"`
		ModelID    string            `json:"model_id"`
		Fields     map[string]any    `json:"fields"`
	}
	return func(c *gin.Context) {
		var row model.AgentConfigFile
		if err := db.First(&row, "id = ?", c.Param("id")).Error; err != nil {
			respondError(c, http.StatusNotFound, "CONFIG_NOT_FOUND", "配置不存在")
			return
		}
		var rule model.AgentTypeRule
		if err := db.Where("name = ?", row.AgentType).First(&rule).Error; err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "AGENT_TYPE_RULE_MISSING", "未找到该软件类型的规则: "+row.AgentType, gin.H{"name": row.AgentType})
			return
		}
		jpaths, err := rule.GetJsonPaths()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if strings.TrimSpace(jpaths.Provider) == "" || strings.TrimSpace(jpaths.Model) == "" {
			respondError(c, http.StatusBadRequest, "AGENT_TYPE_JSON_PATHS_UNCONFIGURED", "该软件类型尚未配置 json 路径")
			return
		}
		var req syncReq
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if strings.TrimSpace(req.ProviderID) == "" || strings.TrimSpace(req.ModelID) == "" {
			respondError(c, http.StatusBadRequest, "PROVIDER_AND_MODEL_ID_REQUIRED", "provider_id 与 model_id 不能为空")
			return
		}
		if len(req.Fields) == 0 {
			respondError(c, http.StatusBadRequest, "FIELDS_REQUIRED", "fields 不能为空")
			return
		}

		content, err := readAgentConfigFileContent(&row, key)
		if err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "READ_FAILED", "读取失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		cleaned := stripJSON5Comments(content)
		resolvedModels := strings.ReplaceAll(jpaths.Model, "{provider_id}", escapeSjsonKey(req.ProviderID))
		base, ok := modelEntryPath([]byte(cleaned), resolvedModels, req.ModelID)
		if !ok {
			respondErrorWithParams(c, http.StatusBadRequest, "MODEL_NOT_FOUND_IN_CONFIG", "未在配置文件的 "+resolvedModels+" 中找到模型 "+req.ModelID, gin.H{"path": resolvedModels, "model": req.ModelID})
			return
		}
		buf := []byte(cleaned)
		applied := 0
		for path, val := range req.Fields {
			full := base + "." + path
			next, err := sjson.SetBytes(buf, full, val)
			if err != nil {
				respondErrorWithParams(c, http.StatusBadRequest, "FIELD_WRITE_FAILED", fmt.Sprintf("写入字段 %s 失败: %v", path, err), gin.H{"scope": "model", "id": req.ModelID, "field": path, "error": err})
				return
			}
			buf = next
			applied++
		}
		updated := string(buf)
		// Preview only — do NOT write here. Caller writes via PUT /:id/content.
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"applied": applied, "content": updated}})
	}
}

// applyRecommendationsToContent merges each rule's Recommended value at
// its key path into the supplied JSON document, using sjson, honouring
// each recommendation's action and 值写法 (op/sep/values):
//
//	skip   → leave the field untouched
//	delete → delete the field (sjson.DeleteBytes)
//	set    → shape Recommended then write it
//
// Returns the updated content and the count of fields applied.
func applyRecommendationsToContent(content, providerPath, modelPath, providerID, modelID string, recs []model.AgentRecommendation) (string, int, error) {
	buf := []byte(content)
	applied := 0
	for _, r := range recs {
		action := r.RecommendAction()
		switch action {
		case "skip":
			continue
		case "delete":
			// delete the field regardless of provider/model scope
			next, ok, err := applyRecDeleteBytes(buf, r, providerPath, modelPath, providerID, modelID)
			if err != nil {
				return string(buf), applied, err
			}
			buf = next
			if ok {
				applied++
			}
			continue
		}
		if r.Recommended == nil {
			continue
		}
		value := r.Recommended
		if shaped, ok := r.ShapeValue(r.Recommended); ok {
			value = shaped
		}
		switch r.Scope {
		case "provider":
			full := providerPath + "." + escapeSjsonKey(providerID) + "." + r.Key
			next, err := sjson.SetBytes(buf, full, value)
			if err != nil {
				return string(buf), applied, fmt.Errorf("provider %q 字段 %s: %v", providerID, r.Key, err)
			}
			buf = next
			applied++
		case "model":
			if modelID == "" {
				continue
			}
			resolved := strings.ReplaceAll(modelPath, "{provider_id}", escapeSjsonKey(providerID))
			base, found := modelEntryPath(buf, resolved, modelID)
			if !found {
				if gjson.GetBytes(buf, resolved).IsArray() {
					continue // cannot fabricate an array element
				}
				base = resolved + "." + escapeSjsonKey(modelID)
			}
			full := base + "." + r.Key
			next, err := sjson.SetBytes(buf, full, value)
			if err != nil {
				return string(buf), applied, fmt.Errorf("model %q 字段 %s: %v", modelID, r.Key, err)
			}
			buf = next
			applied++
		}
	}
	return string(buf), applied, nil
}

// applyRecDeleteBytes deletes one recommendation's field from the JSON
// document. ok reports whether the field existed. Arrays of model entries
// (openclaw shape) are only deleted when the model itself exists.
func applyRecDeleteBytes(buf []byte, r model.AgentRecommendation, providerPath, modelPath, providerID, modelID string) ([]byte, bool, error) {
	switch r.Scope {
	case "provider":
		full := providerPath + "." + escapeSjsonKey(providerID) + "." + r.Key
		if !gjson.GetBytes(buf, full).Exists() {
			return buf, false, nil
		}
		next, err := sjson.DeleteBytes(buf, full)
		return next, true, err
	case "model":
		if modelID == "" {
			return buf, false, nil
		}
		resolved := strings.ReplaceAll(modelPath, "{provider_id}", escapeSjsonKey(providerID))
		base, found := modelEntryPath(buf, resolved, modelID)
		if !found {
			return buf, false, nil
		}
		full := base + "." + r.Key
		if !gjson.GetBytes(buf, full).Exists() {
			return buf, false, nil
		}
		next, err := sjson.DeleteBytes(buf, full)
		return next, true, err
	}
	return buf, false, nil
}

// stripJSON5Comments removes // and /* */ comments so gjson can parse
// JSON5 configs (e.g. openclaw). String contents are left alone so a
// URL like "https://foo" or an embedded "// not a comment" survives.
// escapeSjsonKey makes a JSON object key with arbitrary characters safe to
// embed in an sjson path: dots become `\.` (the sjson escape for a literal
// dot) and backslashes are doubled. Field paths in the rule stay untouched
// — they are authored gjson paths whose dots are real nesting.
func escapeSjsonKey(s string) string {
	if s == "" {
		return s
	}
	r := strings.NewReplacer(`\`, `\\`, `.`, `\.`)
	return r.Replace(s)
}

// modelEntryPath locates a model inside a resolved models container by its
// actual JSON shape. When the container is an object map the model is a key
// (e.g. opencode `provider.<id>.models.<modelId>`); when it is an array each
// element carries an `id` field (e.g. openclaw), so the array index of the
// element whose id matches is returned. The absolute sjson path of the model
// entry is the result; ok is false when the container is missing or the
// model cannot be found.
func modelEntryPath(content []byte, resolvedModels string, modelID string) (string, bool) {
	res := gjson.GetBytes(content, resolvedModels)
	if !res.Exists() {
		return "", false
	}
	if res.IsArray() {
		idx := int64(-1)
		res.ForEach(func(key, value gjson.Result) bool {
			if strings.EqualFold(strings.TrimSpace(value.Get("id").String()), strings.TrimSpace(modelID)) {
				idx = key.Int()
				return false
			}
			return true
		})
		if idx < 0 {
			return "", false
		}
		return fmt.Sprintf("%s.%d", resolvedModels, idx), true
	}
	return resolvedModels + "." + escapeSjsonKey(modelID), true
}

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
