package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
)

// 启动职责分离（S1）：运行服务不再执行 DDL 与种子发布。
//
// 显式任务入口（生产以它们为准，见 backend/cmd/migrate 与部署作业）：
//  1. 结构迁移：`mf-migrate up`（backend/migrations/*.sql，migrator 自动发现，
//     000001 是不可变的安装基线，后续只加有序增量）；
//  2. 内容种子：`mf-migrate seed`（Store.SeedContent，无 DDL：空库发布内置定义，存量定义/外部库/货架只增不改，D2 保证不夺回人工配置）；
//  3. 完整性扫描：`mf-migrate check-refs`（Store.DanglingReferences，只读体检）；
//  4. HTTP 启动：本文件的 CheckCompatibleVersion（只读，不写库、不全表扫描）。
//
// Store.Initialize 是本地安装/测试的显式组合入口（基线 + 增量 + 空库种子 + 种子升级），
// 生产常驻进程不再调用它。先调职责再谈撤权：运行角色的 DDL 权限本次不动，
// S2 冻结说明见 store.go 的基线注释。

// requiredCatalogTables 是 HTTP 服务运行必需的表：缺任一即不兼容（起不来比半残好查）。
var requiredCatalogTables = []string{
	"catalog.entities",
	"catalog.relations",
	"catalog.definition_config",
	"catalog.revisions",
	"catalog.outbox",
	"catalog.api_request_logs",
	"catalog.idempotency_keys",
}

// CheckCompatibleVersion 是 HTTP 进程启动的唯一前置检查：只读校验必需表、必需列与
// 已发布定义存在，不写库、不加载实体/关系全集（EnsureSeedDefinitions 的启动扫描在此之后
// 不再执行）。失败即 Fatal：库没准备好时拒绝服务，而不是降级成“能起但行为不对”。
func (s *Store) CheckCompatibleVersion(ctx context.Context) error {
	for _, t := range requiredCatalogTables {
		var ok bool
		if err := s.DB.QueryRowContext(ctx, `SELECT to_regclass($1) IS NOT NULL`, t).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("incompatible_schema: missing %s (run mf-migrate up)", t)
		}
	}
	var etag string
	if err := s.DB.QueryRowContext(ctx, `SELECT etag FROM catalog.definition_config WHERE singleton=true`).Scan(&etag); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("definitions_missing: no definition configuration (run mf-migrate up, then mf-migrate seed on a fresh install)")
		}
		return err
	}
	// 反查索引缺失只影响反向别名查询性能（功能不受影响）：告警，不阻断启动。
	var hasIdx bool
	if err := s.DB.QueryRowContext(ctx, `SELECT to_regclass('catalog.entities_redirect_lookup') IS NOT NULL`).Scan(&hasIdx); err == nil && !hasIdx {
		log.Print("WARNING catalog startup: missing index catalog.entities_redirect_lookup (run mf-migrate up); reverse alias lookup falls back to sequential scan")
	}
	return nil
}
