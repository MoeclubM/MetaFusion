-- 目录库的**唯一**结构来源：`mf-migrate up` 与目录服务启动（Store.Initialize）执行的都是这一份。
--
-- 收敛历史：这里曾经是 15 个版本迁移 + 一份 schema.sql 终态快照（两处各存一份结构、靠一致性测试
-- 盯着同步）。测试实例的数据不再需要保留后，历史迁移只剩"给旧库补结构"的负担，于是合并为本基线：
-- 只描述当前终态，全文件幂等（IF NOT EXISTS），且不含任何破坏性语句（启动路径也会执行它，
-- 见 TestStartupSchemaHasNoDestructiveStatements）。
--
-- 边界：只建 catalog schema 自己的对象。账号（auth）、互动（community）、存储（storage）的表由各自的
-- 服务在自己的 schema 里幂等建立；目录侧的 created_by / user_id 都是裸 UUID，不跨 schema 建外键——
-- 这是子系统拆分的一条硬边界。
CREATE SCHEMA IF NOT EXISTS catalog;

CREATE TABLE IF NOT EXISTS catalog.entities (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('agent','collection','work','content_unit','expression','release','medium','track')),
 version bigint NOT NULL CHECK(version>0), title text NOT NULL CHECK(length(trim(title))>0),
 status text NOT NULL CHECK(status IN ('draft','pending_review','published','deleted','merged')),
 created_by uuid NOT NULL, redirect_id uuid REFERENCES catalog.entities(id),
 document jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,kind)
);
CREATE INDEX IF NOT EXISTS entities_kind_status ON catalog.entities(kind,status);
CREATE INDEX IF NOT EXISTS entities_search ON catalog.entities USING gin (to_tsvector('simple',title));
CREATE INDEX IF NOT EXISTS entities_document ON catalog.entities USING gin (document jsonb_path_ops);
-- 标签按容器包含过滤（attributes.tags @> [...]）：函数索引让该查询走索引而非全表扫描。
CREATE INDEX IF NOT EXISTS entities_attribute_tags ON catalog.entities USING gin ((document->'attributes'->'tags') jsonb_path_ops);
-- 类型筛选（探索页/货架规则）用的是 jsonb 的 ? 与 ?|（数组元素存在性），
-- 而 entities_document 是 jsonb_path_ops —— 它只支持 @> / @? / @@，**用不上** ?|，
-- 十亿级下这类查询会退化成顺序扫描。这里补一个 jsonb_ops 的表达式索引（默认即是 jsonb_ops）。
CREATE INDEX IF NOT EXISTS entities_types ON catalog.entities USING gin ((document->'types'));
-- 列表页统一 ORDER BY updated_at DESC, id，且几乎都带 kind（+status）过滤。
-- 只有 (kind,status) 索引时，排序列仍要排序；这条复合索引让"最新一批"直接走索引扫描，
-- 也让后续 keyset 分页（WHERE (updated_at,id) < (...)) 有索引可用。
CREATE INDEX IF NOT EXISTS entities_recent ON catalog.entities(kind,status,updated_at DESC,id);
-- 导入幂等键唯一护栏：external_ids.metafusion_import 并发可双插（先查后建竞态）。
-- 有键行唯一，空键/无键行不受约束（手工载荷无键本就不幂等）。存量存在重复键时，
-- 建索引会失败：那属于数据问题，需先合并去重（系统未上线，重建库更省事）。
CREATE UNIQUE INDEX IF NOT EXISTS entities_metafusion_import_key
  ON catalog.entities ((document->'external_ids'->>'metafusion_import'))
  WHERE (document->'external_ids'->>'metafusion_import') IS NOT NULL
    AND (document->'external_ids'->>'metafusion_import') <> '';
CREATE TABLE IF NOT EXISTS catalog.content_units (
 id uuid PRIMARY KEY, kind text NOT NULL DEFAULT 'content_unit' CHECK(kind='content_unit'),
 work_id uuid NOT NULL, work_kind text NOT NULL DEFAULT 'work' CHECK(work_kind='work'), parent_id uuid,
 UNIQUE(id,work_id), FOREIGN KEY(id,kind) REFERENCES catalog.entities(id,kind),
 FOREIGN KEY(work_id,work_kind) REFERENCES catalog.entities(id,kind),
 FOREIGN KEY(parent_id,work_id) REFERENCES catalog.content_units(id,work_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS catalog.expressions (
 id uuid PRIMARY KEY, kind text NOT NULL DEFAULT 'expression' CHECK(kind='expression'),
 work_id uuid NOT NULL, work_kind text NOT NULL DEFAULT 'work' CHECK(work_kind='work'), content_unit_id uuid,
 FOREIGN KEY(id,kind) REFERENCES catalog.entities(id,kind), FOREIGN KEY(work_id,work_kind) REFERENCES catalog.entities(id,kind),
 FOREIGN KEY(content_unit_id,work_id) REFERENCES catalog.content_units(id,work_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS catalog.mediums (
 id uuid PRIMARY KEY, kind text NOT NULL DEFAULT 'medium' CHECK(kind='medium'),
 release_id uuid NOT NULL, release_kind text NOT NULL DEFAULT 'release' CHECK(release_kind='release'), parent_id uuid,
 UNIQUE(id,release_id), FOREIGN KEY(id,kind) REFERENCES catalog.entities(id,kind), FOREIGN KEY(release_id,release_kind) REFERENCES catalog.entities(id,kind),
 FOREIGN KEY(parent_id,release_id) REFERENCES catalog.mediums(id,release_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS catalog.tracks (
 id uuid PRIMARY KEY, kind text NOT NULL DEFAULT 'track' CHECK(kind='track'), medium_id uuid NOT NULL REFERENCES catalog.mediums(id), parent_id uuid,
 -- medium_id 故意单列引用 mediums(id) 而非 (medium_id,medium_kind) 复合引用
 -- entities(id,kind)：medium 有独立侧表，直接引用侧表主键比引用 entities 更紧
 --（侧表行缺失也能拦住）。work/release 无侧表才用复合引用，故风格不对称是
 -- 有意的，不统一。
 UNIQUE(id,medium_id), FOREIGN KEY(id,kind) REFERENCES catalog.entities(id,kind),
 FOREIGN KEY(parent_id,medium_id) REFERENCES catalog.tracks(id,medium_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS catalog.release_subjects (
 release_id uuid NOT NULL, release_kind text NOT NULL DEFAULT 'release' CHECK(release_kind='release'),
 work_id uuid NOT NULL, work_kind text NOT NULL DEFAULT 'work' CHECK(work_kind='work'), role text NOT NULL, position int NOT NULL CHECK(position>=0), attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
 PRIMARY KEY(release_id,work_id,role), FOREIGN KEY(release_id,release_kind) REFERENCES catalog.entities(id,kind), FOREIGN KEY(work_id,work_kind) REFERENCES catalog.entities(id,kind)
);
CREATE TABLE IF NOT EXISTS catalog.track_contents (
 track_id uuid NOT NULL REFERENCES catalog.tracks(id), expression_id uuid NOT NULL REFERENCES catalog.expressions(id),
 position int NOT NULL CHECK(position>=0), locator jsonb NOT NULL, attributes jsonb NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY(track_id,position)
);
CREATE INDEX IF NOT EXISTS contents_expression ON catalog.track_contents(expression_id);
CREATE TABLE IF NOT EXISTS catalog.relations (
 id uuid PRIMARY KEY, version bigint NOT NULL, type text NOT NULL, source_id uuid NOT NULL REFERENCES catalog.entities(id),
 target_id uuid NOT NULL REFERENCES catalog.entities(id), document jsonb NOT NULL, CHECK(source_id<>target_id)
);
CREATE INDEX IF NOT EXISTS relations_endpoints ON catalog.relations(source_id,target_id,type);
-- relations 去重只拦"完全重复边"（端点+类型+属性相同）：应用层
-- validateRelation 以同口径判重并处理对称边反向同义；声明式索引无法表达
-- 对称语义，故此处只做最后一道拦网。position 不计入，与应用层同口径。
-- attributes 直接比 jsonb 逻辑值（jsonb 有 btree 支持）：缺键按 'null'
-- 归一，与 validateRelation 里 encode(nil map)="null" 同口径。
-- 存量若有完全重复边，建索引会失败：属数据问题，需先手工合并去重，
-- 不得为通过迁移而删数据。
CREATE UNIQUE INDEX IF NOT EXISTS relations_no_exact_dup
 ON catalog.relations(source_id, target_id, type, (COALESCE(document->'attributes', 'null'::jsonb)));
-- 结构侧表反向索引：外键只建约束不建索引，List 的 WorkID/ReleaseID/MediumID/
-- ContentUnitID 子查询与收录归属校验此前全走全表扫描。
-- 此处与终态保持一致；表很小，无需 CONCURRENTLY。
CREATE INDEX IF NOT EXISTS content_units_work ON catalog.content_units(work_id);
CREATE INDEX IF NOT EXISTS expressions_work ON catalog.expressions(work_id);
CREATE INDEX IF NOT EXISTS expressions_content_unit ON catalog.expressions(content_unit_id);
CREATE INDEX IF NOT EXISTS mediums_release ON catalog.mediums(release_id);
CREATE INDEX IF NOT EXISTS tracks_medium ON catalog.tracks(medium_id);
CREATE INDEX IF NOT EXISTS release_subjects_work ON catalog.release_subjects(work_id);
CREATE TABLE IF NOT EXISTS catalog.definitions (
 id bigserial PRIMARY KEY, state text NOT NULL CHECK(state IN ('draft','published','superseded')),
 base_version bigint NOT NULL, document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_published_definition ON catalog.definitions(state) WHERE state='published';
-- actor_name / actor_role 是写入时的身份快照：账号数据归账号服务，目录不再『查对方的表』
-- 换显示名（跨 schema JOIN 会破坏子系统边界），改为在写修订行时把当时的用户名与角色一起落下来。
-- 这也是审计记录该有的语义：改名人之后，历史修订仍应显示当时是谁改的。
CREATE TABLE IF NOT EXISTS catalog.revisions (
 id bigserial PRIMARY KEY, target_id text NOT NULL, version bigint NOT NULL, actor_id uuid,
 actor_name text NOT NULL DEFAULT '', actor_role text NOT NULL DEFAULT '',
 edit_note text NOT NULL, sources jsonb NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog.outbox (
 id uuid PRIMARY KEY, type text NOT NULL, entity_id text NOT NULL, version bigint NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog.deliveries (
 consumer text NOT NULL, event_id uuid NOT NULL REFERENCES catalog.outbox(id), delivered_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(consumer,event_id)
);
-- The deferred trigger also guards direct SQL and concurrent reparenting.
CREATE OR REPLACE FUNCTION catalog.check_parent_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cyclic boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(740202);
 EXECUTE format('WITH RECURSIVE ancestors(id,parent_id,path,cycle) AS (
 SELECT id,parent_id,ARRAY[id],false FROM catalog.%I WHERE id=$1
 UNION ALL SELECT p.id,p.parent_id,a.path||p.id,p.id=ANY(a.path)
 FROM catalog.%I p JOIN ancestors a ON p.id=a.parent_id WHERE NOT a.cycle)
 SELECT coalesce(bool_or(cycle),false) FROM ancestors',TG_TABLE_NAME,TG_TABLE_NAME) INTO cyclic USING NEW.id;
 IF cyclic THEN RAISE EXCEPTION 'catalog hierarchy cycle' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['content_units','mediums','tracks'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=t||'_cycle') THEN
 EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE ON catalog.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION catalog.check_parent_cycle()',t||'_cycle',t);
 END IF;
 END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS catalog.external_databases (
 code text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{2,64}$'),
 names jsonb NOT NULL DEFAULT '{}',
 category text NOT NULL DEFAULT 'all'
  CHECK (category IN ('all','agent','collection','work','content_unit','expression','release','medium','track')),
 url_pattern text NOT NULL CHECK (length(trim(url_pattern))>0),
 icon text NOT NULL DEFAULT 'Globe',
 icon_url text NOT NULL DEFAULT '',
 validation_regex text NOT NULL DEFAULT '',
 description text NOT NULL DEFAULT '',
 sort_order int NOT NULL DEFAULT 0,
 is_enabled boolean NOT NULL DEFAULT true,
 is_system boolean NOT NULL DEFAULT false
);

-- 首页货架与探索页共用的聚合规则：前后端共用同一规则，不再各自硬编码。
-- query 为收录规则（types/fields/vocab_terms/relations，AND 语义）；
-- sort/icon/enabled 描述展示方式。names 为四语名称映射（zh-CN/en-US/zh-TW/ja-JP）。
CREATE TABLE IF NOT EXISTS catalog.shelves (
 id bigserial PRIMARY KEY,
 slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
 names jsonb NOT NULL DEFAULT '{}',
 query jsonb NOT NULL DEFAULT '{}',
 sort text NOT NULL DEFAULT 'updated',
 icon text NOT NULL DEFAULT '',
 is_enabled boolean NOT NULL DEFAULT true,
 sort_order int NOT NULL DEFAULT 0
);

ALTER TABLE catalog.track_contents ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE catalog.release_subjects ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 用户首页推荐偏好：展示顺序与隐藏项，内容仍由 catalog.shelves 规则驱动。
CREATE TABLE IF NOT EXISTS catalog.user_preferences (
 user_id uuid PRIMARY KEY,
 home_shelves jsonb NOT NULL DEFAULT '{}'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);

-- 本文件只做"按需建表/建索引"：全部语句幂等（IF NOT EXISTS），不含删列、删表或数据搬迁，
-- 因此 `mf-migrate up` 与目录服务启动都可以安全地反复执行它。
-- 需要一次性数据搬迁时另开一条迁移，不要把破坏性语句写进这里。

-- 建表顺序无关紧要：本文件没有指向 auth.* / community.* / storage.* 的外键。
-- 目录侧的 created_by / user_id 都是裸 UUID——收藏归 community.favorites，账号归 auth.users。

-- 关系属性里的实体引用（character / context / store 等）需要按值反查：
-- 例如角色 C 不是配音关系的端点，而是 character 属性的取值；
-- 没有这个索引，查「谁为这个角色配音、在哪些作品里」只能顺序扫描整张关系表。
CREATE INDEX IF NOT EXISTS relations_document_attributes_gin
    ON catalog.relations USING gin ((document->'attributes'));
