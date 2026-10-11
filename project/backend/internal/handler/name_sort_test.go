package handler

import (
	"reflect"
	"testing"
)

// The admin list pages whose first column is the row's title are ordered by
// sortByNameStable: Latin letters and Han pinyin share one alphabet, so English
// and Chinese interleave.
func TestSortByNameStable(t *testing.T) {
	cases := []struct {
		name  string
		input []string
		want  []string
	}{
		{
			// Real names from the provider page: 多元探索 → "duoyuan…" sits
			// between deepseek and opencode; 银河gpt-R → "yinhe…" goes last.
			name:  "english and pinyin interleave",
			input: []string{"银河gpt-R", "多元探索", "opencode go", "deepseek"},
			want:  []string{"deepseek", "多元探索", "opencode go", "银河gpt-R"},
		},
		{
			// Real names from the rewrite rule page: 为 → "wei" sorts between
			// minimax (m) and workbuddy (w-o).
			name:  "mixed rule names",
			input: []string{"workbuddy glmflash maxtoken 修复", "为 opencode go 添加x-opencode-session", "minimax split reasoning", "为 glm 移除 promptcachekey"},
			want:  []string{"minimax split reasoning", "为 glm 移除 promptcachekey", "为 opencode go 添加x-opencode-session", "workbuddy glmflash maxtoken 修复"},
		},
		{
			name:  "latin is case insensitive",
			input: []string{"opencode-v2", "Openclaw", "opencode-v1", "ChatGPT"},
			want:  []string{"ChatGPT", "Openclaw", "opencode-v1", "opencode-v2"},
		},
		{
			// Same key ("kai"): the English spelling wins over the Han one.
			name:  "english before chinese on equal key",
			input: []string{"开", "kai"},
			want:  []string{"kai", "开"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := append([]string(nil), tc.input...)
			sortByNameStable(got, func(s string) string { return s })
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("order = %v, want %v", got, tc.want)
			}
		})
	}
}
