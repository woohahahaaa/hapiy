package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// The version dialog reads {data:{current,...}}; guard that shape so a frontend
// change and this handler cannot drift silently.
func TestUpdateStatusHandlerShape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctl := NewUpdateController("")
	_ = ctl // checker has not run yet; Current is seeded from version.Version

	r := gin.New()
	r.GET("/update", ctl.StatusHandler())
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/update", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var body struct {
		Data struct {
			Current   string `json:"current"`
			Available bool   `json:"available"`
			Upgrading bool   `json:"upgrading"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (body %s)", err, w.Body.String())
	}
	if body.Data.Current == "" {
		t.Fatalf("current version is empty; body %s", w.Body.String())
	}
}

// A second apply while an upgrade is already marked in-flight is rejected with
// 409 instead of starting a concurrent download.
func TestUpdateApplyConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctl := NewUpdateController("")
	if !ctl.checker.BeginUpgrade() {
		t.Fatal("setup: BeginUpgrade returned false")
	}
	r := gin.New()
	r.POST("/update/apply", ctl.ApplyHandler())
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/update/apply", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", w.Code)
	}
}
