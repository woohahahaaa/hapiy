package relay

import (
	"encoding/json"
	"log"
	"time"

	"github.com/hapiy/hapiy/internal/affinity"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm/clause"
)

// affinityLookupResult is what the engine returns when the channel-affinity
// history has something to say about a request. matched=true means a
// (provider, key, baseURL) tuple was recalled for the request's
// session_id+model. usable=true means the request carries both fields, so a
// successful request will establish or refresh the history row even when no
// recall happened (the UI calls that state "new"). An empty provider means
// nothing matched and the caller should fall through to normal selection.
type affinityLookupResult struct {
	matched      bool
	usable       bool
	providerID   string
	providerName string
	keyIndex     int
	baseURLIndex int
	entryID      string
}

func (r affinityLookupResult) hint() channelHint {
	return channelHint{
		providerID:   r.providerID,
		providerName: r.providerName,
		keyIndex:     r.keyIndex,
		baseURLIndex: r.baseURLIndex,
		entryID:      r.entryID,
	}
}

// lookupAffinity runs the channel-affinity check for a request. It returns
// matched=true only when (1) the feature is enabled, (2) both the session ID
// and model can be extracted from the request, (3) a history row exists for
// that pair and has not outlived the configured TTL, and (4) the stored
// provider is still usable (enabled, not auto-disabled). Key/baseURL indices
// are NOT range-checked here: an out-of-range index is deliberately allowed
// through so the caller can fall back to the first enabled key/baseURL (or
// match by value) instead of discarding the affinity outright.
func (e *Engine) lookupAffinity(req *affinity.Request) affinityLookupResult {
	setting := e.affinitySetting()
	if setting == nil || !setting.Enabled || req == nil || e.db == nil {
		return affinityLookupResult{}
	}
	sessionID := affinity.ExtractHeaderField(req, setting.SessionIDFields)
	if sessionID == "" {
		return affinityLookupResult{}
	}
	modelName := req.Model
	if modelName == "" {
		modelName = affinity.ExtractBodyField(req, setting.ModelFields)
	}
	if modelName == "" {
		return affinityLookupResult{}
	}
	usable := affinityLookupResult{usable: true}

	var row model.RequestChannelHistory
	if err := e.db.Where("session_id = ? AND model = ?", sessionID, modelName).First(&row).Error; err != nil {
		return usable
	}
	ttl := setting.TTLSeconds
	if ttl <= 0 {
		ttl = affinity.DefaultTTLSeconds
	}
	if time.Since(row.LastUsedAt) > time.Duration(ttl)*time.Second {
		// Expired: drop the row lazily so the table does not accumulate
		// dead bindings, and let the request re-enter normal selection.
		e.db.Where("session_id = ? AND model = ?", sessionID, modelName).Delete(&model.RequestChannelHistory{})
		return usable
	}
	if row.ProviderID == "" {
		return usable
	}
	provider, err := e.GetProvider(row.ProviderID)
	if err != nil || provider == nil {
		return usable
	}
	if !provider.Status || !provider.WorkflowEnabled || e.providerDisabled(provider) {
		return usable
	}
	plan, err := e.GetPlan(provider.ID)
	if err != nil || plan == nil {
		return usable
	}
	return affinityLookupResult{
		matched:      true,
		usable:       true,
		providerID:   provider.ID,
		providerName: provider.Name,
		keyIndex:     row.KeyIndex,
		baseURLIndex: row.BaseURLIndex,
		entryID:      row.EntryID,
	}
}

// resolvePostRewriteAffinity runs the second channel-affinity recall, after the
// request rewrite has been applied. Request rewrite rules are part of the
// selected provider's workflow, i.e. they run after dispatch, so a session id
// they synthesize (a header derived from the request body, say) is invisible to
// the dispatch-time recall — which only sees the incoming headers — while it IS
// what the history gets recorded from. Re-running the recall on the post-rewrite
// snapshot closes that gap: what is recorded and what is recalled agree.
//
// Only a hit on the plan's own provider is honoured. The rewrite already ran
// for this plan and the request's entry, log outputs, concurrency and failover
// wiring all belong to it, so switching providers here would invalidate work
// already done; cross-provider sticking stays the job of the dispatch-time
// recall, which sees sessions the client sends itself. A hit on the same
// provider fills req.AffinityReuse/AffinityReuseParts and pins the recalled
// key/base URL; the caller notes the later decision in the usage log.
func (e *Engine) resolvePostRewriteAffinity(plan *ExecutionPlan, req *RelayRequest) {
	if plan == nil || plan.Provider == nil || req == nil {
		return
	}
	// An explicit channel pin (recovery probes, callers that pre-select a
	// channel) is never overridden by a recall.
	if req.KeyIndex >= 0 || req.BaseURLIndex >= 0 {
		return
	}
	result := e.lookupAffinity(&affinity.Request{
		Model:   req.Model,
		Path:    req.Path,
		Headers: req.Headers,
		Body:    affinityBodyBytes(req.Body),
	})
	if !result.usable {
		return
	}
	if !result.matched {
		// The session is readable now but has no history yet: this request
		// establishes a fresh binding, exactly like a dispatch-time "new".
		req.AffinityReuse = "new"
		return
	}
	if (result.providerID == "" || result.providerID != plan.Provider.ID) &&
		(result.providerName == "" || result.providerName != plan.Provider.Name) {
		return
	}
	if result.entryID != "" && result.entryID != req.EntryID {
		return
	}
	if result.keyIndex < 0 || result.keyIndex >= len(plan.Keys) ||
		result.baseURLIndex < 0 || result.baseURLIndex >= len(plan.BaseURLs) {
		// Out-of-range indices degrade to a partial reuse: the indices are
		// left at -1 so the relay layer falls back to the plan's first enabled
		// channel, the same degradation dispatch applies.
		req.AffinityReuse = AffinityReusePartial
		req.AffinityReuseParts = []string{"provider"}
		return
	}
	req.KeyIndex = result.keyIndex
	req.BaseURLIndex = result.baseURLIndex
	req.AffinityReuse = AffinityReuseFull
	req.AffinityReuseParts = []string{"provider", "baseurl", "key"}
}

// breakAffinity severs the channel-affinity binding that routed the request
// to the failing entity: the history row for (session, model) is deleted so
// the next request re-enters normal selection instead of sticking to the
// entity that just failed. Best-effort: errors are logged and swallowed.
func (e *Engine) breakAffinity(req *RelayRequest) {
	if req == nil || e.db == nil {
		return
	}
	setting := e.affinitySetting()
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
	if modelName == "" {
		return
	}
	if err := e.db.Where("session_id = ? AND model = ?", sessionID, modelName).
		Delete(&model.RequestChannelHistory{}).Error; err != nil {
		log.Printf("relay: break affinity history %s/%s: %v", sessionID, modelName, err)
	}
}

// recordAffinity upserts the (session_id, model) history row for the channel
// that just served a request. Errors are logged and swallowed because history
// recording must never break the relay path.
func (e *Engine) recordAffinity(req *RelayRequest, providerID string, keyIndex, baseURLIndex int) {
	if e.db == nil || req == nil {
		return
	}
	setting := e.affinitySetting()
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
		EntryID:      req.EntryID,
		LastUsedAt:   now,
	}
	// Upsert on the (session_id, model) unique index with explicit column
	// assignments. Assign(struct) + FirstOrCreate silently drops index 0
	// (the zero value), so the DB DEFAULT -1 was stored instead; explicit
	// assignment columns always include zero values.
	if err := e.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "session_id"}, {Name: "model"}},
		DoUpdates: clause.AssignmentColumns([]string{"provider_id", "key_index", "base_url_index", "entry_id", "last_used_at"}),
	}).Create(&row).Error; err != nil {
		log.Printf("relay: record affinity history: %v", err)
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
