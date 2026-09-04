package service

import (
	"strings"
	"testing"
)

// testEncKey is a fixed 32-byte AES-256 key shared by the crypto tests.
var testEncKey = []byte("0123456789abcdef0123456789abcdef")

// wrongEncKey is a different 32-byte key, used to prove decryption fails
// when the field was encrypted with another key.
var wrongEncKey = []byte("fedcba9876543210fedcba9876543210")

func TestEncryptFieldRoundTrip(t *testing.T) {
	tests := []struct {
		name      string
		plaintext string
	}{
		{name: "password", plaintext: "s3cr3t-p@ssw0rd"},
		{name: "private key", plaintext: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END OPENSSH PRIVATE KEY-----\n"},
		{name: "unicode", plaintext: "密碼 パスワード 🔑"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			enc, err := EncryptField(testEncKey, tt.plaintext)
			if err != nil {
				t.Fatalf("EncryptField failed: %v", err)
			}
			if !strings.HasPrefix(enc, "enc1:") {
				t.Errorf("output %q missing enc1: prefix", enc)
			}
			if enc == tt.plaintext {
				t.Errorf("output %q equals plaintext; expected ciphertext", enc)
			}
			dec, err := DecryptField(testEncKey, enc)
			if err != nil {
				t.Fatalf("DecryptField failed: %v", err)
			}
			if dec != tt.plaintext {
				t.Errorf("round-trip = %q, want %q", dec, tt.plaintext)
			}
		})
	}
}

func TestEncryptFieldUniqueNonce(t *testing.T) {
	a, err := EncryptField(testEncKey, "same-value")
	if err != nil {
		t.Fatalf("EncryptField failed: %v", err)
	}
	b, err := EncryptField(testEncKey, "same-value")
	if err != nil {
		t.Fatalf("EncryptField failed: %v", err)
	}
	if a == b {
		t.Errorf("encrypting the same value twice produced identical ciphertext %q", a)
	}
}

func TestEncryptFieldEmpty(t *testing.T) {
	enc, err := EncryptField(testEncKey, "")
	if err != nil {
		t.Fatalf("EncryptField failed: %v", err)
	}
	if enc != "" {
		t.Errorf("EncryptField(\"\") = %q, want \"\"", enc)
	}
}

func TestDecryptFieldLegacyPlaintext(t *testing.T) {
	tests := []struct {
		name   string
		stored string
	}{
		{name: "plain password", stored: "plaintext-password"},
		{name: "plain private key", stored: "-----BEGIN RSA PRIVATE KEY-----"},
		{name: "empty", stored: ""},
		{name: "enc-like but not prefixed", stored: "enc:not-real"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dec, err := DecryptField(testEncKey, tt.stored)
			if err != nil {
				t.Fatalf("DecryptField failed: %v", err)
			}
			if dec != tt.stored {
				t.Errorf("DecryptField(%q) = %q, want unchanged %q", tt.stored, dec, tt.stored)
			}
		})
	}
}

func TestDecryptFieldErrors(t *testing.T) {
	enc, err := EncryptField(testEncKey, "sensitive")
	if err != nil {
		t.Fatalf("EncryptField failed: %v", err)
	}
	tampered := enc
	last := tampered[len(tampered)-1]
	replacement := byte('A')
	if last == 'A' {
		replacement = 'B'
	}
	tampered = tampered[:len(tampered)-1] + string(replacement)
	tests := []struct {
		name   string
		key    []byte
		stored string
	}{
		{name: "wrong key", key: wrongEncKey, stored: enc},
		{name: "tampered ciphertext", key: testEncKey, stored: tampered},
		{name: "bad base64", key: testEncKey, stored: "enc1:!!!not-base64!!!"},
		{name: "truncated blob", key: testEncKey, stored: "enc1:"},
		{name: "short key", key: []byte("too-short"), stored: enc},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dec, err := DecryptField(tt.key, tt.stored)
			if err == nil {
				t.Fatalf("DecryptField(%s) = %q, want error", tt.name, dec)
			}
		})
	}
}

func TestSshConfigEncryptDecryptSensitive(t *testing.T) {
	origPassword := "hunter2"
	origPrivateKey := "-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----\n"
	origJumpPassword := "jump-secret"
	origJumpPrivateKey := "-----BEGIN OPENSSH PRIVATE KEY-----\njumpkey\n-----END OPENSSH PRIVATE KEY-----\n"
	cfg := SshConfig{
		Host:       "example.com",
		Port:       2222,
		Username:   "admin",
		AuthType:   "password",
		Password:   origPassword,
		PrivateKey: origPrivateKey,

		JumpEnabled:    true,
		JumpHost:       "bastion.example.com",
		JumpPort:       2223,
		JumpUsername:   "jump-admin",
		JumpAuthType:   "password",
		JumpPassword:   origJumpPassword,
		JumpPrivateKey: origJumpPrivateKey,
	}
	if err := cfg.EncryptSensitive(testEncKey); err != nil {
		t.Fatalf("EncryptSensitive failed: %v", err)
	}
	if strings.HasPrefix(cfg.Password, "enc1:") != true || cfg.Password == "hunter2" {
		t.Errorf("Password not encrypted: %q", cfg.Password)
	}
	if strings.HasPrefix(cfg.PrivateKey, "enc1:") != true {
		t.Errorf("PrivateKey not encrypted: %q", cfg.PrivateKey)
	}
	if strings.HasPrefix(cfg.JumpPassword, "enc1:") != true || cfg.JumpPassword == "jump-secret" {
		t.Errorf("JumpPassword not encrypted: %q", cfg.JumpPassword)
	}
	if strings.HasPrefix(cfg.JumpPrivateKey, "enc1:") != true {
		t.Errorf("JumpPrivateKey not encrypted: %q", cfg.JumpPrivateKey)
	}
	blob, err := cfg.Marshal()
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	if strings.Contains(blob, "hunter2") || strings.Contains(blob, "BEGIN OPENSSH PRIVATE KEY") ||
		strings.Contains(blob, "jump-secret") || strings.Contains(blob, "jumpkey") {
		t.Errorf("marshaled blob leaks plaintext credentials: %s", blob)
	}

	var loaded SshConfig
	if err := loaded.Unmarshal(blob); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	if err := loaded.DecryptSensitive(testEncKey); err != nil {
		t.Fatalf("DecryptSensitive failed: %v", err)
	}
	if loaded.Password != origPassword || loaded.PrivateKey != origPrivateKey {
		t.Errorf("decrypted credentials mismatch: password=%q private_key=%q", loaded.Password, loaded.PrivateKey)
	}
	if loaded.JumpPassword != origJumpPassword || loaded.JumpPrivateKey != origJumpPrivateKey {
		t.Errorf("decrypted jump credentials mismatch: jump_password=%q jump_private_key=%q", loaded.JumpPassword, loaded.JumpPrivateKey)
	}
	if loaded.Host != "example.com" || loaded.Port != 2222 || loaded.Username != "admin" || loaded.AuthType != "password" {
		t.Errorf("non-sensitive fields altered: %+v", loaded)
	}
	if !loaded.JumpEnabled || loaded.JumpHost != "bastion.example.com" || loaded.JumpPort != 2223 ||
		loaded.JumpUsername != "jump-admin" || loaded.JumpAuthType != "password" {
		t.Errorf("non-sensitive jump fields altered: %+v", loaded)
	}
}

func TestSshConfigDecryptSensitiveLegacy(t *testing.T) {
	cfg := SshConfig{Host: "h", Username: "u", AuthType: "key", PrivateKey: "legacy-plain-key", JumpPassword: "legacy-plain-jump-password"}
	if err := cfg.DecryptSensitive(testEncKey); err != nil {
		t.Fatalf("DecryptSensitive failed: %v", err)
	}
	if cfg.PrivateKey != "legacy-plain-key" {
		t.Errorf("legacy plaintext was modified: %q", cfg.PrivateKey)
	}
	if cfg.JumpPassword != "legacy-plain-jump-password" {
		t.Errorf("legacy plaintext jump password was modified: %q", cfg.JumpPassword)
	}
}

func TestSshConfigSanitized(t *testing.T) {
	cfg := SshConfig{
		Host:       "example.com",
		Port:       22,
		Username:   "admin",
		AuthType:   "key",
		Password:   "secret",
		PrivateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",

		JumpEnabled:    true,
		JumpHost:       "bastion.example.com",
		JumpPort:       22,
		JumpUsername:   "jump-admin",
		JumpAuthType:   "key",
		JumpPassword:   "jump-secret",
		JumpPrivateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
	}
	san := cfg.Sanitized()
	if san.Password != "" || san.PrivateKey != "" {
		t.Errorf("Sanitized kept credentials: password=%q private_key=%q", san.Password, san.PrivateKey)
	}
	if san.JumpPassword != "" || san.JumpPrivateKey != "" {
		t.Errorf("Sanitized kept jump credentials: jump_password=%q jump_private_key=%q", san.JumpPassword, san.JumpPrivateKey)
	}
	if san.Host != cfg.Host || san.Port != cfg.Port || san.Username != cfg.Username || san.AuthType != cfg.AuthType {
		t.Errorf("Sanitized altered non-sensitive fields: %+v", san)
	}
	if !san.JumpEnabled || san.JumpHost != cfg.JumpHost || san.JumpPort != cfg.JumpPort ||
		san.JumpUsername != cfg.JumpUsername || san.JumpAuthType != cfg.JumpAuthType {
		t.Errorf("Sanitized altered non-sensitive jump fields: %+v", san)
	}
	// The original must be untouched.
	if cfg.Password != "secret" || cfg.PrivateKey == "" || cfg.JumpPassword != "jump-secret" || cfg.JumpPrivateKey == "" {
		t.Errorf("Sanitized mutated the receiver: %+v", cfg)
	}
}
