package migrator

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
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
	source fs.FS
}

func New(db *sql.DB, source fs.FS) *Migrator {
	return &Migrator{
		db:     db,
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
	_, err := m.db.ExecContext(ctx, query)
	return err
}

// WithLock 在 PostgreSQL Advisory Lock 互斥保护下执行操作
func (m *Migrator) WithLock(ctx context.Context, fn func() error) error {
	var lockAcquired bool
	err := m.db.QueryRowContext(ctx, "SELECT pg_advisory_lock($1)", LockID).Scan(&lockAcquired)
	if err != nil {
		return fmt.Errorf("failed to acquire migration advisory lock: %w", err)
	}
	defer func() {
		_, _ = m.db.ExecContext(context.Background(), "SELECT pg_advisory_unlock($1)", LockID)
	}()

	return fn()
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

	rows, err := m.db.QueryContext(ctx, "SELECT version, name, applied_at, dirty, checksum FROM schema_migrations ORDER BY version ASC")
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
	return applied, nil
}

// Up 执行所有待执行的 up 迁移
func (m *Migrator) Up(ctx context.Context) error {
	return m.WithLock(ctx, func() error {
		applied, err := m.GetAppliedMigrations(ctx)
		if err != nil {
			return err
		}

		// 检查是否存在脏状态 (Dirty State)
		for _, a := range applied {
			if a.Dirty {
				return fmt.Errorf("database is in a dirty state at version %d (%s). Please inspect and force/fix before migrating", a.Version, a.Name)
			}
		}

		files, err := m.LoadMigrationFiles()
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
			h := sha256.Sum256([]byte(f.Content))
			checksum := hex.EncodeToString(h[:])

			tx, err := m.db.BeginTx(ctx, nil)
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
			if strings.TrimSpace(f.Content) != "" {
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
	return m.WithLock(ctx, func() error {
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
		tx, err := m.db.BeginTx(ctx, nil)
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
	applied, err := m.GetAppliedMigrations(ctx)
	if err != nil {
		return err
	}

	files, err := m.LoadMigrationFiles()
	if err != nil {
		return err
	}

	var upFiles []MigrationFile
	for _, f := range files {
		if f.Direction == DirectionUp {
			upFiles = append(upFiles, f)
		}
	}

	fmt.Println("================================================================================")
	fmt.Println("  MetaFusion Database Migrations Status")
	fmt.Println("================================================================================")
	fmt.Printf("%-8s | %-36s | %-10s | %-20s\n", "VERSION", "MIGRATION NAME", "STATUS", "APPLIED AT")
	fmt.Println("---------+--------------------------------------+------------+---------------------")

	for _, f := range upFiles {
		if am, ok := applied[f.Version]; ok {
			statusStr := "APPLIED"
			if am.Dirty {
				statusStr = "DIRTY(!)"
			}
			fmt.Printf("%06d   | %-36s | %-10s | %s\n", f.Version, f.Name, statusStr, am.AppliedAt.Format("2006-01-02 15:04:05"))
		} else {
			fmt.Printf("%06d   | %-36s | %-10s | %s\n", f.Version, f.Name, "PENDING", "-")
		}
	}
	fmt.Println("================================================================================")
	return nil
}

// Force 强制修复指定版本的 dirty 状态
func (m *Migrator) Force(ctx context.Context, version int64) error {
	return m.WithLock(ctx, func() error {
		res, err := m.db.ExecContext(ctx, "UPDATE schema_migrations SET dirty = FALSE WHERE version = $1", version)
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
