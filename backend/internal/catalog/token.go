package catalog

// 账号令牌：RS256（RSASSA-PKCS1-v1_5 + SHA-256）自包含 JWT。
//
// 用标准库实现而非引入第三方 JWT 依赖：部署环境对模块代理访问受限，且
// RS256 的签名/验签只是 crypto/rsa 的 SignPKCS1v15/VerifyPKCS1v15 加一段
// base64url，几行即可，少一层供应链风险。
//
// 验签只需要公钥，因此鉴权中间件可以完全本地判定（不查库）；服务端会话仍
// 保留，作为双模式兜底与可吊销来源，存量随机会话令牌不受影响。

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"os"
	"strings"
	"sync"
	"time"
)

// AccessTokenTTL 是无状态访问令牌的有效期。取得短一些，让登出/改密这类
// 需要快速失效的场景影响面有限；续期由服务端会话（及 /auth/refresh）承担。
const AccessTokenTTL = 15 * time.Minute

// Claims 是访问令牌的载荷。字段名遵循 OIDC 惯例，便于 E3 直接复用为 id_token。
type Claims struct {
	Subject  string `json:"sub"`
	Username string `json:"preferred_username"`
	Email    string `json:"email,omitempty"`
	Role     string `json:"role"`
	Issuer   string `json:"iss"`
	Audience string `json:"aud"`
	IssuedAt int64  `json:"iat"`
	Expires  int64  `json:"exp"`
	JTI      string `json:"jti"`
}

// TokenIssuer 持有签名私钥与验签公钥。零值不可用，需经 NewTokenIssuerFromEnv。
type TokenIssuer struct {
	mu       sync.RWMutex
	priv     *rsa.PrivateKey
	kid      string
	issuer   string
	audience string
	ephemeral bool
	// now 可在测试中替换，用于验证过期与注销过期逻辑；nil 表示 time.Now。
	now func() time.Time
	// revoked 记录已注销的 jti 及其过期时刻。单实例内存实现；多实例部署时应
	// 换成 Redis 集合，否则注销无法跨实例生效。条目随过期时间被惰性清理。
	revoked map[string]int64
	// audiences 是本签发器认可的受众集合：默认受众之外，OIDC id_token 以
	// client_id 为受众（SignForAudience 签发时登记）。验签按集合判断，
	// 未登记的受众一律拒绝，防止令牌在 relying party 之间混淆。
	audiences map[string]bool
}

func (t *TokenIssuer) clock() time.Time {
	if t.now != nil {
		return t.now()
	}
	return time.Now()
}

// NewTokenIssuerFromEnv 从 AUTH_JWT_PRIVATE_KEY 读取 RSA 私钥（PEM 文本，或
// 其 base64 编码），支持 PKCS#1 与 PKCS#8。未配置时生成进程内临时密钥：系统
// 仍可启动并签发/验签，但重启后旧令牌全部失效——双模式的查库兜底会接管。
func NewTokenIssuerFromEnv(issuer, audience string) (*TokenIssuer, error) {
	t := &TokenIssuer{issuer: issuer, audience: audience, revoked: map[string]int64{}, audiences: map[string]bool{}}
	if audience != "" {
		t.audiences[audience] = true
	}
	raw := strings.TrimSpace(os.Getenv("AUTH_JWT_PRIVATE_KEY"))
	if raw == "" {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			return nil, err
		}
		t.priv, t.kid, t.ephemeral = key, keyID(&key.PublicKey), true
		return t, nil
	}
	if !strings.Contains(raw, "-----BEGIN") {
		if dec, err := base64.StdEncoding.DecodeString(raw); err == nil {
			raw = string(dec)
		}
	}
	block, _ := pem.Decode([]byte(raw))
	if block == nil {
		return nil, errors.New("AUTH_JWT_PRIVATE_KEY is not valid PEM")
	}
	if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		t.priv, t.kid = k, keyID(&k.PublicKey)
		return t, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("AUTH_JWT_PRIVATE_KEY must be PKCS#1 or PKCS#8 RSA: %w", err)
	}
	k, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("AUTH_JWT_PRIVATE_KEY must be an RSA key")
	}
	t.priv, t.kid = k, keyID(&k.PublicKey)
	return t, nil
}

// Ephemeral 表示当前使用进程内临时密钥（未配置 AUTH_JWT_PRIVATE_KEY），
// 重启即失效；调用方可据此提示运维配置持久密钥。
func (t *TokenIssuer) Ephemeral() bool { return t != nil && t.ephemeral }

func (t *TokenIssuer) Issuer() string   { return t.issuer }
func (t *TokenIssuer) Audience() string { return t.audience }
func (t *TokenIssuer) KeyID() string    { return t.kid }

// TokenIssuerURL 返回 OIDC issuer 基址（也是 discovery/JWKS 的挂载根）。
// Store 上暴露给 HTTP 层，避免在 http.go 里直接读环境变量。
func (s *Store) TokenIssuerURL() string {
	if s.Tokens == nil {
		return ""
	}
	return s.Tokens.Issuer()
}

// Sign 签发访问令牌，返回 token 与其 jti（jti 用于注销与审计关联）。
func (t *TokenIssuer) Sign(u User) (string, string, time.Time, error) {
	return t.sign(u, t.audience)
}

// SignForAudience 以指定 aud 签发令牌，用于 OIDC id_token（aud 指向客户端）。
// 签发即登记该受众：Verify 只接受已登记受众，未登记的 aud 一律拒绝。
func (t *TokenIssuer) SignForAudience(u User, audience string) (string, time.Time, error) {
	if audience == "" {
		return "", time.Time{}, errors.New("empty audience")
	}
	t.mu.Lock()
	t.audiences[audience] = true
	t.mu.Unlock()
	token, _, exp, err := t.sign(u, audience)
	return token, exp, err
}

func (t *TokenIssuer) sign(u User, audience string) (string, string, time.Time, error) {
	if t == nil || t.priv == nil {
		return "", "", time.Time{}, errors.New("token issuer unavailable")
	}
	now := t.clock()
	exp := now.Add(AccessTokenTTL)
	jtiBytes := make([]byte, 16)
	if _, err := rand.Read(jtiBytes); err != nil {
		return "", "", time.Time{}, err
	}
	jti := base64.RawURLEncoding.EncodeToString(jtiBytes)
	claims := Claims{
		Subject: u.ID, Username: u.Username, Email: u.Email, Role: u.Role,
		Issuer: t.issuer, Audience: audience,
		IssuedAt: now.Unix(), Expires: exp.Unix(), JTI: jti,
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", "", time.Time{}, err
	}
	header, err := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": t.kid})
	if err != nil {
		return "", "", time.Time{}, err
	}
	signing := b64(header) + "." + b64(payload)
	digest := sha256.Sum256([]byte(signing))
	sig, err := rsa.SignPKCS1v15(rand.Reader, t.priv, crypto.SHA256, digest[:])
	if err != nil {
		return "", "", time.Time{}, err
	}
	return signing + "." + b64(sig), jti, exp, nil
}

// Verify 校验签名与时间窗，并检查是否已被注销。任何一步失败都返回错误，
// 调用方据此回退到服务端会话查库（双模式）。
func (t *TokenIssuer) Verify(token string) (*Claims, error) {
	if t == nil || t.priv == nil {
		return nil, errors.New("token issuer unavailable")
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
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, errors.New("malformed signature")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(&t.priv.PublicKey, crypto.SHA256, digest[:], sig); err != nil {
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
	// 受众按登记集合判断：默认受众之外，SignForAudience 签发的 id_token 受众
	// （client_id）在签发时登记。未登记受众拒绝，防止令牌跨 relying party 混用。
	t.mu.RLock()
	audOK := t.audiences[claims.Audience]
	t.mu.RUnlock()
	if !audOK {
		return nil, errors.New("bad audience")
	}
	if claims.Subject == "" {
		return nil, errors.New("missing subject")
	}
	t.mu.Lock()
	if exp, bad := t.revoked[claims.JTI]; bad && now < exp {
		t.mu.Unlock()
		return nil, errors.New("token revoked")
	}
	// 惰性清理：顺带清掉已过期的注销记录，避免 map 无限增长。
	for k, exp := range t.revoked {
		if now >= exp {
			delete(t.revoked, k)
		}
	}
	t.mu.Unlock()
	return &claims, nil
}

// Revoke 把 jti 加入注销集合直到其自然过期。单实例内存实现。
func (t *TokenIssuer) Revoke(jti string, expires int64) {
	if t == nil || jti == "" {
		return
	}
	t.mu.Lock()
	t.revoked[jti] = expires
	t.mu.Unlock()
}

// RevokeToken 校验后注销单个令牌（登出路径用；验签失败则无需注销）。
func (t *TokenIssuer) RevokeToken(token string) {
	c, err := t.Verify(token)
	if err != nil {
		return
	}
	t.Revoke(c.JTI, c.Expires)
}

// PublicJWK 返回验签公钥的 JWK 表示，供 /oidc JWKS 端点与外部服务本地验签。
func (t *TokenIssuer) PublicJWK() map[string]any {
	if t == nil || t.priv == nil {
		return nil
	}
	pub := t.priv.PublicKey
	return map[string]any{
		"kty": "RSA",
		"use": "sig",
		"alg": "RS256",
		"kid": t.kid,
		"n":   b64(pub.N.Bytes()),
		"e":   b64(big.NewInt(int64(pub.E)).Bytes()),
	}
}

// ClaimsToUser 把已验签的载荷还原为 User（只含身份与角色，不查库）。
func ClaimsToUser(c *Claims) *User {
	if c == nil {
		return nil
	}
	return &User{ID: c.Subject, Username: c.Username, Email: c.Email, Role: c.Role}
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
