package catalogv2

import (
	"context"
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
	req := httptest.NewRequest("GET", "/api/v2/oauth/userinfo", nil)
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
