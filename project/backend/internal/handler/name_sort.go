package handler

import (
	"sort"
	"sync"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// Locale-aware ordering for the admin list pages whose first column acts as a
// title (provider name, token name, rule name, …). Latin names sort
// case-insensitively and CJK names sort by pinyin, which plain SQLite
// ORDER BY name (byte comparison) does not do.
//
// A collate.Collator keeps mutable iterators, so every use is serialized. The
// sorts are over small config tables, so a single mutex is plenty.
var (
	nameCollator   = collate.New(language.Chinese)
	nameCollatorMu sync.Mutex
)

// sortByNameStable sorts rows in place by their display name. The comparison is
// stable so equal names keep their previous (creation) order.
func sortByNameStable[T any](rows []T, name func(T) string) {
	nameCollatorMu.Lock()
	defer nameCollatorMu.Unlock()
	sort.SliceStable(rows, func(i, j int) bool {
		return nameCollator.CompareString(name(rows[i]), name(rows[j])) < 0
	})
}

// sliceWindow returns rows[offset : offset+limit] clamped to the slice bounds,
// mirroring the LIMIT/OFFSET the handlers used to apply in SQL.
func sliceWindow[T any](rows []T, offset, limit int) []T {
	if offset < 0 {
		offset = 0
	}
	if offset >= len(rows) {
		return rows[:0]
	}
	end := len(rows)
	if limit > 0 && offset+limit < end {
		end = offset + limit
	}
	return rows[offset:end]
}
