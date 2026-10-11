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
