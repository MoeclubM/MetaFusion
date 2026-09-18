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
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// 目录侧只验签。测试因此自带一个"签发侧"（真实签发方是账号服务，实现位于
// metafusion-auth 仓库）：用同一把 RSA 私钥签出令牌，验证目录的验签行为，
// 同时钉住"目录拿不到签发能力"——本文件里的 signTestToken 是测试专用函数，
// 生产代码没有对应的导出方法。
//
// 三种来源都要覆盖：静态公钥、JWKS、以及待移除的私钥兜底；优先级按 NewTokenVerifierFromEnv 的注释。

func testKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return key
}

// clearSigningSources 把三种来源清空：任何一条测试都必须自己声明用哪一种，
// 否则外层环境（开发机或 CI）里残留的变量会悄悄改变被测路径。
func clearSigningSources(t *testing.T) {
	t.Helper()
	t.Setenv("AUTH_JWT_PUBLIC_KEY", "")
	t.Setenv("AUTH_JWKS_URL", "")
	t.Setenv("AUTH_JWT_PRIVATE_KEY", "")
}

// testVerifier 走兼容兜底路径（AUTH_JWT_PRIVATE_KEY）：私钥只为派生公钥，私钥另存一份用于造令牌。
func testVerifier(t *testing.T, key *rsa.PrivateKey) *TokenVerifier {
	t.Helper()
	clearSigningSources(t)
	t.Setenv("AUTH_JWT_PRIVATE_KEY", pemText(t, key))
	v, err := NewTokenVerifierFromEnv("https://example.test/api", "metafusion")
	if err != nil {
		t.Fatalf("verifier: %v", err)
	}
	if v.Ephemeral() {
		t.Fatal("verifier fell back to ephemeral mode")
	}
	if got := v.Source(); got != SourcePrivateKey {
		t.Fatalf("来源应为兼容兜底 %s，实际 %q", SourcePrivateKey, got)
	}
	return v
}

// testVerifierFromPublicKey 走静态公钥路径（PKIX PEM），这是生产推荐配置。
func testVerifierFromPublicKey(t *testing.T, pub *rsa.PublicKey, encoded string) *TokenVerifier {
	t.Helper()
	clearSigningSources(t)
	t.Setenv("AUTH_JWT_PUBLIC_KEY", encoded)
	v, err := NewTokenVerifierFromEnv("https://example.test/api", "metafusion")
	if err != nil {
		t.Fatalf("public key verifier: %v", err)
	}
	if v.Ephemeral() || v.Source() != SourcePublicKey {
		t.Fatalf("来源应为静态公钥，实际 %q（ephemeral=%v）", v.Source(), v.Ephemeral())
	}
	if got := v.KeyID(); got != keyID(pub) {
		t.Fatalf("kid 应由公钥派生：%q != %q", got, keyID(pub))
	}
	return v
}

func testVerifierFromJWKS(t *testing.T, jwksURL string) *TokenVerifier {
	t.Helper()
	clearSigningSources(t)
	t.Setenv("AUTH_JWKS_URL", jwksURL)
	v, err := NewTokenVerifierFromEnv("https://example.test/api", "metafusion")
	if err != nil {
		t.Fatalf("jwks verifier: %v", err)
	}
	if v.Source() != SourceJWKS {
		t.Fatalf("来源应为 JWKS，实际 %q", v.Source())
	}
	return v
}

func pemText(t *testing.T, key *rsa.PrivateKey) string {
	t.Helper()
	return string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}))
}

func publicPEM(t *testing.T, key *rsa.PublicKey) string {
	t.Helper()
	der, err := x509.MarshalPKIXPublicKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
}

func publicPKCS1PEM(t *testing.T, key *rsa.PublicKey) string {
	t.Helper()
	return string(pem.EncodeToMemory(&pem.Block{Type: "RSA PUBLIC KEY", Bytes: x509.MarshalPKCS1PublicKey(key)}))
}

// jwksHandler 提供与账号服务同格式的 JWKS（kid 取公钥 SPKI 的 SHA-256 前 8 字节），
// 并统计被请求次数：用来证明缓存生效、以及目录不再探测上游。
func jwksHandler(hits *int64, current func() []*rsa.PublicKey) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(hits, 1)
		list := make([]map[string]string, 0)
		for _, pub := range current() {
			list = append(list, map[string]string{
				"kty": "RSA", "use": "sig", "alg": "RS256",
				"kid": keyID(pub),
				"n":   b64(pub.N.Bytes()),
				"e":   b64(big.NewInt(int64(pub.E)).Bytes()),
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": list})
	}
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

// 过期与缺 exp 的令牌一律拒绝（不允许"永久令牌"）。
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

// 兼容兜底路径（AUTH_JWT_PRIVATE_KEY）同样只验签：只保留公钥，别的密钥签的令牌一律拒绝。
func TestPrivateKeyFallbackIsVerifyOnly(t *testing.T) {
	key := testKey(t)
	v := testVerifier(t, key)
	if v.Source() != SourcePrivateKey {
		t.Fatalf("来源应为兼容兜底，实际 %q", v.Source())
	}
	if v.PublicJWK() == nil || v.KeyID() == "" || v.KeyID() == "default" {
		t.Fatalf("兜底路径应派生公钥与 kid")
	}
	if _, err := v.Verify(signTestToken(t, testKey(t), nil)); err == nil {
		t.Fatal("兜底路径接受了别的密钥签的令牌")
	}
}

// 私钥兜底要能吃 PKCS#1、PKCS#8 与 base64 包裹的 PEM 三种写法。
func TestVerifierPrivateKeyFallbackLoadsPEM(t *testing.T) {
	key := testKey(t)
	pkcs1 := pemText(t, key)
	der8, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	pkcs8 := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der8}))
	for name, raw := range map[string]string{"pkcs1": pkcs1, "pkcs8": pkcs8, "base64": base64.StdEncoding.EncodeToString([]byte(pkcs1))} {
		clearSigningSources(t)
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

// 静态公钥三种写法都要能加载并验签。
func TestVerifierStaticPublicKeyFormats(t *testing.T) {
	key := testKey(t)
	spki := publicPEM(t, &key.PublicKey)
	for name, encoded := range map[string]string{
		"pkix":        spki,
		"pkcs1":       publicPKCS1PEM(t, &key.PublicKey),
		"base64-pkix": base64.StdEncoding.EncodeToString([]byte(spki)),
	} {
		v := testVerifierFromPublicKey(t, &key.PublicKey, encoded)
		if _, err := v.Verify(signTestToken(t, key, nil)); err != nil {
			t.Fatalf("%s verify: %v", name, err)
		}
	}
}

// 静态公钥是推荐配置：它优先于 JWKS，也不该带来任何出站请求。
func TestVerifierPrefersStaticPublicKeyWithoutNetwork(t *testing.T) {
	key := testKey(t)
	var hits int64
	up := httptest.NewServer(jwksHandler(&hits, func() []*rsa.PublicKey { return nil }))
	defer up.Close()

	clearSigningSources(t)
	t.Setenv("AUTH_JWT_PUBLIC_KEY", publicPEM(t, &key.PublicKey))
	t.Setenv("AUTH_JWKS_URL", up.URL)                        // 同时配置也不该被用到
	t.Setenv("AUTH_JWT_PRIVATE_KEY", pemText(t, testKey(t))) // 私钥不该被用到
	v, err := NewTokenVerifierFromEnv("https://example.test/api", "metafusion")
	if err != nil {
		t.Fatal(err)
	}
	if v.Source() != SourcePublicKey {
		t.Fatalf("静态公钥应优先，实际来源 %q", v.Source())
	}
	if _, err = v.Verify(signTestToken(t, key, nil)); err != nil {
		t.Fatalf("verify: %v", err)
	}
	if n := atomic.LoadInt64(&hits); n != 0 {
		t.Fatalf("配置了静态公钥时不应请求 JWKS，实际 %d 次", n)
	}
}

// AUTH_JWT_PUBLIC_KEY 里放私钥必须报错：目录的环境变量里出现私钥正是这次收口要消灭的东西。
func TestVerifierRejectsPrivateKeyInPublicKeyEnv(t *testing.T) {
	key := testKey(t)
	clearSigningSources(t)
	t.Setenv("AUTH_JWT_PUBLIC_KEY", pemText(t, key))
	if _, err := NewTokenVerifierFromEnv("https://example.test/api", "metafusion"); err == nil {
		t.Fatal("私钥被当作公钥接受了")
	}
}

// JWKS 优先于私钥兜底：同一进程里两种变量都给时，只有 JWKS 里的钥匙能验签。
func TestVerifierPrefersJWKSOverPrivateKey(t *testing.T) {
	key := testKey(t)
	var hits int64
	up := httptest.NewServer(jwksHandler(&hits, func() []*rsa.PublicKey { return []*rsa.PublicKey{&key.PublicKey} }))
	defer up.Close()

	clearSigningSources(t)
	t.Setenv("AUTH_JWKS_URL", up.URL)
	t.Setenv("AUTH_JWT_PRIVATE_KEY", pemText(t, testKey(t)))
	v, err := NewTokenVerifierFromEnv("https://example.test/api", "metafusion")
	if err != nil {
		t.Fatal(err)
	}
	if v.Source() != SourceJWKS {
		t.Fatalf("JWKS 应优先于私钥兜底，实际来源 %q", v.Source())
	}
	if _, err = v.Verify(signTestToken(t, key, nil)); err != nil {
		t.Fatalf("JWKS 签名密钥应通过: %v", err)
	}
	foreign := testKey(t)
	if _, err = v.Verify(signTestToken(t, foreign, nil)); err == nil {
		t.Fatal("JWKS 模式下接受了不在 JWKS 里的密钥")
	}
}

// JWKS 缓存 10 分钟；kid 轮换（未知 kid）必须触发一次强制刷新。
func TestVerifierJWKSCacheAndRotation(t *testing.T) {
	keyA, keyB := testKey(t), testKey(t)
	var hits int64
	current := keyA
	up := httptest.NewServer(jwksHandler(&hits, func() []*rsa.PublicKey { return []*rsa.PublicKey{&current.PublicKey} }))
	defer up.Close()
	v := testVerifierFromJWKS(t, up.URL)

	tokenA := signTestToken(t, keyA, nil)
	if _, err := v.Verify(tokenA); err != nil {
		t.Fatalf("verify A: %v", err)
	}
	if n := atomic.LoadInt64(&hits); n != 1 {
		t.Fatalf("首次验签应拉取一次 JWKS，实际 %d 次", n)
	}
	if _, err := v.Verify(tokenA); err != nil {
		t.Fatalf("verify A again: %v", err)
	}
	if n := atomic.LoadInt64(&hits); n != 1 {
		t.Fatalf("缓存期内不应重复拉取，实际 %d 次", n)
	}

	// 账号侧轮换签名密钥：新令牌带新 kid，目录必须刷新后接受。
	current = keyB
	if _, err := v.Verify(signTestToken(t, keyB, nil)); err != nil {
		t.Fatalf("轮换后的密钥应通过: %v", err)
	}
	if n := atomic.LoadInt64(&hits); n != 2 {
		t.Fatalf("未知 kid 应触发一次强制刷新，实际共 %d 次", n)
	}
}

// JWKS 里没有的 kid、JWKS 不可用、JWKS 只有非 RSA 密钥：一律 fail closed。
func TestVerifierJWKSFailuresAreClosed(t *testing.T) {
	key := testKey(t)
	var hits int64
	up := httptest.NewServer(jwksHandler(&hits, func() []*rsa.PublicKey { return []*rsa.PublicKey{&key.PublicKey} }))
	defer up.Close()

	v := testVerifierFromJWKS(t, up.URL)
	if _, err := v.Verify(signTestToken(t, testKey(t), nil)); err == nil {
		t.Fatal("JWKS 里不存在的 kid 应被拒")
	}

	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer down.Close()
	vDown := testVerifierFromJWKS(t, down.URL)
	if _, err := vDown.Verify(signTestToken(t, key, nil)); err == nil {
		t.Fatal("JWKS 不可用时必须 fail closed")
	}

	// 只有 EC 密钥的 JWKS：没有可用 RSA 公钥，同样不验签。
	everywhere := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"keys":[{"kty":"EC","kid":"x","crv":"P-256"}]}`))
	}))
	defer everywhere.Close()
	vEC := testVerifierFromJWKS(t, everywhere.URL)
	if _, err := vEC.Verify(signTestToken(t, key, nil)); err == nil {
		t.Fatal("没有可用 RSA 公钥时不能验签")
	}
}

// 静态公钥路径上的声明校验与兜底路径一致：过期、错 issuer、错 audience、错算法、缺 sub 全拒。
func TestStaticPublicKeyVerifierEnforcesClaims(t *testing.T) {
	key := testKey(t)
	v := testVerifierFromPublicKey(t, &key.PublicKey, publicPEM(t, &key.PublicKey))
	if _, err := v.Verify(signTestToken(t, key, nil)); err != nil {
		t.Fatalf("fresh token rejected: %v", err)
	}
	for name, mutate := range map[string]func(Claims) Claims{
		"expired":        func(c Claims) Claims { c.Expires = time.Now().Add(-time.Minute).Unix(); return c },
		"no exp":         func(c Claims) Claims { c.Expires = 0; return c },
		"wrong issuer":   func(c Claims) Claims { c.Issuer = "https://evil.example/api"; return c },
		"wrong audience": func(c Claims) Claims { c.Audience = "metafusion-forum"; return c },
		"no subject":     func(c Claims) Claims { c.Subject = ""; return c },
	} {
		if _, err := v.Verify(signTestToken(t, key, mutate)); err == nil {
			t.Fatalf("%s accepted at the static public key source", name)
		}
	}
	// alg=none 与 HS256 必须被拒（算法混淆）。
	parts := strings.Split(signTestToken(t, key, nil), ".")
	for name, header := range map[string]string{"none": `{"alg":"none"}`, "hs256": `{"alg":"HS256"}`} {
		bad := base64.RawURLEncoding.EncodeToString([]byte(header)) + "." + parts[1] + "." + parts[2]
		if _, err := v.Verify(bad); err == nil {
			t.Fatalf("alg=%s accepted at the static public key source", name)
		}
	}
}

// 未配置任何来源时 fail closed：验签器存在但拒绝一切令牌，绝不静默放行。
func TestVerifierFailsClosedWithoutKey(t *testing.T) {
	clearSigningSources(t)
	v, err := NewTokenVerifierFromEnv("https://example.test/api", "metafusion")
	if err != nil {
		t.Fatal(err)
	}
	if !v.Ephemeral() || v.Source() != SourceNone {
		t.Fatalf("未配置来源时应为 ephemeral，实际 source=%q", v.Source())
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

// 账号服务签发的 groups/permissions 必须逐字落到 User 上：授权只看 permissions，
// groups 只作展示与审计。
func TestClaimsCarryGroupsAndPermissions(t *testing.T) {
	key := testKey(t)
	v := testVerifier(t, key)
	token := signTestToken(t, key, func(c Claims) Claims {
		c.Groups = []string{"catalog_editor"}
		c.Permissions = []string{PermissionEntityEdit, PermissionRelationEdit}
		return c
	})
	claims, err := v.Verify(token)
	if err != nil {
		t.Fatal(err)
	}
	u := ClaimsToUser(claims)
	if !u.Can(PermissionEntityEdit) || u.Can(PermissionLifecycleManage) {
		t.Fatalf("token permissions not honoured: %+v", u)
	}
	if len(u.Groups) != 1 || u.Groups[0] != "catalog_editor" || len(u.Permissions) != 2 {
		t.Fatalf("groups/permissions not restored: %+v", u)
	}
	// 载荷键名与账号服务的签发侧逐字一致：改名会让目录读不到权限。
	payload, err := base64.RawURLEncoding.DecodeString(strings.Split(token, ".")[1])
	if err != nil {
		t.Fatal(err)
	}
	raw := map[string]any{}
	if err = json.Unmarshal(payload, &raw); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"groups", "permissions"} {
		if _, ok := raw[field]; !ok {
			t.Fatalf("%s claim key drifted from the account service", field)
		}
	}
	// Store.Authenticate 走同一条还原路径（目录不查库，身份只来自令牌）。
	s := &Store{Verifier: v}
	authed, err := s.Authenticate(token)
	if err != nil || authed == nil || !authed.Can(PermissionEntityEdit) || authed.Can(PermissionDefinitionsManage) {
		t.Fatalf("authenticate must carry permissions: %v %+v", err, authed)
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
	// JWKS 模式下本服务不持有单一公钥：没有可给出的 JWK。
	var hits int64
	up := httptest.NewServer(jwksHandler(&hits, func() []*rsa.PublicKey { return nil }))
	defer up.Close()
	if jwk = testVerifierFromJWKS(t, up.URL).PublicJWK(); jwk != nil {
		t.Fatalf("JWKS 模式下不应有单一 JWK: %+v", jwk)
	}
}

// 账号服务抖动（JWKS 非 200 / 连接失败）超过 TTL 后，缓存里仍然有效的旧键必须继续可用：
// 公钥没有有效期，TTL 只是"多久去确认一次轮换"；旧实现此时直接返回错误，等于让本服务对
// 所有已签发令牌 401（2026-09-19 第二轮架构报告 #22）。
func TestVerifierJWKSRefreshFailureFallsBackToCachedKey(t *testing.T) {
	key := testKey(t)
	var hits int64
	var down atomic.Bool
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&hits, 1)
		if down.Load() {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		list := []map[string]string{{
			"kty": "RSA", "use": "sig", "alg": "RS256", "kid": keyID(&key.PublicKey),
			"n": b64(key.PublicKey.N.Bytes()), "e": b64(big.NewInt(int64(key.PublicKey.E)).Bytes()),
		}}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": list})
	}))
	defer up.Close()
	v := testVerifierFromJWKS(t, up.URL)

	token := signTestToken(t, key, nil)
	if _, err := v.Verify(token); err != nil {
		t.Fatalf("首次验签: %v", err)
	}
	if n := atomic.LoadInt64(&hits); n != 1 {
		t.Fatalf("首次验签应拉取一次 JWKS，实际 %d 次", n)
	}

	// 抖动 + 缓存过期：刷新失败，但旧键仍在缓存里 → 必须继续验签通过。
	down.Store(true)
	v.mu.Lock()
	v.fetchedAt = time.Now().Add(-2 * jwksCacheTTL)
	v.mu.Unlock()
	if _, err := v.Verify(token); err != nil {
		t.Fatalf("刷新失败时应回落到缓存公钥，实际被拒：%v", err)
	}
	if n := atomic.LoadInt64(&hits); n != 2 {
		t.Fatalf("缓存过期后应尝试刷新一次，实际累计 %d 次", n)
	}

	// 回落只对"缓存里有这个 kid"生效：没有缓存公钥的 kid 仍然 fail closed。
	if _, err := v.Verify(signTestToken(t, testKey(t), nil)); err == nil {
		t.Fatal("缓存里没有的 kid 即使 JWKS 挂掉也必须被拒")
	}

	// 账号服务恢复：下一次刷新成功后缓存更新，旧键仍可用。
	down.Store(false)
	v.mu.Lock()
	v.fetchedAt = time.Now().Add(-2 * jwksCacheTTL)
	v.mu.Unlock()
	if _, err := v.Verify(token); err != nil {
		t.Fatalf("JWKS 恢复后应重新刷新并通过: %v", err)
	}
}

// 并发未知 kid：出站请求必须共享同一次刷新（旧实现是每个请求在持锁期间强制刷新两次，
// 锁被持有到 HTTP 结束，JWKS 慢时该副本的验签全部排队）。
func TestVerifierJWKSConcurrentUnknownKidSharesOneFetch(t *testing.T) {
	keyA, keyB := testKey(t), testKey(t)
	var hits int64
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&hits, 1)
		// 拉长飞行窗口，让并发请求真的重叠在"刷新中"。
		time.Sleep(100 * time.Millisecond)
		list := []map[string]string{{
			"kty": "RSA", "use": "sig", "alg": "RS256", "kid": keyID(&keyA.PublicKey),
			"n": b64(keyA.PublicKey.N.Bytes()), "e": b64(big.NewInt(int64(keyA.PublicKey.E)).Bytes()),
		}}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": list})
	}))
	defer up.Close()
	v := testVerifierFromJWKS(t, up.URL)

	if _, err := v.Verify(signTestToken(t, keyA, nil)); err != nil {
		t.Fatalf("预热验签: %v", err)
	}
	warm := atomic.LoadInt64(&hits)

	const racers = 16
	tokenB := signTestToken(t, keyB, nil)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, _ = v.Verify(tokenB)
		}()
	}
	close(start)
	wg.Wait()

	got := atomic.LoadInt64(&hits) - warm
	t.Logf("%d 个并发未知 kid 产生的出站请求数 = %d", racers, got)
	if got != 1 {
		t.Fatalf("并发未知 kid 应共享同一次刷新（出站请求数 1），实际 %d", got)
	}
}
