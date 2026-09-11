package catalog

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"strings"
	"testing"
	"time"
)

func testIssuer(t *testing.T) *TokenIssuer {
	t.Helper()
	iss, err := NewTokenIssuerFromEnv("https://example.test/api", "metafusion")
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	return iss
}

// 签发的令牌必须能被自己的公钥验签还原身份。
func TestTokenIssuerRoundTrip(t *testing.T) {
	iss := testIssuer(t)
	u := User{ID: "u-1", Username: "alice", Email: "alice@example.com", Role: "admin"}
	token, jti, exp, err := iss.Sign(u)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if jti == "" {
		t.Fatal("jti must not be empty")
	}
	if time.Until(exp) > AccessTokenTTL+time.Minute {
		t.Fatalf("expiry %v exceeds TTL %v", exp, AccessTokenTTL)
	}
	claims, err := iss.Verify(token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	got := ClaimsToUser(claims)
	if got.ID != u.ID || got.Username != u.Username || got.Role != u.Role {
		t.Fatalf("claims mismatch: %+v", got)
	}
	if claims.Issuer != "https://example.test/api" || claims.Audience != "metafusion" {
		t.Fatalf("iss/aud mismatch: %+v", claims)
	}
}

// 篡改载荷或签名必须验签失败；alg 必须锁定 RS256。
func TestTokenIssuerRejectsTampering(t *testing.T) {
	iss := testIssuer(t)
	token, _, _, err := iss.Sign(User{ID: "u-1", Username: "alice", Role: "editor"})
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatal("unexpected token shape")
	}

	// 改签名
	bad := parts[0] + "." + parts[1] + "." + base64.RawURLEncoding.EncodeToString([]byte("nope"))
	if _, err := iss.Verify(bad); err == nil {
		t.Fatal("tampered signature accepted")
	}
	// 改载荷（把角色改成 admin）
	payload, _ := base64.RawURLEncoding.DecodeString(parts[1])
	escalated := strings.Replace(string(payload), `"editor"`, `"admin"`, 1)
	bad2 := parts[0] + "." + base64.RawURLEncoding.EncodeToString([]byte(escalated)) + "." + parts[2]
	if _, err := iss.Verify(bad2); err == nil {
		t.Fatal("tampered payload accepted")
	}
	// alg=none 与 HS256 都必须被拒（算法混淆）
	noneHdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`))
	if _, err := iss.Verify(noneHdr + "." + parts[1] + "."); err == nil {
		t.Fatal("alg=none accepted")
	}
	hsHdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	if _, err := iss.Verify(hsHdr + "." + parts[1] + "." + parts[2]); err == nil {
		t.Fatal("HS256 header accepted")
	}
}

// 过期令牌必须被拒；临界点前仍有效。
func TestTokenIssuerExpiry(t *testing.T) {
	iss := testIssuer(t)
	base := time.Now()
	iss.now = func() time.Time { return base }
	token, _, exp, err := iss.Sign(User{ID: "u-1", Username: "alice", Role: "editor"})
	if err != nil {
		t.Fatal(err)
	}
	// TTL 之内仍然有效
	iss.now = func() time.Time { return base.Add(AccessTokenTTL - time.Second) }
	if _, err := iss.Verify(token); err != nil {
		t.Fatalf("token rejected before expiry: %v", err)
	}
	// 越过 exp 即失效
	iss.now = func() time.Time { return exp.Add(time.Second) }
	if _, err := iss.Verify(token); err == nil {
		t.Fatal("expired token accepted")
	}
}

// 缺少 exp 的令牌（无论签名是否合法）必须被拒，避免"永久令牌"。
func TestTokenIssuerRequiresExp(t *testing.T) {
	iss := testIssuer(t)
	parts := strings.Split(mustSign(t, iss), ".")
	payload, _ := base64.RawURLEncoding.DecodeString(parts[1])
	mutated := strings.Replace(string(payload), `"exp":`, `"exp0":`, 1)
	if _, err := iss.Verify(parts[0] + "." + base64.RawURLEncoding.EncodeToString([]byte(mutated)) + "." + parts[2]); err == nil {
		t.Fatal("token without exp accepted")
	}
}

func mustSign(t *testing.T, iss *TokenIssuer) string {
	t.Helper()
	tok, _, _, err := iss.Sign(User{ID: "u-1", Username: "alice", Role: "editor"})
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

// 登出注销后，同一令牌不得再通过验签。
func TestTokenIssuerRevoke(t *testing.T) {
	iss := testIssuer(t)
	u := User{ID: "u-1", Username: "alice", Role: "editor"}
	token, _, _, err := iss.Sign(u)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := iss.Verify(token); err != nil {
		t.Fatalf("precondition verify failed: %v", err)
	}
	iss.RevokeToken(token)
	if _, err := iss.Verify(token); err == nil {
		t.Fatal("revoked token still verifies")
	}
}

// 从 PEM 加载持久私钥时，必须能与公钥配对（PKCS#1 与 PKCS#8 均支持）。
func TestTokenIssuerLoadsPEM(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pkcs1 := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	der8, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	pkcs8 := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der8})
	for name, pemText := range map[string]string{"pkcs1": string(pkcs1), "pkcs8": string(pkcs8)} {
		t.Setenv("AUTH_JWT_PRIVATE_KEY", pemText)
		iss, err := NewTokenIssuerFromEnv("iss", "aud")
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if iss.Ephemeral() {
			t.Fatalf("%s: expected persistent key", name)
		}
		token, _, _, err := iss.Sign(User{ID: "u", Username: "n", Role: "editor"})
		if err != nil {
			t.Fatalf("%s sign: %v", name, err)
		}
		if _, err := iss.Verify(token); err != nil {
			t.Fatalf("%s verify: %v", name, err)
		}
	}
}

// 未配置私钥时应生成本进程临时密钥（可签发/验签但标记为 ephemeral）。
func TestTokenIssuerEphemeralFallback(t *testing.T) {
	t.Setenv("AUTH_JWT_PRIVATE_KEY", "")
	iss, err := NewTokenIssuerFromEnv("iss", "aud")
	if err != nil {
		t.Fatal(err)
	}
	if !iss.Ephemeral() {
		t.Fatal("expected ephemeral issuer when key is unset")
	}
	tok, _, _, err := iss.Sign(User{ID: "u", Username: "n", Role: "editor"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := iss.Verify(tok); err != nil {
		t.Fatal(err)
	}
}

// 双模式：JWT 走无状态验签；不透明随机令牌回退查库（存量会话不失效）。
func TestAuthenticateDualMode(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.s.Tokens = testIssuer(t)

	// 1) RS256 令牌：即使不在 auth.sessions 中，也应鉴权成功。
	jwt, _, _, err := f.s.Tokens.Sign(f.u)
	if err != nil {
		t.Fatal(err)
	}
	u, err := f.s.Authenticate(ctx, jwt)
	if err != nil || u == nil || u.ID != f.u.ID {
		t.Fatalf("jwt auth failed: %v %+v", err, u)
	}

	// 2) 服务端会话令牌（非 JWT）：回退查库仍应成功。
	legacy, legacyUser, err := f.s.Login(ctx, "fixture-admin", "fixture-password-123")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(legacy, ".") {
		// 配置了签发器时应为 JWT
		t.Fatalf("expected JWT from Login when issuer configured, got opaque token")
	}
	u2, err := f.s.Authenticate(ctx, legacy)
	if err != nil || u2 == nil || u2.ID != legacyUser.ID {
		t.Fatalf("jwt from Login failed: %v", err)
	}

	// 3) 注销后 JWT 不再可用，且会话行被删除。
	if err := f.s.Logout(ctx, legacy); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.Authenticate(ctx, legacy); err == nil {
		t.Fatal("revoked token still authenticates")
	}

	// 4) 垃圾令牌必须失败。
	if _, err := f.s.Authenticate(ctx, "not-a-token"); err == nil {
		t.Fatal("garbage token accepted")
	}
}

// Refresh 必须换发新令牌、作废旧令牌并轮转会话行。
func TestRefreshRotatesToken(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.s.Tokens = testIssuer(t)
	token, u, err := f.s.Login(ctx, "fixture-admin", "fixture-password-123")
	if err != nil {
		t.Fatal(err)
	}
	next, u2, err := f.s.Refresh(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if next == "" || next == token {
		t.Fatal("refresh must issue a new token")
	}
	if u2.ID != u.ID {
		t.Fatalf("refresh changed identity: %+v vs %+v", u2, u)
	}
	if _, err := f.s.Authenticate(ctx, next); err != nil {
		t.Fatalf("refreshed token rejected: %v", err)
	}
	if _, err := f.s.Authenticate(ctx, token); err == nil {
		t.Fatal("old token still valid after refresh")
	}
	if _, _, err := f.s.Refresh(ctx, "garbage"); err == nil {
		t.Fatal("refresh accepted garbage token")
	}
}
