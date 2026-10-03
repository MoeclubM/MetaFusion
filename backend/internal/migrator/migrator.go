package migrator

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const LockID = 88481001 // PostgreSQL advisory lock ID for schema migrations

type MigrationDirection string

const (
	DirectionUp   MigrationDirection = "up"
	DirectionDown MigrationDirection = "down"
)

type MigrationFile struct {
	Version   int64
	Name      string
	Direction MigrationDirection
	Filename  string
	Content   string
}

type AppliedMigration struct {
	Version   int64
	Name      string
	AppliedAt time.Time
	Dirty     bool
	Checksum  string
}

type Migrator struct {
	db     *sql.DB
	q      connection
	source fs.FS
}

func New(db *sql.DB, source fs.FS) *Migrator {
	return &Migrator{
		db:     db,
		q:      db,
		source: source,
	}
}

// EnsureSchemaMigrationsTable 初始化迁移记录表
func (m *Migrator) EnsureSchemaMigrationsTable(ctx context.Context) error {
	query := `
	CREATE TABLE IF NOT EXISTS schema_migrations (
		version BIGINT PRIMARY KEY,
		name VARCHAR(255) NOT NULL,
		applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
		dirty BOOLEAN DEFAULT FALSE NOT NULL,
		checksum VARCHAR(64) DEFAULT '' NOT NULL
	);`
	_, err := m.q.ExecContext(ctx, query)
	return err
}

// connection keeps the advisory lock, ledger and transactions on one session.
type connection interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	BeginTx(context.Context, *sql.TxOptions) (*sql.Tx, error)
}

func (m *Migrator) withLock(ctx context.Context, fn func(*Migrator) error) error {
	conn, err := m.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err = conn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", LockID); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer func() {
		unlockCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := conn.ExecContext(unlockCtx, "SELECT pg_advisory_unlock($1)", LockID); err != nil {
			// Discard a session whose lock cannot be released instead of returning it to the pool.
			_ = conn.Raw(func(any) error { return driver.ErrBadConn })
		}
	}()
	locked := *m
	locked.q = conn
	return fn(&locked)
}

// LoadMigrationFiles 从虚拟文件系统或目录读取并解析所有 SQL 迁移文件
func (m *Migrator) LoadMigrationFiles() ([]MigrationFile, error) {
	var files []MigrationFile

	err := fs.WalkDir(m.source, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, ".sql") {
			return nil
		}

		base := filepath.Base(path)
		parts := strings.Split(base, ".")
		// 格式形如: 000001_initial_schema.up.sql -> [000001_initial_schema, up, sql]
		if len(parts) < 3 {
			return nil
		}

		directionStr := parts[len(parts)-2]
		var direction MigrationDirection
		if directionStr == "up" {
			direction = DirectionUp
		} else if directionStr == "down" {
			direction = DirectionDown
		} else {
			return nil
		}

		namePart := strings.Join(parts[:len(parts)-2], ".")
		subParts := strings.SplitN(namePart, "_", 2)
		if len(subParts) < 1 {
			return nil
		}

		version, err := strconv.ParseInt(subParts[0], 10, 64)
		if err != nil {
			return nil
		}

		name := namePart
		if len(subParts) > 1 {
			name = subParts[1]
		}

		contentBytes, err := fs.ReadFile(m.source, path)
		if err != nil {
			return err
		}

		files = append(files, MigrationFile{
			Version:   version,
			Name:      name,
			Direction: direction,
			Filename:  base,
			Content:   string(contentBytes),
		})
		return nil
	})

	if err != nil {
		return nil, err
	}

	sort.Slice(files, func(i, j int) bool {
		if files[i].Version == files[j].Version {
			return files[i].Direction == DirectionUp
		}
		return files[i].Version < files[j].Version
	})

	return files, nil
}

// GetAppliedMigrations 获取已应用的迁移列表
func (m *Migrator) GetAppliedMigrations(ctx context.Context) (map[int64]AppliedMigration, error) {
	if err := m.EnsureSchemaMigrationsTable(ctx); err != nil {
		return nil, err
	}

	rows, err := m.q.QueryContext(ctx, "SELECT version, name, applied_at, dirty, checksum FROM schema_migrations ORDER BY version ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	applied := make(map[int64]AppliedMigration)
	for rows.Next() {
		var am AppliedMigration
		if err := rows.Scan(&am.Version, &am.Name, &am.AppliedAt, &am.Dirty, &am.Checksum); err != nil {
			return nil, err
		}
		applied[am.Version] = am
	}
	return applied, rows.Err()
}

// checksumOf 算迁移文件内容的 sha256 十六进制摘要：Up 在应用时记入
// schema_migrations，下次跳过前用它比对文件是否被改过（见 verifyAppliedChecksum）。
func checksumOf(content string) string {
	h := sha256.Sum256([]byte(content))
	return hex.EncodeToString(h[:])
}

// Up 执行所有待执行的 up 迁移
func (m *Migrator) Up(ctx context.Context) error {
	return m.withLock(ctx, func(m *Migrator) error {
		applied, err := m.GetAppliedMigrations(ctx)
		if err != nil {
			return err
		}

		files, err := m.LoadMigrationFiles()
		if err != nil {
			return err
		}

		baseline, err := m.loadBaseline(files)
		if err != nil {
			return err
		}
		legacy, err := m.validateLedger(applied, files, baseline)
		if err != nil {
			return err
		}

		var upFiles []MigrationFile
		for _, f := range files {
			if f.Direction == DirectionUp {
				upFiles = append(upFiles, f)
			}
		}

		appliedCount := 0
		for _, f := range upFiles {
			if _, exists := applied[f.Version]; exists {
				continue
			}

			log.Printf("Applying migration [%06d_%s]...", f.Version, f.Name)
			checksum := checksumOf(f.Content)

			tx, err := m.q.BeginTx(ctx, nil)
			if err != nil {
				return fmt.Errorf("failed to begin tx for migration %d: %w", f.Version, err)
			}

			// 先标记 dirty = true
			_, err = tx.ExecContext(ctx, "INSERT INTO schema_migrations (version, name, applied_at, dirty, checksum) VALUES ($1, $2, NOW(), TRUE, $3) ON CONFLICT (version) DO UPDATE SET dirty = TRUE", f.Version, f.Name, checksum)
			if err != nil {
				_ = tx.Rollback()
				return fmt.Errorf("failed to write dirty migration log %d: %w", f.Version, err)
			}

			// 执行 SQL 内容
			if !(legacy && baseline != nil && f.Version == baseline.Version) && strings.TrimSpace(f.Content) != "" {
				if _, err := tx.ExecContext(ctx, f.Content); err != nil {
					_ = tx.Rollback()
					return fmt.Errorf("migration [%06d_%s] failed: %w", f.Version, f.Name, err)
				}
			}

			// 标记 dirty = false
			_, err = tx.ExecContext(ctx, "UPDATE schema_migrations SET dirty = FALSE, applied_at = NOW() WHERE version = $1", f.Version)
			if err != nil {
				_ = tx.Rollback()
				return fmt.Errorf("failed to clear dirty flag for migration %d: %w", f.Version, err)
			}

			if err := tx.Commit(); err != nil {
				return fmt.Errorf("failed to commit migration %d: %w", f.Version, err)
			}

			log.Printf("Successfully applied migration [%06d_%s].", f.Version, f.Name)
			appliedCount++
		}

		if appliedCount == 0 {
			log.Println("Database schema is already up to date. No pending migrations.")
		} else {
			log.Printf("Migration completed: %d migrations applied successfully.", appliedCount)
		}
		return nil
	})
}

// Down 回滚最新版本的一条迁移
func (m *Migrator) Down(ctx context.Context) error {
	return m.withLock(ctx, func(m *Migrator) error {
		applied, err := m.GetAppliedMigrations(ctx)
		if err != nil {
			return err
		}

		if len(applied) == 0 {
			log.Println("No applied migrations found to roll back.")
			return nil
		}

		var latestVersion int64 = -1
		for v := range applied {
			if v > latestVersion {
				latestVersion = v
			}
		}

		files, err := m.LoadMigrationFiles()
		if err != nil {
			return err
		}

		baseline, err := m.loadBaseline(files)
		if err != nil {
			return err
		}
		if _, err = m.validateLedger(applied, files, baseline); err != nil {
			return err
		}

		var downFile *MigrationFile
		for _, f := range files {
			if f.Version == latestVersion && f.Direction == DirectionDown {
				downFile = &f
				break
			}
		}

		if downFile == nil {
			return fmt.Errorf("no down migration file found for version %d", latestVersion)
		}

		log.Printf("Rolling back migration [%06d_%s]...", downFile.Version, downFile.Name)
		tx, err := m.q.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("failed to begin tx: %w", err)
		}

		if strings.TrimSpace(downFile.Content) != "" {
			if _, err := tx.ExecContext(ctx, downFile.Content); err != nil {
				_ = tx.Rollback()
				return fmt.Errorf("down migration failed: %w", err)
			}
		}

		if _, err := tx.ExecContext(ctx, "DELETE FROM schema_migrations WHERE version = $1", latestVersion); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("failed to delete migration record %d: %w", latestVersion, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("failed to commit rollback: %w", err)
		}

		log.Printf("Successfully rolled back migration [%06d_%s].", downFile.Version, downFile.Name)
		return nil
	})
}

// Status 打印迁移状态与待执行迁移
func (m *Migrator) Status(ctx context.Context) error {
	return m.withLock(ctx, func(m *Migrator) error {
		applied, err := m.GetAppliedMigrations(ctx)
		if err != nil {
			return err
		}
		files, err := m.LoadMigrationFiles()
		if err != nil {
			return err
		}
		baseline, err := m.loadBaseline(files)
		if err != nil {
			return err
		}
		entries := map[int64]ledgerEntry{}
		if baseline != nil {
			for _, e := range baseline.Legacy {
				if _, ok := applied[e.Version]; ok {
					entries[e.Version] = e
				}
			}
		}
		for _, f := range files {
			if f.Direction == DirectionUp {
				entries[f.Version] = ledgerEntry{f.Version, f.Name, checksumOf(f.Content)}
			}
		}
		for v, a := range applied {
			if _, ok := entries[v]; !ok {
				entries[v] = ledgerEntry{v, a.Name, ""}
			}
		}
		versions := make([]int64, 0, len(entries))
		for v := range entries {
			versions = append(versions, v)
		}
		sort.Slice(versions, func(i, j int) bool { return versions[i] < versions[j] })
		fmt.Printf("%-8s | %-36s | %-12s | %s\n", "VERSION", "MIGRATION NAME", "STATUS", "APPLIED AT")
		for _, v := range versions {
			e := entries[v]
			status, at := "PENDING", "-"
			if a, ok := applied[v]; ok {
				status, at = "APPLIED", a.AppliedAt.Format("2006-01-02 15:04:05")
				if a.Dirty {
					status = "DIRTY(!)"
				} else if e.Checksum == "" {
					status = "UNKNOWN(!)"
				} else if a.Checksum == "" {
					status = "UNVERIFIED(!)"
				} else if a.Checksum != e.Checksum || a.Name != e.Name {
					status = "MODIFIED(!)"
				}
			}
			fmt.Printf("%06d   | %-36s | %-12s | %s\n", v, e.Name, status, at)
		}
		_, err = m.validateLedger(applied, files, baseline)
		return err
	})
}

// Force 强制修复指定版本的 dirty 状态
func (m *Migrator) Force(ctx context.Context, version int64) error {
	return m.withLock(ctx, func(m *Migrator) error {
		res, err := m.q.ExecContext(ctx, "UPDATE schema_migrations SET dirty = FALSE WHERE version = $1", version)
		if err != nil {
			return err
		}
		rows, _ := res.RowsAffected()
		if rows == 0 {
			return errors.New("specified migration version not found in schema_migrations")
		}
		log.Printf("Forced dirty status to false for version %d.", version)
		return nil
	})
}
