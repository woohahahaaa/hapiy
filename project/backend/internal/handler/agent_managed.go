package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"slices"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
	"gorm.io/gorm"
)

// 托管 provider（添加托管provider）：把系统 Provider 表的供应商按
// endpoint 分组后生成 agent 配置文件里的 provider 块。生成的块来自
// agent-type 规则的公共推荐 + 按 endpoint 标签命中的协议推荐 + 用户
// 选择的 models.dev 参考供应商（生成四统一字段），因此只读。

// managedGroupView is the display state of one endpoint group, derived
// from the live system providers + the persisted group config.
type managedGroupView struct {
	Endpoint      string            `json:"endpoint"`
	Suffix        string            `json:"suffix"`
	ProviderNames []string          `json:"provider_names"`
	ProviderIDs   []string          `json:"provider_ids"` // 分组挂的供应商 id（含并入的无 endpoint 供应商），前端恢复手填 endpoint 用
	ModelCount    int               `json:"model_count"`
	ModelNames    []string          `json:"model_names"`
	ModelSources  map[string]string `json:"model_sources"`
	Generated     map[string]any    `json:"generated"`
	FileProvider  map[string]any    `json:"file_provider"` // normalized actual block, null when absent
	Pending       bool              `json:"pending"`
	PendingFields int               `json:"pending_fields"` // 与文件实际值不一致的叶子字段数（待同步）
}

type managedProviderView struct {
	ID               string                    `json:"id"`
	Name             string                    `json:"name"`
	ProviderIDs      []string                  `json:"provider_ids"`
	StaleProviderIDs []string                  `json:"stale_provider_ids"`
	Groups           []managedGroupView        `json:"groups"`
	HiddenGroups     []model.ManagedAgentGroup `json:"hidden_groups"`
	PendingSync      bool                      `json:"pending_sync"`
	PendingFields    int                       `json:"pending_fields"` // 全部分组待同步字段数之和
	APIKey           string                    `json:"api_key"`
	BaseURL          string                    `json:"base_url"`
	SourceName       string                    `json:"source_name"`
}

// ManagedProviderOptions lists the system Provider rows with endpoint /
// model counts so the 添加托管provider dialog can render its checkbox
// table. Deleted (stale) linked providers are reported separately by
// the managed-provider list endpoint; this endpoint only serves live
// rows.
func ManagedProviderOptions(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var providers []model.Provider
		if err := db.Order("name asc").Find(&providers).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		type option struct {
			ID             string              `json:"id"`
			Name           string              `json:"name"`
			Status         bool                `json:"status"`
			Endpoints      []string            `json:"endpoints"`
			Models         []string            `json:"models"`
			ModelEndpoints map[string][]string `json:"model_endpoints"`
			EndpointCount  int                 `json:"endpoint_count"`
			ModelCount     int                 `json:"model_count"`
		}
		out := make([]option, 0, len(providers))
		for _, p := range providers {
			eps := parseProviderEndpoints(p.Endpoints)
			mods := parseProviderModelNames(p.Models)
			out = append(out, option{
				ID: p.ID, Name: p.Name, Status: p.Status,
				Endpoints: eps, Models: mods,
				ModelEndpoints: parseProviderModelEndpoints(p.Models),
				EndpointCount:  len(eps), ModelCount: len(mods),
			})
		}
		// system_base_url is the same value generation uses (systemBaseURLPrefix),
		// so the托管 dialog can prefill/compare against the authoritative prefix
		// instead of window.location.origin.
		c.JSON(http.StatusOK, gin.H{"data": out, "system_base_url": systemBaseURLPrefix(c, db)})
	}
}

// ListManagedProviders derives the display state of every managed
// provider bound to the config file: groups re-computed from live
// providers (identical endpoints merge), hidden groups (all their
// providers deleted), stale linked ids, and the pending_sync flag
// comparing each group's generated block to the current file content.
func ListManagedProviders(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		row, ok := loadConfigFile(c, db)
		if !ok {
			return
		}
		var managed []model.ManagedAgentProvider
		if err := db.Where("agent_config_file_id = ?", row.ID).Order("created_at asc").Find(&managed).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		liveProviders, err := loadLiveProviders(db)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		rule, ok := loadRuleForRow(c, db, row)
		if !ok {
			return
		}
		content, err := readAgentConfigFileContent(&row, key)
		if err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "READ_FAILED", "读取失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		out := make([]managedProviderView, 0, len(managed))
		for _, m := range managed {
			view := deriveManagedProvider(rule, row, liveProviders, content, m, managedBasePrefix(c, db, m)+managedSourceMarkSuffix(m))
			out = append(out, view)
		}
		c.JSON(http.StatusOK, gin.H{"data": out})
	}
}

// CreateManagedProvider validates the requested name / suffix against
// the file's existing providers and other managed groups, then persists
// the provider link + endpoint groups.
func CreateManagedProvider(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		row, ok := loadConfigFile(c, db)
		if !ok {
			return
		}
		var req managedProviderRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		code, msg, params := validateManagedProviderRequest(db, row, key, req, "")
		if msg != "" {
			respondValidationError(c, code, msg, params)
			return
		}
		m := model.ManagedAgentProvider{
			AgentConfigFileID: row.ID,
			Name:              strings.TrimSpace(req.Name),
		}
		applyManagedAuthFields(&m, req)
		if err := m.SetProviderIDs(req.ProviderIDs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := m.SetGroups(req.Groups); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := db.Create(&m).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"data": m})
	}
}

// UpdateManagedProvider re-applies the same validation as create but
// excludes the provider's own groups from the conflict check, then
// persists the new link + groups.
func UpdateManagedProvider(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		row, ok := loadConfigFile(c, db)
		if !ok {
			return
		}
		var m model.ManagedAgentProvider
		if err := db.First(&m, "id = ?", c.Param("mid")).Error; err != nil {
			respondError(c, http.StatusNotFound, "MANAGED_PROVIDER_NOT_FOUND", "托管 provider 不存在")
			return
		}
		var req managedProviderRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		code, msg, params := validateManagedProviderRequest(db, row, key, req, m.ID)
		if msg != "" {
			respondValidationError(c, code, msg, params)
			return
		}
		m.Name = strings.TrimSpace(req.Name)
		applyManagedAuthFields(&m, req)
		if err := m.SetProviderIDs(req.ProviderIDs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := m.SetGroups(req.Groups); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := db.Save(&m).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// 改名 / 改分组保存时立即驱动配置文件：旧名字的块删掉、按新名字
		// 重新生成，避免旧块在保存瞬间掉进普通供应商列表（等下次同步才
		// 清理就晚了）。
		if _, _, err := rebuildManagedBlocks(c, db, &row, &m, key); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": m})
	}
}

// DeleteManagedProvider removes the managed provider row immediately
// (the confirm dialog already asked the user).
func DeleteManagedProvider(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := db.Delete(&model.ManagedAgentProvider{}, "id = ?", c.Param("mid")).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "deleted"})
	}
}

// SyncManagedProvider writes every non-hidden group's generated block
// into the live config file atomically, updates the content cache, and
// answers with the new content so the 管理模型 view can refresh its
// pending flags.
func SyncManagedProvider(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		row, ok := loadConfigFile(c, db)
		if !ok {
			return
		}
		var m model.ManagedAgentProvider
		if err := db.First(&m, "id = ?", c.Param("mid")).Error; err != nil {
			respondError(c, http.StatusNotFound, "MANAGED_PROVIDER_NOT_FOUND", "托管 provider 不存在")
			return
		}
		formatted, synced, err := rebuildManagedBlocks(c, db, &row, &m, key)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"synced": synced, "content": formatted}})
	}
}

// rebuildManagedBlocks regenerates the managed provider's blocks inside
// the config file: deletes stale blocks (previously synced names that no
// longer belong to the current name/groups — 改名/删除分组不留残留), writes
// the current generated blocks, persists file + DB content, and records
// the current block names. Returns the new content and the write count.
// Used by both 同步 and 保存（保存时立即驱动文件，避免旧名字在保存瞬间
// 掉进普通供应商列表）。
func rebuildManagedBlocks(c *gin.Context, db *gorm.DB, row *model.AgentConfigFile, m *model.ManagedAgentProvider, key []byte) (string, int, error) {
	rule, err := loadRule(db, row.AgentType)
	if err != nil {
		return "", 0, err
	}
	liveProviders, err := loadLiveProviders(db)
	if err != nil {
		return "", 0, err
	}
	content, err := readAgentConfigFileContent(row, key)
	if err != nil {
		return "", 0, fmt.Errorf("读取失败: %w", err)
	}
	jpaths, err := rule.GetJsonPaths()
	if err != nil {
		return "", 0, err
	}
	if strings.TrimSpace(jpaths.Provider) == "" {
		return "", 0, errors.New("该软件类型尚未配置 json 路径")
	}
	groups, err := m.GetGroups()
	if err != nil {
		return "", 0, err
	}
	// 生成配置文件时：endpoint 与命名后缀都相同的分组合并为一个
	// provider 块；endpoint 相同但命名后缀不同则保留各自独立块
	// （块名 = 规则名 + 后缀）。
	groupsByKey := make(map[string]model.ManagedAgentGroup, len(groups))
	for _, g := range groups {
		gkey := g.Endpoint + "\x00" + strings.TrimSpace(g.Suffix)
		if cur, ok := groupsByKey[gkey]; ok {
			cur.ProviderIDs = uniqueSorted(append(cur.ProviderIDs, g.ProviderIDs...))
			if cur.ModelSources == nil {
				cur.ModelSources = map[string]string{}
			}
			for k, v := range g.ModelSources {
				cur.ModelSources[k] = v
			}
			groupsByKey[gkey] = cur
			continue
		}
		groupsByKey[gkey] = g
	}
	ids, _ := m.GetProviderIDs()
	live, _ := liveProvision(ids, liveProviders)
	byID := map[string]model.Provider{}
	for _, p := range liveProviders {
		byID[p.ID] = p
	}
	membersOf := func(g model.ManagedAgentGroup) []model.Provider {
		if members := live[g.Endpoint]; len(members) > 0 {
			return members
		}
		var out []model.Provider
		for _, pid := range g.ProviderIDs {
			if p, ok := byID[pid]; ok {
				out = append(out, p)
			}
		}
		return out
	}

	cleaned := stripJSON5Comments(content)
	buf := []byte(cleaned)
	basePrefix := managedBasePrefix(c, db, *m) + managedSourceMarkSuffix(*m)
	// 上次同步写过的块名里，已不属于当前名字/分组的（改名、删分组）
	// 先整块删除，避免旧块残留成「普通供应商」。
	currentNames := make(map[string]bool, len(groupsByKey))
	for _, stored := range groupsByKey {
		currentNames[providerBlockName(m.Name, stored.Suffix)] = true
	}
	if previous, err := m.GetSyncedBlocks(); err == nil {
		for _, old := range previous {
			if currentNames[old] {
				continue
			}
			if next, derr := sjson.DeleteBytes(buf, jpaths.Provider+"."+old); derr == nil {
				buf = next
			}
		}
	}
	synced := 0
	for _, stored := range groupsByKey {
		members := membersOf(stored)
		if len(members) == 0 {
			continue
		}
		gen := buildGeneratedBlock(rule, jpaths, stored, members, m.APIKey, basePrefix, providerBlockName(m.Name, stored.Suffix))
		fullName := providerBlockName(m.Name, stored.Suffix)
		providerIDPath := jpaths.Provider + "." + fullName
		// 托管块由系统全权生成（不允许编辑）：先整块删除再重写，
		// 清掉上次同步遗留的旧模型条目和用户手改字段，保证同步后
		// 文件块与生成块全等（pending 收敛，不再永远「待同步」）。
		provFields, _ := gen["provider"].(map[string]any)
		// models 子树形状由规则的 models_container 决定：可能是 object
		// map（opencode）或 array of {id,...cfg}（openclaw）。rebuild
		// 整块重写即可，两种形状都能直接交给 sjson 序列化。
		var modelsValue any
		var modelsCount int
		switch m := gen["models"].(type) {
		case map[string]any:
			modelsValue = m
			modelsCount = len(m)
		case []map[string]any:
			modelsValue = m
			modelsCount = len(m)
		case []any:
			modelsValue = m
			modelsCount = len(m)
		}
		if len(provFields) > 0 || modelsCount > 0 {
			if next, err := sjson.DeleteBytes(buf, providerIDPath); err != nil {
				return "", 0, fmt.Errorf("provider 块 %s 重置失败: %w", fullName, err)
			} else {
				buf = next
			}
		}
		for k, v := range provFields {
			next, err := sjson.SetBytes(buf, providerIDPath+"."+k, v)
			if err != nil {
				return "", 0, fmt.Errorf("provider 字段 %s 写入失败: %w", k, err)
			}
			buf = next
			synced++
		}
		if strings.TrimSpace(jpaths.Model) != "" && modelsValue != nil {
			resolved := strings.ReplaceAll(jpaths.Model, "{provider_id}", fullName)
			// 模型名可能自带点（gpt-5.6-sol），逐字段拼 gjson 路径会把
			// 名字拆成嵌套对象，pending 平铺比较永远失败；整个 models
			// 子树一次写入，模型名按字面量落盘。
			next, err := sjson.SetBytes(buf, resolved, modelsValue)
			if err != nil {
				return "", 0, fmt.Errorf("模型列表写入失败: %w", err)
			}
			buf = next
			synced += modelsCount
		}
	}
	// sjson 只原地改写已有行，新增的 provider/模型块会被压成一行；
	// 写盘前整体重新缩进，保证同步后的文件始终是标准 pretty JSON。
	formatted := string(buf)
	if pretty, err := prettifyJSON(string(buf)); err == nil {
		formatted = pretty
	}
	if err := writeAgentConfigFileContent(row, formatted, key); err != nil {
		return "", 0, fmt.Errorf("写入失败: %w", err)
	}
	if err := db.Model(row).Update("content", formatted).Error; err != nil {
		return "", 0, err
	}
	// 记录本次写入的块名，供下次同步清理改名/删分组后的旧块。
	names := make([]string, 0, len(currentNames))
	for n := range currentNames {
		names = append(names, n)
	}
	slices.Sort(names)
	if namesJSON, merr := json.Marshal(names); merr == nil {
		if err := db.Model(m).Update("synced_blocks", string(namesJSON)).Error; err != nil {
			return "", 0, err
		}
	}
	return formatted, synced, nil
}

// ── request / helpers ──────────────────────────────────────────────

type managedProviderRequest struct {
	Name        string                    `json:"name"`
	ProviderIDs []string                  `json:"provider_ids"`
	Groups      []model.ManagedAgentGroup `json:"groups"`
	APIKey      string                    `json:"api_key"`
	BaseURL     string                    `json:"base_url"`
	SourceName  string                    `json:"source_name"`
}

// applyManagedAuthFields copies the access-key / base-url / source options
// from the request onto the row (shared by create & update).
func applyManagedAuthFields(m *model.ManagedAgentProvider, req managedProviderRequest) {
	m.APIKey = strings.TrimSpace(req.APIKey)
	m.BaseURL = strings.TrimSpace(req.BaseURL)
	m.SourceName = strings.TrimSpace(req.SourceName)
}

// validateManagedProviderRequest enforces the shared creation rules:
// name / link required; suffix required (and unique) when more than one
// endpoint group exists; every group's final provider name (base +
// suffix) must not collide with providers already in the file or with
// other managed providers' group names. selfID ("" on create) excludes
// the managed provider itself from the managed-name conflict check.
// It returns a stable code + message (+ interpolation params) for
// user-facing validation errors, and code "" for internal failures.
func validateManagedProviderRequest(db *gorm.DB, row model.AgentConfigFile, key []byte, req managedProviderRequest, selfID string) (string, string, gin.H) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return "MANAGED_NAME_REQUIRED", "供应商名字不能为空", nil
	}
	if len(req.ProviderIDs) == 0 {
		return "MANAGED_PROVIDER_REQUIRED", "请至少选择一个供应商", nil
	}
	liveProviders, err := loadLiveProviders(db)
	if err != nil {
		return "", err.Error(), nil
	}
	live, _ := liveProvision(req.ProviderIDs, liveProviders)
	byID := map[string]model.Provider{}
	for _, p := range liveProviders {
		byID[p.ID] = p
	}
	groupActive := func(g model.ManagedAgentGroup) bool {
		if len(live[g.Endpoint]) > 0 {
			return true
		}
		for _, pid := range g.ProviderIDs {
			if _, ok := byID[pid]; ok {
				return true
			}
		}
		return false
	}
	activeGroups := make([]model.ManagedAgentGroup, 0, len(req.Groups))
	for _, g := range req.Groups {
		if groupActive(g) {
			activeGroups = append(activeGroups, g)
		}
	}
	if len(activeGroups) == 0 {
		return "MANAGED_NO_AVAILABLE_ENDPOINT", "所选供应商没有可用的 endpoint", nil
	}

	// 1. suffix rules: required; 后缀唯一性按 (endpoint, 后缀) 判定 ——
	// 相同 endpoint 里重复的后缀会合并成一个 provider 块，允许；不同
	// endpoint 撞同名后缀才会是名字冲突。
	if len(activeGroups) > 1 {
		suffixEndpoint := make(map[string]string, len(activeGroups))
		for _, g := range activeGroups {
			suffix := strings.TrimSpace(g.Suffix)
			if suffix == "" {
				return "MANAGED_SUFFIX_REQUIRED", fmt.Sprintf("有多个 endpoint 分组，必须为 %s 填写后缀", g.Endpoint), gin.H{"endpoint": g.Endpoint}
			}
			if prev, ok := suffixEndpoint[suffix]; ok && prev != g.Endpoint {
				return "MANAGED_SUFFIX_DUPLICATE", fmt.Sprintf("后缀 %q 重复", suffix), gin.H{"suffix": suffix}
			}
			suffixEndpoint[suffix] = g.Endpoint
		}
	}

	// 2. name conflicts against the live file's providers.
	content, err := readAgentConfigFileContent(&row, key)
	if err != nil {
		return "", "读取配置失败: " + err.Error(), nil
	}
	rule, err := loadRule(db, row.AgentType)
	if err != nil {
		return "", err.Error(), nil
	}
	jpaths, _ := rule.GetJsonPaths()
	existing := map[string]bool{}
	if strings.TrimSpace(jpaths.Provider) != "" {
		provResult := gjson.Parse(stripJSON5Comments(content)).Get(jpaths.Provider)
		if provResult.IsObject() {
			for id := range provResult.Map() {
				existing[id] = true
			}
		}
	}
	// 本托管 provider 自己（按 selfID）历史生成的块名：根名 + 各分组名。
	// 这些名字在重存/合并时应当原地覆盖，而不是被当成同名冲突。
	ownBlocks := map[string]bool{}
	if selfID != "" {
		var self model.ManagedAgentProvider
		if err := db.Where("id = ?", selfID).First(&self).Error; err == nil {
			ownBlocks[strings.TrimSpace(self.Name)] = true
			if gs, gerr := self.GetGroups(); gerr == nil {
				for _, g := range gs {
					ownBlocks[providerBlockName(self.Name, strings.TrimSpace(g.Suffix))] = true
				}
			}
		}
	}
	for _, g := range activeGroups {
		full := providerBlockName(name, strings.TrimSpace(g.Suffix))
		// 本托管 provider 自己上次同步生成的块不算冲突：重存/合并时原地覆盖。
		if existing[full] && !ownBlocks[full] {
			return "MANAGED_NAME_CONFLICT_FILE", fmt.Sprintf("名称 %q 与配置文件里已有的 provider 同名，请更换名字或后缀", full), gin.H{"name": full}
		}
	}

	// 3. name conflicts against other managed providers' group names.
	// Root name must not equal another managed provider's root name, and
	// each final group name must not collide with their group names.
	var managed []model.ManagedAgentProvider
	if err := db.Where("agent_config_file_id = ?", row.ID).Find(&managed).Error; err != nil {
		return "", err.Error(), nil
	}
	for _, m := range managed {
		if selfID != "" && m.ID == selfID {
			continue
		}
		if m.Name == name {
			return "MANAGED_NAME_CONFLICT_MANAGED", fmt.Sprintf("名称 %q 与其他托管 provider 同名", name), gin.H{"name": name}
		}
		mGroups, err := m.GetGroups()
		if err != nil {
			continue
		}
		for _, g := range mGroups {
			blockName := providerBlockName(m.Name, g.Suffix)
			if blockName == name {
				return "MANAGED_NAME_CONFLICT_MANAGED", fmt.Sprintf("名称 %q 与其他托管 provider 同名", name), gin.H{"name": name}
			}
			for _, ag := range activeGroups {
				full := providerBlockName(name, strings.TrimSpace(ag.Suffix))
				if blockName == full && full != "" {
					return "MANAGED_GROUP_NAME_CONFLICT", fmt.Sprintf("名称 %q 与其他托管 provider 的分组同名", full), gin.H{"name": full}
				}
			}
		}
	}
	return "", "", nil
}

// respondValidationError writes a structured 400 response for a
// validateManagedProviderRequest result. Internal failures (code "")
// keep the raw message fallback.
func respondValidationError(c *gin.Context, code, msg string, params gin.H) {
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if len(params) > 0 {
		respondErrorWithParams(c, http.StatusBadRequest, code, msg, params)
		return
	}
	respondError(c, http.StatusBadRequest, code, msg)
}

// deriveManagedProvider recomputes the endpoint groups from the live
// linked providers, merges persisted suffix / model sources by exact
// endpoint, marks hidden groups and stale ids, and computes pending
// sync per group by comparing the generated block with the file.
func deriveManagedProvider(rule model.AgentTypeRule, row model.AgentConfigFile, liveProviders []model.Provider, content string, m model.ManagedAgentProvider, basePrefix string) managedProviderView {
	view := managedProviderView{ID: m.ID, Name: m.Name, APIKey: m.APIKey, BaseURL: m.BaseURL, SourceName: m.SourceName}
	view.ProviderIDs, _ = m.GetProviderIDs()
	live, deletedIDs := liveProvision(view.ProviderIDs, liveProviders)
	view.StaleProviderIDs = deletedIDs
	storedGroups, _ := m.GetGroups()
	byID := map[string]model.Provider{}
	for _, p := range liveProviders {
		byID[p.ID] = p
	}
	membersOf := func(g model.ManagedAgentGroup) []model.Provider {
		if members := live[g.Endpoint]; len(members) > 0 {
			return members
		}
		var out []model.Provider
		for _, pid := range g.ProviderIDs {
			if p, ok := byID[pid]; ok {
				out = append(out, p)
			}
		}
		return out
	}
	jpaths, _ := rule.GetJsonPaths()
	provResult := gjson.Parse(stripJSON5Comments(content)).Get(jpaths.Provider)

	// Hidden = persisted groups that resolve no live members (deleted or
	// paused providers for ordinary endpoint groups; dangling ids for the
	// 未配置 endpoint group).
	for _, stored := range storedGroups {
		if len(membersOf(stored)) == 0 {
			view.HiddenGroups = append(view.HiddenGroups, stored)
		}
	}

	for _, stored := range storedGroups {
		members := membersOf(stored)
		if len(members) == 0 {
			continue
		}
		mv := managedGroupView{
			Endpoint:     stored.Endpoint,
			Suffix:       stored.Suffix,
			ProviderIDs:  stored.ProviderIDs,
			ModelSources: stored.ModelSources,
		}
		for _, p := range members {
			mv.ProviderNames = append(mv.ProviderNames, p.Name)
		}
		mv.ModelNames = uniqueSorted(membersModelNames(members))
		mv.ModelCount = len(mv.ModelNames)
		gen := buildGeneratedBlock(rule, jpaths, stored, members, m.APIKey, basePrefix, providerBlockName(m.Name, stored.Suffix))
		mv.Generated = gen
		fullName := providerBlockName(m.Name, stored.Suffix)
		actual := normalizeFileProvider(provResult.Get(fullName), jpaths)
		mv.FileProvider = actual
		expected := normalizeGenerated(gen)
		mv.Pending = !deepEqualJSON(expected, actual)
		if mv.Pending {
			view.PendingSync = true
		}
		mv.PendingFields = countDiffLeaves(expected, actual)
		view.PendingFields += mv.PendingFields
		view.Groups = append(view.Groups, mv)
	}
	return view
}

// buildGeneratedBlock assembles the normalized provider block for one
// endpoint group: provider-level fields from the rule's common recs plus
// the protocol matched by this endpoint's suffix tags, the full access URL
// (system base URL [+/__来源] + endpoint, written into the protocol's /
// provider baseURL-ish field when present), and the model list with the
// four unified fields filled from the chosen models.dev reference
// suppliers. apiKeyOverride is the 令牌 key chosen in the 托管 dialog;
// empty falls back to the first linked provider's key (legacy rows).
func buildGeneratedBlock(rule model.AgentTypeRule, jpaths model.AgentJsonPaths, group model.ManagedAgentGroup, members []model.Provider, apiKeyOverride string, basePrefix string, displayName string) map[string]any {
	recs, _ := rule.GetRecommendations()
	protocols, _ := rule.GetProtocols()
	mif, _ := rule.GetModelInfoFields()
	protocol := matchProtocolByEndpoint(group.Endpoint, protocols)

	providerRecs := recsForScope(recs, "provider")
	modelRecs := recsForScope(recs, "model")
	if protocol != nil {
		providerRecs = append(providerRecs, recsForScope(protocol.Recommendations, "provider")...)
		modelRecs = append(modelRecs, recsForScope(protocol.Recommendations, "model")...)
	}

	// models.dev snapshot for the reference-supplier capability lookup.
	// Fetch failures degrade to "no model info" rather than failing the
	// whole view/sync: the snapshot endpoint served the UI already, and a
	// transient network error must not break config generation.
	mdModels, _ := modelsDev.load()

	block := map[string]any{}
	applyRecToMap(block, providerRecs)
	// name：模板声明了 name 字段时自动填成 provider 显示名（规则名+后缀），
	// 避免生成的块没有显示名、在 opencode 里不好认。
	if hasRecommendationKey(providerRecs, "name") {
		_ = setDottedValue(block, "name", displayName)
	}
	// baseURL = 系统 BaseURL [+ /__来源]（+ endpoint，当规则没有声明协议/
	// SDK 驱动字段时）：prefer the protocol's first condition field ending
	// in baseURL/baseUrl/url, then any common provider rec key that looks
	// like a URL field. 声明了 api/npm 等驱动字段的规则（opencode 的 npm、
	// openclaw 的 api）由 agent 自己拼操作路径（/chat/completions 等），
	// baseURL 只写到根；未声明的（WorkBuddy 的 url 是完整地址语义）才把
	// endpoint 拼进 baseURL。
	if field := endpointFieldFor(protocol, providerRecs); field != "" {
		url := strings.TrimSuffix(basePrefix, "/")
		if !ruleAppendsPathItself(providerRecs) {
			url += group.Endpoint
		}
		_ = setDottedValue(block, field, url)
	}
	// apiKey: only the dialog-chosen 令牌 key is written. Missing (未填)
	// keys are left out of the generated block instead of silently falling
	// back to a linked provider's key, which previously produced surprises
	// like a managed provider borrowing someone else's key.
	if key := apiKeyFieldFor(providerRecs); key != "" {
		if k := apiKeyOverride; k != "" {
			_ = setDottedValue(block, key, k)
		}
	}

	models := buildManagedModels(jpaths.ModelsContainer, members, modelRecs, group, mif, mdModels)
	return map[string]any{"provider": block, "models": models}
}

// buildManagedModels emits the per-provider `models` subtree in the
// shape declared by the rule (`jpaths.ModelsContainer`): array of
// {id, name, ...cfg} when "array" (openclaw-style), or object map keyed
// by model name whose value is the cfg object when "object"
// (opencode-style). Empty value falls back to "object" so legacy rules
// without the field keep their old behaviour.
func buildManagedModels(container string, members []model.Provider, modelRecs []model.AgentRecommendation, group model.ManagedAgentGroup, mif model.AgentModelInfoFieldPaths, mdModels []modelsDevModel) any {
	names := uniqueSorted(membersModelNames(members))
	if strings.EqualFold(strings.TrimSpace(container), "array") {
		out := make([]map[string]any, 0, len(names))
		for _, name := range names {
			cfg := buildOneModelCfg(name, modelRecs, group, mif, mdModels)
			// 数组形状：每项必须有 id 字段（openclaw / 校验依赖此键）。
			// name 字段由 rec 决定是否写入（模板里 `name` 字段的
			// Recommended 通常是 null，循环里会跳过），所以这里只在
			// cfg 没有同名键时回填。
			if _, hasID := cfg["id"]; !hasID {
				cfg["id"] = name
			}
			if _, hasName := cfg["name"]; !hasName {
				cfg["name"] = name
			}
			out = append(out, cfg)
		}
		return out
	}
	out := map[string]any{}
	for _, name := range names {
		cfg := buildOneModelCfg(name, modelRecs, group, mif, mdModels)
		out[name] = cfg
	}
	return out
}

// buildOneModelCfg fills one model's config object: recs (respecting each
// recommendation's action / 值写法), then the four unified model-info
// fields from the chosen models.dev reference supplier. Returns an empty
// object when no values are available so the entry still shows up.
func buildOneModelCfg(name string, modelRecs []model.AgentRecommendation, group model.ManagedAgentGroup, mif model.AgentModelInfoFieldPaths, mdModels []modelsDevModel) map[string]any {
	cfg := map[string]any{}
	applyRecToMap(cfg, modelRecs)
	if supplier := group.ModelSources[name]; supplier != "" {
		if mdModels != nil {
			if row, ok := findModelsDevRow(mdModels, name, supplier); ok {
				applyModelInfoFromModelsDev(row, mif, cfg)
			}
		}
	}
	return cfg
}

// applyRecToMap writes a batch of recommendations into a config map in
// one place, honoring each rec's action (set/skip/delete) and its
// 值写法 (op/sep/values):
//
//   - action=skip            → leave the field untouched
//   - action=delete          → delete the field from the map
//   - action=set (default)   → shape the Recommended value, write it
//
// Dotted keys are honoured via setDottedValue / deleteDottedValue.
func applyRecToMap(m map[string]any, recs []model.AgentRecommendation) {
	for _, r := range recs {
		switch r.RecommendAction() {
		case "skip":
			continue
		case "delete":
			deleteDottedValue(m, r.Key)
			continue
		}
		if r.Recommended == nil {
			continue
		}
		if v, ok := r.ShapeValue(r.Recommended); ok {
			_ = setDottedValue(m, r.Key, v)
		}
	}
}

// deleteDottedValue removes the value at a dotted path inside m,
// pruning empty intermediate objects along the way.
func deleteDottedValue(m map[string]any, path string) {
	segs := strings.Split(path, ".")
	cur := m
	for i, seg := range segs {
		if seg == "" {
			return
		}
		if i == len(segs)-1 {
			delete(cur, seg)
			return
		}
		next, ok := cur[seg]
		if !ok {
			return
		}
		child, ok := next.(map[string]any)
		if !ok {
			return
		}
		cur = child
	}
}

// matchProtocolByEndpoint returns the first protocol whose 词库里任一
// endpoint 关键词是 endpoint 的子串（包含即命中，例如关键词
// "completions" 命中 "/v1/chat/completions"）。
func matchProtocolByEndpoint(endpoint string, protocols []model.AgentProtocol) *model.AgentProtocol {
	for i := range protocols {
		for _, tag := range protocols[i].EndpointTags {
			tag = strings.TrimSpace(tag)
			if tag != "" && strings.Contains(endpoint, tag) {
				return &protocols[i]
			}
		}
	}
	return nil
}

// endpointFieldFor picks where the group's endpoint should be written:
// the protocol's first condition field whose path looks like a base URL,
// else the first provider rec field named like one.
func endpointFieldFor(protocol *model.AgentProtocol, recs []model.AgentRecommendation) string {
	if protocol != nil {
		for _, cond := range protocol.Conditions {
			if looksLikeURIField(cond.Field) {
				return cond.Field
			}
		}
	}
	for _, r := range recs {
		if looksLikeURIField(r.Key) && r.Recommended == nil {
			return r.Key
		}
	}
	return ""
}

func looksLikeURIField(field string) bool {
	lower := strings.ToLower(field)
	return strings.HasSuffix(lower, "baseurl") || strings.HasSuffix(lower, "base_url") || strings.HasSuffix(lower, "url") || field == "baseUrl"
}

// ruleAppendsPathItself reports whether the rule's provider recs declare a
// protocol / SDK driver field (openclaw's `api`, opencode's `npm`,
// codex's `wire_api`, ...) that makes the agent append the operation path
// itself (e.g. /chat/completions). Managed generation then writes the
// baseURL without the endpoint suffix; rules with no such field (e.g.
// WorkBuddy's `url` is a full-URL semantics) keep the endpoint in baseURL.
func ruleAppendsPathItself(recs []model.AgentRecommendation) bool {
	for _, r := range recs {
		switch strings.ToLower(strings.TrimSpace(r.Key)) {
		case "api", "npm", "package", "wire_api", "wireapi", "sdk", "adapter":
			return true
		}
	}
	return false
}

// apiKeyFieldFor returns the dotted path of a required provider rec
// whose leaf looks like an api key field, "" when none.
func apiKeyFieldFor(recs []model.AgentRecommendation) string {
	for _, r := range recs {
		lower := strings.ToLower(r.Key)
		if r.Required && r.Recommended == nil && (strings.HasSuffix(lower, "apikey") || strings.HasSuffix(lower, "key")) {
			return r.Key
		}
	}
	return ""
}

// applyModelInfoFromModelsDev fills the five unified model-config fields
// from a models.dev row (matched by the model name + the reference
// supplier stored in the group's ModelSources), writing each value at its
// rule-configured path after shaping it with the field spec's op (e.g.
// opencode's `reasoning` boolean). Each field spec's action is honoured:
// "skip" leaves the field untouched, "delete" removes it from the config,
// and "set" (default) writes the shaped value. Nothing is persisted here:
// the view / generation reads the live snapshot each time.
//
// reasoning_effort 的来源是 models.dev 的 reasoning_options effort 枚举
// （该模型支持的思考档位数组，跟 input_types 同构），经 spec 的 op/values
// 变形后写入；没有枚举的模型不写。思考档位的“选哪一档”由 spec 表达
// （op=first + values 白名单），统一层不掺默认值。
func applyModelInfoFromModelsDev(row modelsDevModel, mif model.AgentModelInfoFieldPaths, cfg map[string]any) {
	writeSpec := func(spec model.AgentModelInfoFieldSpec, raw any) {
		if spec.Path == "" {
			return
		}
		switch spec.RecommendAction() {
		case "skip":
			return
		case "delete":
			deleteDottedValue(cfg, spec.Path)
			return
		}
		if v, ok := spec.Shape(raw); ok {
			_ = setDottedValue(cfg, spec.Path, v)
		}
	}
	if mif.MaxContext.Path != "" && row.ContextLength > 0 {
		writeSpec(mif.MaxContext, row.ContextLength)
	}
	if mif.MaxOutputToken.Path != "" && row.MaxOutput > 0 {
		writeSpec(mif.MaxOutputToken, row.MaxOutput)
	}
	if len(row.InputTypes) > 0 && mif.InputTypes.Path != "" {
		vals := make([]any, len(row.InputTypes))
		for i, s := range row.InputTypes {
			vals[i] = s
		}
		writeSpec(mif.InputTypes, vals)
	}
	if mif.ThinkingLevels.Path != "" && row.Reasoning {
		writeSpec(mif.ThinkingLevels, []any{"high"})
	}
	if mif.ReasoningEffort.Path != "" && len(row.EffortLevels) > 0 {
		levels := make([]any, len(row.EffortLevels))
		for i, s := range row.EffortLevels {
			levels[i] = s
		}
		writeSpec(mif.ReasoningEffort, levels)
	}
}

// providerBlockName joins the root name and the group suffix.
func providerBlockName(name, suffix string) string {
	return strings.TrimSpace(name) + strings.TrimSpace(suffix)
}

// settingSystemBaseURL stores the stable system-base-URL prefix configured
// on the BaseURL settings page (e.g. "https://hapiying.hihy.me:6060/proxy").
// When set it wins over the request-derived fallback so managed providers
// that choose 跟随系统 keep the same prefix regardless of which origin the
// dashboard request arrived through (公网域名/隧道反代会把请求 Host 改掉)。
const settingSystemBaseURL = "system_base_url"

// systemBaseURLPrefix resolves the对外 BaseURL: the system_base_url
// setting when configured, else scheme://host/{suffix} derived from the
// current dashboard request + the base_url_suffix setting. The setting is
// the single source of truth for both the托管 dialog's 系统自动值 and the
// generated JSON, so 跟随系统 stays consistent even behind a tunnel that
// rewrites the request Host.
func systemBaseURLPrefix(c *gin.Context, db *gorm.DB) string {
	if v, err := service.GetSetting(db, settingSystemBaseURL); err == nil {
		if p := strings.TrimSpace(v); p != "" {
			return strings.TrimSuffix(p, "/")
		}
	}
	scheme := "http"
	if c != nil && c.Request != nil {
		if proto := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")); proto == "https" {
			scheme = "https"
		} else if c.Request.TLS != nil {
			scheme = "https"
		}
	}
	host := ""
	if c != nil && c.Request != nil {
		host = strings.TrimSpace(c.Request.Host)
	}
	suffix := "proxy"
	if v, err := service.GetSetting(db, "base_url_suffix"); err == nil && strings.TrimSpace(v) != "" {
		suffix = strings.TrimSpace(v)
	}
	return scheme + "://" + host + "/" + suffix
}

// managedBasePrefix resolves the base URL prefix for a managed provider:
// its explicit BaseURL override when set, else the system base URL derived
// from the current request + the base_url_suffix setting.
func managedBasePrefix(c *gin.Context, db *gorm.DB, m model.ManagedAgentProvider) string {
	if override := strings.TrimSpace(m.BaseURL); override != "" {
		return strings.TrimSuffix(override, "/")
	}
	return systemBaseURLPrefix(c, db)
}

// managedSourceMarkSuffix returns the "/__来源" segment appended after the
// base URL when the managed provider has a 来源名 filled in (BaseURL
// settings page 标记来源 logic); empty 来源名 = no mark.
func managedSourceMarkSuffix(m model.ManagedAgentProvider) string {
	name := strings.TrimSpace(m.SourceName)
	if name == "" {
		return ""
	}
	return "/__" + name
}

// liveProvision splits the system providers referenced by the managed
// row into live (still in DB) and deleted (stale), then groups live
// providers by their exact endpoint strings. Providers with no
// endpoints are ignored for grouping (their models were never synced).
func liveProvision(ids []string, liveProviders []model.Provider) (map[string][]model.Provider, []string) {
	want := make(map[string]bool, len(ids))
	for _, id := range ids {
		want[id] = true
	}
	byID := make(map[string]model.Provider, len(liveProviders))
	for _, p := range liveProviders {
		byID[p.ID] = p
	}
	var stale []string
	live := map[string][]model.Provider{}
	for _, id := range ids {
		p, ok := byID[id]
		if !ok {
			stale = append(stale, id)
			continue
		}
		for _, ep := range parseProviderEndpoints(p.Endpoints) {
			if strings.TrimSpace(ep) == "" {
				continue
			}
			live[ep] = append(live[ep], p)
		}
	}
	return live, stale
}

func membersModelNames(members []model.Provider) []string {
	var out []string
	for _, p := range members {
		out = append(out, parseProviderModelNames(p.Models)...)
	}
	return out
}

func uniqueSorted(names []string) []string {
	seen := make(map[string]bool, len(names))
	var out []string
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	return out
}

func recsForScope(recs []model.AgentRecommendation, scope string) []model.AgentRecommendation {
	var out []model.AgentRecommendation
	for _, r := range recs {
		if r.Scope == scope {
			out = append(out, r)
		}
	}
	return out
}

// hasRecommendationKey reports whether any rec declares the exact key,
// regardless of its Recommended value (used to auto-fill std display
// fields like provider `name`).
func hasRecommendationKey(recs []model.AgentRecommendation, key string) bool {
	for _, r := range recs {
		if r.Key == key {
			return true
		}
	}
	return false
}

// normalizeFileProvider turns a file provider block (other fields + its
// models subtree whatever its shape) into the same {fields…, models:
// {name: cfg}} shape used by generated blocks so pending compares
// cleanly. Returns nil when the provider is absent or not an object.
func normalizeFileProvider(val gjson.Result, jpaths model.AgentJsonPaths) map[string]any {
	if !val.IsObject() {
		return nil
	}
	out := map[string]any{}
	modelLeaf := lastPathSegment(jpaths.Model)
	models := map[string]any{}
	for k, v := range val.Map() {
		if k == modelLeaf && (v.IsObject() || v.IsArray()) {
			if v.IsArray() {
				for _, item := range v.Array() {
					id := item.Get("id").String()
					if id == "" {
						id = item.Get("name").String()
					}
					if id != "" && item.IsObject() {
						models[id] = gjsonToMap(item)
					}
				}
			} else {
				for id, mv := range v.Map() {
					if mv.IsObject() {
						models[id] = gjsonToMap(mv)
					}
				}
			}
			continue
		}
		out[k] = gjsonValueToAny(v)
	}
	out["models"] = models
	return out
}

// normalizeGenerated flattens the {provider:…, models:…} shape produced
// by buildGeneratedBlock into {fields…, models:{id: cfg}} so it can be
// compared against normalizeFileProvider's output. Both shapes — object
// map keyed by id, and array of {id, ...cfg} — collapse to the same
// map form here so the pending diff stays shape-agnostic.
func normalizeGenerated(gen map[string]any) map[string]any {
	out := map[string]any{}
	provider, _ := gen["provider"].(map[string]any)
	models := map[string]any{}
	switch m := gen["models"].(type) {
	case map[string]any:
		for id, cfg := range m {
			models[id] = cfg
		}
	case []any:
		for _, raw := range m {
			item, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			id, _ := item["id"].(string)
			if id == "" {
				if name, _ := item["name"].(string); name != "" {
					id = name
				}
			}
			if id == "" {
				continue
			}
			models[id] = item
		}
	case []map[string]any:
		for _, item := range m {
			id, _ := item["id"].(string)
			if id == "" {
				if name, _ := item["name"].(string); name != "" {
					id = name
				}
			}
			if id == "" {
				continue
			}
			models[id] = item
		}
	}
	for k, v := range provider {
		out[k] = v
	}
	out["models"] = models
	return out
}

func gjsonToMap(v gjson.Result) map[string]any {
	out := map[string]any{}
	for k, mv := range v.Map() {
		out[k] = gjsonValueToAny(mv)
	}
	return out
}

func gjsonValueToAny(v gjson.Result) any {
	switch v.Type {
	case gjson.String:
		return v.String()
	case gjson.Number:
		return v.Num
	case gjson.True:
		return true
	case gjson.False:
		return false
	case gjson.JSON:
		if v.IsArray() {
			arr := v.Array()
			out := make([]any, len(arr))
			for i, item := range arr {
				out[i] = gjsonValueToAny(item)
			}
			return out
		}
		return gjsonToMap(v)
	default:
		return nil
	}
}

// deepEqualJSON is a JSON-semantic deep equality (map keys unordered).
func deepEqualJSON(a, b map[string]any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	aj, _ := json.Marshal(a)
	bj, _ := json.Marshal(b)
	var am, bm any
	if err := json.Unmarshal(aj, &am); err != nil {
		return false
	}
	if err := json.Unmarshal(bj, &bm); err != nil {
		return false
	}
	return fmt.Sprintf("%v", am) == fmt.Sprintf("%v", bm)
}

// countDiffLeaves counts leaf-level differences between two JSON values:
// a key present on only one side counts once, and differing leaf values
// count once per field. Nested objects recurse; arrays compare as whole
// values (DeepEqual). Used for the 待同步字段数 badge in the 管理模型 view.
func countDiffLeaves(a, b any) int {
	am, aok := a.(map[string]any)
	bm, bok := b.(map[string]any)
	if aok && bok {
		keys := make(map[string]struct{}, len(am)+len(bm))
		for k := range am {
			keys[k] = struct{}{}
		}
		for k := range bm {
			keys[k] = struct{}{}
		}
		n := 0
		for k := range keys {
			av, ahas := am[k]
			bv, bhas := bm[k]
			if !ahas || !bhas {
				n++
				continue
			}
			n += countDiffLeaves(av, bv)
		}
		return n
	}
	if reflect.DeepEqual(a, b) {
		return 0
	}
	return 1
}

// setDottedValue writes v at a dotted path inside m, creating
func setDottedValue(m map[string]any, path string, v any) error {
	segs := strings.Split(path, ".")
	cur := m
	for i, seg := range segs {
		if seg == "" {
			return fmt.Errorf("空路径段 %q", path)
		}
		if i == len(segs)-1 {
			cur[seg] = v
			return nil
		}
		next, ok := cur[seg]
		if !ok || !isObjectMap(next) {
			n := map[string]any{}
			cur[seg] = n
			cur = n
			continue
		}
		cur = next.(map[string]any)
	}
	return nil
}

func isObjectMap(v any) bool {
	_, ok := v.(map[string]any)
	return ok
}

// parseStringArray parses a stored JSON array string.
func parseStringArray(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var arr []string
	if err := json.Unmarshal([]byte(raw), &arr); err != nil {
		return nil
	}
	return arr
}

// mustJSON serializes a value, ignoring errors (only used for blobs that
// always serialize).
func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// parseProviderEndpoints extracts the endpoint list of a system
// Provider row. Endpoints are stored as an object array with a
// "pathSuffix" field (e.g. [{"pathSuffix":"/v1/chat/completions"}]),
// but plain string arrays are tolerated too.
func parseProviderEndpoints(raw string) []string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil
	}
	var plain []string
	if err := json.Unmarshal([]byte(s), &plain); err == nil {
		return plain
	}
	var objs []struct {
		PathSuffix string `json:"pathSuffix"`
	}
	if err := json.Unmarshal([]byte(s), &objs); err != nil {
		return nil
	}
	var out []string
	for _, o := range objs {
		if strings.TrimSpace(o.PathSuffix) != "" {
			out = append(out, strings.TrimSpace(o.PathSuffix))
		}
	}
	return out
}

// parseProviderModelNames extracts the model names of a system Provider
// row. Models are stored as an object array with a "model" field (e.g.
// [{"model":"deepseek-v4-flash","endpoints":[...],"rate":"1"}]), but
// plain string arrays are tolerated too.
func parseProviderModelNames(raw string) []string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil
	}
	var plain []string
	if err := json.Unmarshal([]byte(s), &plain); err == nil {
		return plain
	}
	var objs []struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal([]byte(s), &objs); err != nil {
		return nil
	}
	var out []string
	for _, o := range objs {
		if strings.TrimSpace(o.Model) != "" {
			out = append(out, strings.TrimSpace(o.Model))
		}
	}
	return out
}

// parseProviderModelEndpoints extracts each model's endpoint list from a
// system Provider row (object-array shape [{"model":"x","endpoints":[...]}])
// keyed by model name. Plain string arrays and rows without a models array
// yield an empty map (front end then treats every model as 不限). This
// powers the managed-provider dialog's endpoint grouping: a model whose
// endpoints are empty (不限) is matched against the supplier's first
// endpoint, while explicit endpoints land in their own groups.
func parseProviderModelEndpoints(raw string) map[string][]string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var plain []string
	if err := json.Unmarshal([]byte(raw), &plain); err == nil {
		return nil // no per-model endpoint info
	}
	var objs []struct {
		Model     string   `json:"model"`
		Endpoints []string `json:"endpoints"`
	}
	if err := json.Unmarshal([]byte(raw), &objs); err != nil {
		return nil
	}
	out := make(map[string][]string, len(objs))
	for _, o := range objs {
		name := strings.TrimSpace(o.Model)
		if name == "" {
			continue
		}
		var eps []string
		for _, e := range o.Endpoints {
			if e = strings.TrimSpace(e); e != "" {
				eps = append(eps, e)
			}
		}
		out[name] = eps
	}
	return out
}

func loadLiveProviders(db *gorm.DB) ([]model.Provider, error) {
	var providers []model.Provider
	if err := db.Find(&providers).Error; err != nil {
		return nil, err
	}
	return providers, nil
}

func loadRule(db *gorm.DB, name string) (model.AgentTypeRule, error) {
	var rule model.AgentTypeRule
	// 按名称识别规则时大小写不敏感：接管的 record_name / agent_type 可能是
	// "OpenCode" 而规则叫 "opencode"，SQLite 默认 BINARY collation 区分
	// 大小写，直接用 `name = ?` 会漏配。
	err := db.Where("LOWER(name) = LOWER(?)", name).First(&rule).Error
	return rule, err
}

func loadConfigFile(c *gin.Context, db *gorm.DB) (model.AgentConfigFile, bool) {
	var row model.AgentConfigFile
	if err := db.First(&row, "id = ?", c.Param("id")).Error; err != nil {
		respondError(c, http.StatusNotFound, "CONFIG_NOT_FOUND", "配置不存在")
		return row, false
	}
	return row, true
}

func loadRuleForRow(c *gin.Context, db *gorm.DB, row model.AgentConfigFile) (model.AgentTypeRule, bool) {
	rule, err := loadRule(db, row.AgentType)
	if err != nil {
		respondErrorWithParams(c, http.StatusBadRequest, "AGENT_TYPE_RULE_MISSING", "未找到该软件类型的规则: "+row.AgentType, gin.H{"name": row.AgentType})
		return rule, false
	}
	return rule, true
}
