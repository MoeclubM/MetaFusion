-- Catalog installation baseline at the completed 000020 boundary.
-- Existing verified ledgers are preserved and this DDL is not replayed.
CREATE SCHEMA IF NOT EXISTS catalog;

CREATE FUNCTION catalog.check_parent_cycle() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
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
END $_$;

CREATE TABLE catalog.api_request_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid NOT NULL,
    credential_type text NOT NULL,
    credential_name text DEFAULT ''::text NOT NULL,
    method text NOT NULL,
    route text NOT NULL,
    status integer DEFAULT 0 NOT NULL,
    ms integer DEFAULT 0 NOT NULL
);

CREATE TABLE catalog.content_units (
    id uuid NOT NULL,
    kind text DEFAULT 'content_unit'::text NOT NULL,
    work_id uuid NOT NULL,
    work_kind text DEFAULT 'work'::text NOT NULL,
    parent_id uuid,
    CONSTRAINT content_units_kind_check CHECK ((kind = 'content_unit'::text)),
    CONSTRAINT content_units_work_kind_check CHECK ((work_kind = 'work'::text))
);

CREATE TABLE catalog.definition_config (
    singleton boolean DEFAULT true NOT NULL,
    document jsonb NOT NULL,
    etag text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT definition_config_singleton_check CHECK (singleton)
);

CREATE TABLE catalog.deliveries (
    consumer text NOT NULL,
    event_id uuid NOT NULL
);

CREATE TABLE catalog.entities (
    id uuid NOT NULL,
    kind text NOT NULL,
    version bigint NOT NULL,
    title text NOT NULL,
    status text NOT NULL,
    created_by uuid NOT NULL,
    document jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entities_kind_check CHECK ((kind = ANY (ARRAY['agent'::text, 'collection'::text, 'work'::text, 'content_unit'::text, 'expression'::text, 'release'::text, 'medium'::text, 'track'::text]))),
    CONSTRAINT entities_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending_review'::text, 'published'::text, 'deleted'::text, 'merged'::text]))),
    CONSTRAINT entities_title_check CHECK ((length(TRIM(BOTH FROM title)) > 0)),
    CONSTRAINT entities_version_check CHECK ((version > 0))
);

CREATE TABLE catalog.expressions (
    id uuid NOT NULL,
    kind text DEFAULT 'expression'::text NOT NULL,
    work_id uuid NOT NULL,
    work_kind text DEFAULT 'work'::text NOT NULL,
    content_unit_id uuid,
    CONSTRAINT expressions_kind_check CHECK ((kind = 'expression'::text)),
    CONSTRAINT expressions_work_kind_check CHECK ((work_kind = 'work'::text))
);

CREATE TABLE catalog.external_databases (
    code text NOT NULL,
    names jsonb DEFAULT '{}'::jsonb NOT NULL,
    category text DEFAULT 'all'::text NOT NULL,
    url_pattern text NOT NULL,
    icon text DEFAULT 'Globe'::text NOT NULL,
    icon_url text DEFAULT ''::text NOT NULL,
    validation_regex text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    CONSTRAINT external_databases_category_check CHECK ((category = ANY (ARRAY['all'::text, 'agent'::text, 'collection'::text, 'work'::text, 'content_unit'::text, 'expression'::text, 'release'::text, 'medium'::text, 'track'::text]))),
    CONSTRAINT external_databases_code_check CHECK ((code ~ '^[a-z0-9_]{2,64}$'::text)),
    CONSTRAINT external_databases_url_pattern_check CHECK ((length(TRIM(BOTH FROM url_pattern)) > 0))
);

CREATE TABLE catalog.idempotency_keys (
    operation text NOT NULL,
    user_id uuid NOT NULL,
    request_key text NOT NULL,
    request_hash text NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE catalog.mediums (
    id uuid NOT NULL,
    kind text DEFAULT 'medium'::text NOT NULL,
    release_id uuid NOT NULL,
    release_kind text DEFAULT 'release'::text NOT NULL,
    parent_id uuid,
    CONSTRAINT mediums_kind_check CHECK ((kind = 'medium'::text)),
    CONSTRAINT mediums_release_kind_check CHECK ((release_kind = 'release'::text))
);

CREATE TABLE catalog.notification_receipts (
    recipient_id uuid NOT NULL,
    event_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE catalog.notifications (
    id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    type text NOT NULL,
    actor_id uuid,
    actor_name text DEFAULT ''::text NOT NULL,
    subject_type text DEFAULT ''::text NOT NULL,
    subject_id text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    dedupe_key text NOT NULL,
    last_event_id text DEFAULT ''::text NOT NULL,
    count integer DEFAULT 1 NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_count_check CHECK ((count > 0)),
    CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['comment.replied'::text, 'entity.included'::text, 'entity.review_approved'::text, 'entity.review_rejected'::text, 'import.completed'::text])))
);

CREATE TABLE catalog.outbox (
    id uuid NOT NULL,
    type text NOT NULL,
    entity_id text NOT NULL,
    version bigint NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE catalog.rate_limit_policy (
    singleton boolean DEFAULT true NOT NULL,
    document jsonb NOT NULL,
    etag text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rate_limit_policy_singleton_check CHECK (singleton)
);

CREATE TABLE catalog.relations (
    id uuid NOT NULL,
    version bigint NOT NULL,
    type text NOT NULL,
    source_id uuid NOT NULL,
    target_id uuid NOT NULL,
    document jsonb NOT NULL,
    CONSTRAINT relations_check CHECK ((source_id <> target_id))
);

CREATE TABLE catalog.release_subjects (
    release_id uuid NOT NULL,
    release_kind text DEFAULT 'release'::text NOT NULL,
    work_id uuid NOT NULL,
    work_kind text DEFAULT 'work'::text NOT NULL,
    role text NOT NULL,
    "position" integer NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT release_subjects_position_check CHECK (("position" >= 0)),
    CONSTRAINT release_subjects_release_kind_check CHECK ((release_kind = 'release'::text)),
    CONSTRAINT release_subjects_work_kind_check CHECK ((work_kind = 'work'::text))
);

CREATE SEQUENCE catalog.revisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE catalog.revisions (
    id bigint DEFAULT nextval('catalog.revisions_id_seq'::regclass) NOT NULL,
    target_id text NOT NULL,
    version bigint NOT NULL,
    actor_id uuid,
    actor_name text DEFAULT ''::text NOT NULL,
    edit_note text NOT NULL,
    sources jsonb NOT NULL,
    snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



ALTER SEQUENCE catalog.revisions_id_seq OWNED BY catalog.revisions.id;

CREATE SEQUENCE catalog.shelves_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE catalog.shelves (
    id bigint DEFAULT nextval('catalog.shelves_id_seq'::regclass) NOT NULL,
    slug text NOT NULL,
    names jsonb DEFAULT '{}'::jsonb NOT NULL,
    query jsonb DEFAULT '{}'::jsonb NOT NULL,
    sort text DEFAULT 'updated'::text NOT NULL,
    icon text DEFAULT ''::text NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT shelves_slug_check CHECK ((slug ~ '^[a-z0-9][a-z0-9_-]{1,63}$'::text))
);



ALTER SEQUENCE catalog.shelves_id_seq OWNED BY catalog.shelves.id;

CREATE TABLE catalog.track_contents (
    track_id uuid NOT NULL,
    expression_id uuid NOT NULL,
    "position" integer NOT NULL,
    locator jsonb NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    sources jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT track_contents_position_check CHECK (("position" >= 0)),
    CONSTRAINT track_contents_sources_array CHECK ((jsonb_typeof(sources) = 'array'::text))
);

CREATE TABLE catalog.tracks (
    id uuid NOT NULL,
    kind text DEFAULT 'track'::text NOT NULL,
    medium_id uuid NOT NULL,
    parent_id uuid,
    CONSTRAINT tracks_kind_check CHECK ((kind = 'track'::text))
);

CREATE TABLE catalog.user_preferences (
    user_id uuid NOT NULL,
    home_shelves jsonb DEFAULT '{}'::jsonb NOT NULL
);





ALTER TABLE ONLY catalog.api_request_logs
    ADD CONSTRAINT api_request_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY catalog.content_units
    ADD CONSTRAINT content_units_id_work_id_key UNIQUE (id, work_id);

ALTER TABLE ONLY catalog.content_units
    ADD CONSTRAINT content_units_pkey PRIMARY KEY (id);

ALTER TABLE ONLY catalog.definition_config
    ADD CONSTRAINT definition_config_pkey PRIMARY KEY (singleton);

ALTER TABLE ONLY catalog.deliveries
    ADD CONSTRAINT deliveries_pkey PRIMARY KEY (consumer, event_id);

ALTER TABLE ONLY catalog.entities
    ADD CONSTRAINT entities_id_kind_key UNIQUE (id, kind);

ALTER TABLE ONLY catalog.entities
    ADD CONSTRAINT entities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY catalog.expressions
    ADD CONSTRAINT expressions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY catalog.external_databases
    ADD CONSTRAINT external_databases_pkey PRIMARY KEY (code);

ALTER TABLE ONLY catalog.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (operation, user_id, request_key);

ALTER TABLE ONLY catalog.mediums
    ADD CONSTRAINT mediums_id_release_id_key UNIQUE (id, release_id);

ALTER TABLE ONLY catalog.mediums
    ADD CONSTRAINT mediums_pkey PRIMARY KEY (id);

ALTER TABLE ONLY catalog.notification_receipts
    ADD CONSTRAINT notification_receipts_pkey PRIMARY KEY (recipient_id, event_id);

ALTER TABLE ONLY catalog.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY catalog.outbox
    ADD CONSTRAINT outbox_pkey PRIMARY KEY (id);

ALTER TABLE ONLY catalog.rate_limit_policy
    ADD CONSTRAINT rate_limit_policy_pkey PRIMARY KEY (singleton);

ALTER TABLE ONLY catalog.relations
    ADD CONSTRAINT relations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY catalog.release_subjects
    ADD CONSTRAINT release_subjects_pkey PRIMARY KEY (release_id, work_id, role);

ALTER TABLE ONLY catalog.revisions
    ADD CONSTRAINT revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY catalog.shelves
    ADD CONSTRAINT shelves_pkey PRIMARY KEY (id);

ALTER TABLE ONLY catalog.shelves
    ADD CONSTRAINT shelves_slug_key UNIQUE (slug);

ALTER TABLE ONLY catalog.track_contents
    ADD CONSTRAINT track_contents_pkey PRIMARY KEY (track_id, "position");

ALTER TABLE ONLY catalog.tracks
    ADD CONSTRAINT tracks_id_medium_id_key UNIQUE (id, medium_id);

ALTER TABLE ONLY catalog.tracks
    ADD CONSTRAINT tracks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY catalog.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);

CREATE INDEX api_request_logs_user_at ON catalog.api_request_logs USING btree (user_id, at DESC);

CREATE INDEX content_units_work ON catalog.content_units USING btree (work_id);

CREATE INDEX contents_expression ON catalog.track_contents USING btree (expression_id);

CREATE INDEX entities_attribute_tags ON catalog.entities USING gin ((((document -> 'attributes'::text) -> 'tags'::text)) jsonb_path_ops);

CREATE INDEX entities_kind_status ON catalog.entities USING btree (kind, status);

CREATE UNIQUE INDEX entities_metafusion_import_key ON catalog.entities USING btree ((((document -> 'external_ids'::text) ->> 'metafusion_import'::text))) WHERE ((((document -> 'external_ids'::text) ->> 'metafusion_import'::text) IS NOT NULL) AND (((document -> 'external_ids'::text) ->> 'metafusion_import'::text) <> ''::text));

CREATE INDEX entities_recent ON catalog.entities USING btree (kind, status, updated_at DESC, id);

CREATE INDEX entities_redirect_lookup ON catalog.entities USING btree (((document ->> 'redirect_id'::text))) WHERE (status = 'merged'::text);

CREATE INDEX expressions_content_unit ON catalog.expressions USING btree (content_unit_id);

CREATE INDEX expressions_work ON catalog.expressions USING btree (work_id);

CREATE INDEX mediums_release ON catalog.mediums USING btree (release_id);

CREATE UNIQUE INDEX notifications_aggregate ON catalog.notifications USING btree (recipient_id, dedupe_key);

CREATE INDEX notifications_inbox ON catalog.notifications USING btree (recipient_id, updated_at DESC, id DESC);

CREATE INDEX notifications_unread ON catalog.notifications USING btree (recipient_id, updated_at DESC) WHERE (read_at IS NULL);

CREATE INDEX outbox_entity_created_id ON catalog.outbox USING btree (created_at, id) WHERE (type ~~ 'entity.%'::text);

CREATE INDEX relations_document_attributes_gin ON catalog.relations USING gin (((document -> 'attributes'::text)));

CREATE INDEX relations_endpoints ON catalog.relations USING btree (source_id, target_id, type);

CREATE UNIQUE INDEX relations_no_exact_dup ON catalog.relations USING btree (source_id, target_id, type, COALESCE((document -> 'attributes'::text), 'null'::jsonb));

CREATE INDEX relations_rule_scope ON catalog.relations USING btree (type, source_id, target_id);

CREATE INDEX relations_target_lookup ON catalog.relations USING btree (target_id, id);

CREATE INDEX relations_target_rule ON catalog.relations USING btree (target_id, type, source_id);

CREATE INDEX relations_type_listing ON catalog.relations USING btree (type, id);

CREATE INDEX release_subjects_work ON catalog.release_subjects USING btree (work_id);

CREATE INDEX tracks_medium ON catalog.tracks USING btree (medium_id);

CREATE CONSTRAINT TRIGGER content_units_cycle AFTER INSERT OR UPDATE ON catalog.content_units DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION catalog.check_parent_cycle();

CREATE CONSTRAINT TRIGGER mediums_cycle AFTER INSERT OR UPDATE ON catalog.mediums DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION catalog.check_parent_cycle();

CREATE CONSTRAINT TRIGGER tracks_cycle AFTER INSERT OR UPDATE ON catalog.tracks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION catalog.check_parent_cycle();

ALTER TABLE ONLY catalog.content_units
    ADD CONSTRAINT content_units_id_kind_fkey FOREIGN KEY (id, kind) REFERENCES catalog.entities(id, kind);

ALTER TABLE ONLY catalog.content_units
    ADD CONSTRAINT content_units_parent_id_work_id_fkey FOREIGN KEY (parent_id, work_id) REFERENCES catalog.content_units(id, work_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY catalog.content_units
    ADD CONSTRAINT content_units_work_id_work_kind_fkey FOREIGN KEY (work_id, work_kind) REFERENCES catalog.entities(id, kind);

ALTER TABLE ONLY catalog.deliveries
    ADD CONSTRAINT deliveries_event_id_fkey FOREIGN KEY (event_id) REFERENCES catalog.outbox(id);

ALTER TABLE ONLY catalog.expressions
    ADD CONSTRAINT expressions_content_unit_id_work_id_fkey FOREIGN KEY (content_unit_id, work_id) REFERENCES catalog.content_units(id, work_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY catalog.expressions
    ADD CONSTRAINT expressions_id_kind_fkey FOREIGN KEY (id, kind) REFERENCES catalog.entities(id, kind);

ALTER TABLE ONLY catalog.expressions
    ADD CONSTRAINT expressions_work_id_work_kind_fkey FOREIGN KEY (work_id, work_kind) REFERENCES catalog.entities(id, kind);

ALTER TABLE ONLY catalog.mediums
    ADD CONSTRAINT mediums_id_kind_fkey FOREIGN KEY (id, kind) REFERENCES catalog.entities(id, kind);

ALTER TABLE ONLY catalog.mediums
    ADD CONSTRAINT mediums_parent_id_release_id_fkey FOREIGN KEY (parent_id, release_id) REFERENCES catalog.mediums(id, release_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY catalog.mediums
    ADD CONSTRAINT mediums_release_id_release_kind_fkey FOREIGN KEY (release_id, release_kind) REFERENCES catalog.entities(id, kind);

ALTER TABLE ONLY catalog.relations
    ADD CONSTRAINT relations_source_id_fkey FOREIGN KEY (source_id) REFERENCES catalog.entities(id);

ALTER TABLE ONLY catalog.relations
    ADD CONSTRAINT relations_target_id_fkey FOREIGN KEY (target_id) REFERENCES catalog.entities(id);

ALTER TABLE ONLY catalog.release_subjects
    ADD CONSTRAINT release_subjects_release_id_release_kind_fkey FOREIGN KEY (release_id, release_kind) REFERENCES catalog.entities(id, kind);

ALTER TABLE ONLY catalog.release_subjects
    ADD CONSTRAINT release_subjects_work_id_work_kind_fkey FOREIGN KEY (work_id, work_kind) REFERENCES catalog.entities(id, kind);

ALTER TABLE ONLY catalog.track_contents
    ADD CONSTRAINT track_contents_expression_id_fkey FOREIGN KEY (expression_id) REFERENCES catalog.expressions(id);

ALTER TABLE ONLY catalog.track_contents
    ADD CONSTRAINT track_contents_track_id_fkey FOREIGN KEY (track_id) REFERENCES catalog.tracks(id);

ALTER TABLE ONLY catalog.tracks
    ADD CONSTRAINT tracks_id_kind_fkey FOREIGN KEY (id, kind) REFERENCES catalog.entities(id, kind);

ALTER TABLE ONLY catalog.tracks
    ADD CONSTRAINT tracks_medium_id_fkey FOREIGN KEY (medium_id) REFERENCES catalog.mediums(id);

ALTER TABLE ONLY catalog.tracks
    ADD CONSTRAINT tracks_parent_id_medium_id_fkey FOREIGN KEY (parent_id, medium_id) REFERENCES catalog.tracks(id, medium_id) DEFERRABLE INITIALLY DEFERRED;

INSERT INTO catalog.rate_limit_policy(singleton, document, etag, updated_at)
VALUES (true, '{}'::jsonb, gen_random_uuid()::text, now());

-- >>> audit-ddl begin
DO $audit_ddl$
BEGIN
  PERFORM pg_advisory_xact_lock(740205);
  IF to_regclass('audit.audit_log') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS audit;
    CREATE TABLE audit.audit_log (
      id               uuid PRIMARY KEY,
      occurred_at      timestamptz NOT NULL DEFAULT now(),
      service          text NOT NULL,
      action           text NOT NULL,
      actor_user_id    uuid,
      actor_username   text NOT NULL DEFAULT '',
      credential_type  text NOT NULL DEFAULT '',
      actor_ip         text NOT NULL DEFAULT '',
      actor_user_agent text NOT NULL DEFAULT '',
      target_type      text NOT NULL DEFAULT '',
      target_id        text NOT NULL DEFAULT '',
      changes          jsonb NOT NULL DEFAULT '{}'::jsonb,
      result           text NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure')),
      error_code       text NOT NULL DEFAULT '',
      request_method   text NOT NULL DEFAULT '',
      route            text NOT NULL DEFAULT '',
      http_status      int NOT NULL DEFAULT 0,
      request_id       text NOT NULL DEFAULT ''
    );
    CREATE INDEX audit_log_occurred_at_idx ON audit.audit_log(occurred_at DESC);
    CREATE INDEX audit_log_service_action_idx ON audit.audit_log(service, action, occurred_at DESC);
    CREATE INDEX audit_log_actor_idx ON audit.audit_log(actor_user_id, occurred_at DESC);
    CREATE INDEX audit_log_target_idx ON audit.audit_log(target_type, target_id, occurred_at DESC);
  END IF;
END
$audit_ddl$;
-- <<< audit-ddl end
