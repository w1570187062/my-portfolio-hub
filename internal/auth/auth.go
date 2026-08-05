package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"os"
	"strconv"
	"strings"
	"time"
)

// defaultTTL is how long an issued token stays valid (7 days).
// Satisfies "at least one day" and survives container restarts thanks to a stable secret.
const defaultTTL = 7 * 24 * time.Hour

func secret() []byte {
	s := os.Getenv("TOKEN_SECRET")
	if s == "" {
		s = "portfolio-local-secret"
	}
	return []byte(s)
}

// Check validates credentials against env (defaults: admin / admin12345).
func Check(user, pass string) bool {
	wantUser := os.Getenv("ADMIN_USER")
	if wantUser == "" {
		wantUser = "admin"
	}
	wantPass := os.Getenv("ADMIN_PASS")
	if wantPass == "" {
		wantPass = "admin12345"
	}
	return user == wantUser && pass == wantPass
}

// Issue returns a stateless signed token: base64(user|exp).base64(hmac).
// Validation recomputes the HMAC, so no server-side state is needed and a
// container restart does not invalidate already-issued tokens.
func Issue(user string) string {
	exp := time.Now().Add(defaultTTL).Unix()
	payload := user + "|" + strconv.FormatInt(exp, 10)
	raw := []byte(payload)
	mac := hmac.New(sha256.New, secret())
	sum := mac.Sum(raw)
	return base64.URLEncoding.EncodeToString(raw) + "." + base64.URLEncoding.EncodeToString(sum)
}

// Valid reports whether a token is correctly signed and still unexpired.
func Valid(tok string) bool {
	parts := strings.Split(tok, ".")
	if len(parts) != 2 {
		return false
	}
	raw, err1 := base64.URLEncoding.DecodeString(parts[0])
	sum, err2 := base64.URLEncoding.DecodeString(parts[1])
	if err1 != nil || err2 != nil {
		return false
	}
	mac := hmac.New(sha256.New, secret())
	expected := mac.Sum(raw)
	if !hmac.Equal(expected, sum) {
		return false
	}
	s := string(raw)
	idx := strings.LastIndex(s, "|")
	if idx < 0 {
		return false
	}
	exp, err := strconv.ParseInt(s[idx+1:], 10, 64)
	if err != nil {
		return false
	}
	return time.Now().Unix() < exp
}
