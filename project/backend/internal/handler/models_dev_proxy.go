package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/service"
)

const modelsDevURL = "https://models.dev/api.json"
const modelsDevCacheTTL = 24 * time.Hour

type modelsDevModel struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	ProviderID    string   `json:"provider_id"`
	ProviderName  string   `json:"provider_name"`
	InputPrice    float64  `json:"input_price"`
	OutputPrice   float64  `json:"output_price"`
	CacheWriteP   float64  `json:"cache_write_price"`
	CacheReadP    float64  `json:"cache_read_price"`
	ContextLength int      `json:"context_length"`
	MaxOutput     int      `json:"max_output"`
	InputTypes    []string `json:"input_types"`
	OutputTypes   []string `json:"output_types"`
	Reasoning     bool     `json:"reasoning"`
	// EffortLevels 是该模型支持的思考档位枚举（models.dev
	// reasoning_options 里 type=effort 的 values），如
	// none/low/medium/high/xhigh。toggle / budget_tokens 型选项不产生档位。
	EffortLevels []string `json:"effort_levels"`
}

type modelsDevSnapshot struct {
	models    []modelsDevModel
	fetchedAt time.Time
}

// modelsDevProxy holds a cached, single-flight snapshot of models.dev.
type modelsDevProxy struct {
	mu     sync.Mutex
	cached *modelsDevSnapshot
}

var modelsDev = &modelsDevProxy{}

func (p *modelsDevProxy) load() ([]modelsDevModel, error) {
	p.mu.Lock()
	if p.cached != nil && time.Since(p.cached.fetchedAt) < modelsDevCacheTTL {
		snapshot := p.cached
		p.mu.Unlock()
		return snapshot.models, nil
	}
	p.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, modelsDevURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := service.DefaultClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, errUpstream{code: resp.StatusCode}
	}

	var raw map[string]struct {
		Name   string `json:"name"`
		Models map[string]struct {
			Name string `json:"name"`
			Cost *struct {
				Input     float64 `json:"input"`
				Output    float64 `json:"output"`
				CacheWrit float64 `json:"cache_write"`
				CacheRead float64 `json:"cache_read"`
			} `json:"cost"`
			Limit *struct {
				Context int `json:"context"`
				Output  int `json:"output"`
			} `json:"limit"`
			Modalities *struct {
				Input  []string `json:"input"`
				Output []string `json:"output"`
			} `json:"modalities"`
			Reasoning bool `json:"reasoning"`
			// reasoning_options: [{"type":"toggle"}, {"type":"effort","values":[...]},
			// {"type":"budget_tokens","min":...}] — 只有 effort 型才给出档位枚举。
			ReasoningOptions []struct {
				Type   string   `json:"type"`
				Values []string `json:"values"`
			} `json:"reasoning_options"`
		} `json:"models"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}

	models := make([]modelsDevModel, 0, 4096)
	for providerID, provider := range raw {
		providerName := provider.Name
		if providerName == "" {
			providerName = providerID
		}
		for modelID, model := range provider.Models {
			var input, output, cacheWrite, cacheRead float64
			if model.Cost != nil {
				input = model.Cost.Input
				output = model.Cost.Output
				cacheWrite = model.Cost.CacheWrit
				cacheRead = model.Cost.CacheRead
			}
			var contextLength, maxOutput int
			if model.Limit != nil {
				contextLength = model.Limit.Context
				maxOutput = model.Limit.Output
			}
			name := model.Name
			if name == "" {
				name = modelID
			}
			models = append(models, modelsDevModel{
				ID:            modelID,
				Name:          name,
				ProviderID:    providerID,
				ProviderName:  providerName,
				InputPrice:    input,
				OutputPrice:   output,
				CacheWriteP:   cacheWrite,
				CacheReadP:    cacheRead,
				ContextLength: contextLength,
				MaxOutput:     maxOutput,
				InputTypes:    model.Modalities.Input,
				OutputTypes:   model.Modalities.Output,
				Reasoning:     model.Reasoning,
				EffortLevels:  effortLevels(model.ReasoningOptions),
			})
		}
	}

	p.mu.Lock()
	p.cached = &modelsDevSnapshot{models: models, fetchedAt: time.Now()}
	p.mu.Unlock()
	return models, nil
}

// effortLevels extracts the effort-enum values from a model's
// reasoning_options (the "思考档位" list a model supports). toggle /
// budget_tokens options carry no levels and are ignored.
func effortLevels(opts []struct {
	Type   string   `json:"type"`
	Values []string `json:"values"`
}) []string {
	var out []string
	for _, o := range opts {
		if o.Type == "effort" && len(o.Values) > 0 {
			out = append(out, o.Values...)
		}
	}
	return out
}

type errUpstream struct{ code int }

func (e errUpstream) Error() string {
	return "upstream status " + itoa(e.code)
}

func itoa(v int) string {
	const digits = "0123456789"
	if v == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = digits[v%10]
		v /= 10
	}
	return string(buf[i:])
}

// findModelsDevRow returns the models.dev row whose model name matches
// modelValue (id / name, case-insensitive, falling back to a fully
// qualified id whose trailing segment equals modelValue) AND whose
// provider equals supplierName (case-insensitive).
func findModelsDevRow(models []modelsDevModel, modelValue, supplierName string) (modelsDevModel, bool) {
	needle := strings.ToLower(strings.TrimSpace(modelValue))
	supplier := strings.ToLower(strings.TrimSpace(supplierName))
	if needle == "" || supplier == "" {
		return modelsDevModel{}, false
	}
	for _, m := range models {
		if strings.ToLower(m.ProviderName) != supplier {
			continue
		}
		id := strings.ToLower(m.ID)
		name := strings.ToLower(m.Name)
		if id == needle || name == needle || strings.HasSuffix(id, "/"+needle) {
			return m, true
		}
	}
	return modelsDevModel{}, false
}

func ModelsDevList() gin.HandlerFunc {
	return func(c *gin.Context) {
		models, err := modelsDev.load()
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "获取 models.dev 数据失败，请稍后重试"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": models})
	}
}
