package main

import (
	"fmt"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func main() {
	db, err := gorm.Open(sqlite.Open("/Users/Agent/Desktop/vcfiles/hapiy/project/backend/hapiy.db"), &gorm.Config{})
	if err != nil { panic(err) }

	// 复刻 handler.aggregateLogStats 的查询
	run := func(label string, from, to *time.Time) {
		q := db.Model(&model.Log{}).
			Select(`COUNT(*) AS total_requests,
				COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS success_count,
				COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_count,
				COALESCE(SUM(CASE WHEN status = 'success' THEN prompt_tokens + completion_tokens ELSE 0 END), 0) AS total_tokens,
				COALESCE(SUM(CASE WHEN status = 'success' THEN quota ELSE 0 END), 0) AS total_cost`).
			Where("status IN ?", []string{"success", "failed"})
		if from != nil { q = q.Where("created_at >= ?", *from) }
		if to != nil { q = q.Where("created_at <= ?", *to) }
		var row struct {
			TotalRequests int64
			SuccessCount  int64
			FailedCount   int64
			TotalTokens   int64
			TotalCost     float64
		}
		if err := q.Scan(&row).Error; err != nil { panic(err) }
		fmt.Printf("%-12s req=%-6d ok=%-6d fail=%-6d tokens=%-10d cost=%.2f\n", label, row.TotalRequests, row.SuccessCount, row.FailedCount, row.TotalTokens, row.TotalCost)
	}

	loc := time.FixedZone("CST", 8*3600)
	today0 := time.Date(2026, 8, 27, 0, 0, 0, 0, loc)
	todayEnd := time.Date(2026, 8, 27, 23, 59, 59, 999, loc)
	yes0 := time.Date(2026, 8, 26, 0, 0, 0, 0, loc)
	yesEnd := time.Date(2026, 8, 26, 23, 59, 59, 999, loc)
	week0 := time.Date(2026, 8, 20, 0, 0, 0, 0, loc)

	run("今天", &today0, &todayEnd)
	run("昨天", &yes0, &yesEnd)
	run("一周", &week0, &todayEnd)
	run("无窗口", nil, nil)
}
