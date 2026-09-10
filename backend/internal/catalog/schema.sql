CREATE SCHEMA IF NOT EXISTS catalog;
CREATE TABLE IF NOT EXISTS catalog.users (
 id uuid PRIMARY KEY, username text NOT NULL UNIQUE, email text NOT NULL DEFAULT '', password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('editor','admin'))
);
ALTER TABLE catalog.users ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS catalog.sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES catalog.users(id), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog.entities (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('agent','collection','work','content_unit','expression','release','medium','track')),
 version bigint NOT NULL CHECK(version>0), title text NOT NULL CHECK(length(trim(title))>0),
 status text NOT NULL CHECK(status IN ('draft','pending_review','published','deleted','merged')),
 created_by uuid NOT NULL REFERENCES catalog.users(id), redirect_id uuid REFERENCES catalog.entities(id),
 document jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,kind)
);
CREATE INDEX IF NOT EXISTS entities_kind_status ON catalog.entities(kind,status);
CREATE INDEX IF NOT EXISTS entities_search ON catalog.entities USING gin (to_tsvector('simple',title));
CREATE INDEX IF NOT EXISTS entities_document ON catalog.entities USING gin (document jsonb_path_ops);
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
CREATE TABLE IF NOT EXISTS catalog.definitions (
 id bigserial PRIMARY KEY, state text NOT NULL CHECK(state IN ('draft','published','superseded')),
 base_version bigint NOT NULL, document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_published_definition ON catalog.definitions(state) WHERE state='published';
CREATE TABLE IF NOT EXISTS catalog.revisions (
 id bigserial PRIMARY KEY, target_id text NOT NULL, version bigint NOT NULL, actor_id uuid REFERENCES catalog.users(id),
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
 name_zh text NOT NULL CHECK (length(trim(name_zh))>0),
 name_en text NOT NULL DEFAULT '',
 names jsonb NOT NULL DEFAULT '{}',
 category text NOT NULL DEFAULT 'all',
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
-- sort/icon/enabled 描述展示方式。names 走四语 map，name_zh/name_en 仅作回退。
CREATE TABLE IF NOT EXISTS catalog.shelves (
 id bigserial PRIMARY KEY,
 slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
 names jsonb NOT NULL DEFAULT '{}',
 name_zh text NOT NULL DEFAULT '',
 name_en text NOT NULL DEFAULT '',
 query jsonb NOT NULL DEFAULT '{}',
 sort text NOT NULL DEFAULT 'updated',
 icon text NOT NULL DEFAULT '',
 is_enabled boolean NOT NULL DEFAULT true,
 sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS catalog.oauth_clients (
 id text PRIMARY KEY, secret_hash text NOT NULL, name text NOT NULL,
 redirect_uris text[] NOT NULL DEFAULT '{}', trusted boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog.oauth_codes (
 code text PRIMARY KEY, client_id text NOT NULL REFERENCES catalog.oauth_clients(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES catalog.users(id) ON DELETE CASCADE,
 redirect_uri text NOT NULL, scope text NOT NULL DEFAULT 'profile',
 expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS catalog.oauth_tokens (
 token_hash text PRIMARY KEY, client_id text NOT NULL REFERENCES catalog.oauth_clients(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES catalog.users(id) ON DELETE CASCADE,
 scope text NOT NULL DEFAULT 'profile', expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog.favorites (
 user_id uuid NOT NULL REFERENCES catalog.users(id) ON DELETE CASCADE,
 target_type text NOT NULL CHECK (target_type IN ('work','release','artist','franchise','canonical_entry')),
 target_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS favorites_target ON catalog.favorites(target_type, target_id);
CREATE INDEX IF NOT EXISTS favorites_user_created ON catalog.favorites(user_id, created_at DESC);

ALTER TABLE catalog.track_contents ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE catalog.release_subjects ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
