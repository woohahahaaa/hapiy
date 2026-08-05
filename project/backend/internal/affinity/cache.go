package affinity

import (
	"crypto/sha1"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

// cache is a simple in-memory TTL cache mapping an affinity cache key to a
// Triple. It is intentionally dependency-free (no Redis) for the first pass;
// swapping in a Redis-backed store later keeps the same interface.
type cache struct {
	mu      sync.Mutex
	entries map[string]cacheEntry
}

type cacheEntry struct {
	triple Triple
	expiry time.Time
}

func newCache() *cache {
	return &cache{entries: make(map[string]cacheEntry)}
}

// Get returns the cached Triple and whether it is still fresh.
func (c *cache) Get(key string) (Triple, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok {
		return Triple{}, false
	}
	if time.Now().After(e.expiry) {
		delete(c.entries, key)
		return Triple{}, false
	}
	return e.triple, true
}

// Set stores a Triple under key for ttl.
func (c *cache) Set(key string, t Triple, ttl time.Duration) {
	if ttl <= 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[key] = cacheEntry{triple: t, expiry: time.Now().Add(ttl)}
}

// Delete removes a key (used when the recalled provider turns out unusable).
func (c *cache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, key)
}

// fingerprint hashes an affinity value so the cache key is bounded in size.
func fingerprint(s string) string {
	if s == "" {
		return ""
	}
	sum := sha1.Sum([]byte(s))
	return hex.EncodeToString(sum[:])[:12]
}

// buildCacheKey composes the cache key from the rule name, optional model, and
// the affinity value fingerprint. Including the model scope (when the rule
// wants it) prevents cross-model hits.
func buildCacheKey(ruleName string, includeModel bool, modelName string, affinityValue string) string {
	parts := make([]string, 0, 3)
	if ruleName != "" {
		parts = append(parts, ruleName)
	}
	if includeModel && modelName != "" {
		parts = append(parts, modelName)
	}
	parts = append(parts, fingerprint(affinityValue))
	return strings.Join(parts, ":")
}
