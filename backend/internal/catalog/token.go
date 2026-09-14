package catalog

// 访问令牌的**验签侧**：RS256（RSASSA-PKCS1-v1_5 + SHA-256）自包含 JWT。
//
// 账号拆分完成后，令牌只由账号服务（metafusion-auth）签发；目录侧保留的只有验签：
// 用同一把 RSA 私钥派生的公钥在本地判定签名、时间窗、issuer 与 audience。
// 这里刻意**不提供签发、续期与注销**——目录进程拿不到也不需要签发路径，
// 少一条被误当成"第二个签发方"的可能；令牌撤销依赖 15 分钟短有效期与账号侧的会话表。
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
	"math/big"
	"os"
	"strings"
	"sync"
	"time"
)

// Claims 是访问令牌的载荷。字段名遵循 OIDC 惯例，与账号服务的签发侧逐字一致。
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

// TokenVerifier 只持公钥：零值不可用，需经 NewTokenVerifierFromEnv。
type TokenVerifier struct {
	mu        sync.RWMutex
	pub       *rsa.PublicKey
	kid       string
	issuer    string
	audience  string
	ephemeral bool
	// now 可在测试中替换，用于验证过期边界；nil 表示 time.Now。
	now func() time.Time
}

func (t *TokenVerifier) clock() time.Time {
	if t != nil && t.now != nil {
		return t.now()
	}
	return time.Now()
}

// NewTokenVerifierFromEnv 从 AUTH_JWT_PRIVATE_KEY 读取 RSA 私钥（PEM 文本或其 base64），
// 只保留其中的公钥用于验签，私钥读完即丢——目录进程因此**无法**签发任何令牌。
// 支持 PKCS#1 与 PKCS#8。未配置时返回一个只能拒绝一切令牌的验签器（fail closed）：
// 目录的公开读接口照常工作，写接口在验签失败时按未登录处理，不会静默放行。
func NewTokenVerifierFromEnv(issuer, audience string) (*TokenVerifier, error) {
	t := &TokenVerifier{issuer: issuer, audience: audience}
	raw := strings.TrimSpace(os.Getenv("AUTH_JWT_PRIVATE_KEY"))
	if raw == "" {
		t.ephemeral = true
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
		t.pub, t.kid = &k.PublicKey, keyID(&k.PublicKey)
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
	t.pub, t.kid = &k.PublicKey, keyID(&k.PublicKey)
	return t, nil
}

// Ephemeral 表示没有可用的验签公钥（未配置 AUTH_JWT_PRIVATE_KEY）：
// 所有需要身份的请求都会被当作匿名，调用方应据此告警配置缺失。
func (t *TokenVerifier) Ephemeral() bool { return t == nil || t.ephemeral }

func (t *TokenVerifier) Issuer() string   { return t.issuer }
func (t *TokenVerifier) Audience() string { return t.audience }
func (t *TokenVerifier) KeyID() string    { return t.kid }

// Verify 校验签名与时间窗。任何一步失败都返回错误，调用方据此按匿名处理。
func (t *TokenVerifier) Verify(token string) (*Claims, error) {
	if t == nil || t.pub == nil {
		return nil, errors.New("token verifier unavailable")
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
	if err := rsa.VerifyPKCS1v15(t.pub, crypto.SHA256, digest[:], sig); err != nil {
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

// PublicJWK 返回验签公钥的 JWK 表示。目录侧不再暴露 JWKS 端点（由账号服务提供），
// 这里保留给"本服务是某个令牌的受众、需要把公钥给出去"的测试与排查场景。
func (t *TokenVerifier) PublicJWK() map[string]any {
	if t == nil || t.pub == nil {
		return nil
	}
	return map[string]any{
		"kty": "RSA",
		"use": "sig",
		"alg": "RS256",
		"kid": t.kid,
		"n":   b64(t.pub.N.Bytes()),
		"e":   b64(big.NewInt(int64(t.pub.E)).Bytes()),
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
