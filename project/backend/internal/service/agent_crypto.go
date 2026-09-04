package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
)

// encryptionPrefix marks values produced by EncryptField. Stored values
// without it are treated as legacy plaintext during decryption, so rows
// saved before this feature keep working.
const encryptionPrefix = "enc1:"

// EncryptField encrypts plaintext with AES-256-GCM using key and returns a
// self-describing "enc1:<base64(nonce||ciphertext)>" string. The 12-byte
// random nonce is prepended to the ciphertext so no per-field nonce state
// needs persisting. Empty plaintext returns "" unchanged so absent
// credentials stay absent.
func EncryptField(key []byte, plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	if len(key) != 32 {
		return "", fmt.Errorf("加密密钥必须是 32 字节（当前 %d 字节）", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("创建 AES 加密器失败: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("创建 GCM 加密器失败: %w", err)
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("生成随机 nonce 失败: %w", err)
	}
	sealed := aead.Seal(nil, nonce, []byte(plaintext), nil)
	blob := append(nonce, sealed...)
	return encryptionPrefix + base64.StdEncoding.EncodeToString(blob), nil
}

// DecryptField reverses EncryptField. Empty stored values return ""; values
// without the "enc1:" prefix are legacy plaintext and returned unchanged;
// anything else is base64-decoded and authenticated via AES-GCM, returning
// a descriptive error when the value is malformed, tampered, or encrypted
// with a different key.
func DecryptField(key []byte, stored string) (string, error) {
	if stored == "" {
		return "", nil
	}
	if !strings.HasPrefix(stored, encryptionPrefix) {
		return stored, nil
	}
	if len(key) != 32 {
		return "", fmt.Errorf("加密密钥必须是 32 字节（当前 %d 字节）", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("创建 AES 解密器失败: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("创建 GCM 解密器失败: %w", err)
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, encryptionPrefix))
	if err != nil {
		return "", fmt.Errorf("解密数据格式错误: %w", err)
	}
	nonceSize := aead.NonceSize()
	if len(raw) < nonceSize {
		return "", fmt.Errorf("解密数据不完整（缺少 nonce 或密文）")
	}
	nonce, ciphertext := raw[:nonceSize], raw[nonceSize:]
	plaintext, err := aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("解密失败（密钥不匹配或数据被篡改）: %w", err)
	}
	return string(plaintext), nil
}
