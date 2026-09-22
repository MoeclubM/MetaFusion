package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"

	auditlog "github.com/metafusion/metafusion-app/internal/audit"
	"github.com/metafusion/metafusion-app/migrations"
)

// baseline 是目录库的结构来源：与 `mf-migrate up` 执行的是**同一份文件**（迁移 000001）。
// S2 冻结（注释说明，不动规则）：000001 是已执行的安装基线，永不修改；后续结构变化只以
// 有序不可变的增量迁移表达（见 catalogIncrementals），仍只有 backend/migrations 一份结构来源。
// 以前这里 //go:embed 了一份 schema.sql 终态快照，与迁移文件各存一份、靠一致性测试盯着同步；
// 数据不再需要历史迁移后合并成单一基线，两边读同一份，冗余与漂移一起消失。
const baselineFile = "000001_catalog_core.up.sql"

func catalogBaseline() (string, error) {
	b, err := fs.ReadFile(migrations.FS, baselineFile)
	if err != nil {
		return "", fmt.Errorf("read catalog baseline %s: %w", baselineFile, err)
	}
	return string(b), nil
}

// auditSchemaFile 是审计表结构（迁移 000002）。目录服务启动路径与 `mf-migrate up` 执行
// **同一份文件**：新库只起服务也能建表，不然写路由的审计行会整条落空；版本记账仍归 mf-migrate
// （schema_migrations 只有它维护）。语句全是 IF NOT EXISTS 且共用契约里的 advisory 锁 740205，
// 两条路径、四个服务重复执行都安全。
const auditSchemaFile = "000002_audit_log.up.sql"

func catalogAuditSchema() (string, error) {
	b, err := fs.ReadFile(migrations.FS, auditSchemaFile)
	if err != nil {
		return "", fmt.Errorf("read audit schema %s: %w", auditSchemaFile, err)
	}
	return string(b), nil
}

// notificationsSchemaFile 是站内通知（迁移 000003），与 000002 同一套做法：
// 新库只起服务也能建表（否则收件箱端点会 500），版本记账仍归 mf-migrate。
// 只建表、不写行，重复执行安全。
const notificationsSchemaFile = "000003_notifications.up.sql"

func catalogNotificationsSchema() (string, error) {
	b, err := fs.ReadFile(migrations.FS, notificationsSchemaFile)
	if err != nil {
		return "", fmt.Errorf("read notifications schema %s: %w", notificationsSchemaFile, err)
	}
	return string(b), nil
}

// 领域哨兵错误：respond（http.go）按错误链判定 HTTP 状态码，所以写路径与
// retirement/生命周期里的拒绝必须用同一批哨兵，而不是各自 fmt.Errorf 出同名字符串——
// 字符串比较在 %w 包裹后就失效（403/409 会退化成 400）。
// 哨兵文本即响应里的机器码（forbidden / version_conflict），与前端字典逐字对齐。
var (
	errForbidden       = errors.New("forbidden")
	errVersionConflict = errors.New("version_conflict")
	// errInvalidStatus 是"当前状态不允许这个动作"的稳定码（如 Unpublish 只接受 published）。
	// 它不需要 respond 特判——默认分支就是 400 + 错误文本；登记成哨兵是为了让调用方与
	// 测试能 errors.Is 判定，而不是比较字符串（%w 包裹后字符串比较会失效）。
	errInvalidStatus = errors.New("invalid_status")
)

type Store struct {
	DB *sql.DB
	// Verifier 是账号服务令牌的验签器（只有公钥）。为 nil 或未配置密钥时，
	// 需要身份的接口按匿名处理——目录不再有"查库兜底"这条路径。
	Verifier *TokenVerifier
	// PAT 是个人访问令牌（mfp_ 前缀）的内省器，见 pat.go。为 nil（未配置 AUTH_URL）时，
	// 带 mfp_ 前缀的请求一律 503 auth_unavailable：身份只能问账号服务，目录不查它的表。
	PAT *PATIntrospector
	// Audit 是审计留痕写入器（internal/audit，见 audit.go 的接线）。为 nil 时写路由不写审计行
	// （单测里大量夹具只有 Store{DB:…}，不该为了"没接审计"而让请求变形）。
	Audit *auditlog.Recorder
	// defStatus 记录最近一次启动期定义种子合并的结果（见 definitions.go 的 DefinitionStatus）。
	// 由服务侧透出在 /health：这一项要回答的是"站点可用，但定义是不是没更新"。
	defStatusMu sync.Mutex
	defStatus   DefinitionStatus
}
type queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func Open(ctx context.Context, dsn string) (*Store, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(20)
	db.SetConnMaxLifetime(time.Hour)
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{DB: db}, nil
}

// Authenticate 只做无状态 RS256 验签：目录侧不再回退查 auth.sessions / auth.oauth_tokens。
// 那两张表归账号服务所有，跨系统读对方的表会让"各司其职"名存实亡，因此这里连 ctx 都不需要。
// 验签器缺失或验签失败一律按匿名处理（fail closed），不会静默放行。
func (s *Store) Authenticate(token string) (*User, error) {
	token = strings.TrimSpace(token)
	if token == "" || s.Verifier == nil {
		return nil, sql.ErrNoRows
	}
	claims, err := s.Verifier.Verify(token)
	if err != nil {
		return nil, err
	}
	return ClaimsToUser(claims), nil
}

// Initialize 是本地安装与测试的显式组合入口（S1）：基线 + 结构增量 + 空库内容种子 +
// 种子增量合并，一次到达可服务状态。生产常驻进程不再调用它，改走 CheckCompatibleVersion
// （只读，见 startup.go 的职责映射）；生产的结构/种子/体检分别由 mf-migrate up、
// mf-migrate seed、mf-migrate check-refs 承担。Existing catalog data are untouched.
// 其写入职责与 mf-migrate up 分工：migrate 只负责结构迁移（backend/migrations），
// 定义/货架/外部库三类"内容种子"只在这里逐行 ON CONFLICT DO NOTHING 补齐
// （第一方 OAuth 客户端随账号拆分归账号服务），
// 因种子会随版本新增条目（如货架新增 slug），不属于一次性结构迁移。
// 任一轨道先执行都安全：种子用 ON CONFLICT 保护已有行（后台自定义不被覆盖）。
//
// 定义种子语义（空库全量播种、存量**只增不改**）：catalog.definitions 非空时
// 不覆盖既有文档——后台改过的关系/词表/字段（禁用某关系码、entry_role 降级）全部保留；
// 播种之后再由 EnsureSeedDefinitions 做一次增量合并，只补种子里新增而当前缺失的键，
// 这样新版本新增的关系码/字段能到达存量实例，又不会覆盖任何人工决定。
// 见 TestDefinitionsSeedOnlyWhenEmpty 与 TestMergeSeedDefinitionsIsAdditiveOnly。
func (s *Store) Initialize(ctx context.Context) error {
	baseline, err := catalogBaseline()
	if err != nil {
		return err
	}
	// 注意：这里必须是 if err := s.write(...); err != nil 而不是 return s.write(...)——
	// 后者会让下面的种子增量合并成为不可达代码（go vet 会报 unreachable，且永不执行）。
	if err := s.write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, baseline); err != nil {
			return err
		}
		// 首次内容种子与 SeedContent 共用 seedContentTx（见 seed_content.go），
		// 两条路径口径一致：定义空表才插，外部库/货架只增不改。
		return seedContentTx(ctx, tx)
	}); err != nil {
		return err
	}
	// 审计表与迁移 000002 是同一份 DDL。刻意放在基线事务**之外**执行：建表要与另外三个服务
	// 抢同一个 advisory 锁（740205），不该把目录基线事务一起拖住；失败直接上报——起不来比
	// "服务能起但一行审计都不留"好排查得多。
	auditSchema, err := catalogAuditSchema()
	if err != nil {
		return err
	}
	if _, err = s.DB.ExecContext(ctx, auditSchema); err != nil {
		return fmt.Errorf("apply audit schema %s: %w", auditSchemaFile, err)
	}
	notificationsSchema, err := catalogNotificationsSchema()
	if err != nil {
		return err
	}
	if _, err = s.DB.ExecContext(ctx, notificationsSchema); err != nil {
		return fmt.Errorf("apply notifications schema %s: %w", notificationsSchemaFile, err)
	}
	// 结构增量与基线同一安装路径执行（见 catalogIncrementals）：生产以 mf-migrate up 为准，
	// 本地安装/测试经此处到达同一终态。S1 会把服务启动改成只读兼容检查，届时本调用留在
	// 显式安装入口，不再属于每次启动的职责。
	if err = applyCatalogIncrementals(ctx, s.DB); err != nil {
		return err
	}
	// 定义种子是"只空库播种"，存量实例拿不到新版本新增的关系码/字段；
	// 这里再做一次只增不改的增量合并，把缺失的定义补上（不会覆盖后台的人工调整）。
	return s.EnsureSeedDefinitions(ctx)
}

// write 执行一次写事务（不加全局锁）。
//
// 十万/百万级时“所有写都串行”只是慢；到亿级就是吞吐天花板：一个 advisory 锁把整个目录
// （含互不相干的 agent/work/expression）压成单写通道。因此默认路径不再取锁，只有可能触碰
// 受结构约束的表（content_units/mediums/tracks 的父子环检查）或关系无环校验的写，
// 才走 writeStructural。
func (s *Store) write(ctx context.Context, fn func(*sql.Tx) error) error {
	return s.tx(ctx, fn, false)
}

// writeStructural 执行需要与结构校验串行的写事务。
//
// 锁键与 check_parent_cycle 触发器共用（740202）：并发重定父时，触发器内的递归检查才能
// 看到别的事务刚提交的父子关系，环检测不会两边同时通过。代价是这些写彼此串行——
// 它们只是结构编辑（篇目/载体/轨道/关系），不是目录主体。
// 与 migrator.go LockID 88481001 无互斥：migrate 是独立进程的一次性操作，用会话级
// pg_advisory_lock；此处是事务级 xact 锁，键与粒度都不同。需要部署期互斥时应在编排层
// 串行（先 migrate 后启动），不在此加锁。
func (s *Store) writeStructural(ctx context.Context, fn func(*sql.Tx) error) error {
	return s.tx(ctx, fn, true)
}

func (s *Store) tx(ctx context.Context, fn func(*sql.Tx) error, structural bool) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if structural {
		if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(740202)"); err != nil {
			return err
		}
	}
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// definitionsLockKey 是定义版本协调的 advisory 键（M02）：发布取独占，
// 定义敏感写（实体/关系/合并改写）取共享。旧定义写穿发布影响检查即被串行化：
// 发布等待在途写完成，在途写等待发布完成，不靠"写前读版本"赌时序。
// 与结构锁 740202、migrator 的 88481001、审计契约的 740205 都不同键。
//
// releaseLockClass 是发行粒度的 advisory 类键（M01）：Release.subjects 与
// TrackContent 按 Release 互斥（删 subject 与加收录不再各看各的旧快照），
// 不同发行互不阻塞，不恢复全库写锁。键 = (740204, hashtext(release_id))。
//
// 加锁顺序全局一致（结构 → 定义共享 → 发行），发布只取独占、不与其他锁共持，
// 因此无死锁环；并发正确性仍需双连接受控测试（见并发测试，本机无库时跳过）。
const definitionsLockKey = 740203
const releaseLockClass = 740204

func lockDefinitionsShared(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock_shared($1::bigint)", definitionsLockKey)
	return err
}

func lockDefinitionsExclusive(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock($1::bigint)", definitionsLockKey)
	return err
}

func lockRelease(ctx context.Context, tx *sql.Tx, releaseID string) error {
	_, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock($1::int, hashtext($2))", releaseLockClass, releaseID)
	return err
}

// lockReleaseScope 取本次实体写入所属发行的 M01 锁：release 改 subjects、
// track 改 contents，同一发行的两类写互斥；medium 不改映射且归属不可变，
// 取同锁只为让复核稳定（结构写本就全局串行，无并发损失）。
// 新建 release（ID 未分配、无人可达）与归属缺失（后继报 parent_required/
// invalid_reference）不取锁，其余一律按所属发行取。调用方保证在定义共享锁之后调用。
func lockReleaseScope(ctx context.Context, tx *sql.Tx, e Entity) error {
	var releaseID string
	switch e.Kind {
	case "release":
		releaseID = e.ID
	case "medium":
		releaseID = e.ReleaseID
	case "track":
		if e.MediumID == "" {
			return nil
		}
		if err := tx.QueryRowContext(ctx, "SELECT release_id FROM catalog.mediums WHERE id=$1", e.MediumID).Scan(&releaseID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return fmt.Errorf("invalid_reference")
			}
			return err
		}
	default:
		return nil
	}
	if releaseID == "" {
		return nil
	}
	return lockRelease(ctx, tx, releaseID)
}

// structuralKind 判断该 kind 的写入是否可能触碰受结构约束的表：
// content_units/mediums/tracks 上有 check_parent_cycle 触发器，必须与环检查串行。
// 其它 kind（agent/collection/work/expression/release）不写这三张表，无需全局锁。
func structuralKind(kind string) bool {
	switch kind {
	case "content_unit", "medium", "track":
		return true
	}
	return false
}

// newID 生成时间有序的 UUIDv7 作为主键。
//
// 随机 UUIDv4 做主键时插入点散落整棵 B-tree：亿级下页分裂、索引膨胀与缓存命中都会明显变差，
// 且按时间范围扫描（导出/同步/分区裁剪）没有局部性。v7 前缀是毫秒时间戳，插入集中在最右侧。
// 代价是 ID 泄漏创建时间（毫秒级，与 created_at 同级信息）；生成失败退回 v4，不返回空 ID。
func newID() string {
	if id, err := uuid.NewV7(); err == nil {
		return id.String()
	}
	return uuid.NewString()
}
func encode(v any) string { b, _ := json.Marshal(v); return string(b) }
func nullable(v string) any {
	if v == "" {
		return nil
	}
	return v
}
func definitions(ctx context.Context, q queryer) (DefinitionVersion, error) {
	var v DefinitionVersion
	var b []byte
	err := q.QueryRowContext(ctx, "SELECT id,state,base_version,document,created_at FROM catalog.definitions WHERE state='published'").Scan(&v.ID, &v.State, &v.BaseVersion, &b, &v.CreatedAt)
	if err == nil {
		err = json.Unmarshal(b, &v.Document)
	}
	return v, err
}

// definitionsCache 是已发布定义的进程内小缓存：导入/校验等热路径每次读库
// 取同一份 published 行，缓存按（id + base_version）失效。
//   - 只缓存读 published 行：Draft/Publish 写路径不走缓存，发布后版本号变化
//     即失效，不会读到旧定义；
//   - 事务内读取（*sql.Tx）不走缓存：Publish 的 impact 全量校验在长事务内必须
//     看到本事务的写入（tx），缓存是进程级、跨事务，会读脏旧版本；
//   - 多实例/多进程不一致窗口：缓存只在本进程有效，发布后其它进程最多滞后到
//     下一次版本号变化（下一次 Definitions 调用即刷新），不做跨进程广播；
//   - 测试与 Store{} 空实例：DB 为 nil 时直接回退读库（返回原始错误），
//     不因缓存引入新失败形态。
var (
	definitionsCacheMu sync.Mutex
	definitionsCache   DefinitionVersion
	definitionsCacheDB *sql.DB
	definitionsCacheOK bool
)

func (s *Store) Definitions(ctx context.Context) (DefinitionVersion, error) {
	// 空 DB（纯映射单测的 Store{}）直接回退读库，保持原有错误语义。
	if s.DB == nil {
		return definitions(ctx, s.DB)
	}
	definitionsCacheMu.Lock()
	cached, cachedDB, ok := definitionsCache, definitionsCacheDB, definitionsCacheOK
	definitionsCacheMu.Unlock()
	// 缓存按 *sql.DB 区分：测试夹具为每个用例建隔离库（同 id/base_version
	// 但不同 document），跨库复用会串定义。生产单库进程内则命中同一指针。
	if ok && cachedDB == s.DB {
		// 轻量失效检查：只读 id/base_version，不反序列化整份 document。
		var id, base int64
		if err := s.DB.QueryRowContext(ctx, "SELECT id,base_version FROM catalog.definitions WHERE state='published'").Scan(&id, &base); err == nil && id == cached.ID && base == cached.BaseVersion {
			return cached, nil
		}
	}
	v, err := definitions(ctx, s.DB)
	if err != nil {
		return v, err
	}
	definitionsCacheMu.Lock()
	definitionsCache, definitionsCacheDB, definitionsCacheOK = v, s.DB, true
	definitionsCacheMu.Unlock()
	return v, err
}

// InvalidateDefinitionsCache 清空进程内定义缓存，供测试在改动定义后强制刷新。
// 生产路径靠版本号失效，不需要调用。
func InvalidateDefinitionsCache() {
	definitionsCacheMu.Lock()
	definitionsCache, definitionsCacheDB, definitionsCacheOK = DefinitionVersion{}, nil, false
	definitionsCacheMu.Unlock()
}
func get(ctx context.Context, q queryer, id string) (Entity, error) {
	var e Entity
	var b []byte
	err := q.QueryRowContext(ctx, "SELECT document FROM catalog.entities WHERE id=$1", id).Scan(&b)
	if err != nil {
		return e, err
	}
	if err = json.Unmarshal(b, &e); err != nil {
		return e, err
	}
	switch e.Kind {
	case "content_unit":
		err = q.QueryRowContext(ctx, "SELECT work_id,coalesce(parent_id::text,'') FROM catalog.content_units WHERE id=$1", id).Scan(&e.WorkID, &e.ParentID)
	case "expression":
		err = q.QueryRowContext(ctx, "SELECT work_id,coalesce(content_unit_id::text,'') FROM catalog.expressions WHERE id=$1", id).Scan(&e.WorkID, &e.ContentUnitID)
	case "medium":
		err = q.QueryRowContext(ctx, "SELECT release_id,coalesce(parent_id::text,'') FROM catalog.mediums WHERE id=$1", id).Scan(&e.ReleaseID, &e.ParentID)
	case "track":
		err = q.QueryRowContext(ctx, "SELECT medium_id,coalesce(parent_id::text,'') FROM catalog.tracks WHERE id=$1", id).Scan(&e.MediumID, &e.ParentID)
		if err != nil {
			return e, err
		}
		var rows *sql.Rows
		rows, err = q.QueryContext(ctx, "SELECT expression_id,position,locator,attributes FROM catalog.track_contents WHERE track_id=$1 ORDER BY position", id)
		if err != nil {
			return e, err
		}
		defer rows.Close()
		e.Contents = []Inclusion{}
		for rows.Next() {
			var c Inclusion
			var loc, attrs []byte
			if err = rows.Scan(&c.ExpressionID, &c.Position, &loc, &attrs); err != nil {
				return e, err
			}
			if len(loc) > 0 {
				if err = json.Unmarshal(loc, &c.Locator); err != nil {
					return e, err
				}
			}
			if len(attrs) > 0 {
				if err = json.Unmarshal(attrs, &c.Attributes); err != nil {
					return e, err
				}
			}
			e.Contents = append(e.Contents, c)
		}
		err = rows.Err()
	case "release":
		var rows *sql.Rows
		rows, err = q.QueryContext(ctx, "SELECT work_id,role,position,attributes FROM catalog.release_subjects WHERE release_id=$1 ORDER BY position,work_id", id)
		if err != nil {
			return e, err
		}
		defer rows.Close()
		e.Subjects = []Subject{}
		for rows.Next() {
			var x Subject
			var attrs []byte
			if err = rows.Scan(&x.WorkID, &x.Role, &x.Position, &attrs); err != nil {
				return e, err
			}
			if len(attrs) > 0 {
				if err = json.Unmarshal(attrs, &x.Attributes); err != nil {
					return e, err
				}
			}
			e.Subjects = append(e.Subjects, x)
		}
		err = rows.Err()
	}
	return e, err
}
func visible(e Entity, u *User) bool {
	// 未发布条目只有创建者与持审核/生命周期权者（旧 admin）可见。
	return e.Status == "published" || u != nil && (u.Can(PermissionLifecycleManage) || ownedBy(e, *u))
}

// GetManyVisible 一次查询批量取实体，仅返回 u 可见者。
// 用于关系对端解析：真实条目署名可达数百条，逐条 Get 会形成 N+1 且易被固定上限截断。
func (s *Store) GetManyVisible(ctx context.Context, ids []string, u *User) (map[string]Entity, error) {
	out := map[string]Entity{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.DB.QueryContext(ctx,
		"SELECT id::text, document, status, created_by::text FROM catalog.entities WHERE id = ANY($1::uuid[])", pq.Array(ids))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, status, createdBy string
		var b []byte
		if err = rows.Scan(&id, &b, &status, &createdBy); err != nil {
			return nil, err
		}
		var e Entity
		if err = json.Unmarshal(b, &e); err != nil {
			return nil, err
		}
		// 可见性以库列为准（document 里的 status 可能滞后）。
		e.ID, e.Status, e.CreatedBy = id, status, createdBy
		if visible(e, u) {
			out[id] = e
		}
	}
	return out, rows.Err()
}
func (s *Store) Get(ctx context.Context, id string, u *User) (Entity, error) {
	if _, err := uuid.Parse(id); err != nil {
		return Entity{}, fmt.Errorf("invalid_id")
	}
	e, err := get(ctx, s.DB, id)
	if err == nil && !visible(e, u) {
		return Entity{}, sql.ErrNoRows
	}
	return e, err
}

// reference 是写侧身份归一：merged/deleted 行的引用一律拒绝（invalid_reference），
// 调用方先经 ResolveIdentity/identity 端点拿到 canonical 再写——归一靠"拒绝+指路"，
// 不在写路径里静默改写目标（静默改写会让调用方记错自己引的是谁）。
// catalogIncrementals 是基线之后的结构增量（S2 冻结原则：000001 永不修改，新结构只以
// 有序不可变增量表达）。安装路径（Initialize）与 `mf-migrate up` 执行同一批文件
// （migrator 按 backend/migrations/*.sql 自动发现），语句全部幂等，重复执行安全。
// 每项修复提交各自追加自己的文件，不提前引用不存在的文件。
var catalogIncrementals = []string{
	"000006_request_idempotency.up.sql",         // R1：catalog.idempotency_keys
	"000007_revision_definition_version.up.sql", // D4：revisions.definition_version
	"000008_redirect_lookup_index.up.sql",       // R2：entities redirect 反查索引
	"000009_notification_receipts.up.sql",       // A04：notification_receipts 收据表
}

// applyCatalogIncrementals 在安装路径上执行结构增量（见 catalogIncrementals 注释）。
func applyCatalogIncrementals(ctx context.Context, db *sql.DB) error {
	for _, f := range catalogIncrementals {
		b, err := fs.ReadFile(migrations.FS, f)
		if err != nil {
			return fmt.Errorf("read catalog incremental %s: %w", f, err)
		}
		if _, err := db.ExecContext(ctx, string(b)); err != nil {
			return fmt.Errorf("apply catalog incremental %s: %w", f, err)
		}
	}
	return nil
}

func reference(ctx context.Context, q queryer, u *User) func(string, []string) error {
	return func(id string, kinds []string) error {
		if _, err := uuid.Parse(id); err != nil {
			return fmt.Errorf("invalid_reference")
		}
		e, err := get(ctx, q, id)
		if err != nil || !contains(kinds, e.Kind) || !visible(e, u) || e.Status == "deleted" || e.Status == "merged" {
			return fmt.Errorf("invalid_reference")
		}
		return nil
	}
}

// 四类版本互不混用（D4）：
//  1. 数据库迁移版本：schema_migrations + backend/migrations/*.sql，回答"库结构到哪了"；
//  2. definitions 发布版本：catalog.definitions.id，回答"校验与展示按哪份定义"；
//  3. 条目修订版本：catalog.revisions.version（按 target_id 递增）与 entities.version
//     乐观并发计数，回答"这个条目改到第几版"；
//  4. 服务镜像/接口兼容版本：构建期注入的 git sha（见 version.go），回答"线上跑的是哪次构建"。
//
// 本函数同时写 3 的修订行与 outbox 事件，并把 2 的当前值记进修订行的
// definition_version：字段含义变化后，历史值仍可用当时的定义解释。
//
// 双快照的用途与保留策略（任务 8：不删历史）：两次写入是同一快照的两份不同用途——
// revisions 按 target_id 留版本化历史（用户可见的修订时间线，回滚与审计的依据），
// outbox 按事件留待投递的事实（未来跨服务消费者的唯一来源，见 Deliver 的保留注释）。
// 当前 Deliver 无生产消费者，但两边都不清：删修订断时间线，删 outbox 断 deliveries 外键
// 且丢审计；事件只引用修订 ID 太省会逼消费者回查，当前最小载荷即全量快照。
//
// 关键动作的留痕现状核对：授权/处置类动作（实体删除/合并、下架、关系删除、定义起草/发布、
// 合并改写）全部经本函数落在业务事务内——事务回滚则留痕与业务一起消失，不存在
// “改了没记、记了没改”的半成品。通用访问审计（audit.Recorder）是进程内有界队列异步落库，
// 满则丢行计数（尽力而为），只做访问日志，不承担业务留痕。
func audit(ctx context.Context, tx *sql.Tx, id string, version int64, u User, note string, sources []Source, snapshot any, eventType string) error {
	// actor_name/actor_role 与 actor_id 一起落库：读取修订历史不再需要 JOIN auth.users
	// （账号表归账号服务，跨 schema 读会让两个系统在数据层重新耦合）。
	// definition_version 取同一事务内的已发布定义：definitions.published 事件的 audit
	// 调用发生在发布事务提交前，读到的是本事务刚发布的版本，引用即自身；无已发布行
	//（极端空库路径）时记 NULL，不伪造引用。
	var defVersion *int64
	var publishedID int64
	if err := tx.QueryRowContext(ctx, "SELECT id FROM catalog.definitions WHERE state='published'").Scan(&publishedID); err == nil {
		defVersion = &publishedID
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO catalog.revisions(target_id,version,actor_id,actor_name,actor_role,edit_note,sources,snapshot,definition_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", id, version, u.ID, u.Username, u.Role, note, encode(sources), encode(snapshot), defVersion); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "INSERT INTO catalog.outbox(id,type,entity_id,version,payload) VALUES($1,$2,$3,$4,$5)", uuid.NewString(), eventType, id, version, encode(snapshot))
	return err
}
func (s *Store) Save(ctx context.Context, input Edit, u User) (Entity, error) {
	e := input.Entity
	// 结构类实体（篇目/载体/轨道）走串行写通道，其余 kind 并行写。
	commit := s.write
	if structuralKind(e.Kind) {
		commit = s.writeStructural
	}
	err := commit(ctx, func(tx *sql.Tx) error {
		if err := validateSources(input.EditNote, input.Sources); err != nil {
			return err
		}
		// M02 先取定义共享（顺序：结构锁由 commit 在事务开始时已取 → 定义共享 → 发行锁，
		// 全局一致，见 definitionsLockKey 注释）。
		if err := lockDefinitionsShared(ctx, tx); err != nil {
			return err
		}
		// M01 再按所属发行取锁（新建 release/归属缺失跳过，见 lockReleaseScope）。
		if err := lockReleaseScope(ctx, tx, e); err != nil {
			return err
		}
		v, err := definitions(ctx, tx)
		if err != nil {
			return err
		}
		var old Entity
		// create 决定了这一步是"无版本可比的纯插入"还是"必须带版本条件的更新"。
		create := e.ID == ""
		if create {
			if input.ExpectedVersion != 0 {
				return errVersionConflict
			}
			e.ID = newID()
			e.Version = 1
			e.CreatedBy = u.ID
			// R1 幂等声明与业务写入同一事务：已存在响应即重放返回（不写业务），
			// 否则占位并继续，提交前回填首创响应（见 audit 调用点之后）。
			if input.idempotency != nil {
				prior, claimed, cerr := claimIdempotencyTx(ctx, tx, input.idempotency)
				if cerr != nil {
					return cerr
				}
				if !claimed {
					if e, cerr = replayEntity(prior); cerr != nil {
						return cerr
					}
					return errIdempotentReplay
				}
			}
		} else {
			old, err = get(ctx, tx, e.ID)
			if err != nil {
				return err
			}
			if !visible(old, &u) || old.Status == "deleted" || old.Status == "merged" {
				return errForbidden
			}
			if old.Version != input.ExpectedVersion {
				return errVersionConflict
			}
			if old.Kind != e.Kind || old.WorkID != e.WorkID || old.ReleaseID != e.ReleaseID || old.MediumID != e.MediumID {
				return fmt.Errorf("immutable_scope")
			}
			e.CreatedBy = old.CreatedBy
			e.Version = old.Version + 1
		}
		if !u.Can(PermissionLifecycleManage) {
			if old.ID != "" && !canEditEntity(u, old) {
				return errForbidden
			}
			// 无实体编辑权者走审核制：只能存草稿或提交审核，不能发布，也不可触碰已发布条目。
			if !u.Can(PermissionEntityEdit) {
				if old.Status == "published" {
					return errForbidden
				}
				if e.Status != "draft" && e.Status != "pending_review" {
					return errForbidden
				}
			}
			// 持实体编辑权者（旧 editor）可维护公开条目；发布他人的草稿、降级与删除
			// 仍由 catalog.lifecycle.manage（旧 admin-only）处理。
		}
		if e.Status == "" {
			e.Status = "draft"
		}
		if e.Status == "deleted" || e.Status == "merged" || e.RedirectID != "" {
			return fmt.Errorf("use_lifecycle_endpoint")
		}
		if old.Status == "published" && e.Status != "published" {
			return fmt.Errorf("use_lifecycle_endpoint")
		}
		e.Title = strings.TrimSpace(e.Title)
		e.UpdatedAt = time.Now().UTC()
		ref := reference(ctx, tx, &u)
		if e.Status == "published" {
			ref = reference(ctx, tx, nil)
		}
		// 零翻译可发布：published 要求至少一条翻译（含原文语种行），否则多语言
		// 展示无回退依据。此处显式拦截——只影响本次写入，不追溯存量。
		if e.Status == "published" && len(e.Translations) == 0 {
			return fmt.Errorf("translation_required")
		}
		// D3 正式新建口径（前后端同一套）：新写必须显式声明 types，只有一个例外——
		// 该 kind 只有一个启用类型时（如 medium/track）服务端自动采用它，前端同样
		// 自动勾选（见 EntityEditor），不让用户重复勾选“介质的类型=介质”。
		// 历史回退只看创建时间（主键 UUIDv7 时间戳，见 isLegacyUntyped），不看“有没有 ID”：
		// 口径生效点之后创建的无类型实体（只能是裸骨架或导入链路）补属性同样要先声明
		// types，“先裸建、再补属性”的两步绕行就此关闭。更新抹空已有 types 同样拦截
		//（否则 strip types 即可绕开字段约束）。
		if create && !input.internal && len(e.Types) == 0 {
			if code, ok := v.Document.soleEnabledType(e.Kind); ok {
				e.Types = []string{code}
			}
		}
		if !input.internal && !create && len(e.Types) == 0 && len(old.Types) > 0 {
			// 已有 types 的记录不得经普通保存抹空最后一个类型，与属性是否为空无关；
			// 历史兼容只留给真正无类型存量（见 isLegacyUntyped）。
			return fmt.Errorf("types_required")
		}
		if !input.internal && len(e.Types) == 0 && needsExplicitTypes(e) && (create || !isLegacyUntyped(old)) {
			return fmt.Errorf("types_required")
		}
		historical := input.internal || !create && (len(old.Types) > 0 || isLegacyUntyped(old))
		if err = v.Document.validateEntity(e, ref, historical); err != nil {
			return err
		}
		// ExternalIDs 两层复核：先格式层（键合规、值非空收敛、metafusion_import
		// 内部键格式），再预设层（键必须已在 external_databases 预设，值按
		// validation_regex 收敛；official_website 存完整 URL 走 validURL；
		// 内部键不在预设表，预设层跳过）。两层缺一不可：格式层拦手工伪造的
		// 非法键（如 forged:::key），预设层拦格式合法但无预设的键。
		if err = v.Document.validateExternalIDs(e); err != nil {
			return err
		}
		// 内部幂等键只能由导入链路声明（见 validation.go 的 guardImportKey）：
		// 任何登录用户都能写草稿，手工载荷抢占键会让合法导入永久撞唯一索引。
		if !input.internal {
			if err = guardImportKey(e.ExternalIDs, old.ExternalIDs); err != nil {
				return err
			}
		}
		if err = validateExternalIDsAgainstDB(ctx, tx, e); err != nil {
			return err
		}
		if err = v.Document.retiredEntity(e, old); err != nil {
			return err
		}
		if e.WorkID != "" {
			if err = ref(e.WorkID, []string{"work"}); err != nil {
				return err
			}
		}
		if e.ReleaseID != "" {
			if err = ref(e.ReleaseID, []string{"release"}); err != nil {
				return err
			}
		}
		if e.MediumID != "" {
			if err = ref(e.MediumID, []string{"medium"}); err != nil {
				return err
			}
		}
		if e.ParentID != "" {
			if err = ref(e.ParentID, []string{e.Kind}); err != nil {
				return err
			}
		}
		if e.ContentUnitID != "" {
			if err = ref(e.ContentUnitID, []string{"content_unit"}); err != nil {
				return err
			}
		}
		stored := e
		stored.WorkID = ""
		stored.ContentUnitID = ""
		stored.ReleaseID = ""
		stored.MediumID = ""
		stored.ParentID = ""
		stored.Contents = nil
		stored.Subjects = nil
		// 乐观并发的"版本检查 + 写入"必须是**一次原子操作**：原先是"先读版本、再无条件写"，
		// READ COMMITTED 下两个并发写各自读到同一版本、都通过检查，后写覆盖先写 = 丢更新。
		// 版本条件进 WHERE 后，后到者先在行锁上排队，锁释放时重算条件、版本已变 → 0 行 →
		// version_conflict，整个事务（含侧表与审计行）一起回滚。
		if create {
			if _, err = tx.ExecContext(ctx, `INSERT INTO catalog.entities(id,kind,version,title,status,created_by,document,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, e.ID, e.Kind, e.Version, e.Title, e.Status, e.CreatedBy, encode(stored), e.UpdatedAt); err != nil {
				return err
			}
		} else {
			var res sql.Result
			if res, err = tx.ExecContext(ctx, `UPDATE catalog.entities SET version=$3,title=$4,status=$5,document=$6,updated_at=$7 WHERE id=$1 AND version=$2`, e.ID, input.ExpectedVersion, e.Version, e.Title, e.Status, encode(stored), e.UpdatedAt); err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n == 0 {
				return errVersionConflict
			}
		}
		switch e.Kind {
		case "content_unit":
			_, err = tx.ExecContext(ctx, "INSERT INTO catalog.content_units(id,work_id,parent_id) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET parent_id=EXCLUDED.parent_id", e.ID, e.WorkID, nullable(e.ParentID))
		case "expression":
			_, err = tx.ExecContext(ctx, "INSERT INTO catalog.expressions(id,work_id,content_unit_id) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET content_unit_id=EXCLUDED.content_unit_id", e.ID, e.WorkID, nullable(e.ContentUnitID))
		case "medium":
			_, err = tx.ExecContext(ctx, "INSERT INTO catalog.mediums(id,release_id,parent_id) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET parent_id=EXCLUDED.parent_id", e.ID, e.ReleaseID, nullable(e.ParentID))
		case "track":
			_, err = tx.ExecContext(ctx, "INSERT INTO catalog.tracks(id,medium_id,parent_id) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET parent_id=EXCLUDED.parent_id", e.ID, e.MediumID, nullable(e.ParentID))
			if err != nil {
				return err
			}
			if _, err = tx.ExecContext(ctx, "DELETE FROM catalog.track_contents WHERE track_id=$1", e.ID); err != nil {
				return err
			}
			for _, c := range e.Contents {
				if _, err = tx.ExecContext(ctx, "INSERT INTO catalog.track_contents(track_id,expression_id,position,locator,attributes) VALUES($1,$2,$3,$4,$5)", e.ID, c.ExpressionID, c.Position, encode(c.Locator), encode(c.Attributes)); err != nil {
					return err
				}
			}
		case "release":
			if _, err = tx.ExecContext(ctx, "DELETE FROM catalog.release_subjects WHERE release_id=$1", e.ID); err != nil {
				return err
			}
			for _, x := range e.Subjects {
				if _, err = tx.ExecContext(ctx, "INSERT INTO catalog.release_subjects(release_id,work_id,role,position,attributes) VALUES($1,$2,$3,$4,$5)", e.ID, x.WorkID, x.Role, x.Position, encode(x.Attributes)); err != nil {
					return err
				}
			}
		}
		if err != nil {
			return err
		}
		missing, err := undeclaredReleaseSubject(ctx, tx, e)
		if err != nil {
			return err
		}
		if missing {
			return fmt.Errorf("undeclared_release_subject")
		}
		if err := audit(ctx, tx, e.ID, e.Version, u, input.EditNote, input.Sources, e, "entity.saved"); err != nil {
			return err
		}
		// R1 首创响应与业务写入同一事务回填：崩溃只会整体回滚，重试按已存在行重放。
		if create && input.idempotency != nil {
			if err := setIdempotencyResponseTx(ctx, tx, input.idempotency, e); err != nil {
				return err
			}
		}
		// 通知与实体写入**同一事务**：审核结果与收录事件不会出现"改了却没通知"的半成品。
		// create 时 old 是零值，用 nil 表示"没有旧版本"（零值 Entity 的 Status 也是空串，
		// 直接传会被当成一次"从空状态变成 published"的跃迁）。
		var before *Entity
		if !create {
			prior := old
			before = &prior
		}
		return notifySaveOutcome(ctx, tx, before, e, u)
	})
	// errIdempotentReplay 是内部控制流：e 已是重放的首创结果，返回成功。
	if errors.Is(err, errIdempotentReplay) {
		return e, nil
	}
	return e, err
}

// undeclaredReleaseSubject 只复核本次写入可能打破的收录归属：release 重写
// subjects、track 重写 contents，均只涉及其所在发行；medium 改动不触及映射表，
// 限定其发行复核；其余 kind 不触及映射表且归属字段在 Save 内不可变
// （immutable_scope），跳过复核。语义与原全表 EXISTS 一致——任一发行存在
// 未声明收录即拒绝，只是不再为一次单实体写入扫描全库。
func undeclaredReleaseSubject(ctx context.Context, tx *sql.Tx, e Entity) (bool, error) {
	var releaseID, trackID any
	switch e.Kind {
	case "release":
		releaseID = e.ID
	case "track":
		trackID = e.ID
	case "medium":
		releaseID = e.ReleaseID
	default:
		return false, nil
	}
	var missing bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS(
	 SELECT 1 FROM catalog.track_contents c
	 JOIN catalog.tracks t ON t.id=c.track_id
	 JOIN catalog.mediums m ON m.id=t.medium_id
	 JOIN catalog.expressions x ON x.id=c.expression_id
	 WHERE ($1::uuid IS NULL OR m.release_id=$1)
	 AND ($2::uuid IS NULL OR t.id=$2)
	 AND NOT EXISTS(SELECT 1 FROM catalog.release_subjects s
	 WHERE s.release_id=m.release_id AND s.work_id=x.work_id))`, releaseID, trackID).Scan(&missing)
	return missing, err
}

type ListOptions struct {
	Kind, Query, Type, Status, WorkID, ContentUnitID, ReleaseID, MediumID, ParentID, Field, Value string
	// Kinds / Types 是多值版本：Kinds 命中任一 kind，Types 命中任一动态业务类型。
	// 关系编辑器的对端选择器需要"kind 与业务类型同时约束"，命中必须在 SQL 侧完成；
	// 否则先取固定条数再在前端过滤，会把合法候选截断丢弃。
	Kinds, Types []string
	// Tags 按"任一命中"（OR）过滤 attributes.tags，走 jsonb 容器包含，
	// 由 entities_attribute_tags 函数索引支撑，避免全表扫描。
	Tags []string
	// OriginalLanguage 按 document->>'original_language' 精确匹配：八层级通用列，
	// 探索页侧栏的原语言筛选即它（值如 ja/zh/en，大小写按入库原样比）。
	OriginalLanguage string
	// HasPictures 只留有封面的：document->'pictures' 为非空数组。CASE 保序
	// （WHEN 为真才求 array_length）：缺键/标量/对象走 ELSE=0 按无封面过滤。
	HasPictures bool
	// Sort / Order 是白名单排序键与方向（见 listSortKeys），Locale 只在 Sort=title
	// 时参与"取哪个语种的题名"；未知键由 normalizeListSort 拒掉（HTTP 400 invalid_sort），
	// 不静默退回默认序——静默忽略正是"传了 sort=title 却拿到 updated_at 序列"的成因。
	Sort, Order, Locale string
	Offset, Limit       int
}

// listFilter builds the shared WHERE clause for List and Count so the list
// total is a real COUNT(*) over the same predicate set, not len(items).
// listFilterNestedKey 供纯 SQL 构造（如单测）时在 ctx 中显式携带 Definitions
// 快照：生产路径仍读已发布版本；携带快照时跳过 DB 查询，避免离线断言依赖数据库。
type listFilterNestedKey struct{}

// withListFilterDefinitions 把 Definitions 快照注入 ctx，供 listFilter 解析
// field 点分路径时使用（同包测试用）。
func withListFilterDefinitions(ctx context.Context, d Definitions) context.Context {
	return context.WithValue(ctx, listFilterNestedKey{}, d)
}

// nestedQuoteKey 把已解析的字段码内联为 SQL 字面量：字段码受 codePattern
// 约束，此处再转义单引号兜底；用户取值一律走绑定参数。
func nestedQuoteKey(k string) string { return "'" + strings.ReplaceAll(k, "'", "''") + "'" }

// compileNestedPath 把点分路径编译成谓词：group 节点用 -> 逐层下钻，
// list 中途节点用 jsonb_array_elements 的 EXISTS 实现"任一元素命中"，
// 叶子一律按现有等值语义做 ->> 文本比较。base 为叶子父级的 JSON 表达式，
// lookup 为首段的查表域（实体属性表或某结构组的子字段表），seed 为链路上
// 已确认的祖先字段（含入口本身）。
func compileNestedPath(base string, lookup map[string]Field, seed []Field, path []string, value string, args *[]any) (string, error) {
	parent := base
	node := Field{}
	chain := append([]Field{}, seed...)
	froms := []string{}
	for i, sg := range path {
		var child Field
		if i == 0 {
			var ok bool
			child, ok = lookup[sg]
			if !ok {
				return "", fmt.Errorf("unknown_field")
			}
		} else {
			if node.Type != "group" {
				return "", fmt.Errorf("unknown_field")
			}
			var ok bool
			child, ok = node.Fields[sg]
			if !ok {
				return "", fmt.Errorf("unknown_field")
			}
		}
		node = child
		chain = append(chain, child)
		if i < len(path)-1 {
			if node.Type != "group" && node.Type != "list" {
				return "", fmt.Errorf("unknown_field")
			}
			parent += "->" + nestedQuoteKey(sg)
			for node.Type == "list" {
				if node.Items == nil {
					return "", fmt.Errorf("unknown_field")
				}
				alias := fmt.Sprintf("elem%d", len(froms)+1)
				froms = append(froms, "jsonb_array_elements("+parent+") AS "+alias)
				parent = alias
				node = *node.Items
				chain = append(chain, node)
			}
		}
	}
	for _, f := range chain {
		if !f.Enabled {
			return "", fmt.Errorf("field_not_searchable")
		}
	}
	if !node.Searchable {
		return "", fmt.Errorf("field_not_searchable")
	}
	*args = append(*args, value)
	cond := fmt.Sprintf("%s->>%s=$%d", parent, nestedQuoteKey(path[len(path)-1]), len(*args))
	if len(froms) == 0 {
		return cond, nil
	}
	return "EXISTS(SELECT 1 FROM " + strings.Join(froms, ", ") + " WHERE " + cond + ")", nil
}

// nestedFieldPredicate 解析 field 点分路径并编译成 WHERE 谓词：
// 结构属性伪字段 locator./inclusion_attributes./subject_attributes. 编译成
// catalog.track_contents / catalog.release_subjects 的 EXISTS 子查询，
// kind 显式不匹配时谓词恒假（返回空集）而不是报错；其余路径命中实体
// document->'attributes'，group 逐层下钻、list 中途节点按任一元素命中。
func nestedFieldPredicate(doc Definitions, o ListOptions, args *[]any) (string, error) {
	segs := strings.Split(o.Field, ".")
	for _, sg := range segs {
		if sg == "" || !codePattern.MatchString(sg) {
			return "", fmt.Errorf("unknown_field")
		}
	}
	switch segs[0] {
	case "locator", "inclusion_attributes", "subject_attributes":
		root, ok := doc.Fields[segs[0]]
		if !ok || root.Type != "group" {
			return "", fmt.Errorf("unknown_field")
		}
		want := "track"
		table, corr, base := "catalog.track_contents tc", "tc.track_id = catalog.entities.id", "tc.locator"
		if segs[0] == "subject_attributes" {
			want = "release"
			table, corr, base = "catalog.release_subjects rs", "rs.release_id = catalog.entities.id", "rs.attributes"
		} else if segs[0] == "inclusion_attributes" {
			base = "tc.attributes"
		}
		cond, err := compileNestedPath(base, root.Fields, []Field{root}, segs[1:], o.Value, args)
		if err != nil {
			return "", err
		}
		if (o.Kind != "" && o.Kind != want) || (len(o.Kinds) > 0 && !contains(o.Kinds, want)) {
			// kind 不匹配时恒假：已绑定的取值参数不再需要，弹出以保持
			// 参数位置与谓词一一对应。
			*args = (*args)[:len(*args)-1]
			return "1=0", nil
		}
		return "EXISTS(SELECT 1 FROM " + table + " WHERE " + corr + " AND (" + cond + "))", nil
	default:
		return compileNestedPath("document->'attributes'", doc.Fields, nil, segs, o.Value, args)
	}
}

func listFilter(ctx context.Context, s *Store, o ListOptions, u *User, args *[]any) ([]string, error) {
	parts := []string{"status NOT IN ('deleted','merged')"}
	add := func(clause string, value any) {
		*args = append(*args, value)
		parts = append(parts, fmt.Sprintf(clause, len(*args)))
	}
	if u == nil {
		parts = append(parts, "status='published'")
	} else if !u.Can(PermissionLifecycleManage) {
		// 未发布条目只有创建者能列；持审核/生命周期权者与旧 admin 同口径，看全量。
		add("(status='published' OR created_by=$%d)", u.ID)
	}
	if o.Kind != "" {
		add("kind=$%d", o.Kind)
	}
	if len(o.Kinds) > 0 {
		add("kind = ANY($%d)", pq.Array(o.Kinds))
	}
	if o.Status != "" {
		add("status=$%d", o.Status)
	}
	if o.OriginalLanguage != "" {
		add("document->>'original_language'=$%d", o.OriginalLanguage)
	}
	if o.HasPictures {
		parts = append(parts, "(CASE WHEN jsonb_typeof(document->'pictures')='array' THEN jsonb_array_length(document->'pictures') ELSE 0 END>0)")
	}
	if o.Query != "" {
		// 翻译搜索走 (document->'translations')::text ILIKE：整 JSON 转文本匹配，
		// 无索引支撑，大库上是顺序扫描。这是刻意的最小口径——精确的多语言标题
		// 检索应走专用全文/三元组索引（三期），此处保留"能搜到"的降级语义，
		// 不为单个 LIKE 建昂贵的表达式索引。title 列有 entities_search GIN。
		// 模式由 likeContains 编译：用户输入里的 %/_/\ 按字面处理（like_pattern.go）。
		add("(title ILIKE $%[1]d OR (document->'translations')::text ILIKE $%[1]d)", likeContains(o.Query))
	}
	if o.Type != "" {
		add("document->'types' ? $%d", o.Type)
	}
	if len(o.Types) > 0 {
		// ?| 是 jsonb "任一键存在"，与前端 EntityPicker 的业务类型白名单同口径。
		add("document->'types' ?| $%d", pq.Array(o.Types))
	}
	if o.WorkID != "" {
		add("(id IN(SELECT id FROM catalog.content_units WHERE work_id=$%[1]d) OR id IN(SELECT id FROM catalog.expressions WHERE work_id=$%[1]d) OR id IN(SELECT release_id FROM catalog.release_subjects WHERE work_id=$%[1]d))", o.WorkID)
	}
	if o.ReleaseID != "" {
		add("id IN(SELECT id FROM catalog.mediums WHERE release_id=$%d)", o.ReleaseID)
	}
	if o.ContentUnitID != "" {
		add("id IN(SELECT id FROM catalog.expressions WHERE content_unit_id=$%d)", o.ContentUnitID)
	}
	if o.MediumID != "" {
		add("id IN(SELECT id FROM catalog.tracks WHERE medium_id=$%d)", o.MediumID)
	}
	if o.ParentID != "" {
		add("id IN(SELECT id FROM catalog.content_units WHERE parent_id=$%[1]d UNION ALL SELECT id FROM catalog.mediums WHERE parent_id=$%[1]d UNION ALL SELECT id FROM catalog.tracks WHERE parent_id=$%[1]d)", o.ParentID)
	}
	if o.Field != "" {
		// definitions 快照默认读已发布版本；纯 SQL 构造（如单测）可经 ctx
		// 显式携带快照（withListFilterDefinitions），避免离线断言依赖数据库。
		var doc Definitions
		if dd, ok := ctx.Value(listFilterNestedKey{}).(Definitions); ok && dd.Fields != nil {
			doc = dd
		} else {
			v, err := s.Definitions(ctx)
			if err != nil {
				return nil, err
			}
			doc = v.Document
		}
		if !strings.Contains(o.Field, ".") {
			f, ok := doc.Fields[o.Field]
			if !ok || !f.Searchable {
				return nil, fmt.Errorf("field_not_searchable")
			}
			*args = append(*args, o.Field, o.Value)
			parts = append(parts, fmt.Sprintf("document->'attributes'->>$%d=$%d", len(*args)-1, len(*args)))
		} else {
			cond, ferr := nestedFieldPredicate(doc, o, args)
			if ferr != nil {
				return nil, ferr
			}
			parts = append(parts, cond)
		}
	}
	if len(o.Tags) > 0 {
		// 任一标签命中即可。用容器包含（@>）而非展开比较，以命中
		// entities_attribute_tags 函数 GIN 索引。
		ors := make([]string, 0, len(o.Tags))
		for _, tag := range o.Tags {
			if strings.TrimSpace(tag) == "" {
				continue
			}
			*args = append(*args, `["`+strings.ReplaceAll(tag, `"`, `\"`)+`"]`)
			ors = append(ors, fmt.Sprintf("document->'attributes'->'tags' @> $%d::jsonb", len(*args)))
		}
		if len(ors) > 0 {
			parts = append(parts, "("+strings.Join(ors, " OR ")+")")
		}
	}
	return parts, nil
}

// Count returns the real total for ListOptions over the same predicates List
// uses. List endpoints use it instead of len(items) so pagination totals stay
// exact as the dataset grows.
func (s *Store) Count(ctx context.Context, o ListOptions, u *User) (int64, error) {
	args := []any{}
	parts, err := listFilter(ctx, s, o, u, &args)
	if err != nil {
		return 0, err
	}
	var n int64
	err = s.DB.QueryRowContext(ctx, "SELECT count(*) FROM catalog.entities WHERE "+strings.Join(parts, " AND "), args...).Scan(&n)
	return n, err
}

// entityListSortKeys 是实体列表排序键白名单，白名单之外在 HTTP 层被拒（400 invalid_sort）。
// "最新创建"排在 id 上：entities 表没有 created_at 列（基线迁移是唯一结构来源，不为一个
// 排序键改结构），而主键由 uuid.NewV7() 生成、按时间有序，id 序即创建时间序且能走主键索引
// ——与货架排序 shelfOrderClause 的 created 取值同一口径。
var entityListSortKeys = map[string]bool{"updated_at": true, "created_at": true, "title": true}

// sortLocaleOK 只接受形如 zh-CN / ja / en-US 的语种码。它只当绑定参数用，
// 形态不合法的取值被丢弃（排序退到原文语种/en-US/基础题名），不因此拒绝整次列表请求。
func sortLocaleOK(s string) bool {
	if len(s) < 2 || len(s) > 20 {
		return false
	}
	for i, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z':
			continue
		case (r == '-' || r == '_') && i > 0:
			continue
		case r >= '0' && r <= '9' && i > 0:
			continue
		default:
			return false
		}
	}
	return true
}

// normalizeListSort 校验并归一化排序参数：未知排序键/方向返回稳定码（HTTP 层映射 400），
// 不静默退回默认序——静默忽略正是"传了 sort=title 却拿到 updated_at 序列"的成因。
func normalizeListSort(o *ListOptions) error {
	o.Sort = strings.ToLower(strings.TrimSpace(o.Sort))
	o.Order = strings.ToLower(strings.TrimSpace(o.Order))
	if o.Sort != "" && !entityListSortKeys[o.Sort] {
		return fmt.Errorf("invalid_sort")
	}
	if o.Order != "" && o.Order != "asc" && o.Order != "desc" {
		return fmt.Errorf("invalid_order")
	}
	o.Locale = strings.TrimSpace(o.Locale)
	if !sortLocaleOK(o.Locale) {
		o.Locale = ""
	}
	return nil
}

// entityListOrderClause 生成实体列表的 ORDER BY：排序键与方向都经白名单映射成 SQL 片段，
// 用户输入**不进 SQL 文本**（title 排序只把请求语种作为绑定参数 $n 带进去）。
// 末位一律补 id，同一排序键下的并列值靠它定序，分页不会抖动。
func entityListOrderClause(o ListOptions, args *[]any) (string, error) {
	structural := o.ReleaseID != "" || o.MediumID != "" || o.ParentID != "" || o.ContentUnitID != ""
	// 方向缺省按排序键的直觉取值：时间类"最新在前"，题名类 A→Z；显式 order 覆盖它。
	dir := "DESC"
	if o.Sort == "title" {
		dir = "ASC"
	}
	if o.Order == "asc" {
		dir = "ASC"
	} else if o.Order == "desc" {
		dir = "DESC"
	}
	switch o.Sort {
	case "":
		if structural {
			// 结构子项按 position 排序：Go 落库恒为数字（types.go Position int），
			// 正则守卫只防直接 SQL 写入的脏串（PG 无 TRY_CAST，裸 ::int 会报 22P02
			// 导致整页 500；脏串按 0 排而不中断列表）。
			return "CASE WHEN document->>'position' ~ '^-?[0-9]+$' THEN (document->>'position')::int ELSE 0 END, updated_at DESC, id", nil
		}
		return "updated_at DESC, id", nil
	case "updated_at":
		return "updated_at " + dir + ", id", nil
	case "created_at":
		return "id " + dir, nil
	case "title":
		// 多语言题名：请求语种 → 原文语种 → en-US → 基础题名，与前端 lib/titles.ts
		// 的选取链同序（首位由调用方按界面语言传入）。只按基础题名排会让日文/中文界面
		// 看到"顺序与显示的题名无关"，这里让排序键与页面显示的题名是同一个值。
		*args = append(*args, o.Locale)
		return fmt.Sprintf("COALESCE(NULLIF(document->'translations'->$%d::text->>'title',''), NULLIF(document->'translations'->(document->>'original_language')->>'title',''), NULLIF(document->'translations'->'en-US'->>'title',''), title) %s, id", len(*args), dir), nil
	}
	return "", fmt.Errorf("invalid_sort")
}

func (s *Store) List(ctx context.Context, o ListOptions, u *User) ([]Entity, error) {
	args := []any{}
	parts, err := listFilter(ctx, s, o, u, &args)
	if err != nil {
		return nil, err
	}
	if o.Limit <= 0 || o.Limit > 100 {
		o.Limit = 50
	}
	if o.Offset < 0 {
		o.Offset = 0
	}
	orderClause, err := entityListOrderClause(o, &args)
	if err != nil {
		return nil, err
	}
	args = append(args, o.Limit, o.Offset)
	rows, err := s.DB.QueryContext(ctx, "SELECT id FROM catalog.entities WHERE "+strings.Join(parts, " AND ")+fmt.Sprintf(" ORDER BY "+orderClause+" LIMIT $%d OFFSET $%d", len(args)-1, len(args)), args...)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	// 批量取回：先查 ID 再逐个 Get 的 N+1 改为一次 getMany（IN + 按 kind 批量
	// 补侧表），顺序按 ids 回填。getMany 只返回可见者：IDs 与返回的差集是
	// "状态翻转/不可见"的并发竞态，直接跳过（不整页失败）。
	// 分页总数仍由 Count 的真实 COUNT(*) 保证，不用 len(items) 代替。
	if len(ids) == 0 {
		return []Entity{}, nil
	}
	got, err := s.getMany(ctx, ids, u)
	if err != nil {
		return nil, err
	}
	items := make([]Entity, 0, len(ids))
	for _, id := range ids {
		if e, ok := got[id]; ok {
			items = append(items, e)
		}
	}
	return items, nil
}

// Revisions 返回某目标的修订历史。目标可以是实体，也可以是关系：
// 关系修订的 target_id 就是关系 ID 本身（见 audit / SaveRelation），
// 关系在 entities 表没有对应行，因此不能沿用实体的可见性判定。
func (s *Store) Revisions(ctx context.Context, id string, u *User) ([]map[string]any, error) {
	if _, err := uuid.Parse(id); err != nil {
		return nil, fmt.Errorf("invalid_id")
	}
	// 实体修订逐行按实体可见性过滤；关系修订的可见性改由其两端实体验证，
	// 所以需要区分本次查询的目标类型。
	entityScoped := true
	if _, err := s.Get(ctx, id, u); err != nil {
		r, rerr := relationByID(ctx, s.DB, id)
		if rerr != nil {
			return nil, err
		}
		src, serr := get(ctx, s.DB, r.SourceID)
		tgt, terr := get(ctx, s.DB, r.TargetID)
		if serr != nil || terr != nil || !visible(src, u) || !visible(tgt, u) ||
			src.Status == "deleted" || src.Status == "merged" || tgt.Status == "deleted" || tgt.Status == "merged" {
			return nil, sql.ErrNoRows
		}
		entityScoped = false
	}
	// 身份取自修订行里的快照列，**不 JOIN auth.users**：账号表归账号服务，目录侧读它
	// 就等于把两个系统的数据层重新绑在一起（也挡住了将来换库/换实例的可能）。
	// 老库迁移过来的存量行可能没有快照，回退为 system/editor，只影响显示名。
	rows, err := s.DB.QueryContext(ctx, `
		SELECT r.id, r.version, COALESCE(r.actor_id::text, ''), COALESCE(NULLIF(r.actor_name, ''), 'system'), COALESCE(NULLIF(r.actor_role, ''), 'editor'), r.edit_note, r.sources, r.snapshot, r.created_at, r.definition_version
		FROM catalog.revisions r
		WHERE r.target_id = $1
		ORDER BY r.version DESC, r.id DESC
		LIMIT 100`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var revID, version int64
		var actorID, actorName, actorRole, note string
		var sources, snapshot json.RawMessage
		var at time.Time
		var defVersion sql.NullInt64
		if err = rows.Scan(&revID, &version, &actorID, &actorName, &actorRole, &note, &sources, &snapshot, &at, &defVersion); err != nil {
			return nil, err
		}
		// 实体修订的 snapshot 是 Entity，逐行按实体可见性过滤；
		// 关系修订的 snapshot 是 Relation，授权已在查询前按两端实体完成，不再套实体判定。
		if entityScoped {
			var historical Entity
			if err = json.Unmarshal(snapshot, &historical); err != nil {
				return nil, err
			}
			if !visible(historical, u) {
				continue
			}
		}
		// definition_version：本次写入所依据的已发布定义版本（D4，四类版本之 2）；
		// 迁移前老行记 null。展示端据此追溯，不混用条目修订 version。
		var defVersionAny any
		if defVersion.Valid {
			defVersionAny = defVersion.Int64
		}
		out = append(out, map[string]any{
			"id":                 revID,
			"version":            version,
			"actor_id":           actorID,
			"actor_name":         actorName,
			"actor_role":         actorRole,
			"edit_note":          note,
			"sources":            sources,
			"snapshot":           snapshot,
			"created_at":         at,
			"definition_version": defVersionAny,
		})
	}
	return out, rows.Err()
}

// ListAll is used for bounded entity directories, which must not silently truncate at 100.
func (s *Store) ListAll(ctx context.Context, o ListOptions, u *User) ([]Entity, error) {
	out := []Entity{}
	o.Limit = 100
	for {
		items, err := s.List(ctx, o, u)
		if err != nil {
			return nil, err
		}
		out = append(out, items...)
		if len(items) < o.Limit {
			return out, nil
		}
		o.Offset += o.Limit
	}
}
