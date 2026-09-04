package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/handler"
	"github.com/hapiy/hapiy/internal/middleware"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestProviderRoutes_disableStatusDoesNotMatchProviderID(t *testing.T) {
	// Given
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&model.Provider{}, &model.AutoDisableState{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	if err := db.Create(&model.Provider{ID: "provider-1", Name: "provider"}).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}

	sessions := middleware.NewSessionStore()
	session := sessions.Issue("wooh")
	router := gin.New()
	dashboard := router.Group("/v1/dashboard")
	dashboard.Use(middleware.AuthRequired(db, sessions))
	dashboard.GET("/providers/disable-status", handler.ListProviderDisableStatus(db))
	dashboard.GET("/providers/:id", handler.GetProvider(db))
	routes := router.Routes()
	staticRouteIndex := -1
	parameterRouteIndex := -1
	for index, route := range routes {
		switch route.Path {
		case "/v1/dashboard/providers/disable-status":
			staticRouteIndex = index
		case "/v1/dashboard/providers/:id":
			parameterRouteIndex = index
		}
	}
	if staticRouteIndex >= parameterRouteIndex {
		t.Fatalf("provider GET routes must register static path before parameter path: %#v", routes)
	}

	request := httptest.NewRequest(http.MethodGet, "/v1/dashboard/providers/disable-status", nil)
	request.AddCookie(&http.Cookie{Name: "hapiy_admin_session", Value: session})
	recorder := httptest.NewRecorder()

	// When
	router.ServeHTTP(recorder, request)

	// Then
	if recorder.Code != http.StatusOK {
		t.Fatalf("status: want %d, got %d: %s", http.StatusOK, recorder.Code, recorder.Body.String())
	}
}

func TestProviderRoutes_providerIDStillMatchesProviderHandler(t *testing.T) {
	// Given
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&model.Provider{}, &model.AutoDisableState{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	if err := db.Create(&model.Provider{ID: "provider-1", Name: "provider"}).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}

	sessions := middleware.NewSessionStore()
	session := sessions.Issue("wooh")
	router := gin.New()
	dashboard := router.Group("/v1/dashboard")
	dashboard.Use(middleware.AuthRequired(db, sessions))
	dashboard.GET("/providers/disable-status", handler.ListProviderDisableStatus(db))
	dashboard.GET("/providers/:id", handler.GetProvider(db))

	request := httptest.NewRequest(http.MethodGet, "/v1/dashboard/providers/provider-1", nil)
	request.AddCookie(&http.Cookie{Name: "hapiy_admin_session", Value: session})
	recorder := httptest.NewRecorder()

	// When
	router.ServeHTTP(recorder, request)

	// Then
	if recorder.Code != http.StatusOK {
		t.Fatalf("status: want %d, got %d: %s", http.StatusOK, recorder.Code, recorder.Body.String())
	}
}
