package handler

import (
	"sort"
	"strings"
	"unicode"

	"github.com/mozillazg/go-pinyin"
)

// Locale-aware ordering for the admin list pages whose first column acts as a
// title (provider name, token name, rule name, …). Every name is turned into a
// lowercase "alphabet" key: Latin letters as-is, Han characters as toneless
// pinyin. Names are then compared as plain strings, so English and Chinese
// interleave in one order (deepseek < 多元探索 duoyuan < opencode). When two
// names share a key — an English name whose spelling matches a pinyin reading —
// the non-Han one sorts first.
//
// The frontend mirrors this for the one client-sorted table (channel affinity,
// see lib/title-sort.ts).

func nameSortKey(name string) string {
	args := pinyin.NewArgs()
	args.Style = pinyin.Normal
	// Keep non-Han runes (Latin, digits, punctuation) as-is instead of
	// dropping them, so both scripts share one comparison key.
	args.Fallback = func(r rune, _ pinyin.Args) []string { return []string{string(r)} }
	return strings.ToLower(strings.Join(pinyin.LazyPinyin(name, args), ""))
}

func hasHan(name string) bool {
	for _, r := range name {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

// sortByNameStable sorts rows in place by their display name. The comparison is
// stable so rows with an equal key keep their previous (creation) order.
func sortByNameStable[T any](rows []T, name func(T) string) {
	type keyed struct {
		row T
		key string
		han bool
	}
	items := make([]keyed, len(rows))
	for i, r := range rows {
		n := name(r)
		items[i] = keyed{row: r, key: nameSortKey(n), han: hasHan(n)}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].key != items[j].key {
			return items[i].key < items[j].key
		}
		// Same pinyin/letter key: English before Chinese.
		if items[i].han != items[j].han {
			return !items[i].han
		}
		return false
	})
	for i := range items {
		rows[i] = items[i].row
	}
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
