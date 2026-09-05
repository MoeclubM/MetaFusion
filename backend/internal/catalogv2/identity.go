package catalogv2

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"strings"
	"time"
)

func (s *Store) User(ctx context.Context, token string) (*User, error) {
	hash := sha256.Sum256([]byte(token))
	var u User
	err := s.DB.QueryRowContext(ctx, "SELECT u.id,u.username,u.role FROM catalog_v2.sessions s JOIN catalog_v2.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()", hex.EncodeToString(hash[:])).Scan(&u.ID, &u.Username, &u.Role)
	return &u, err
}
func (s *Store) SetupNeeded(ctx context.Context) (bool, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM catalog_v2.users").Scan(&n)
	return n == 0, err
}
func (s *Store) CreateUser(ctx context.Context, username, password string, setup bool, actor *User) (User, error) {
	u := User{ID: uuid.NewString(), Username: strings.TrimSpace(username), Role: "editor"}
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
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM catalog_v2.users").Scan(&n); err != nil {
				return err
			}
			if n != 0 {
				return fmt.Errorf("setup_complete")
			}
			u.Role = "admin"
		}
		_, err := tx.ExecContext(ctx, "INSERT INTO catalog_v2.users(id,username,password_hash,role) VALUES($1,$2,$3,$4)", u.ID, u.Username, string(hash), u.Role)
		return err
	})
	return u, err
}
func (s *Store) Login(ctx context.Context, username, password string) (string, User, error) {
	var u User
	var stored string
	err := s.DB.QueryRowContext(ctx, "SELECT id,username,role,password_hash FROM catalog_v2.users WHERE username=$1", strings.TrimSpace(username)).Scan(&u.ID, &u.Username, &u.Role, &stored)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(stored), []byte(password)) != nil {
		return "", u, fmt.Errorf("invalid_credentials")
	}
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", u, err
	}
	token := hex.EncodeToString(b)
	hash := sha256.Sum256([]byte(token))
	_, err = s.DB.ExecContext(ctx, "INSERT INTO catalog_v2.sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", hex.EncodeToString(hash[:]), u.ID, time.Now().Add(24*time.Hour))
	return token, u, err
}
func (s *Store) Logout(ctx context.Context, token string) error {
	hash := sha256.Sum256([]byte(token))
	_, err := s.DB.ExecContext(ctx, "DELETE FROM catalog_v2.sessions WHERE token_hash=$1", hex.EncodeToString(hash[:]))
	return err
}
