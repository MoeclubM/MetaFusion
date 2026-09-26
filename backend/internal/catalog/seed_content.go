package catalog

import (
	"context"
	"database/sql"
)

// SeedContent 是空库首次内容种子 + 存量增量合并的显式入口（无 DDL）。
//
// 分工（见 startup.go 的职责映射）：结构只由 mf-migrate up（backend/migrations）负责，
// 本函数只补三类内容种子——已发布定义（空表才插）、外部库、货架，全部只增不改
// （ON CONFLICT DO NOTHING / 缺键才补，后台自定义不被覆盖）；最后再调
// EnsureSeedDefinitions 把种子新增的定义键合并进已发布定义。空库一次到达可服务状态，
// 存量库重复执行不写新版本。表缺失（没跑过 up）如实报错，不在这里建表。
func (s *Store) SeedContent(ctx context.Context) error {
	if err := s.write(ctx, func(tx *sql.Tx) error { return seedContentTx(ctx, tx) }); err != nil {
		return err
	}
	return s.EnsureSeedDefinitions(ctx)
}

// seedContentTx 补齐三类内容种子：定义空表才插整份种子文档（Validate 先行），
// 外部库与货架逐行 ON CONFLICT DO NOTHING，存量行缺失语种另由 backfill 补齐。
// 与 Initialize 共用：两条路径的首次内容口径一致，不各自演进。
func seedContentTx(ctx context.Context, tx *sql.Tx) error {
	// 只判空表：逐行种子无需全表计数。
	var seeded bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM catalog.definition_config)").Scan(&seeded); err != nil {
		return err
	}
	if !seeded {
		d := Defaults()
		if err := d.Validate(); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO catalog.definition_config(singleton,document,etag) VALUES(true,$1,$2)", encode(d), newID()); err != nil {
			return err
		}
	}
	// 已迁到账号服务（auth store 的 Init 幂等播种）：auth schema 不归目录服务所有，
	// 目录侧不再往里面写任何一行。
	if err := seedExternalDatabases(ctx, tx); err != nil {
		return err
	}
	// 种子补译文只在空库播种时才进库，存量行的语种缺口要靠这里补（只增不改）。
	if err := backfillExternalDatabaseNames(ctx, tx); err != nil {
		return err
	}
	return seedShelves(ctx, tx)
}
