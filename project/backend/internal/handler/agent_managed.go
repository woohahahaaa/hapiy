package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
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
	ModelCount    int               `json:"model_count"`
	ModelNames    []string          `json:"model_names"`
	ModelSources  map[string]string `json:"model_sources"`
	Generated     map[string]any    `json:"generated"`
	FileProvider  map[string]any    `json:"file_provider"` // normalized actual block, null when absent
	Pending       bool              `json:"pending"`
}

type managedProviderView struct {
	ID               string                   `json:"id"`
	Name             string                   `json:"name"`
	ProviderIDs      []string                 `json:"provider_ids"`
	StaleProviderIDs []string                 `json:"stale_provider_ids"`
	Groups           []managedGroupView       `json:"groups"`
	HiddenGroups     []model.ManagedAgentGroup `json:"hidden_groups"`
	PendingSync      bool                     `json:"pending_sync"`
	APIKey           string                   `json:"api_key"`
	UseSourceMark    bool                     `json:"use_source_mark"`
	SourceName       string                   `json:"source_name"`
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
		c.JSON(http.StatusOK, gin.H{"data": out})
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
			c.JSON(http.StatusBadRequest, gin.H{"error": "读取失败: " + err.Error()})
			return
		}
		out := make([]managedProviderView, 0, len(managed))
		basePrefix := systemBaseURLPrefix(c, db)
		for _, m := range managed {
			view := deriveManagedProvider(rule, row, liveProviders, content, m, basePrefix+managedSourceMarkSuffix(m))
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
		msg := validateManagedProviderRequest(db, row, key, req, "")
		if msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
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
			c.JSON(http.StatusNotFound, gin.H{"error": "托管 provider 不存在"})
			return
		}
		var req managedProviderRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		msg := validateManagedProviderRequest(db, row, key, req, m.ID)
		if msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
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
			c.JSON(http.StatusNotFound, gin.H{"error": "托管 provider 不存在"})
			return
		}
		rule, ok := loadRuleForRow(c, db, row)
		if !ok {
			return
		}
		liveProviders, err := loadLiveProviders(db)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		content, err := readAgentConfigFileContent(&row, key)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "读取失败: " + err.Error()})
			return
		}
		jpaths, err := rule.GetJsonPaths()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if strings.TrimSpace(jpaths.Provider) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该软件类型尚未配置 json 路径"})
			return
		}
		groups, err := m.GetGroups()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		groupsByEndpoint := make(map[string]model.ManagedAgentGroup, len(groups))
		for _, g := range groups {
			groupsByEndpoint[g.Endpoint] = g
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
		basePrefix := systemBaseURLPrefix(c, db) + managedSourceMarkSuffix(m)
		synced := 0
		for _, stored := range groupsByEndpoint {
			members := membersOf(stored)
			if len(members) == 0 {
				continue
			}
			gen := buildGeneratedBlock(rule, jpaths, stored, members, m.APIKey, basePrefix)
			fullName := providerBlockName(m.Name, stored.Suffix)
			providerIDPath := jpaths.Provider + "." + fullName
			for k, v := range gen["provider"].(map[string]any) {
				next, err := sjson.SetBytes(buf, providerIDPath+"."+k, v)
				if err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("provider 字段 %s 写入失败: %v", k, err)})
					return
				}
				buf = next
				synced++
			}
			if strings.TrimSpace(jpaths.Model) != "" {
				for modelName, modelCfg := range gen["models"].(map[string]any) {
					resolved := strings.ReplaceAll(jpaths.Model, "{provider_id}", fullName)
					for k, v := range modelCfg.(map[string]any) {
						full := resolved + "." + modelName + "." + k
						next, err := sjson.SetBytes(buf, full, v)
						if err != nil {
							c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("模型 %s 字段 %s 写入失败: %v", modelName, k, err)})
							return
						}
						buf = next
						synced++
					}
				}
			}
		}
		formatted := string(buf)
		if err := writeAgentConfigFileContent(&row, formatted, key); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "写入失败: " + err.Error()})
			return
		}
		if err := db.Model(&row).Update("content", formatted).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"synced": synced, "content": formatted}})
	}
}

// ── request / helpers ──────────────────────────────────────────────

type managedProviderRequest struct {
	Name          string                    `json:"name"`
	ProviderIDs   []string                  `json:"provider_ids"`
	Groups        []model.ManagedAgentGroup `json:"groups"`
	APIKey        string                    `json:"api_key"`
	UseSourceMark bool                      `json:"use_source_mark"`
	SourceName    string                    `json:"source_name"`
}

// applyManagedAuthFields copies the access-key / source-mark options from
// the request onto the row (shared by create & update).
func applyManagedAuthFields(m *model.ManagedAgentProvider, req managedProviderRequest) {
	m.APIKey = strings.TrimSpace(req.APIKey)
	m.UseSourceMark = req.UseSourceMark
	m.SourceName = strings.TrimSpace(req.SourceName)
}

// validateManagedProviderRequest enforces the shared creation rules:
// name / link required; suffix required (and unique) when more than one
// endpoint group exists; every group's final provider name (base +
// suffix) must not collide with providers already in the file or with
// other managed providers' group names. selfID ("" on create) excludes
// the managed provider itself from the managed-name conflict check.
func validateManagedProviderRequest(db *gorm.DB, row model.AgentConfigFile, key []byte, req managedProviderRequest, selfID string) string {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return "供应商名字不能为空"
	}
	if len(req.ProviderIDs) == 0 {
		return "请至少选择一个供应商"
	}
	liveProviders, err := loadLiveProviders(db)
	if err != nil {
		return err.Error()
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
		return "所选供应商没有可用的 endpoint"
	}

	// 1. suffix rules: required + unique when more than one active group.
	groupsByEndpoint := make(map[string]model.ManagedAgentGroup, len(activeGroups))
	for _, g := range activeGroups {
		groupsByEndpoint[g.Endpoint] = g
	}
	if len(activeGroups) > 1 {
		seen := make(map[string]bool, len(activeGroups))
		for _, g := range activeGroups {
			suffix := strings.TrimSpace(g.Suffix)
			if suffix == "" {
				return fmt.Sprintf("有多个 endpoint 分组，必须为 %s 填写后缀", g.Endpoint)
			}
			if seen[suffix] {
				return fmt.Sprintf("后缀 %q 重复", suffix)
			}
			seen[suffix] = true
		}
	}

	// 2. name conflicts against the live file's providers.
	content, err := readAgentConfigFileContent(&row, key)
	if err != nil {
		return "读取配置失败: " + err.Error()
	}
	rule, err := loadRule(db, row.AgentType)
	if err != nil {
		return err.Error()
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
	for _, g := range activeGroups {
		full := providerBlockName(name, strings.TrimSpace(g.Suffix))
		if existing[full] {
			return fmt.Sprintf("名称 %q 与配置文件里已有的 provider 同名，请更换名字或后缀", full)
		}
	}

	// 3. name conflicts against other managed providers' group names.
	// Root name must not equal another managed provider's root name, and
	// each final group name must not collide with their group names.
	var managed []model.ManagedAgentProvider
	if err := db.Where("agent_config_file_id = ?", row.ID).Find(&managed).Error; err != nil {
		return err.Error()
	}
	for _, m := range managed {
		if selfID != "" && m.ID == selfID {
			continue
		}
		if m.Name == name {
			return fmt.Sprintf("名称 %q 与其他托管 provider 同名", name)
		}
		mGroups, err := m.GetGroups()
		if err != nil {
			continue
		}
		for _, g := range mGroups {
			blockName := providerBlockName(m.Name, g.Suffix)
			if blockName == name {
				return fmt.Sprintf("名称 %q 与其他托管 provider 同名", name)
			}
			for _, ag := range activeGroups {
				full := providerBlockName(name, strings.TrimSpace(ag.Suffix))
				if blockName == full && full != "" {
					return fmt.Sprintf("名称 %q 与其他托管 provider 的分组同名", full)
				}
			}
		}
	}
	return ""
}

// deriveManagedProvider recomputes the endpoint groups from the live
// linked providers, merges persisted suffix / model sources by exact
// endpoint, marks hidden groups and stale ids, and computes pending
// sync per group by comparing the generated block with the file.
func deriveManagedProvider(rule model.AgentTypeRule, row model.AgentConfigFile, liveProviders []model.Provider, content string, m model.ManagedAgentProvider, basePrefix string) managedProviderView {
	view := managedProviderView{ID: m.ID, Name: m.Name, APIKey: m.APIKey, UseSourceMark: m.UseSourceMark, SourceName: m.SourceName}
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
			ModelSources: stored.ModelSources,
		}
		for _, p := range members {
			mv.ProviderNames = append(mv.ProviderNames, p.Name)
		}
		mv.ModelNames = uniqueSorted(membersModelNames(members))
		mv.ModelCount = len(mv.ModelNames)
		gen := buildGeneratedBlock(rule, jpaths, stored, members, m.APIKey, basePrefix)
		mv.Generated = gen
		fullName := providerBlockName(m.Name, stored.Suffix)
		actual := normalizeFileProvider(provResult.Get(fullName), jpaths)
		mv.FileProvider = actual
		expected := normalizeGenerated(gen)
		mv.Pending = !deepEqualJSON(expected, actual)
		if mv.Pending {
			view.PendingSync = true
		}
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
func buildGeneratedBlock(rule model.AgentTypeRule, jpaths model.AgentJsonPaths, group model.ManagedAgentGroup, members []model.Provider, apiKeyOverride string, basePrefix string) map[string]any {
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
	for _, r := range providerRecs {
		if r.Recommended == nil {
			continue
		}
		_ = setDottedValue(block, r.Key, r.Recommended)
	}
	// baseURL = 系统 BaseURL [+ /__来源] + endpoint：prefer the protocol's
	// first condition field ending in baseURL/baseUrl/url, then any common
	// provider rec key that looks like a URL field.
	if field := endpointFieldFor(protocol, providerRecs); field != "" {
		_ = setDottedValue(block, field, strings.TrimSuffix(basePrefix, "/")+group.Endpoint)
	}
	// apiKey: the dialog-chosen 令牌 key wins; legacy rows fall back to the
	// first linked provider's key.
	if key := apiKeyFieldFor(providerRecs); key != "" {
		k := apiKeyOverride
		if k == "" {
			k = firstKeyOf(members)
		}
		if k != "" {
			_ = setDottedValue(block, key, k)
		}
	}

	models := map[string]any{}
	for _, name := range uniqueSorted(membersModelNames(members)) {
		cfg := map[string]any{}
		for _, r := range modelRecs {
			if r.Recommended == nil {
				continue
			}
			_ = setDottedValue(cfg, r.Key, r.Recommended)
		}
		if supplier := group.ModelSources[name]; supplier != "" {
			if row, ok := findModelsDevRow(mdModels, name, supplier); ok {
				applyModelInfoFromModelsDev(row, mif, cfg)
			}
		}
		// Only carry models that would actually be written into the file
		// (i.e. have at least one field); models with no data source and
		// no model recs stay out so the pending comparison stays clean.
		if len(cfg) == 0 {
			continue
		}
		models[name] = cfg
	}
	return map[string]any{"provider": block, "models": models}
}

// matchProtocolByEndpoint returns the first protocol whose "根据
// endpoint 来判断" tag is a suffix of the endpoint. Tags OR together //
// protocols are evaluated in order.
func matchProtocolByEndpoint(endpoint string, protocols []model.AgentProtocol) *model.AgentProtocol {
	for i := range protocols {
		for _, tag := range protocols[i].EndpointTags {
			tag = strings.TrimSpace(tag)
			if tag != "" && strings.HasSuffix(endpoint, tag) {
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

func firstKeyOf(members []model.Provider) string {
	for _, p := range members {
		keys := parseStringArray(p.Keys)
		if len(keys) > 0 && strings.TrimSpace(keys[0]) != "" {
			return strings.TrimSpace(keys[0])
		}
	}
	return ""
}

// applyModelInfo writes the four unified model-info fields at their
// rule-configured paths. Numbers are stored when > 0; array fields
// (supported types / thinking levels) keep their array shape.
// applyModelInfoFromModelsDev fills the four unified model-config fields
// from a models.dev row (matched by the model name + the reference
// supplier stored in the group's ModelSources). Nothing is persisted
// here: the view / generation reads the live snapshot each time.
func applyModelInfoFromModelsDev(row modelsDevModel, mif model.AgentModelInfoFieldPaths, cfg map[string]any) {
	if strings.TrimSpace(mif.MaxContext) != "" && row.ContextLength > 0 {
		_ = setDottedValue(cfg, mif.MaxContext, row.ContextLength)
	}
	if strings.TrimSpace(mif.MaxOutputToken) != "" && row.MaxOutput > 0 {
		_ = setDottedValue(cfg, mif.MaxOutputToken, row.MaxOutput)
	}
	if len(row.InputTypes) > 0 && strings.TrimSpace(mif.InputTypes) != "" {
		vals := make([]any, len(row.InputTypes))
		for i, s := range row.InputTypes {
			vals[i] = s
		}
		_ = setDottedValue(cfg, mif.InputTypes, vals)
	}
	if strings.TrimSpace(mif.ThinkingLevels) != "" {
		vals := []any{}
		if row.Reasoning {
			vals = append(vals, "high")
		}
		_ = setDottedValue(cfg, mif.ThinkingLevels, vals)
	}
}

// providerBlockName joins the root name and the group suffix.
func providerBlockName(name, suffix string) string {
	return strings.TrimSpace(name) + strings.TrimSpace(suffix)
}

// systemBaseURLPrefix builds the对外 BaseURL the BaseURL settings page
// shows: scheme://host/{suffix}. The suffix lives in the base_url_suffix
// setting (default "proxy"); scheme/host come from the current dashboard
// request so the generated agent config points at the same origin the
// operator is browsing.
func systemBaseURLPrefix(c *gin.Context, db *gorm.DB) string {
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

// managedSourceMarkSuffix returns the "/__来源" segment to append after the
// system base URL when the managed provider has 标记来源 enabled.
func managedSourceMarkSuffix(m model.ManagedAgentProvider) string {
	if !m.UseSourceMark {
		return ""
	}
	name := strings.TrimSpace(m.SourceName)
	if name == "" {
		name = strings.TrimSpace(m.Name)
	}
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
// by buildGeneratedBlock into {fields…, models:{name: cfg}} so it can be
// compared against normalizeFileProvider's output.
func normalizeGenerated(gen map[string]any) map[string]any {
	out := map[string]any{}
	provider, _ := gen["provider"].(map[string]any)
	models, _ := gen["models"].(map[string]any)
	for k, v := range provider {
		out[k] = v
	}
	if models == nil {
		models = map[string]any{}
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

// setDottedValue writes v at a dotted path inside m, creating
// intermediate objects as needed.
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
	err := db.Where("name = ?", name).First(&rule).Error
	return rule, err
}

func loadConfigFile(c *gin.Context, db *gorm.DB) (model.AgentConfigFile, bool) {
	var row model.AgentConfigFile
	if err := db.First(&row, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "配置不存在"})
		return row, false
	}
	return row, true
}

func loadRuleForRow(c *gin.Context, db *gorm.DB, row model.AgentConfigFile) (model.AgentTypeRule, bool) {
	rule, err := loadRule(db, row.AgentType)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未找到该软件类型的规则: " + row.AgentType})
		return rule, false
	}
	return rule, true
}