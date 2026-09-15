package catalog

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"strings"
	"testing"
	"time"
)

// 目录侧只验签。测试因此自带一个“签发侧”（真实签发方是账号服务，实现位于
// metafusion-auth 仓库）：用同一把 RSA 私钥签出令牌，验证目录的验签行为，
// 同时钉住“目录拿不到签发能力”——本文件里的 signTestToken 是测试专用函数，
// 生产代码没有对应的导出方法。

func testKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return key
}

// testVerifier 把测试私钥交给验签器，返回验签器；私钥另存一份只用于造令牌。
func testVerifier(t *testing.T, key *rsa.PrivateKey) *TokenVerifier {
	t.Helper()
	t.Setenv("AUTH_JWT_PRIVATE_KEY", pemText(t, key))
	v, err := NewTokenVerifierFromEnv("https://example.test/api", "metafusion")
	if err != nil {
		t.Fatalf("verifier: %v", err)
	}
	if v.Ephemeral() {
		t.Fatal("verifier fell back to ephemeral mode")
	}
	return v
}

func pemText(t *testing.T, key *rsa.PrivateKey) string {
	t.Helper()
	return string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}))
}

// signTestToken 按与账号服务逐字一致的载荷形状签发 RS256 令牌。
func signTestToken(t *testing.T, key *rsa.PrivateKey, mutate func(Claims) Claims) string {
	t.Helper()
	claims := Claims{
		Subject: "11111111-1111-1111-1111-111111111111", Username: "kana", Email: "kana@example.com",
		Role: "editor", Issuer: "https://example.test/api", Audience: "metafusion",
		IssuedAt: time.Now().Unix(), Expires: time.Now().Add(10 * time.Minute).Unix(), JTI: "test-jti",
	}
	if mutate != nil {
		claims = mutate(claims)
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	sum := sha256.Sum256(der)
	kid := base64.RawURLEncoding.EncodeToString(sum[:8])
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": kid})
	signing := b64(header) + "." + b64(payload)
	digest := sha256.Sum256([]byte(signing))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return signing + "." + b64(sig)
}

// 账号服务签发的令牌必须能被目录还原出身份。
func TestVerifyRestoresIdentity(t *testing.T) {
	key := testKey(t)
	v := testVerifier(t, key)
	claims, err := v.Verify(signTestToken(t, key, nil))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	u := ClaimsToUser(claims)
	if u.ID != "11111111-1111-1111-1111-111111111111" || u.Username != "kana" || u.Role != "editor" {
		t.Fatalf("claims mismatch: %+v", u)
	}
}

// 篡改签名或载荷必须失败；alg 必须锁死 RS256。
func TestVerifyRejectsTampering(t *testing.T) {
	key := testKey(t)
	v := testVerifier(t, key)
	token := signTestToken(t, key, nil)
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatal("unexpected token shape")
	}
	// 改签名
	bad := parts[0] + "." + parts[1] + "." + base64.RawURLEncoding.EncodeToString([]byte("nope"))
	if _, err := v.Verify(bad); err == nil {
		t.Fatal("tampered signature accepted")
	}
	// 改载荷：把角色提权成 admin
	payload, _ := base64.RawURLEncoding.DecodeString(parts[1])
	escalated := strings.Replace(string(payload), `"editor"`, `"admin"`, 1)
	bad2 := parts[0] + "." + base64.RawURLEncoding.EncodeToString([]byte(escalated)) + "." + parts[2]
	if _, err := v.Verify(bad2); err == nil {
		t.Fatal("tampered payload accepted")
	}
	// alg=none 与 HS256 都必须被拒（算法混淆）
	noneHdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`))
	if _, err := v.Verify(noneHdr + "." + parts[1] + "."); err == nil {
		t.Fatal("alg=none accepted")
	}
	hsHdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256"}`))
	if _, err := v.Verify(hsHdr + "." + parts[1] + "." + parts[2]); err == nil {
		t.Fatal("HS256 header accepted")
	}
}

// 过期与缺 exp 的令牌一律拒绝（不允许“永久令牌”）。
func TestVerifyEnforcesExpiry(t *testing.T) {
	key := testKey(t)
	v := testVerifier(t, key)
	base := time.Now()
	v.now = func() time.Time { return base }
	token := signTestToken(t, key, nil)
	if _, err := v.Verify(token); err != nil {
		t.Fatalf("fresh token rejected: %v", err)
	}
	v.now = func() time.Time { return base.Add(11 * time.Minute) }
	if _, err := v.Verify(token); err == nil {
		t.Fatal("expired token accepted")
	}
	v.now = func() time.Time { return base }
	noExp := signTestToken(t, key, func(c Claims) Claims { c.Expires = 0; return c })
	if _, err := v.Verify(noExp); err == nil {
		t.Fatal("token without exp accepted")
	}
}

// issuer、audience 与 sub 都必须合规：目录不能接受别人签的、或不是给它的令牌。
func TestVerifyEnforcesIssuerAndAudience(t *testing.T) {
	key := testKey(t)
	v := testVerifier(t, key)
	for name, mutate := range map[string]func(Claims) Claims{
		"wrong issuer":   func(c Claims) Claims { c.Issuer = "https://evil.example/api"; return c },
		"wrong audience": func(c Claims) Claims { c.Audience = "metafusion-forum"; return c },
		"no subject":     func(c Claims) Claims { c.Subject = ""; return c },
	} {
		token := signTestToken(t, key, mutate)
		if _, err := v.Verify(token); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
}

// id_token（aud 指向第三方客户端）不是给目录的访问凭证：第三方请求目录时
// 必须换成 aud=metafusion 的访问令牌。
func TestVerifyRejectsClientAudiencedToken(t *testing.T) {
	key := testKey(t)
	v := testVerifier(t, key)
	idToken := signTestToken(t, key, func(c Claims) Claims { c.Audience = "metafusion-forum"; return c })
	if _, err := v.Verify(idToken); err == nil {
		t.Fatal("id_token accepted as an access token")
	}
}

// 别的密钥签出来的令牌不得通过（公钥不同即签名不同）。
func TestVerifyRejectsForeignKey(t *testing.T) {
	v := testVerifier(t, testKey(t))
	foreign := signTestToken(t, testKey(t), nil)
	if _, err := v.Verify(foreign); err == nil {
		t.Fatal("token from another key accepted")
	}
}

// PKCS#1、PKCS#8 与 base64 包裹的 PEM 都要能加载，且只保留公钥用于验签。
func TestVerifierLoadsPEM(t *testing.T) {
	key := testKey(t)
	pkcs1 := pemText(t, key)
	der8, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	pkcs8 := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der8}))
	for name, raw := range map[string]string{"pkcs1": pkcs1, "pkcs8": pkcs8, "base64": base64.StdEncoding.EncodeToString([]byte(pkcs1))} {
		t.Setenv("AUTH_JWT_PRIVATE_KEY", raw)
		v, err := NewTokenVerifierFromEnv("https://example.test/api", "metafusion")
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if v.Ephemeral() {
			t.Fatalf("%s: expected a real key", name)
		}
		if v.KeyID() == "" || v.KeyID() == "default" {
			t.Fatalf("%s: no kid derived", name)
		}
		if _, err = v.Verify(signTestToken(t, key, nil)); err != nil {
			t.Fatalf("%s verify: %v", name, err)
		}
	}
}

// 未配置密钥时 fail closed：验签器存在但拒绝一切令牌，绝不静默放行。
func TestVerifierFailsClosedWithoutKey(t *testing.T) {
	t.Setenv("AUTH_JWT_PRIVATE_KEY", "")
	v, err := NewTokenVerifierFromEnv("https://example.test/api", "metafusion")
	if err != nil {
		t.Fatal(err)
	}
	if !v.Ephemeral() {
		t.Fatal("expected ephemeral verifier when the key is unset")
	}
	if _, err := v.Verify(signTestToken(t, testKey(t), nil)); err == nil {
		t.Fatal("verifier without a key accepted a token")
	}
	var nilVerifier *TokenVerifier
	if _, err := nilVerifier.Verify("a.b.c"); err == nil {
		t.Fatal("nil verifier accepted a token")
	}
}

// Store.Authenticate 只做验签：没有验签器、空令牌、垃圾令牌都必须是匿名，
// 而且**不再有查库兜底**这条路径。
func TestStoreAuthenticateIsVerifyOnly(t *testing.T) {
	s := &Store{}
	if _, err := s.Authenticate("anything"); err == nil {
		t.Fatal("store without a verifier accepted a token")
	}
	key := testKey(t)
	s.Verifier = testVerifier(t, key)
	if _, err := s.Authenticate(""); err == nil {
		t.Fatal("empty token accepted")
	}
	if _, err := s.Authenticate("not-a-token"); err == nil {
		t.Fatal("garbage token accepted")
	}
	u, err := s.Authenticate(signTestToken(t, key, nil))
	if err != nil || u == nil || u.Role != "editor" {
		t.Fatalf("valid token rejected: %v %+v", err, u)
	}
}

// PublicJWK 只暴露公钥参数，不得包含任何私钥材料。
func TestPublicJWKHasNoPrivateMaterial(t *testing.T) {
	v := testVerifier(t, testKey(t))
	jwk := v.PublicJWK()
	if jwk["kty"] != "RSA" || jwk["alg"] != "RS256" || jwk["kid"] != v.KeyID() {
		t.Fatalf("unexpected jwk: %+v", jwk)
	}
	for _, forbidden := range []string{"d", "p", "q", "dp", "dq", "qi"} {
		if _, ok := jwk[forbidden]; ok {
			t.Fatalf("jwk leaks private parameter %q", forbidden)
		}
	}
}
