package catalog

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

func (s *Store) User(ctx context.Context, token string) (*User, error) {
	h := sessionHash(token)
	var u User
	err := s.DB.QueryRowContext(ctx, "SELECT u.id,u.username,COALESCE(u.email,''),u.role FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()", h).Scan(&u.ID, &u.Username, &u.Email, &u.Role)
	if err == nil {
		return &u, nil
	}
	err = s.DB.QueryRowContext(ctx, "SELECT u.id,u.username,COALESCE(u.email,''),u.role FROM auth.oauth_tokens t JOIN auth.users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.expires_at>now()", h).Scan(&u.ID, &u.Username, &u.Email, &u.Role)
	return &u, err
}

func (s *Store) SetupNeeded(ctx context.Context) (bool, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM auth.users").Scan(&n)
	return n == 0, err
}

func (s *Store) CreateUser(ctx context.Context, username, email, password string, setup bool, actor *User) (User, error) {
	u := User{ID: uuid.NewString(), Username: strings.TrimSpace(username), Email: strings.TrimSpace(email), Role: "editor"}
	if u.Email == "" {
		u.Email = fmt.Sprintf("%s@findverse.cc", u.Username)
	}
	if len(u.Username) < 2 || len(u.Username) > 80 || len(password) < 12 || len(password) > 72 {
		return u, fmt.Errorf("invalid_credentials_format")
	}
	if !setup && (actor == nil || actor.Role != "admin") {
		return u, fmt.Errorf("forbidden")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return u, err
	}
	err = s.write(ctx, func(tx *sql.Tx) error {
		if setup {
			var n int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM auth.users").Scan(&n); err != nil {
				return err
			}
			if n != 0 {
				return fmt.Errorf("setup_complete")
			}
			u.Role = "admin"
		}
		_, err := tx.ExecContext(ctx, "INSERT INTO auth.users(id,username,email,password_hash,role) VALUES($1,$2,$3,$4,$5)", u.ID, u.Username, u.Email, string(hash), u.Role)
		return err
	})
	return u, err
}

// Login 校验口令，签发 RS256 访问令牌，并在服务端登记一条同哈希会话记录。
// 双模式：JWT 让后续请求无需查库；会话记录保留可吊销性与 /auth/refresh 的续期
// 依据（JWT 本身不可撤回，登出时靠 jti 注销集合 + 删除会话行）。
func (s *Store) Login(ctx context.Context, username, password string) (string, User, error) {
	var u User
	var stored string
	err := s.DB.QueryRowContext(ctx, "SELECT id,username,COALESCE(email,''),role,password_hash FROM auth.users WHERE username=$1 OR (email=$1 AND email<>'')", strings.TrimSpace(username)).Scan(&u.ID, &u.Username, &u.Email, &u.Role, &stored)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(stored), []byte(password)) != nil {
		return "", u, fmt.Errorf("invalid_credentials")
	}
	token, _, err := s.issueSessionToken(u)
	if err != nil {
		return "", u, err
	}
	// 会话行按既有语义保留 24 小时：JWT 过期后验签失败会回退查库，
	// 这行记录就是"仍处于登录态"的事实来源，直到刷新或登出为止。
	if _, err = s.DB.ExecContext(ctx, "INSERT INTO auth.sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", sessionHash(token), u.ID, time.Now().Add(24*time.Hour)); err != nil {
		return "", u, err
	}
	return token, u, nil
}

// issueSessionToken 在配置了签发器时返回 RS256 JWT（有效期 AccessTokenTTL），
// 否则退回随机不透明令牌（纯查库模式，保持既有行为与测试可用）。
func (s *Store) issueSessionToken(u User) (string, time.Duration, error) {
	if s.Tokens == nil {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			return "", 0, err
		}
		return hex.EncodeToString(b), 24 * time.Hour, nil
	}
	token, _, exp, err := s.Tokens.Sign(u)
	if err != nil {
		return "", 0, err
	}
	return token, time.Until(exp), nil
}

// sessionHash 统一服务端会话的存储形式：无论令牌是 JWT 还是不透明随机串，
// 都只落 SHA-256，避免数据库泄露即等于令牌泄露。
func sessionHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

func (s *Store) Logout(ctx context.Context, token string) error {
	if s.Tokens != nil {
		s.Tokens.RevokeToken(token)
	}
	_, err := s.DB.ExecContext(ctx, "DELETE FROM auth.sessions WHERE token_hash=$1", sessionHash(token))
	return err
}

// Refresh 校验现有令牌（无状态或查库），重新签发一个新令牌并清理旧会话行。
// 用于访问令牌临近过期时的续期；refresh 本身也接受 Bearer 令牌，前端无需
// 额外的 refresh_token 字段。新令牌按库中最新身份签发：JWT 内 role 可能陈旧
// （降权后旧令牌仍能验签通过），必须回表取最新行，否则降权会被续期续接。
func (s *Store) Refresh(ctx context.Context, token string) (string, User, error) {
	u, err := s.Authenticate(ctx, token)
	if err != nil || u == nil {
		return "", User{}, fmt.Errorf("invalid_token")
	}
	var fresh User
	if ferr := s.DB.QueryRowContext(ctx, "SELECT id,username,COALESCE(email,''),role FROM auth.users WHERE id=$1", u.ID).Scan(&fresh.ID, &fresh.Username, &fresh.Email, &fresh.Role); ferr != nil {
		return "", User{}, fmt.Errorf("invalid_token")
	}
	u = &fresh
	if s.Tokens == nil {
		return token, *u, nil // 纯查库模式无续期语义，原令牌继续有效
	}
	next, _, err := s.issueSessionToken(*u)
	if err != nil {
		return "", User{}, err
	}
	s.Tokens.RevokeToken(token)
	if _, err = s.DB.ExecContext(ctx, "DELETE FROM auth.sessions WHERE token_hash=$1", sessionHash(token)); err != nil {
		return "", User{}, err
	}
	// 与 Login 一致：会话行保留 24 小时，作为 JWT 过期后的查库兜底事实来源。
	if _, err = s.DB.ExecContext(ctx, "INSERT INTO auth.sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", sessionHash(next), u.ID, time.Now().Add(24*time.Hour)); err != nil {
		return "", User{}, err
	}
	return next, *u, nil
}

type OAuthClient struct {
	ID           string   `json:"client_id"`
	SecretHash   string   `json:"-"`
	Name         string   `json:"name"`
	RedirectURIs []string `json:"redirect_uris"`
	Trusted      bool     `json:"trusted"`
	CreatedAt    string   `json:"created_at"`
}

func (s *Store) ListOAuthClients(ctx context.Context) ([]OAuthClient, error) {
	rows, err := s.DB.QueryContext(ctx, "SELECT id, name, redirect_uris, trusted, created_at FROM auth.oauth_clients ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []OAuthClient
	for rows.Next() {
		var c OAuthClient
		var uris []string
		var t time.Time
		if err := rows.Scan(&c.ID, &c.Name, pq.Array(&uris), &c.Trusted, &t); err != nil {
			return nil, err
		}
		c.RedirectURIs = uris
		c.CreatedAt = t.UTC().Format(time.RFC3339)
		list = append(list, c)
	}
	return list, rows.Err()
}

func (s *Store) GetOAuthClient(ctx context.Context, id string) (*OAuthClient, error) {
	var c OAuthClient
	var uris []string
	var t time.Time
	err := s.DB.QueryRowContext(ctx, "SELECT id, secret_hash, name, redirect_uris, trusted, created_at FROM auth.oauth_clients WHERE id=$1", strings.TrimSpace(id)).Scan(&c.ID, &c.SecretHash, &c.Name, pq.Array(&uris), &c.Trusted, &t)
	if err != nil {
		return nil, err
	}
	c.RedirectURIs = uris
	c.CreatedAt = t.UTC().Format(time.RFC3339)
	return &c, nil
}

func (s *Store) CreateOAuthCode(ctx context.Context, clientID string, userID string, redirectURI, scope string) (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	code := hex.EncodeToString(b)
	if scope == "" {
		scope = "profile"
	}
	_, err := s.DB.ExecContext(ctx, "INSERT INTO auth.oauth_codes(code, client_id, user_id, redirect_uri, scope, expires_at) VALUES($1, $2, $3, $4, $5, $6)", code, clientID, userID, redirectURI, scope, time.Now().Add(10*time.Minute))
	return code, err
}

func (s *Store) ExchangeOAuthCode(ctx context.Context, clientID, clientSecret, code, redirectURI string) (string, *User, error) {
	client, err := s.GetOAuthClient(ctx, clientID)
	if err != nil || client == nil {
		return "", nil, fmt.Errorf("invalid_client")
	}
	if client.SecretHash != "" {
		if clientSecret == "" || bcrypt.CompareHashAndPassword([]byte(client.SecretHash), []byte(clientSecret)) != nil {
			return "", nil, fmt.Errorf("invalid_client_secret")
		}
	}
	var userID string
	var codeURI string
	var scope string
	// 原子兑付：只有未使用且未过期的码才能标记成功，并发双兑只有一个成功。
	// 注意不能复用 s.write（全局串行锁），此处用单条条件 UPDATE 即可。
	res, err := s.DB.ExecContext(ctx, "UPDATE auth.oauth_codes SET used=true WHERE code=$1 AND client_id=$2 AND used=false AND expires_at>now()", strings.TrimSpace(code), clientID)
	if err != nil {
		return "", nil, fmt.Errorf("invalid_grant")
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return "", nil, fmt.Errorf("expired_or_used_code")
	}
	err = s.DB.QueryRowContext(ctx, "SELECT user_id, redirect_uri, scope FROM auth.oauth_codes WHERE code=$1 AND client_id=$2", strings.TrimSpace(code), clientID).Scan(&userID, &codeURI, &scope)
	if err != nil {
		return "", nil, fmt.Errorf("invalid_grant")
	}
	if redirectURI != "" && redirectURI != codeURI {
		return "", nil, fmt.Errorf("redirect_uri_mismatch")
	}
	var u User
	if err = s.DB.QueryRowContext(ctx, "SELECT id, username, COALESCE(email,''), role FROM auth.users WHERE id=$1", userID).Scan(&u.ID, &u.Username, &u.Email, &u.Role); err != nil {
		return "", nil, err
	}
	// 签发 OIDC access_token：配置签发器时为 RS256 JWT（可被 JWKS 本地验签），
	// 否则退回不透明随机串。无论哪种都只落 SHA-256 以便吊销。
	token, _, _, err := s.signOAuthToken(u)
	if err != nil {
		return "", nil, err
	}
	_, err = s.DB.ExecContext(ctx, "INSERT INTO auth.oauth_tokens(token_hash, client_id, user_id, scope, expires_at) VALUES($1, $2, $3, $4, $5)", sessionHash(token), clientID, userID, scope, time.Now().Add(30*24*time.Hour))
	if err != nil {
		return "", nil, err
	}
	return token, &u, nil
}

// signOAuthToken 为 OAuth/OIDC 流程签发访问令牌：有签发器用 RS256 JWT，
// 否则用 32 字节随机串。返回令牌与其有效期（用于响应 expires_in）。
func (s *Store) signOAuthToken(u User) (string, time.Duration, int64, error) {
	if s.Tokens == nil {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			return "", 0, 0, err
		}
		return hex.EncodeToString(b), 30 * 24 * time.Hour, 0, nil
	}
	token, _, exp, err := s.Tokens.Sign(u)
	if err != nil {
		return "", 0, 0, err
	}
	return token, time.Until(exp), exp.Unix(), nil
}

// IDToken 为 OIDC 客户端签发 id_token：与访问令牌同密钥、同算法、同身份声明，
// 额外把 aud 指向客户端。客户端可用 JWKS 公钥本地验签获得用户身份。
func (s *Store) IDToken(u User, clientID string) (string, int64, error) {
	if s.Tokens == nil {
		return "", 0, nil
	}
	aud := clientID
	if aud == "" {
		aud = s.Tokens.Audience()
	}
	token, exp, err := s.Tokens.SignForAudience(u, aud)
	if err != nil {
		return "", 0, err
	}
	return token, exp.Unix(), nil
}

func (s *Store) UserFromOAuthToken(ctx context.Context, token string) (*User, error) {
	var u User
	err := s.DB.QueryRowContext(ctx, "SELECT u.id, u.username, COALESCE(u.email,''), u.role FROM auth.oauth_tokens t JOIN auth.users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.expires_at>now()", sessionHash(token)).Scan(&u.ID, &u.Username, &u.Email, &u.Role)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Store) ChangePassword(ctx context.Context, userID, oldPassword, newPassword string) error {
	if len(newPassword) < 12 || len(newPassword) > 72 {
		return fmt.Errorf("invalid_password_length")
	}
	var stored string
	err := s.DB.QueryRowContext(ctx, "SELECT password_hash FROM auth.users WHERE id=$1", userID).Scan(&stored)
	if err != nil {
		return fmt.Errorf("user_not_found")
	}
	if bcrypt.CompareHashAndPassword([]byte(stored), []byte(oldPassword)) != nil {
		return fmt.Errorf("invalid_old_password")
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if _, err = s.DB.ExecContext(ctx, "UPDATE auth.users SET password_hash=$1 WHERE id=$2", string(newHash), userID); err != nil {
		return err
	}
	// 改密后作废该用户全部服务端会话与 OAuth 令牌：旧访问令牌验签成功会直接
	// 放行（15 分钟窗口），必须删会话行才能让回退查库也失效；OAuth 行 30 天有效，
	// 不删则第三方令牌继续可用。与 ResetUserPassword 行为对齐。
	if _, err = s.DB.ExecContext(ctx, "DELETE FROM auth.sessions WHERE user_id=$1", userID); err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, "DELETE FROM auth.oauth_tokens WHERE user_id=$1", userID)
	return err
}

func (s *Store) LogoutAll(ctx context.Context, userID string) error {
	if _, err := s.DB.ExecContext(ctx, "DELETE FROM auth.sessions WHERE user_id=$1", userID); err != nil {
		return err
	}
	_, err := s.DB.ExecContext(ctx, "DELETE FROM auth.oauth_tokens WHERE user_id=$1", userID)
	return err
}

func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.DB.QueryContext(ctx, "SELECT id, username, COALESCE(email,''), role FROM auth.users ORDER BY username ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.Role); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) UpdateUserRole(ctx context.Context, targetUserID, newRole string, actor *User) error {
	if actor == nil || actor.Role != "admin" {
		return fmt.Errorf("forbidden")
	}
	if newRole != "admin" && newRole != "editor" {
		return fmt.Errorf("invalid_role")
	}
	if actor.ID == targetUserID && newRole != "admin" {
		var adminCount int
		if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM auth.users WHERE role='admin'").Scan(&adminCount); err != nil {
			return err
		}
		if adminCount <= 1 {
			return fmt.Errorf("cannot_demote_sole_admin")
		}
	}
	res, err := s.DB.ExecContext(ctx, "UPDATE auth.users SET role=$1 WHERE id=$2", newRole, targetUserID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("user_not_found")
	}
	return nil
}

func (s *Store) ResetUserPassword(ctx context.Context, targetUserID, newPassword string, actor *User) error {
	if actor == nil || actor.Role != "admin" {
		return fmt.Errorf("forbidden")
	}
	if len(newPassword) < 12 || len(newPassword) > 72 {
		return fmt.Errorf("invalid_password_length")
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	res, err := s.DB.ExecContext(ctx, "UPDATE auth.users SET password_hash=$1 WHERE id=$2", string(newHash), targetUserID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("user_not_found")
	}
	_, _ = s.DB.ExecContext(ctx, "DELETE FROM auth.sessions WHERE user_id=$1", targetUserID)
	_, _ = s.DB.ExecContext(ctx, "DELETE FROM auth.oauth_tokens WHERE user_id=$1", targetUserID)
	return nil
}
