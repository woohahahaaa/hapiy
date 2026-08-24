package relay

import (
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/hapiy/hapiy/internal/affinity"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm/clause"
)

// fallbackLookupResult is what the engine returns when the fallback affinity
// finds a prior channel for the request. The caller hands the (provider,
// key_index, base_url_index) tuple back to the dispatch path as a hint;
// an empty provider means nothing matched and the caller should fall
// through to normal selection.
type fallbackLookupResult struct {
	matched       bool
	providerID    string
	providerName  string
	keyIndex      int
	baseURLIndex  int
}

// lookupFallbackAffinity runs the fallback affinity check for a request.
// It returns matched=true only when (1) the fallback feature is enabled,
// (2) both the session ID and model can be extracted from the request,
// (3) a history row exists for that pair, and (4) the stored provider
// is still usable (enabled, not auto-disabled). Key/baseURL indices are
// NOT range-checked here: an out-of-range index is deliberately allowed
// through so the caller can fall back to the first enabled key/baseURL
// (or match by value) instead of discarding the affinity outright.
func (e *Engine) lookupFallbackAffinity(req *affinity.Request) fallbackLookupResult {
	setting := e.fallbackSetting()
	if setting == nil || !setting.Enabled {
		return fallbackLookupResult{}
	}
	if req == nil {
		return fallbackLookupResult{}
	}
	sessionID := affinity.ExtractHeaderField(req, setting.SessionIDFields)
	if sessionID == "" {
		return fallbackLookupResult{}
	}
	modelName := req.Model
	if modelName == "" {
		modelName = affinity.ExtractBodyField(req, setting.ModelFields)
	}
	if modelName == "" {
		return fallbackLookupResult{}
	}
	if e.db == nil {
		return fallbackLookupResult{}
	}
	var row model.RequestChannelHistory
	if err := e.db.Where("session_id = ? AND model = ?", sessionID, modelName).First(&row).Error; err != nil {
		return fallbackLookupResult{}
	}
	if row.ProviderID == "" {
		return fallbackLookupResult{}
	}
	provider, err := e.GetProvider(row.ProviderID)
	if err != nil || provider == nil {
		return fallbackLookupResult{}
	}
	if !provider.Status || !provider.WorkflowEnabled || e.providerDisabled(provider) {
		return fallbackLookupResult{}
	}
	plan, err := e.GetPlan(provider.ID)
	if err != nil || plan == nil {
		return fallbackLookupResult{}
	}
	return fallbackLookupResult{
		matched:      true,
		providerID:   provider.ID,
		providerName: provider.Name,
		keyIndex:     row.KeyIndex,
		baseURLIndex: row.BaseURLIndex,
	}
}

// recordFallbackChannel upserts the (session_id, model) history row for the
// channel that just served a request. Errors are logged and swallowed
// because history recording must never break the relay path.
func (e *Engine) recordFallbackChannel(req *RelayRequest, providerID string, keyIndex, baseURLIndex int) {
	if e.db == nil || req == nil {
		return
	}
	setting := e.fallbackSetting()
	if setting == nil || !setting.Enabled {
		return
	}
	affReq := &affinity.Request{
		Model:   req.Model,
		Path:    req.Path,
		Headers: req.Headers,
		Body:    affinityBodyBytes(req.Body),
	}
	sessionID := affinity.ExtractHeaderField(affReq, setting.SessionIDFields)
	if sessionID == "" {
		return
	}
	modelName := req.Model
	if modelName == "" {
		modelName = affinity.ExtractBodyField(affReq, setting.ModelFields)
	}
	if modelName == "" || providerID == "" {
		return
	}
	now := time.Now()
	row := model.RequestChannelHistory{
		SessionID:    sessionID,
		Model:        modelName,
		ProviderID:   providerID,
		KeyIndex:     keyIndex,
		BaseURLIndex: baseURLIndex,
		LastUsedAt:   now,
	}
	// Upsert on the (session_id, model) unique index with explicit column
	// assignments. Assign(struct) + FirstOrCreate silently drops index 0
	// (the zero value), so the DB DEFAULT -1 was stored instead; explicit
	// assignment columns always include zero values.
	if err := e.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "session_id"}, {Name: "model"}},
		DoUpdates: clause.AssignmentColumns([]string{"provider_id", "key_index", "base_url_index", "last_used_at"}),
	}).Create(&row).Error; err != nil {
		log.Printf("relay: record fallback history: %v", err)
	}
}

func affinityBodyBytes(body map[string]interface{}) []byte {
	if len(body) == 0 {
		return nil
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil
	}
	return raw
}

// errFallbackNotMatched is exported for tests; production callers should
// check the bool returned by lookupFallbackAffinity instead.
var errFallbackNotMatched = errors.New("fallback affinity: no match")
