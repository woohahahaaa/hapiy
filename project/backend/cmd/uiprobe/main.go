package main

import (
	"fmt"

	"github.com/hapiy/hapiy/internal/model"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func main() {
	db, err := gorm.Open(sqlite.Open("/Users/Agent/Desktop/vcfiles/hapiy/project/backend/hapiy.db"), &gorm.Config{})
	if err != nil {
		panic(err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("__uiprobe_pw__"), bcrypt.DefaultCost)
	if err != nil {
		panic(err)
	}
	u := model.User{Username: "__ui_probe__", Password: string(hash), Role: "admin", Status: true}
	if err := db.Where("username = ?", "__ui_probe__").FirstOrCreate(&u).Error; err != nil {
		panic(err)
	}
	fmt.Println("OK")
}