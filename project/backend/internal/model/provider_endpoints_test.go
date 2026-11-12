package model

import (
	"encoding/json"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateProviderEndpointsPreservesModelFields(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&Provider{}); err != nil {
		t.Fatal(err)
	}
	p := Provider{ID: "legacy", Name: "legacy", Endpoints: `[{"pathSuffix":"/v1/chat/completions"},{"pathSuffix":"/v1/responses"}]`, Models: `[{"model":"a","endpoints":[],"rate":"2","prices":{"input":"$3"}},{"model":"b","endpoints":["/v1/responses"]}]`}
	if err := db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := MigrateProviderEndpoints(db); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.First(&p, "id = ?", p.ID).Error; err != nil {
		t.Fatal(err)
	}
	var models []struct {
		Model     string
		Endpoints []string
		Rate      string
		Prices    map[string]string
	}
	if err := json.Unmarshal([]byte(p.Models), &models); err != nil {
		t.Fatal(err)
	}
	if p.Endpoints != "[]" || len(models[0].Endpoints) != 2 || len(models[1].Endpoints) != 1 || models[0].Rate != "2" || models[0].Prices["input"] != "$3" {
		t.Fatalf("migration lost data: %+v, %s", models, p.Endpoints)
	}
}

func TestSplitEndpointPaths(t *testing.T) {
	cases := map[string][]string{
		"/a /b,/c;/d":         {"/a", "/b", "/c", "/d"},
		"/a，/b；/c、/d":         {"/a", "/b", "/c", "/d"},
		"v1/chat/completions": {"/v1/chat/completions"},
		" /a, /b ,, /a ":      {"/a", "/b"},
		"   ":                 {},
	}
	for raw, want := range cases {
		got := SplitEndpointPaths(raw)
		if len(got) != len(want) {
			t.Fatalf("SplitEndpointPaths(%q) = %v, want %v", raw, got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("SplitEndpointPaths(%q) = %v, want %v", raw, got, want)
			}
		}
	}
}

func TestNormalizeModelEndpointsRepairsCombinedEntries(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&Provider{}); err != nil {
		t.Fatal(err)
	}
	p := Provider{ID: "combined", Name: "combined", Endpoints: "[]", Models: `[
		{"model":"img","endpoints":["/images/generations,/images/edits"],"rate":"1","prices":{"input":"$2"}},
		{"model":"spaced","endpoints":["/a /b","/a"]},
		{"model":"clean","endpoints":["/v1/chat/completions"]},
		{"model":"open","endpoints":[]}
	]`}
	if err := db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := NormalizeModelEndpoints(db); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.First(&p, "id = ?", p.ID).Error; err != nil {
		t.Fatal(err)
	}
	var models []struct {
		Model     string
		Endpoints []string
		Rate      string
		Prices    map[string]string
	}
	if err := json.Unmarshal([]byte(p.Models), &models); err != nil {
		t.Fatal(err)
	}
	want := map[string][]string{
		"img":    {"/images/generations", "/images/edits"},
		"spaced": {"/a", "/b"},
		"clean":  {"/v1/chat/completions"},
		"open":   {},
	}
	for _, m := range models {
		got := m.Endpoints
		if len(got) != len(want[m.Model]) {
			t.Fatalf("model %s endpoints = %v, want %v", m.Model, got, want[m.Model])
		}
		for i := range got {
			if got[i] != want[m.Model][i] {
				t.Fatalf("model %s endpoints = %v, want %v", m.Model, got, want[m.Model])
			}
		}
		if m.Model == "img" && (m.Rate != "1" || m.Prices["input"] != "$2") {
			t.Fatalf("normalize lost model fields: %+v", m)
		}
	}
}
