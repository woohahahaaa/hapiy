// Package provider holds the write operations on gateway providers that are
// shared by the dashboard handlers and the MCP tools. Routing both paths
// through one implementation keeps an agent-issued change identical to a click
// in the console: same uniqueness checks, same relay engine refresh, same
// channel event rows.
package provider

import (
	"errors"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/gorm"
)

var (
	ErrNotFound      = errors.New("provider not found")
	ErrNameTaken     = errors.New("供应商名称已存在")
	ErrWorkflowTaken = errors.New("当前已有一个同名供应商的工作流在启用，请先将另一个关闭")
	ErrDimension     = errors.New("dimension 必须是 provider、base_url 或 key")
	ErrValueRequired = errors.New("base_url 和 key 维度必须给出 value")
)

// Create inserts a provider after the name-uniqueness check and refreshes the
// relay plans so the new provider can serve requests immediately.
func Create(db *gorm.DB, engine *relay.Engine, p *model.Provider) error {
	var count int64
	if err := db.Model(&model.Provider{}).Where("name = ?", p.Name).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrNameTaken
	}
	if err := db.Create(p).Error; err != nil {
		return err
	}
	reload(engine)
	return nil
}

// Update saves an already-loaded provider (p.ID must be set).
func Update(db *gorm.DB, engine *relay.Engine, p *model.Provider) error {
	var count int64
	if err := db.Model(&model.Provider{}).Where("name = ? AND id <> ?", p.Name, p.ID).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrNameTaken
	}
	if err := db.Save(p).Error; err != nil {
		return err
	}
	if engine != nil {
		engine.InvalidatePlan(p.ID)
	}
	return nil
}

// Delete removes a provider and reloads the relay plans. A missing id is not
// an error, matching the dashboard endpoint.
func Delete(db *gorm.DB, engine *relay.Engine, id string) error {
	if err := db.Delete(&model.Provider{}, "id = ?", id).Error; err != nil {
		return err
	}
	reload(engine)
	return nil
}

// SetStatus enables or disables a provider (the channel-level switch).
func SetStatus(db *gorm.DB, engine *relay.Engine, id string, enabled bool) (*model.Provider, error) {
	p, err := load(db, id)
	if err != nil {
		return nil, err
	}
	p.Status = enabled
	if err := db.Save(p).Error; err != nil {
		return nil, err
	}
	reload(engine)
	return p, nil
}

// ToggleStatus flips the channel-level switch, like the table's 启用/停用 button.
func ToggleStatus(db *gorm.DB, engine *relay.Engine, id string) (*model.Provider, error) {
	p, err := load(db, id)
	if err != nil {
		return nil, err
	}
	return SetStatus(db, engine, id, !p.Status)
}

// SetWorkflow enables or disables the workflow-level flag (the switch on the
// topology node). Only one workflow per provider name may be on.
func SetWorkflow(db *gorm.DB, engine *relay.Engine, id string, enabled bool) (*model.Provider, error) {
	p, err := load(db, id)
	if err != nil {
		return nil, err
	}
	if enabled {
		var count int64
		if err := db.Model(&model.Provider{}).
			Where("name = ? AND id <> ? AND workflow_enabled = ?", p.Name, p.ID, true).
			Count(&count).Error; err != nil {
			return nil, err
		}
		if count > 0 {
			return nil, ErrWorkflowTaken
		}
	}
	p.WorkflowEnabled = enabled
	if err := db.Save(p).Error; err != nil {
		return nil, err
	}
	reload(engine)
	return p, nil
}

// ToggleWorkflow flips the workflow-level flag.
func ToggleWorkflow(db *gorm.DB, engine *relay.Engine, id string) (*model.Provider, error) {
	p, err := load(db, id)
	if err != nil {
		return nil, err
	}
	return SetWorkflow(db, engine, id, !p.WorkflowEnabled)
}

// SetDedupeV1 stores the model-list /v1 dedupe preference. It never touches
// the rest of the provider row.
func SetDedupeV1(db *gorm.DB, id string, enabled bool) error {
	p, err := load(db, id)
	if err != nil {
		return err
	}
	return db.Model(p).Update("dedupe_v1_suffix", enabled).Error
}

// ResetDisableValue clears one auto-disabled entity (provider row, one base
// URL or one key) and drops its pending recovery record.
func ResetDisableValue(db *gorm.DB, engine *relay.Engine, providerID, dimension, value string) error {
	if !validDimension(dimension) {
		return ErrDimension
	}
	p, err := load(db, providerID)
	if err != nil {
		return err
	}
	if dimension == model.FailoverDimensionProvider {
		value = p.ID
	}
	if value == "" {
		return ErrValueRequired
	}
	stateResult := db.Model(&model.AutoDisableState{}).
		Where("provider_id = ? AND dimension = ? AND value = ?", p.ID, dimension, value).
		Update("disabled", false)
	if stateResult.Error != nil {
		return stateResult.Error
	}
	// Manual restore only clears the exact restored entity: drop the matching
	// pending record so it stops showing in the recovery list.
	if err := db.Where("provider_id = ? AND dimension = ? AND value = ?",
		p.ID, dimension, value).
		Delete(&model.DisabledRecord{}).Error; err != nil {
		return err
	}
	if stateResult.RowsAffected > 0 {
		service.LogEvent(service.LogSourceChannelRecoveredManual, p.Name,
			service.ChannelEventMessage(dimension, value),
			"操作: 恢复供应商 "+service.DimensionLabel(dimension)+" 的单个禁用条目")
	}
	reload(engine)
	return nil
}

// ResetDisableDimension clears every auto-disable state of one dimension for
// one provider (恢复 Provider 行 / 全部 BaseURL / 全部 Key).
func ResetDisableDimension(db *gorm.DB, engine *relay.Engine, providerID, dimension string) error {
	if !validDimension(dimension) {
		return ErrDimension
	}
	stateResult := db.Model(&model.AutoDisableState{}).
		Where("provider_id = ? AND dimension = ?", providerID, dimension).
		Update("disabled", false)
	if stateResult.Error != nil {
		return stateResult.Error
	}
	delResult := db.Where("provider_id = ? AND dimension = ?", providerID, dimension).
		Delete(&model.DisabledRecord{})
	if delResult.Error != nil {
		return delResult.Error
	}
	if stateResult.RowsAffected > 0 || delResult.RowsAffected > 0 {
		service.LogEvent(service.LogSourceChannelRecoveredManual, displayName(db, providerID),
			service.ChannelEventMessage(dimension, ""),
			"操作: 重置供应商 "+service.DimensionLabel(dimension)+" 维度禁用状态")
	}
	reload(engine)
	return nil
}

// ResetAllDisable clears one dimension across every provider. It mirrors the
// dashboard's 恢复全部 action, which resets states only.
func ResetAllDisable(db *gorm.DB, engine *relay.Engine, dimension string) error {
	if !validDimension(dimension) {
		return ErrDimension
	}
	stateResult := db.Model(&model.AutoDisableState{}).
		Where("dimension = ?", dimension).
		Update("disabled", false)
	if stateResult.Error != nil {
		return stateResult.Error
	}
	if stateResult.RowsAffected > 0 {
		service.LogEvent(service.LogSourceChannelRecoveredManual, "",
			"重置全部 "+service.DimensionLabel(dimension)+" 禁用状态",
			"操作: 重置全部 "+service.DimensionLabel(dimension)+" 维度禁用状态")
	}
	reload(engine)
	return nil
}

func load(db *gorm.DB, id string) (*model.Provider, error) {
	var p model.Provider
	if err := db.First(&p, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

func reload(engine *relay.Engine) {
	if engine != nil {
		_ = engine.LoadProviders()
	}
}

func displayName(db *gorm.DB, providerID string) string {
	var p model.Provider
	if err := db.First(&p, "id = ?", providerID).Error; err != nil {
		return ""
	}
	return p.Name
}

func validDimension(dimension string) bool {
	switch dimension {
	case model.FailoverDimensionProvider, model.FailoverDimensionBaseURL, model.FailoverDimensionKey:
		return true
	}
	return false
}
