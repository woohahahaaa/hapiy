package service

import (
	"sync"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

type QuotaLedger struct {
	db   *gorm.DB
	lock sync.Mutex
}

var globalQuotaLedger *QuotaLedger

func InitQuotaLedger(db *gorm.DB) {
	globalQuotaLedger = &QuotaLedger{db: db}
}

func Quota() *QuotaLedger {
	return globalQuotaLedger
}

func (q *QuotaLedger) Charge(tokenID string, tokens int64) error {
	if tokens <= 0 {
		return nil
	}
	q.lock.Lock()
	defer q.lock.Unlock()
	return q.db.Model(&model.Token{}).
		Where("id = ?", tokenID).
		UpdateColumn("used_quota", gorm.Expr("used_quota + ?", tokens)).Error
}