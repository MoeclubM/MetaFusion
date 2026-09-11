package catalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestOAuthFlow(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	// List default clients
	clients, err := f.s.ListOAuthClients(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(clients) < 3 {
		t.Fatalf("expected at least 3 default clients, got %d", len(clients))
	}

	// Create code
	code, err := f.s.CreateOAuthCode(ctx, "metafusion-forum", f.u.ID, "https://forum.findverse.cc/auth/oauth2_basic/callback", "profile")
	if err != nil {
		t.Fatal(err)
	}
	if code == "" {
		t.Fatal("empty code")
	}

	// Exchange code
	token, u, err := f.s.ExchangeOAuthCode(ctx, "metafusion-forum", "", code, "https://forum.findverse.cc/auth/oauth2_basic/callback")
	if err != nil {
		t.Fatal(err)
	}
	if token == "" || u == nil || u.Username != "fixture-admin" {
		t.Fatalf("unexpected exchange result: %v, %v", token, u)
	}

	// Reusing same code should fail
	if _, _, err := f.s.ExchangeOAuthCode(ctx, "metafusion-forum", "", code, "https://forum.findverse.cc/auth/oauth2_basic/callback"); err == nil {
		t.Fatal("expected error on code reuse, got nil")
	}

	// Validate token
	u2, err := f.s.User(ctx, token)
	if err != nil || u2 == nil || u2.ID != f.u.ID {
		t.Fatalf("token auth failed: %v, %v", u2, err)
	}

	// Test HTTP endpoints
	gin.SetMode(gin.TestMode)
	r := gin.New()
	HTTP{Store: f.s}.Register(r)

	// Userinfo endpoint
	req := httptest.NewRequest("GET", "/api/oauth/userinfo", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 from /userinfo, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "fixture-admin") {
		t.Fatalf("expected userinfo to contain fixture-admin, got: %s", w.Body.String())
	}
}

// OIDC：签发 RS256 id_token（aud 指向客户端），discovery 与 JWKS 自洽。
func TestOIDCIDTokenAndJWKS(t *testing.T) {
	f := newFixture(t)
	f.s.Tokens = testIssuer(t)

	idToken, exp, err := f.s.IDToken(f.u, "metafusion-forum")
	if err != nil {
		t.Fatal(err)
	}
	if idToken == "" || exp == 0 {
		t.Fatalf("empty id_token: %q exp=%d", idToken, exp)
	}
	claims, err := f.s.Tokens.Verify(idToken)
	if err != nil {
		t.Fatalf("id_token must verify: %v", err)
	}
	if claims.Audience != "metafusion-forum" {
		t.Fatalf("id_token aud = %q, want client id", claims.Audience)
	}
	if claims.Subject != f.u.ID {
		t.Fatalf("id_token sub = %q, want %q", claims.Subject, f.u.ID)
	}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	HTTP{Store: f.s}.Register(r)

	req := httptest.NewRequest("GET", "/api/.well-known/openid-configuration", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("discovery status %d: %s", w.Code, w.Body.String())
	}
	var disc map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &disc); err != nil {
		t.Fatal(err)
	}
	issuer, _ := disc["issuer"].(string)
	if issuer == "" || disc["jwks_uri"] != issuer+"/oidc/jwks" {
		t.Fatalf("discovery mismatch: %+v", disc)
	}

	req2 := httptest.NewRequest("GET", "/api/oidc/jwks", nil)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("jwks status %d", w2.Code)
	}
	var jwks struct {
		Keys []map[string]any `json:"keys"`
	}
	if err := json.Unmarshal(w2.Body.Bytes(), &jwks); err != nil {
		t.Fatal(err)
	}
	if len(jwks.Keys) != 1 {
		t.Fatalf("expected exactly one JWK, got %d", len(jwks.Keys))
	}
	k := jwks.Keys[0]
	if k["kty"] != "RSA" || k["alg"] != "RS256" || k["kid"] != f.s.Tokens.KeyID() {
		t.Fatalf("unexpected JWK: %+v", k)
	}
	if k["n"] == "" || k["e"] == "" {
		t.Fatalf("JWK missing modulus/exponent: %+v", k)
	}
}

// OAuth 授权码换取的访问令牌在配置签发器时应为可本地验签的 RS256 JWT，
// 同时仍能通过 oauth_tokens 哈希被查库路径识别（双模式一致）。
func TestOAuthExchangeIssuesJWT(t *testing.T) {
	f := newFixture(t)
	f.s.Tokens = testIssuer(t)
	ctx := context.Background()
	code, err := f.s.CreateOAuthCode(ctx, "metafusion-forum", f.u.ID, "https://forum.findverse.cc/auth/oauth2_basic/callback", "profile")
	if err != nil {
		t.Fatal(err)
	}
	token, u, err := f.s.ExchangeOAuthCode(ctx, "metafusion-forum", "", code, "https://forum.findverse.cc/auth/oauth2_basic/callback")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(token, ".") {
		t.Fatal("expected a JWT access token, got opaque token")
	}
	claims, err := f.s.Tokens.Verify(token)
	if err != nil || claims.Subject != u.ID {
		t.Fatalf("issued access token must verify: %v", err)
	}
	if back, err := f.s.UserFromOAuthToken(ctx, token); err != nil || back.ID != f.u.ID {
		t.Fatalf("oauth token not resolvable from store: %v", err)
	}
}
