package main

import (
	"fmt"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func main() {
	db, err := gorm.Open(sqlite.Open("/Users/Agent/Desktop/vcfiles/hapiy/project/backend/hapiy.db"), &gorm.Config{})
	if err != nil {
		panic(err)
	}
	if err := model.AutoMigrate(db); err != nil {
		panic(err)
	}
	if err := model.MigrateTopologySchema(db); err != nil {
		panic(err)
	}
	fmt.Println("migrate done")
}
