package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"reflect"
	"slices"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"github.com/tidwall/gjson"
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
	RuleName      string            `json:"rule_name"` // 命中的 Endpoint 规则名，"" = 没命中任何规则
	RuleTag       string            `json:"rule_tag"`  // 命中用的通配词（如 "*completion*"）
	Hits          []string          `json:"hits"`      // 同一条规则归纳到的 live endpoint（含本组）
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
// table, together with the endpoint → rule map (endpoint_rules) the dialog
// groups by. Deleted (stale) linked providers are reported separately by
// the managed-provider list endpoint; this endpoint only serves live
// rows. The map is built from the live providers plus the endpoints the
// record already saved, so an old group saved before a rule existed still
// reports the rule it now belongs to.
func ManagedProviderOptions(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		row, ok := loadConfigFile(c, db)
		if !ok {
			return
		}
		rule, ok := loadRuleForRow(c, db, row)
		if !ok {
			return
		}
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
		endpoints := make([]string, 0, len(providers))
		for _, p := range providers {
			eps := effectiveProviderEndpoints(p)
			mods := parseProviderModelNames(p.Models)
			endpoints = append(endpoints, eps...)
			out = append(out, option{
				ID: p.ID, Name: p.Name, Status: p.Status,
				Endpoints: eps, Models: mods,
				ModelEndpoints: parseProviderModelEndpoints(p.Models),
				EndpointCount:  len(eps), ModelCount: len(mods),
			})
		}
		endpoints = append(endpoints, storedManagedEndpoints(db, row.ID)...)
		protocols, _ := rule.GetProtocols()
		// system_base_url is the same value generation uses (systemBaseURLPrefix),
		// so the托管 dialog can prefill/compare against the authoritative prefix
		// instead of window.location.origin.
		c.JSON(http.StatusOK, gin.H{
			"data":            out,
			"system_base_url": systemBaseURLPrefix(c, db),
			"endpoint_rules":  endpointRuleMap(endpoints, protocols),
		})
	}
}

// storedManagedEndpoints returns the endpoints already saved in the
// record's managed provider groups (both visible and hidden ones).
func storedManagedEndpoints(db *gorm.DB, configFileID string) []string {
	var managed []model.ManagedAgentProvider
	if err := db.Where("agent_config_file_id = ?", configFileID).Find(&managed).Error; err != nil {
		return nil
	}
	var out []string
	for _, m := range managed {
		groups, err := m.GetGroups()
		if err != nil {
			continue
		}
		for _, g := range groups {
			out = append(out, g.Endpoint)
		}
	}
	return out
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
		credSpec := managedCredentialSpec(rule.Name)
		for _, m := range managed {
			view := deriveManagedProvider(rule, row, liveProviders, content, m, managedBasePrefix(c, db, m)+managedSourceMarkSuffix(m))
			// 配置块可能已经与文件一致（没有差异），但凭据库里还没有这些引用名
			// （或存的值不是当前令牌）：也算待同步，否则同步入口不出现、
			// 凭据永远写不进去。
			if managedCredentialMissing(&row, key, credSpec, m.APIKey, view.Groups) {
				view.PendingSync = true
			}
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
			respondError(c, http.StatusNotFound, "MANAGED_PROVIDER_NOT_FOUND", "托管供应商不存在")
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
		// 落库前留一份原值：重建配置文件失败时必须把分组/名字回滚回去，
		// 否则会留下「DB 已是新分组、文件里还是旧块」的半状态——旧块随后
		// 既不被认领（掉进普通供应商列表），又要等下一次同步才可能被清掉。
		before := m

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
			if restoreErr := db.Model(&model.ManagedAgentProvider{}).Where("id = ?", m.ID).Updates(map[string]any{
				"name":         before.Name,
				"provider_ids": before.ProviderIDs,
				"groups":       before.Groups,
				"api_key":      before.APIKey,
				"base_url":     before.BaseURL,
				"source_name":  before.SourceName,
			}).Error; restoreErr != nil {
				log.Printf("managed: 回滚托管行 %s 失败: %v", m.ID, restoreErr)
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": m})
	}
}

// DeleteManagedProvider removes the managed provider row immediately
// (the confirm dialog already asked the user). The blocks it wrote are
// removed from the config file first: leaving them behind would silently turn
// them into 普通供应商 with no record left to recognise them.
func DeleteManagedProvider(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		var m model.ManagedAgentProvider
		if err := db.First(&m, "id = ?", c.Param("mid")).Error; err != nil {
			// 幂等：行已不存在时保持旧行为，直接返回成功。
			c.JSON(http.StatusOK, gin.H{"message": "deleted"})
			return
		}
		warning := ""
		if row, ok := loadConfigFile(c, db); ok {
			if err := removeManagedBlocks(db, &row, &m, key); err != nil {
				// 清块失败不该挡住删行（例如配置文件已被删除/不可读），
				// 但要如实告诉前端，方便用户手动检查残留块。
				log.Printf("managed: 删除托管行时清理配置块失败: %v", err)
				warning = err.Error()
			}
		}
		if err := db.Delete(&model.ManagedAgentProvider{}, "id = ?", m.ID).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		resp := gin.H{"message": "deleted"}
		if warning != "" {
			resp["warning"] = warning
		}
		c.JSON(http.StatusOK, resp)
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
			respondError(c, http.StatusNotFound, "MANAGED_PROVIDER_NOT_FOUND", "托管供应商不存在")
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
	// 凭据库声明（dsh 的 apiKeyEnv → $DSH_HOME/.credentials.yaml）：生成的块
	// 只放引用，令牌要同步写进凭据库，见 syncManagedCredentials。
	credSpec := managedCredentialSpec(rule.Name)
	var gens []map[string]any
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
		return "", 0, errors.New("该软件类型尚未配置 JSON 路径")
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
	protocols, _ := rule.GetProtocols()
	live, _ := liveProvision(ids, liveProviders)
	byID := map[string]model.Provider{}
	for _, p := range liveProviders {
		byID[p.ID] = p
	}
	membersOf := func(g model.ManagedAgentGroup) []model.Provider {
		if members := membersByRule(live, g.Endpoint, protocols); len(members) > 0 {
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

	editor, err := newConfigEditor(content, row.Path)
	if err != nil {
		return "", 0, fmt.Errorf("解析配置失败: %w", err)
	}
	basePrefix := managedBasePrefix(c, db, *m) + managedSourceMarkSuffix(*m)
	// currentNames 只收「本轮真的会写出块」的分组：分组失去全部成员后
	// 不再算当前。否则文件里留着它的块，而界面又不认它（hidden 分组不进
	// 托管块名），它就会掉进普通供应商列表且永远清不掉。
	currentNames := make(map[string]bool, len(groupsByKey))
	for _, stored := range groupsByKey {
		if len(membersOf(stored)) == 0 {
			continue
		}
		currentNames[providerBlockName(m.Name, stored.Suffix)] = true
	}
	// 清理：不在 currentNames 里的托管块整块删除。识别两类来源 ——
	//  1. 历史记录（synced_blocks，见文末「只增不减」）：改名、删分组、
	//     以及把旧快照写回文件（版本回滚 / 手工改）后，旧名字仍对得上；
	//  2. 文件里根名形态（根名 / 根名_ / 根名-）的块：删除旧托管行后又
	//     建了同名行、或更早版本留下的块，没有历史记录也能认出来。
	// 别的托管行认领的块名一律不碰（同一文件多行共用根名前缀的场景）。
	claimsElsewhere := otherManagedClaims(db, row.ID, m.ID)
	stale := make([]string, 0, 8)
	staleSeen := make(map[string]bool, 8)
	addStale := func(name string) {
		if name == "" || staleSeen[name] || currentNames[name] || claimsElsewhere[name] {
			return
		}
		staleSeen[name] = true
		stale = append(stale, name)
	}
	if previous, err := m.GetSyncedBlocks(); err == nil {
		for _, old := range previous {
			addStale(old)
		}
	}
	for _, name := range fileManagedBlockNames(editor, jpaths, m.Name, claimsElsewhere) {
		addStale(name)
	}
	for _, old := range stale {
		// 清理是best-effort：路径不存在时 delete 是 no-op。
		if _, derr := editor.Delete(jpaths.Provider + "." + escapeSjsonKey(old)); derr != nil {
			return "", 0, fmt.Errorf("旧供应商块 %s 删除失败: %w", old, derr)
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
		gens = append(gens, gen)
		// models 子树形状由规则的 models_container 决定：可能是 object
		// map（opencode）或 array of {id,...cfg}（openclaw / dsh）。
		// rebuild 整块重写即可，两种形状编辑器都能直接序列化。
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
			if _, derr := editor.Delete(providerIDPath); derr != nil {
				return "", 0, fmt.Errorf("供应商块 %s 重置失败: %w", fullName, derr)
			}
		}
		// 写入顺序 = 文件里的字段顺序（sjson 与 yaml.v3 编辑器都是追加式，
		// prettify 只重排缩进）。provider 字段按字典序写，models 子树固定
		// 最后写：既保证 `models` 永远落在托管块末尾，也让同一份数据多次
		// 同步产出逐字节一致的文件（map 遍历顺序随机会让字段互相换位）。
		fieldKeys := make([]string, 0, len(provFields))
		for k := range provFields {
			fieldKeys = append(fieldKeys, k)
		}
		slices.Sort(fieldKeys)
		for _, k := range fieldKeys {
			if werr := editor.Set(providerIDPath+"."+k, provFields[k]); werr != nil {
				return "", 0, fmt.Errorf("供应商字段 %s 写入失败: %w", k, werr)
			}
			synced++
		}
		if strings.TrimSpace(jpaths.Model) != "" && modelsValue != nil {
			resolved := strings.ReplaceAll(jpaths.Model, "{provider_id}", fullName)
			// 模型名可能自带点（gpt-5.6-sol）——整段 models 子树一次写入，
			// 名字按字面量落盘，不会被拆成嵌套对象。
			if werr := editor.Set(resolved, modelsValue); werr != nil {
				return "", 0, fmt.Errorf("模型列表写入失败: %w", werr)
			}
			synced += modelsCount
		}
	}
	// 凭据库：写在配置文件之前 —— 凭据写不进去就整次同步失败，避免把配置
	// 写成一个必然报 MISSING_CREDENTIAL 的块（弹窗选的令牌必须落到目标机）。
	credRefs := credentialRefsOf(credSpec, gens)
	if err := syncManagedCredentials(row, key, credSpec, m.APIKey, credRefs); err != nil {
		return "", 0, err
	}
	// JSON 侧 sjson 只原地改写已有行，新增的块会被压成一行；写盘前整体
	// 重新缩进，保证同步后的文件始终是标准 pretty JSON。YAML 侧节点序列化
	// 本身就是规范缩进，直接使用。
	formatted, merr := editor.Marshal()
	if merr != nil {
		return "", 0, fmt.Errorf("序列化配置失败: %w", merr)
	}
	if !isYAMLConfigPath(row.Path) {
		if pretty, perr := prettifyJSON(formatted); perr == nil {
			formatted = pretty
		}
	}
	if err := writeAgentConfigFileContent(row, formatted, key); err != nil {
		return "", 0, fmt.Errorf("写入失败: %w", err)
	}
	if err := db.Model(row).Update("content", formatted).Error; err != nil {
		return "", 0, err
	}
	recordAgentConfigVersion(db, row.ID, formatted)
	// 记录写过的块名，供下次同步清理改名/删分组后的旧块。历史只增不减：
	// 只记「当前名字」的话，一旦文件被版本回滚/手工改回旧名字，那些块就
	// 再没有任何记录能认出它们，会永久留在普通供应商列表里。
	names := make([]string, 0, len(currentNames)+8)
	seenName := make(map[string]bool, len(currentNames)+8)
	addName := func(n string) {
		if n == "" || seenName[n] {
			return
		}
		seenName[n] = true
		names = append(names, n)
	}
	if previous, perr := m.GetSyncedBlocks(); perr == nil {
		for _, old := range previous {
			addName(old)
		}
	}
	for n := range currentNames {
		addName(n)
	}
	slices.Sort(names)
	if namesJSON, merr := json.Marshal(names); merr == nil {
		if err := db.Model(m).Update("synced_blocks", string(namesJSON)).Error; err != nil {
			return "", 0, err
		}
	}
	return formatted, synced, nil
}

// otherManagedClaims collects the block names another managed row on the same
// config file may own — its root name plus everything it has ever written — so
// 根名形态 清理 never mistakes another row's block for a stale leftover.
func otherManagedClaims(db *gorm.DB, fileID, selfID string) map[string]bool {
	claims := map[string]bool{}
	var rows []model.ManagedAgentProvider
	if err := db.Where("agent_config_file_id = ? AND id <> ?", fileID, selfID).Find(&rows).Error; err != nil {
		// 读不到就退化成「只管自己」：宁可不删，也不误删别的托管行。
		log.Printf("managed: 读取同文件其他托管行失败: %v", err)
		return claims
	}
	for _, r := range rows {
		if name := strings.TrimSpace(r.Name); name != "" {
			claims[name] = true
		}
		if blocks, err := r.GetSyncedBlocks(); err == nil {
			for _, b := range blocks {
				if b != "" {
					claims[b] = true
				}
			}
		}
	}
	return claims
}

// managedBlockPrefixMatches reports whether a file provider block name carries
// the managed row's root-name shape: the root itself, or the root followed by
// a suffix separator (`_` / `-`).
func managedBlockPrefixMatches(root, blockName string) bool {
	if root == "" || blockName == "" {
		return false
	}
	return blockName == root ||
		strings.HasPrefix(blockName, root+"_") ||
		strings.HasPrefix(blockName, root+"-")
}

// fileManagedBlockNames lists the provider blocks in the file that carry the
// managed row's root-name shape, so 残块 left by a rename, a version rollback
// or a delete-and-recreate are still recognised as ours instead of silently
// becoming 普通供应商. Names claimed by another managed row are skipped.
func fileManagedBlockNames(editor configEditor, jpaths model.AgentJsonPaths, root string, claimsElsewhere map[string]bool) []string {
	root = strings.TrimSpace(root)
	if root == "" || strings.TrimSpace(jpaths.Provider) == "" {
		return nil
	}
	provResult := gjson.Parse(string(editor.JSON())).Get(jpaths.Provider)
	if !provResult.IsObject() {
		return nil
	}
	var out []string
	provResult.ForEach(func(key, _ gjson.Result) bool {
		name := key.String()
		if managedBlockPrefixMatches(root, name) && !claimsElsewhere[name] {
			out = append(out, name)
		}
		return true
	})
	return out
}

// removeManagedBlocks deletes every block this managed row owns from the
// config file (历史记录 ∪ 根名形态), then persists file + cache + version.
// Used when the row is deleted: without it the orphaned blocks silently turn
// into 普通供应商 and no record is left to recognise them.
func removeManagedBlocks(db *gorm.DB, row *model.AgentConfigFile, m *model.ManagedAgentProvider, key []byte) error {
	rule, err := loadRule(db, row.AgentType)
	if err != nil {
		return err
	}
	jpaths, err := rule.GetJsonPaths()
	if err != nil {
		return err
	}
	if strings.TrimSpace(jpaths.Provider) == "" {
		return errors.New("该软件类型尚未配置 JSON 路径")
	}
	content, err := readAgentConfigFileContent(row, key)
	if err != nil {
		return fmt.Errorf("读取失败: %w", err)
	}
	editor, err := newConfigEditor(content, row.Path)
	if err != nil {
		return fmt.Errorf("解析配置失败: %w", err)
	}
	claimsElsewhere := otherManagedClaims(db, row.ID, m.ID)
	names := make([]string, 0, 8)
	seen := make(map[string]bool, 8)
	add := func(name string) {
		if name == "" || seen[name] || claimsElsewhere[name] {
			return
		}
		seen[name] = true
		names = append(names, name)
	}
	if previous, perr := m.GetSyncedBlocks(); perr == nil {
		for _, old := range previous {
			add(old)
		}
	}
	for _, name := range fileManagedBlockNames(editor, jpaths, m.Name, claimsElsewhere) {
		add(name)
	}
	if len(names) == 0 {
		return nil
	}
	for _, name := range names {
		if _, derr := editor.Delete(jpaths.Provider + "." + escapeSjsonKey(name)); derr != nil {
			return fmt.Errorf("块 %s 删除失败: %w", name, derr)
		}
	}
	formatted, merr := editor.Marshal()
	if merr != nil {
		return fmt.Errorf("序列化配置失败: %w", merr)
	}
	if !isYAMLConfigPath(row.Path) {
		if pretty, perr := prettifyJSON(formatted); perr == nil {
			formatted = pretty
		}
	}
	if err := writeAgentConfigFileContent(row, formatted, key); err != nil {
		return fmt.Errorf("写入失败: %w", err)
	}
	if err := db.Model(row).Update("content", formatted).Error; err != nil {
		return err
	}
	recordAgentConfigVersion(db, row.ID, formatted)
	return nil
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
		return "MANAGED_NO_AVAILABLE_ENDPOINT", "所选供应商没有可用的 Endpoint", nil
	}

	// 1. suffix rules: required; 后缀唯一性按 (endpoint, 后缀) 判定 ——
	// 相同 endpoint 里重复的后缀会合并成一个 provider 块，允许；不同
	// endpoint 撞同名后缀才会是名字冲突。
	if len(activeGroups) > 1 {
		suffixEndpoint := make(map[string]string, len(activeGroups))
		for _, g := range activeGroups {
			suffix := strings.TrimSpace(g.Suffix)
			if suffix == "" {
				return "MANAGED_SUFFIX_REQUIRED", fmt.Sprintf("有多个 Endpoint 分组，必须为 %s 填写后缀", g.Endpoint), gin.H{"endpoint": g.Endpoint}
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
		view, _ := configJSONView(content, row.Path)
		provResult := gjson.Parse(string(view)).Get(jpaths.Provider)
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
			return "MANAGED_NAME_CONFLICT_FILE", fmt.Sprintf("名称 %q 与配置文件里已有的供应商同名，请更换名字或后缀", full), gin.H{"name": full}
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
			return "MANAGED_NAME_CONFLICT_MANAGED", fmt.Sprintf("名称 %q 与其他托管供应商同名", name), gin.H{"name": name}
		}
		mGroups, err := m.GetGroups()
		if err != nil {
			continue
		}
		for _, g := range mGroups {
			blockName := providerBlockName(m.Name, g.Suffix)
			if blockName == name {
				return "MANAGED_NAME_CONFLICT_MANAGED", fmt.Sprintf("名称 %q 与其他托管供应商同名", name), gin.H{"name": name}
			}
			for _, ag := range activeGroups {
				full := providerBlockName(name, strings.TrimSpace(ag.Suffix))
				if blockName == full && full != "" {
					return "MANAGED_GROUP_NAME_CONFLICT", fmt.Sprintf("名称 %q 与其他托管供应商的分组同名", full), gin.H{"name": full}
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
	protocols, _ := rule.GetProtocols()
	membersOf := func(g model.ManagedAgentGroup) []model.Provider {
		if members := membersByRule(live, g.Endpoint, protocols); len(members) > 0 {
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
	jsonView, _ := configJSONView(content, row.Path)
	provResult := gjson.Parse(string(jsonView)).Get(jpaths.Provider)

	// 同一规则（endpoint_tags 命中）+ 同一命名后缀的存量分组写进文件时本来
	// 就合成一个 provider 块（见 rebuildManagedBlocks），视图里也合成一组：
	// 否则折叠上线前存下的 /chat/completions 与 /v1/chat/completions 会在
	// 同一规则下显示成两行、两个块名。没命中规则的 endpoint 保持独立成组。
	type mergedGroup struct {
		endpoint string
		suffix   string
		ids      []string
		sources  map[string]string
	}
	var merged []*mergedGroup
	byKey := make(map[string]*mergedGroup, len(storedGroups))
	for _, stored := range storedGroups {
		key := ruleKey(stored.Endpoint, protocols) + "\x00" + strings.TrimSpace(stored.Suffix)
		cur, ok := byKey[key]
		if !ok {
			cur = &mergedGroup{endpoint: stored.Endpoint, suffix: stored.Suffix, sources: map[string]string{}}
			byKey[key] = cur
			merged = append(merged, cur)
		}
		cur.ids = uniqueSorted(append(cur.ids, stored.ProviderIDs...))
		for modelID, source := range stored.ModelSources {
			cur.sources[modelID] = source
		}
	}
	stored := make([]model.ManagedAgentGroup, 0, len(merged))
	for _, mg := range merged {
		stored = append(stored, model.ManagedAgentGroup{
			Endpoint:     mg.endpoint,
			Suffix:       mg.suffix,
			ProviderIDs:  mg.ids,
			ModelSources: mg.sources,
		})
	}

	// Hidden = persisted groups that resolve no live members (deleted or
	// paused providers for ordinary endpoint groups; dangling ids for the
	// 未配置 endpoint group).
	for _, group := range stored {
		if len(membersOf(group)) == 0 {
			view.HiddenGroups = append(view.HiddenGroups, group)
		}
	}

	for _, group := range stored {
		members := membersOf(group)
		if len(members) == 0 {
			continue
		}
		mv := managedGroupView{
			Endpoint:     group.Endpoint,
			Suffix:       group.Suffix,
			ProviderIDs:  group.ProviderIDs,
			ModelSources: group.ModelSources,
		}
		// 分组归属的规则：弹窗和列表都按它显示（老记录存的是折叠前的
		// endpoint，命中信息由这里补齐，不必等用户重存）。
		if ruleIndex := matchProtocolIndexByEndpoint(group.Endpoint, protocols); ruleIndex >= 0 {
			mv.RuleName = protocols[ruleIndex].Name
			mv.RuleTag = matchedEndpointTag(group.Endpoint, protocols[ruleIndex])
			mv.Hits = endpointsSharingRule(live, group.Endpoint, protocols)
		}
		if len(mv.Hits) == 0 {
			mv.Hits = []string{group.Endpoint}
		}
		for _, p := range members {
			mv.ProviderNames = append(mv.ProviderNames, p.Name)
		}
		mv.ModelNames = uniqueSorted(membersModelNamesForEndpoint(members, group.Endpoint, protocols))
		mv.ModelCount = len(mv.ModelNames)
		gen := buildGeneratedBlock(rule, jpaths, group, members, m.APIKey, basePrefix, providerBlockName(m.Name, group.Suffix))
		mv.Generated = gen
		fullName := providerBlockName(m.Name, group.Suffix)
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

// ruleKey identifies the group an endpoint belongs to for merging: the
// matched rule, or the endpoint itself when no rule hits it.
func ruleKey(endpoint string, protocols []model.AgentProtocol) string {
	if idx := matchProtocolIndexByEndpoint(endpoint, protocols); idx >= 0 {
		return "rule:" + strconv.Itoa(idx)
	}
	return "endpoint:" + strings.ToLower(strings.TrimSpace(endpoint))
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

	models := buildManagedModels(jpaths.ModelsContainer, members, modelRecs, group, mif, mdModels, protocols)
	return map[string]any{"provider": block, "models": models}
}

// buildManagedModels emits the per-provider `models` subtree in the
// shape declared by the rule (`jpaths.ModelsContainer`): array of
// {id, name, ...cfg} when "array" (openclaw-style), or object map keyed
// by model name whose value is the cfg object when "object"
// (opencode-style). Empty value falls back to "object" so legacy rules
// without the field keep their old behaviour.
func buildManagedModels(container string, members []model.Provider, modelRecs []model.AgentRecommendation, group model.ManagedAgentGroup, mif model.AgentModelInfoFieldPaths, mdModels []modelsDevModel, protocols []model.AgentProtocol) any {
	names := uniqueSorted(membersModelNamesForEndpoint(members, group.Endpoint, protocols))
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
	ensureCapabilitiesComplete(cfg, mif.InputTypes.Path)
	return cfg
}

// ensureCapabilitiesComplete fills the required sibling keys of an OpenCode-V2
// `capabilities` object. V2 validates capabilities as a complete struct —
// tools (bool) + input (array) + output (array) — and treats a provider whose
// model carries a partial object (e.g. only the input types written from
// models.dev) as malformed, skipping the whole provider. This runs only when
// the rule writes model input types under capabilities.* (the opencode-v2
// template), so other agents are untouched. Defaults mirror OpenCode's own
// fallback for a model it does not know: tools on, text+image in, text out.
func ensureCapabilitiesComplete(cfg map[string]any, inputPath string) {
	if !strings.HasPrefix(strings.TrimSpace(inputPath), "capabilities.") {
		return
	}
	caps, _ := cfg["capabilities"].(map[string]any)
	if caps == nil {
		caps = map[string]any{}
		cfg["capabilities"] = caps
	}
	if _, ok := caps["tools"]; !ok {
		caps["tools"] = true
	}
	if _, ok := caps["input"]; !ok {
		caps["input"] = []any{"text", "image"}
	}
	if _, ok := caps["output"]; !ok {
		caps["output"] = []any{"text"}
	}
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

// matchEndpointTag reports whether one endpoint_tags entry matches an
// endpoint. A tag containing "*" is a case-insensitive glob where "*"
// matches any run of characters (e.g. "*completion*" hits both
// "/v1/chat/completions" and "/chat/completion"); a tag without "*" must
// equal the whole endpoint case-insensitively. This keeps precise tags
// ("responses") exact while letting rules cover /v1-prefixed and bare
// variants with one wildcard.
func matchEndpointTag(endpoint, tag string) bool {
	tag = strings.TrimSpace(tag)
	if tag == "" {
		return false
	}
	endpoint = strings.ToLower(strings.TrimSpace(endpoint))
	tag = strings.ToLower(tag)
	if !strings.Contains(tag, "*") {
		return endpoint == tag
	}
	parts := strings.Split(tag, "*")
	pos := 0
	for i, part := range parts {
		if part == "" {
			continue
		}
		if i == 0 {
			if !strings.HasPrefix(endpoint[pos:], part) {
				return false
			}
			pos += len(part)
			continue
		}
		j := strings.Index(endpoint[pos:], part)
		if j < 0 {
			return false
		}
		pos += j + len(part)
	}
	if last := parts[len(parts)-1]; last != "" {
		return strings.HasSuffix(endpoint, last)
	}
	return true
}

// matchProtocolByEndpoint returns the first protocol with an endpoint_tags
// entry matching endpoint (see matchEndpointTag). Order is priority, so
// more specific tags must come first.
func matchProtocolByEndpoint(endpoint string, protocols []model.AgentProtocol) *model.AgentProtocol {
	if i := matchProtocolIndexByEndpoint(endpoint, protocols); i >= 0 {
		return &protocols[i]
	}
	return nil
}

// matchProtocolIndexByEndpoint is matchProtocolByEndpoint's index form (the
// 托管 dialog groups endpoints by rule index, not by pointer).
func matchProtocolIndexByEndpoint(endpoint string, protocols []model.AgentProtocol) int {
	for i := range protocols {
		for _, tag := range protocols[i].EndpointTags {
			if matchEndpointTag(endpoint, tag) {
				return i
			}
		}
	}
	return -1
}

// matchedEndpointTag returns the tag that hit the endpoint (the rule as
// written, e.g. "*completion*"), "" when none does.
func matchedEndpointTag(endpoint string, protocol model.AgentProtocol) string {
	for _, tag := range protocol.EndpointTags {
		if matchEndpointTag(endpoint, tag) {
			return tag
		}
	}
	return ""
}

// endpointRuleInfo classifies one endpoint against the rule's protocols.
// Canonical is the group's representative endpoint — the shortest endpoint
// sharing the rule, ties broken lexicographically, so the choice never
// depends on provider order or on which providers are currently linked.
type endpointRuleInfo struct {
	Canonical string `json:"canonical"`
	RuleIndex int    `json:"rule_index"`
	RuleName  string `json:"rule_name"`
	Tag       string `json:"tag"`
}

// endpointRuleMap classifies every passed endpoint (live provider endpoints
// plus the endpoints already saved in the record's managed groups). The
// 托管 dialog groups by Canonical instead of re-running the glob match in
// the browser: preview（弹窗里现算）与保存后的列表因此是同一套归类。没命中
// 任何规则的 endpoint 不在表里，调用方按原样独立成组。
func endpointRuleMap(endpoints []string, protocols []model.AgentProtocol) map[string]endpointRuleInfo {
	seen := map[string]bool{}
	byRule := map[int][]string{}
	for _, raw := range endpoints {
		ep := strings.TrimSpace(raw)
		if ep == "" || seen[ep] {
			continue
		}
		seen[ep] = true
		if idx := matchProtocolIndexByEndpoint(ep, protocols); idx >= 0 {
			byRule[idx] = append(byRule[idx], ep)
		}
	}
	canonical := make(map[int]string, len(byRule))
	for idx, eps := range byRule {
		canonical[idx] = representativeEndpoint(eps)
	}
	out := make(map[string]endpointRuleInfo, len(seen))
	for ep := range seen {
		idx := matchProtocolIndexByEndpoint(ep, protocols)
		if idx < 0 {
			continue
		}
		out[ep] = endpointRuleInfo{
			Canonical: canonical[idx],
			RuleIndex: idx,
			RuleName:  protocols[idx].Name,
			Tag:       matchedEndpointTag(ep, protocols[idx]),
		}
	}
	return out
}

// representativeEndpoint picks the endpoint a rule group is named after:
// the shortest one, ties broken lexicographically.
func representativeEndpoint(endpoints []string) string {
	best := ""
	for _, ep := range endpoints {
		if best == "" || len(ep) < len(best) || (len(ep) == len(best) && ep < best) {
			best = ep
		}
	}
	return best
}

// endpointsSharingRule lists the live endpoints that fall into the same
// managed group as endpoint (sorted, for stable output).
func endpointsSharingRule(live map[string][]model.Provider, endpoint string, protocols []model.AgentProtocol) []string {
	out := make([]string, 0, len(live))
	for ep := range live {
		if sameEndpointRule(ep, endpoint, protocols) {
			out = append(out, ep)
		}
	}
	slices.Sort(out)
	return out
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
// on the BaseURL settings page (e.g. "https://hapiying.example.com:6060/proxy").
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
// providers by their effective endpoint strings (provider-level list when
// present, else the union of their models' endpoints). Providers with no
// endpoints at all are ignored for grouping (their models were never
// synced).
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
		for _, ep := range effectiveProviderEndpoints(p) {
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

// sameEndpointRule reports whether two endpoints belong to the same managed
// group: identical strings, or both matching the same non-nil protocol rule.
// endpoint_tags are globs now, so "/chat/completions" and
// "/v1/chat/completions" are one group under "*completion*".
func sameEndpointRule(a, b string, protocols []model.AgentProtocol) bool {
	if a == b {
		return true
	}
	pa := matchProtocolByEndpoint(a, protocols)
	pb := matchProtocolByEndpoint(b, protocols)
	return pa != nil && pa == pb
}

// membersByRule unions the live providers of every endpoint that shares
// endpoint's protocol rule, so a rule-merged group keeps the models of each
// member endpoint. Keys are walked in sorted order so the member list (and
// the generated block) stays stable across runs.
func membersByRule(live map[string][]model.Provider, endpoint string, protocols []model.AgentProtocol) []model.Provider {
	keys := make([]string, 0, len(live))
	for ep := range live {
		if sameEndpointRule(ep, endpoint, protocols) {
			keys = append(keys, ep)
		}
	}
	slices.Sort(keys)
	var out []model.Provider
	seen := map[string]bool{}
	for _, ep := range keys {
		for _, p := range live[ep] {
			if seen[p.ID] {
				continue
			}
			seen[p.ID] = true
			out = append(out, p)
		}
	}
	return out
}

func membersModelNamesForEndpoint(members []model.Provider, endpoint string, protocols []model.AgentProtocol) []string {
	var out []string
	for _, p := range members {
		byModel := parseProviderModelEndpoints(p.Models)
		for _, name := range parseProviderModelNames(p.Models) {
			paths := byModel[name]
			if len(paths) == 0 {
				out = append(out, name)
				continue
			}
			for _, path := range paths {
				if sameEndpointRule(path, endpoint, protocols) {
					out = append(out, name)
					break
				}
			}
		}
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

// effectiveProviderEndpoints returns the endpoint list used for managed-agent
// grouping and the option table: the legacy provider-level list when it
// still declares one, else the order-preserving union of its models'
// endpoints (the new per-model source of truth). Providers with neither
// have no protocol information and keep being skipped by group derivation.
func effectiveProviderEndpoints(p model.Provider) []string {
	if eps := parseProviderEndpoints(p.Endpoints); len(eps) > 0 {
		return eps
	}
	modelEndpoints := parseProviderModelEndpoints(p.Models)
	var out []string
	seen := map[string]bool{}
	for _, name := range parseProviderModelNames(p.Models) {
		for _, ep := range modelEndpoints[name] {
			if !seen[ep] {
				seen[ep] = true
				out = append(out, ep)
			}
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
