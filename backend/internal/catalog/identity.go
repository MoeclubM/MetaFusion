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
	hash := sha256.Sum256([]byte(token))
	var u User
	err := s.DB.QueryRowContext(ctx, "SELECT u.id,u.username,COALESCE(u.email,''),u.role FROM catalog.sessions s JOIN catalog.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()", hex.EncodeToString(hash[:])).Scan(&u.ID, &u.Username, &u.Email, &u.Role)
	if err == nil {
		return &u, nil
	}
	err = s.DB.QueryRowContext(ctx, "SELECT u.id,u.username,COALESCE(u.email,''),u.role FROM catalog.oauth_tokens t JOIN catalog.users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.expires_at>now()", hex.EncodeToString(hash[:])).Scan(&u.ID, &u.Username, &u.Email, &u.Role)
	return &u, err
}

func (s *Store) SetupNeeded(ctx context.Context) (bool, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM catalog.users").Scan(&n)
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
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM catalog.users").Scan(&n); err != nil {
				return err
			}
			if n != 0 {
				return fmt.Errorf("setup_complete")
			}
			u.Role = "admin"
		}
		_, err := tx.ExecContext(ctx, "INSERT INTO catalog.users(id,username,email,password_hash,role) VALUES($1,$2,$3,$4,$5)", u.ID, u.Username, u.Email, string(hash), u.Role)
		return err
	})
	return u, err
}

func (s *Store) Login(ctx context.Context, username, password string) (string, User, error) {
	var u User
	var stored string
	err := s.DB.QueryRowContext(ctx, "SELECT id,username,COALESCE(email,''),role,password_hash FROM catalog.users WHERE username=$1 OR (email=$1 AND email<>'')", strings.TrimSpace(username)).Scan(&u.ID, &u.Username, &u.Email, &u.Role, &stored)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(stored), []byte(password)) != nil {
		return "", u, fmt.Errorf("invalid_credentials")
	}
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", u, err
	}
	token := hex.EncodeToString(b)
	hash := sha256.Sum256([]byte(token))
	_, err = s.DB.ExecContext(ctx, "INSERT INTO catalog.sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", hex.EncodeToString(hash[:]), u.ID, time.Now().Add(24*time.Hour))
	return token, u, err
}

func (s *Store) Logout(ctx context.Context, token string) error {
	hash := sha256.Sum256([]byte(token))
	_, err := s.DB.ExecContext(ctx, "DELETE FROM catalog.sessions WHERE token_hash=$1", hex.EncodeToString(hash[:]))
	return err
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
	rows, err := s.DB.QueryContext(ctx, "SELECT id, name, redirect_uris, trusted, created_at FROM catalog.oauth_clients ORDER BY id")
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
	err := s.DB.QueryRowContext(ctx, "SELECT id, secret_hash, name, redirect_uris, trusted, created_at FROM catalog.oauth_clients WHERE id=$1", strings.TrimSpace(id)).Scan(&c.ID, &c.SecretHash, &c.Name, pq.Array(&uris), &c.Trusted, &t)
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
	_, err := s.DB.ExecContext(ctx, "INSERT INTO catalog.oauth_codes(code, client_id, user_id, redirect_uri, scope, expires_at) VALUES($1, $2, $3, $4, $5, $6)", code, clientID, userID, redirectURI, scope, time.Now().Add(10*time.Minute))
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
	var used bool
	var expiresAt time.Time
	err = s.DB.QueryRowContext(ctx, "SELECT user_id, redirect_uri, scope, used, expires_at FROM catalog.oauth_codes WHERE code=$1 AND client_id=$2", strings.TrimSpace(code), clientID).Scan(&userID, &codeURI, &scope, &used, &expiresAt)
	if err != nil {
		return "", nil, fmt.Errorf("invalid_grant")
	}
	if used || expiresAt.Before(time.Now()) {
		return "", nil, fmt.Errorf("expired_or_used_code")
	}
	if redirectURI != "" && redirectURI != codeURI {
		return "", nil, fmt.Errorf("redirect_uri_mismatch")
	}
	_, _ = s.DB.ExecContext(ctx, "UPDATE catalog.oauth_codes SET used=true WHERE code=$1", strings.TrimSpace(code))
	tb := make([]byte, 32)
	if _, err := rand.Read(tb); err != nil {
		return "", nil, err
	}
	token := hex.EncodeToString(tb)
	thash := sha256.Sum256([]byte(token))
	_, err = s.DB.ExecContext(ctx, "INSERT INTO catalog.oauth_tokens(token_hash, client_id, user_id, scope, expires_at) VALUES($1, $2, $3, $4, $5)", hex.EncodeToString(thash[:]), clientID, userID, scope, time.Now().Add(30*24*time.Hour))
	if err != nil {
		return "", nil, err
	}
	var u User
	err = s.DB.QueryRowContext(ctx, "SELECT id, username, role FROM catalog.users WHERE id=$1", userID).Scan(&u.ID, &u.Username, &u.Email, &u.Role)
	return token, &u, err
}

func (s *Store) UserFromOAuthToken(ctx context.Context, token string) (*User, error) {
	thash := sha256.Sum256([]byte(token))
	var u User
	err := s.DB.QueryRowContext(ctx, "SELECT u.id, u.username, u.role FROM catalog.oauth_tokens t JOIN catalog.users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.expires_at>now()", hex.EncodeToString(thash[:])).Scan(&u.ID, &u.Username, &u.Email, &u.Role)
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
	err := s.DB.QueryRowContext(ctx, "SELECT password_hash FROM catalog.users WHERE id=$1", userID).Scan(&stored)
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
	_, err = s.DB.ExecContext(ctx, "UPDATE catalog.users SET password_hash=$1 WHERE id=$2", string(newHash), userID)
	return err
}

func (s *Store) LogoutAll(ctx context.Context, userID string) error {
	_, err := s.DB.ExecContext(ctx, "DELETE FROM catalog.sessions WHERE user_id=$1", userID)
	return err
}

func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.DB.QueryContext(ctx, "SELECT id, username, role FROM catalog.users ORDER BY username ASC")
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
		if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM catalog.users WHERE role='admin'").Scan(&adminCount); err != nil {
			return err
		}
		if adminCount <= 1 {
			return fmt.Errorf("cannot_demote_sole_admin")
		}
	}
	res, err := s.DB.ExecContext(ctx, "UPDATE catalog.users SET role=$1 WHERE id=$2", newRole, targetUserID)
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
	res, err := s.DB.ExecContext(ctx, "UPDATE catalog.users SET password_hash=$1 WHERE id=$2", string(newHash), targetUserID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("user_not_found")
	}
	_, _ = s.DB.ExecContext(ctx, "DELETE FROM catalog.sessions WHERE user_id=$1", targetUserID)
	return nil
}

