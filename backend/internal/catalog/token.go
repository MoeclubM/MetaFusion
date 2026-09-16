package catalog

// 访问令牌的**验签侧**：RS256（RSASSA-PKCS1-v1_5 + SHA-256）自包含 JWT。
//
// 账号拆分完成后，令牌只由账号服务（metafusion-auth）签发；目录侧保留的只有验签：
// 按来源优先级取一把公钥，在本地判定签名、时间窗、issuer 与 audience。
// 这里刻意**不提供签发、续期与注销**——目录进程拿不到也不需要签发路径，
// 少一条被误当成"第二个签发方"的可能；令牌撤销依赖 15 分钟短有效期与账号侧的会话表。
//
// 验签来源按优先级（见 NewTokenVerifierFromEnv）：
//  1. AUTH_JWT_PUBLIC_KEY —— 静态公钥（PEM 文本或其 base64）：少一条网络依赖，换钥匙要重启；
//  2. AUTH_JWKS_URL —— 账号服务的 JWKS：按 kid 选钥、10 分钟缓存、未知 kid 强制刷新；
//  3. AUTH_JWT_PRIVATE_KEY —— 兼容兜底：读私钥只为派生公钥，启动时告警，该路径待移除。
// 三者都没有时 fail closed：验签器存在但拒绝一切令牌。
//
// 用标准库实现而不引入第三方 JWT 依赖：RS256 的验签只是 crypto/rsa 的
// VerifyPKCS1v15 加一段 base64url，少一层供应链风险。

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// 验签来源标识：Source() 与启动日志用，也是排查"目录拿的是谁的钥匙"的唯一依据。
const (
	SourcePublicKey  = "AUTH_JWT_PUBLIC_KEY"
	SourceJWKS       = "AUTH_JWKS_URL"
	SourcePrivateKey = "AUTH_JWT_PRIVATE_KEY" // 兼容兜底，待移除
	SourceNone       = ""
)

// jwksCacheTTL 是 JWKS 公钥缓存时长：访问令牌有效期只有 15 分钟，缓存必须明显短于它，
// 否则账号侧轮换密钥后，旧公钥在目录侧还会被继续接受。
const jwksCacheTTL = 10 * time.Minute

// Claims 是访问令牌的载荷。字段名遵循 OIDC 惯例，与账号服务的签发侧逐字一致。
type Claims struct {
	Subject  string `json:"sub"`
	Username string `json:"preferred_username"`
	Email    string `json:"email,omitempty"`
	Role     string `json:"role"`
	// Groups/Permissions 与账号服务的签发侧逐字一致（见 metafusion-auth 的 Claims）：
	// groups 是组码（展示与审计用），permissions 是展开后的权限码集合——授权只看它。
	Groups      []string `json:"groups,omitempty"`
	Permissions []string `json:"permissions,omitempty"`
	Issuer      string   `json:"iss"`
	Audience    string   `json:"aud"`
	IssuedAt    int64    `json:"iat"`
	Expires     int64    `json:"exp"`
	JTI         string   `json:"jti"`
}

// TokenVerifier 只持公钥：零值不可用，需经 NewTokenVerifierFromEnv。
type TokenVerifier struct {
	mu sync.RWMutex
	// static 是本地持有的验签公钥：来自 AUTH_JWT_PUBLIC_KEY，或兼容兜底里从私钥派生的公钥。
	// 非空时不再请求 JWKS（静态公钥轮换要重启，换来少一条网络依赖）。
	static *rsa.PublicKey
	kid    string
	// jwksURL 为空表示不走 JWKS；keys 是按 kid 缓存的公钥，fetchedAt 记录最近一次成功拉取。
	jwksURL   string
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
	client    *http.Client
	// source 是当前生效的来源，用于启动日志与排查。
	source   string
	issuer   string
	audience string
	// now 可在测试中替换，用于验证过期边界；nil 表示 time.Now。
	now func() time.Time
}

func (t *TokenVerifier) clock() time.Time {
	if t != nil && t.now != nil {
		return t.now()
	}
	return time.Now()
}

// NewTokenVerifierFromEnv 按优先级装配验签来源：静态公钥 → JWKS → 私钥兜底（启动告警）。
// 都未配置时返回只能拒绝一切令牌的验签器（fail closed）：目录的公开读接口照常工作，
// 写接口在验签失败时按未登录处理，不会静默放行。
func NewTokenVerifierFromEnv(issuer, audience string) (*TokenVerifier, error) {
	return newTokenVerifier(issuer, audience, os.Getenv)
}

// newTokenVerifier 是装配主体；getenv 可注入，便于测试三种来源与优先级。
func newTokenVerifier(issuer, audience string, getenv func(string) string) (*TokenVerifier, error) {
	t := &TokenVerifier{
		issuer:   issuer,
		audience: audience,
		client:   &http.Client{Timeout: 2 * time.Second},
		keys:     map[string]*rsa.PublicKey{},
	}
	if raw := strings.TrimSpace(getenv("AUTH_JWT_PUBLIC_KEY")); raw != "" {
		pub, err := parseStaticPublicKey(raw)
		if err != nil {
			return nil, fmt.Errorf("AUTH_JWT_PUBLIC_KEY: %w", err)
		}
		t.static, t.kid, t.source = pub, keyID(pub), SourcePublicKey
		return t, nil
	}
	if jwks := strings.TrimSpace(getenv("AUTH_JWKS_URL")); jwks != "" {
		t.jwksURL, t.source = jwks, SourceJWKS
		return t, nil
	}
	raw := strings.TrimSpace(getenv("AUTH_JWT_PRIVATE_KEY"))
	if raw == "" {
		return t, nil
	}
	pub, err := publicKeyFromPrivatePEM(raw)
	if err != nil {
		return nil, fmt.Errorf("AUTH_JWT_PRIVATE_KEY: %w", err)
	}
	// 兼容兜底：只取公钥，私钥读完即丢——目录进程因此无法签发任何令牌。
	t.static, t.kid, t.source = pub, keyID(pub), SourcePrivateKey
	log.Print("AUTH_JWT_PRIVATE_KEY is deprecated for the catalog: it is read only to derive the public key (no signing path); set AUTH_JWT_PUBLIC_KEY or AUTH_JWKS_URL instead, this fallback will be removed")
	return t, nil
}

// parseStaticPublicKey 解析静态验签公钥：PEM 文本或其 base64，支持 PKIX（PUBLIC KEY）与 PKCS#1（RSA PUBLIC KEY）。
// 刻意不接受私钥：目录的环境变量里出现私钥正是这次收口要消灭的东西，直接报错比默默接受更容易被发现。
func parseStaticPublicKey(raw string) (*rsa.PublicKey, error) {
	block, _ := pem.Decode([]byte(decodeMaybeBase64PEM(raw)))
	if block == nil {
		return nil, errors.New("not a valid PEM (want a public key, e.g. openssl rsa -pubout)")
	}
	if strings.Contains(block.Type, "PRIVATE KEY") {
		return nil, errors.New("must be a public key, not a private key")
	}
	if parsed, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		pub, ok := parsed.(*rsa.PublicKey)
		if !ok {
			return nil, errors.New("must be an RSA public key")
		}
		return pub, nil
	}
	if pub, err := x509.ParsePKCS1PublicKey(block.Bytes); err == nil {
		return pub, nil
	}
	return nil, errors.New("must be a PKIX or PKCS#1 RSA public key")
}

// publicKeyFromPrivatePEM 从私钥 PEM（PKCS#1 或 PKCS#8）派生公钥；私钥本身不再保留。
func publicKeyFromPrivatePEM(raw string) (*rsa.PublicKey, error) {
	block, _ := pem.Decode([]byte(decodeMaybeBase64PEM(raw)))
	if block == nil {
		return nil, errors.New("not a valid PEM")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return &key.PublicKey, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("must be PKCS#1 or PKCS#8 RSA private key")
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("must be an RSA private key")
	}
	return &key.PublicKey, nil
}

// decodeMaybeBase64PEM 兼容"PEM 文本"与"base64 包裹的 PEM"两种写法（环境变量里写多行 PEM 很难）。
func decodeMaybeBase64PEM(raw string) string {
	if strings.Contains(raw, "-----BEGIN") {
		return raw
	}
	if dec, err := base64.StdEncoding.DecodeString(raw); err == nil {
		return string(dec)
	}
	return raw
}

// Source 返回当前生效的验签来源（见 Source* 常量）；都未配置时返回空串。
func (t *TokenVerifier) Source() string {
	if t == nil {
		return SourceNone
	}
	return t.source
}

// Ephemeral 表示没有任何验签来源：所有需要身份的请求都会被当作匿名，调用方应据此告警配置缺失。
func (t *TokenVerifier) Ephemeral() bool { return t == nil || t.source == SourceNone }

func (t *TokenVerifier) Issuer() string   { return t.issuer }
func (t *TokenVerifier) Audience() string { return t.audience }
func (t *TokenVerifier) KeyID() string    { return t.kid }

// Verify 校验签名与时间窗。任何一步失败都返回错误，调用方据此按匿名处理。
func (t *TokenVerifier) Verify(token string) (*Claims, error) {
	if t == nil {
		return nil, errors.New("token verifier unavailable")
	}
	if t.static == nil && t.jwksURL == "" {
		return nil, errors.New("token verifier unavailable: no public key or JWKS configured")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("malformed token")
	}
	headerRaw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, errors.New("malformed header")
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(headerRaw, &header); err != nil {
		return nil, errors.New("malformed header")
	}
	// 只接受 RS256：拒绝 none/HS* 等算法，避免算法混淆攻击。
	if header.Alg != "RS256" {
		return nil, errors.New("unexpected algorithm")
	}
	key, err := t.signingKey(header.Kid)
	if err != nil {
		return nil, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, errors.New("malformed signature")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], sig); err != nil {
		return nil, errors.New("bad signature")
	}
	payloadRaw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("malformed payload")
	}
	var claims Claims
	if err := json.Unmarshal(payloadRaw, &claims); err != nil {
		return nil, errors.New("malformed payload")
	}
	now := t.clock().Unix()
	if claims.Expires == 0 || now >= claims.Expires {
		return nil, errors.New("token expired")
	}
	if claims.Issuer != t.issuer {
		return nil, errors.New("bad issuer")
	}
	// 受众只认配置的那一个：id_token（aud 指向第三方客户端）不是给本服务的凭证。
	if t.audience != "" && claims.Audience != t.audience {
		return nil, errors.New("bad audience")
	}
	if claims.Subject == "" {
		return nil, errors.New("missing subject")
	}
	return &claims, nil
}

// signingKey 按令牌头里的 kid 取验签公钥：静态公钥优先；JWKS 模式先读缓存，
// 缓存过期或 kid 未知时拉取一次（轮换期间签名密钥可能刚换过）。
// 失败一律返回错误（fail closed），不退回"没有密钥也放行"。
func (t *TokenVerifier) signingKey(kid string) (*rsa.PublicKey, error) {
	if t.static != nil {
		return t.static, nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if key, ok := t.keys[kid]; ok && time.Since(t.fetchedAt) < jwksCacheTTL {
		return key, nil
	}
	if err := t.refreshLocked(); err != nil {
		return nil, fmt.Errorf("signing key unavailable: %w", err)
	}
	if key, ok := t.keys[kid]; ok {
		return key, nil
	}
	// 只有一个密钥且令牌头没带 kid：账号服务总是带 kid，这条只是容错。
	if kid == "" && len(t.keys) == 1 {
		for _, key := range t.keys {
			return key, nil
		}
	}
	return nil, errors.New("unknown signing key")
}

// refreshLocked 拉取 JWKS 并整体替换缓存（调用方持锁）。2 秒超时；非 200、解析失败
// 或没有任何可用 RSA 公钥都算失败，此时旧缓存保持不动，下一次再试。
func (t *TokenVerifier) refreshLocked() error {
	if t.jwksURL == "" {
		return errors.New("no jwks url configured")
	}
	req, err := http.NewRequest(http.MethodGet, t.jwksURL, nil)
	if err != nil {
		return err
	}
	resp, err := t.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks unavailable: HTTP %d", resp.StatusCode)
	}
	var doc struct {
		Keys []struct {
			KID string `json:"kid"`
			KTY string `json:"kty"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err = json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return err
	}
	keys := map[string]*rsa.PublicKey{}
	for _, k := range doc.Keys {
		if !strings.EqualFold(k.KTY, "RSA") {
			continue
		}
		key, err := rsaFromJWK(k.N, k.E)
		if err != nil {
			continue
		}
		keys[k.KID] = key
	}
	if len(keys) == 0 {
		return errors.New("jwks has no usable key")
	}
	t.keys = keys
	t.fetchedAt = time.Now()
	return nil
}

// rsaFromJWK 把 JWK 的 n/e 还原成 RSA 公钥。
func rsaFromJWK(nB64, eB64 string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nB64)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(eB64)
	if err != nil {
		return nil, err
	}
	e := 0
	for _, b := range eBytes {
		e = e<<8 | int(b)
	}
	if e == 0 {
		return nil, errors.New("invalid exponent")
	}
	return &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: e}, nil
}

// PublicJWK 返回验签公钥的 JWK 表示。目录侧不再暴露 JWKS 端点（由账号服务提供）；
// JWKS 模式下本服务不持有单一公钥，返回 nil。
func (t *TokenVerifier) PublicJWK() map[string]any {
	if t == nil || t.static == nil {
		return nil
	}
	return map[string]any{
		"kty": "RSA",
		"use": "sig",
		"alg": "RS256",
		"kid": t.kid,
		"n":   b64(t.static.N.Bytes()),
		"e":   b64(big.NewInt(int64(t.static.E)).Bytes()),
	}
}

// ClaimsToUser 把已验签的载荷还原为 User（身份、角色与权限集合，不查库）。
func ClaimsToUser(c *Claims) *User {
	if c == nil {
		return nil
	}
	return &User{ID: c.Subject, Username: c.Username, Email: c.Email, Role: c.Role, Groups: c.Groups, Permissions: c.Permissions}
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// keyID 取公钥 SPKI DER 的 SHA-256 前 8 字节，作为稳定且不泄露密钥的 kid。
func keyID(pub *rsa.PublicKey) string {
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return "default"
	}
	sum := sha256.Sum256(der)
	return base64.RawURLEncoding.EncodeToString(sum[:8])
}
