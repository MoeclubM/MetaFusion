package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io/fs"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"

	"github.com/metafusion/metafusion-app/migrations"
)

// baseline 是目录库的结构来源：与 `mf-migrate up` 执行的是**同一份文件**（迁移 000001）。
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

type Store struct {
	DB *sql.DB
	// Verifier 是账号服务令牌的验签器（只有公钥）。为 nil 或未配置密钥时，
	// 需要身份的接口按匿名处理——目录不再有"查库兜底"这条路径。
	Verifier *TokenVerifier
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

// Initialize touches only the new schema. Existing catalog and module data are untouched.
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
		// 只判空表：逐行种子无需全表计数。
		var seeded bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM catalog.definitions)").Scan(&seeded); err != nil {
			return err
		}
		if !seeded {
			d := Defaults()
			if err := d.Validate(); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO catalog.definitions(state,base_version,document) VALUES('published',0,$1)", encode(d)); err != nil {
				return err
			}
		}
		// 已迁到账号服务（auth store 的 Init 幂等播种）：auth schema 不归目录服务所有，
		// 目录侧不再往里面写任何一行。
		if err := seedExternalDatabases(ctx, tx); err != nil {
			return err
		}
		if err := seedShelves(ctx, tx); err != nil {
			return err
		}
		return nil
	}); err != nil {
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
func audit(ctx context.Context, tx *sql.Tx, id string, version int64, u User, note string, sources []Source, snapshot any, eventType string) error {
	// actor_name/actor_role 与 actor_id 一起落库：读取修订历史不再需要 JOIN auth.users
	// （账号表归账号服务，跨 schema 读会让两个系统在数据层重新耦合）。
	if _, err := tx.ExecContext(ctx, "INSERT INTO catalog.revisions(target_id,version,actor_id,actor_name,actor_role,edit_note,sources,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", id, version, u.ID, u.Username, u.Role, note, encode(sources), encode(snapshot)); err != nil {
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
		v, err := definitions(ctx, tx)
		if err != nil {
			return err
		}
		var old Entity
		if e.ID == "" {
			if input.ExpectedVersion != 0 {
				return fmt.Errorf("version_conflict")
			}
			e.ID = newID()
			e.Version = 1
			e.CreatedBy = u.ID
		} else {
			old, err = get(ctx, tx, e.ID)
			if err != nil {
				return err
			}
			if !visible(old, &u) || old.Status == "deleted" || old.Status == "merged" {
				return fmt.Errorf("forbidden")
			}
			if old.Version != input.ExpectedVersion {
				return fmt.Errorf("version_conflict")
			}
			if old.Kind != e.Kind || old.WorkID != e.WorkID || old.ReleaseID != e.ReleaseID || old.MediumID != e.MediumID {
				return fmt.Errorf("immutable_scope")
			}
			e.CreatedBy = old.CreatedBy
			e.Version = old.Version + 1
		}
		if !u.Can(PermissionLifecycleManage) {
			if old.ID != "" && !canEditEntity(u, old) {
				return fmt.Errorf("forbidden")
			}
			// 无实体编辑权者走审核制：只能存草稿或提交审核，不能发布，也不可触碰已发布条目。
			if !u.Can(PermissionEntityEdit) {
				if old.Status == "published" {
					return fmt.Errorf("forbidden")
				}
				if e.Status != "draft" && e.Status != "pending_review" {
					return fmt.Errorf("forbidden")
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
		// 展示无回退依据。validateEntity 统一 historical=true（存量/impact 宽容），
		// 此处显式拦截——只影响本次写入，不追溯存量。
		if e.Status == "published" && len(e.Translations) == 0 {
			return fmt.Errorf("translation_required")
		}
		if err = v.Document.validateEntity(e, ref, true); err != nil {
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
		_, err = tx.ExecContext(ctx, `INSERT INTO catalog.entities(id,kind,version,title,status,created_by,document,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,title=EXCLUDED.title,status=EXCLUDED.status,document=EXCLUDED.document,updated_at=EXCLUDED.updated_at`, e.ID, e.Kind, e.Version, e.Title, e.Status, e.CreatedBy, encode(stored), e.UpdatedAt)
		if err != nil {
			return err
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
		return audit(ctx, tx, e.ID, e.Version, u, input.EditNote, input.Sources, e, "entity.saved")
	})
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
	Tags          []string
	Offset, Limit int
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
	if o.Query != "" {
		// 翻译搜索走 (document->'translations')::text ILIKE：整 JSON 转文本匹配，
		// 无索引支撑，大库上是顺序扫描。这是刻意的最小口径——精确的多语言标题
		// 检索应走专用全文/三元组索引（三期），此处保留"能搜到"的降级语义，
		// 不为单个 LIKE 建昂贵的表达式索引。title 列有 entities_search GIN。
		add("(title ILIKE $%[1]d OR (document->'translations')::text ILIKE $%[1]d)", "%"+o.Query+"%")
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
	args = append(args, o.Limit, o.Offset)
	orderClause := "updated_at DESC, id"
	if o.ReleaseID != "" || o.MediumID != "" || o.ParentID != "" || o.ContentUnitID != "" {
		// 结构子项按 position 排序：Go 落库恒为数字（types.go Position int），
		// 正则守卫只防直接 SQL 写入的脏串（PG 无 TRY_CAST，裸 ::int 会报 22P02
		// 导致整页 500；脏串按 0 排而不中断列表）。
		orderClause = "CASE WHEN document->>'position' ~ '^-?[0-9]+$' THEN (document->>'position')::int ELSE 0 END, updated_at DESC, id"
	}
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
		SELECT r.id, r.version, COALESCE(r.actor_id::text, ''), COALESCE(NULLIF(r.actor_name, ''), 'system'), COALESCE(NULLIF(r.actor_role, ''), 'editor'), r.edit_note, r.sources, r.snapshot, r.created_at
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
		if err = rows.Scan(&revID, &version, &actorID, &actorName, &actorRole, &note, &sources, &snapshot, &at); err != nil {
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
		out = append(out, map[string]any{
			"id":         revID,
			"version":    version,
			"actor_id":   actorID,
			"actor_name": actorName,
			"actor_role": actorRole,
			"edit_note":  note,
			"sources":    sources,
			"snapshot":   snapshot,
			"created_at": at,
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
