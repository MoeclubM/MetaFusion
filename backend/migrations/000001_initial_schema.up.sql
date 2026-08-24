-- ==============================================================================
-- 000001_initial_schema.up.sql
-- MetaFusion Production Baseline Schema
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- 1. 枚举与基础类型
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('guest', 'member', 'archivist', 'admin', 'banned');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transcode_status') THEN
        CREATE TYPE transcode_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'skipped');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_role') THEN
        CREATE TYPE file_role AS ENUM ('master_archive', 'preview_stream', 'waveform_json', 'thumbnail', 'subtitle', 'cue_sheet', 'log_file');
    END IF;
END $$;

-- 2. 用户与认证
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(64) UNIQUE NOT NULL,
    display_name VARCHAR(128),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role DEFAULT 'member' NOT NULL,
    invite_code VARCHAR(64) UNIQUE,
    invites_remaining INT DEFAULT 2 NOT NULL,
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    avatar_url VARCHAR(512),
    bio TEXT,
    favorites_public BOOLEAN DEFAULT TRUE NOT NULL,
    email_public BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) UNIQUE NOT NULL,
    inviter_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    used_by UUID REFERENCES users(id) ON DELETE SET NULL,
    is_used BOOLEAN DEFAULT FALSE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(64) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    prefix VARCHAR(12) NOT NULL,
    scopes TEXT[] DEFAULT '{read}' NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    target_type VARCHAR(16) NOT NULL,
    target_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uni_fav_user_target UNIQUE (user_id, target_type, target_id)
);

-- 3. 动态形态、本体定义与标签体系
CREATE TABLE IF NOT EXISTS entity_type_definitions (
    code VARCHAR(32) PRIMARY KEY,
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) NOT NULL,
    names JSONB DEFAULT '{}'::jsonb NOT NULL,
    description TEXT,
    icon VARCHAR(64) DEFAULT 'Folder' NOT NULL,
    color VARCHAR(32) DEFAULT 'emerald' NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    is_system BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS media_types (
    code VARCHAR(32) PRIMARY KEY,
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) NOT NULL,
    names JSONB DEFAULT '{}'::jsonb NOT NULL,
    description TEXT,
    icon VARCHAR(64) DEFAULT 'Folder' NOT NULL,
    color VARCHAR(32) DEFAULT 'emerald' NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    is_system BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(64) UNIQUE NOT NULL,
    display_names JSONB DEFAULT '{}'::jsonb NOT NULL,
    category VARCHAR(32) DEFAULT 'genre' NOT NULL,
    description TEXT,
    is_official BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS virtual_shelves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    names JSONB DEFAULT '{}'::jsonb NOT NULL,
    description TEXT,
    descriptions JSONB DEFAULT '{}'::jsonb NOT NULL,
    icon VARCHAR(64) DEFAULT 'BookOpen' NOT NULL,
    color VARCHAR(32) DEFAULT 'emerald' NOT NULL,
    filter_tags TEXT[] DEFAULT '{}' NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_system BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS user_custom_shelves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    slug VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    names JSONB DEFAULT '{}'::jsonb NOT NULL,
    description TEXT,
    descriptions JSONB DEFAULT '{}'::jsonb NOT NULL,
    icon VARCHAR(64) DEFAULT 'Bookmark' NOT NULL,
    color VARCHAR(32) DEFAULT 'emerald' NOT NULL,
    filter_tags TEXT[] DEFAULT '{}' NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_pinned BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uni_user_shelf_slug UNIQUE (owner_id, slug)
);

-- 4. 艺术家与企划
CREATE TABLE IF NOT EXISTS artists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    disambiguation VARCHAR(255),
    type VARCHAR(32) DEFAULT 'person' NOT NULL,
    entity_type VARCHAR(32) DEFAULT 'person' NOT NULL,
    language VARCHAR(16) DEFAULT 'zh-CN' NOT NULL,
    begin_date VARCHAR(32),
    end_date VARCHAR(32),
    area VARCHAR(64),
    biography TEXT,
    avatar_url VARCHAR(512),
    external_ids JSONB DEFAULT '{}'::jsonb NOT NULL,
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS franchises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    original_title VARCHAR(255) DEFAULT '' NOT NULL,
    summary TEXT,
    language VARCHAR(16) DEFAULT 'zh-CN' NOT NULL,
    avatar_url VARCHAR(512) DEFAULT '' NOT NULL,
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 5. LRM 编目模型：Work -> Release -> Medium -> Track / CanonicalEntry
CREATE TABLE IF NOT EXISTS works (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    original_title VARCHAR(255) DEFAULT '' NOT NULL,
    category_code VARCHAR(32) DEFAULT '',
    disambiguation VARCHAR(255),
    summary TEXT,
    cover_aspect VARCHAR(8) DEFAULT '' NOT NULL,
    original_language VARCHAR(16) DEFAULT 'ja-JP' NOT NULL,
    tags TEXT[] DEFAULT '{}' NOT NULL,
    external_ids JSONB DEFAULT '{}'::jsonb NOT NULL,
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID REFERENCES works(id) ON DELETE CASCADE NOT NULL,
    title VARCHAR(255) NOT NULL,
    disambiguation VARCHAR(255),
    release_date VARCHAR(32),
    country VARCHAR(64) DEFAULT '',
    language VARCHAR(64) DEFAULT '',
    barcode VARCHAR(64),
    catalog_number VARCHAR(64),
    distribution_channel VARCHAR(32) DEFAULT 'mixed' NOT NULL,
    cover_url VARCHAR(512),
    status VARCHAR(32) DEFAULT 'official' NOT NULL,
    catalog_metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    external_ids JSONB DEFAULT '{}'::jsonb NOT NULL,
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS mediums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id UUID REFERENCES releases(id) ON DELETE CASCADE NOT NULL,
    position INT DEFAULT 1 NOT NULL,
    format VARCHAR(64) DEFAULT 'Digital' NOT NULL,
    title VARCHAR(255),
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID REFERENCES works(id) ON DELETE CASCADE NOT NULL,
    entry_number INT DEFAULT 1 NOT NULL,
    title VARCHAR(255) NOT NULL,
    original_title VARCHAR(255),
    entry_type VARCHAR(64) DEFAULT 'episode' NOT NULL,
    duration_seconds INT,
    air_date VARCHAR(32),
    synopsis TEXT,
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uni_work_entry_num UNIQUE (work_id, entry_number)
);

CREATE TABLE IF NOT EXISTS tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medium_id UUID REFERENCES mediums(id) ON DELETE CASCADE NOT NULL,
    canonical_entry_id UUID REFERENCES canonical_entries(id) ON DELETE SET NULL,
    position INT DEFAULT 1 NOT NULL,
    title VARCHAR(255) NOT NULL,
    duration_seconds INT,
    artist_credit VARCHAR(255),
    number VARCHAR(32) DEFAULT '' NOT NULL,
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 6. CAS 资产体系 (Asset Registry, Asset Files & Asset Bindings)
CREATE TABLE IF NOT EXISTS asset_registries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sha256 VARCHAR(64) UNIQUE NOT NULL,
    size_bytes BIGINT NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    storage_key VARCHAR(512) NOT NULL,
    reference_count INT DEFAULT 1 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registry_id UUID REFERENCES asset_registries(id) ON DELETE RESTRICT,
    uploader_id UUID REFERENCES users(id) ON DELETE SET NULL,
    filename VARCHAR(255) NOT NULL,
    file_role file_role DEFAULT 'master_archive' NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    storage_key VARCHAR(512) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    transcode_status transcode_status DEFAULT 'pending' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_file_id UUID REFERENCES asset_files(id) ON DELETE CASCADE NOT NULL,
    target_type VARCHAR(32) NOT NULL,
    target_id UUID NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 7. 关系网络 (Entity Relationships & Relation Types)
CREATE TABLE IF NOT EXISTS relation_types (
    code VARCHAR(64) PRIMARY KEY,
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) NOT NULL,
    names JSONB DEFAULT '{}'::jsonb NOT NULL,
    reverse_code VARCHAR(64),
    source_type VARCHAR(32) NOT NULL,
    target_type VARCHAR(32) NOT NULL,
    description TEXT,
    is_temporal BOOLEAN DEFAULT FALSE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    is_system BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR(32) NOT NULL,
    source_id UUID NOT NULL,
    target_type VARCHAR(32) NOT NULL,
    target_id UUID NOT NULL,
    relation_type VARCHAR(64) REFERENCES relation_types(code) ON DELETE RESTRICT NOT NULL,
    qualifier VARCHAR(64) DEFAULT '' NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_directed BOOLEAN DEFAULT TRUE NOT NULL,
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uni_entity_relation UNIQUE (source_type, source_id, target_type, target_id, relation_type)
);

CREATE TABLE IF NOT EXISTS work_artist_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID REFERENCES works(id) ON DELETE CASCADE NOT NULL,
    artist_id UUID REFERENCES artists(id) ON DELETE CASCADE NOT NULL,
    role VARCHAR(64) DEFAULT 'author' NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uni_work_artist_role UNIQUE (work_id, artist_id, role)
);

-- 8. 外部数据库与动态属性引擎
CREATE TABLE IF NOT EXISTS external_database_definitions (
    code VARCHAR(32) PRIMARY KEY,
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) NOT NULL,
    names JSONB DEFAULT '{}'::jsonb NOT NULL,
    url_template VARCHAR(512) NOT NULL,
    icon VARCHAR(64) DEFAULT 'Database' NOT NULL,
    color VARCHAR(32) DEFAULT 'emerald' NOT NULL,
    applicable_types TEXT[] DEFAULT '{}' NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    is_system BOOLEAN DEFAULT FALSE NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_attribute_schemas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_entity VARCHAR(32) NOT NULL,
    field_key VARCHAR(64) NOT NULL,
    display_names JSONB DEFAULT '{}'::jsonb NOT NULL,
    data_type VARCHAR(32) DEFAULT 'string' NOT NULL,
    options JSONB DEFAULT '[]'::jsonb NOT NULL,
    description TEXT,
    is_required BOOLEAN DEFAULT FALSE NOT NULL,
    is_system BOOLEAN DEFAULT FALSE NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uni_entity_field UNIQUE (target_entity, field_key)
);

-- 9. 社区、论坛与私信
CREATE TABLE IF NOT EXISTS forum_boards (
    code VARCHAR(32) PRIMARY KEY,
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) NOT NULL,
    description_zh TEXT,
    description_en TEXT,
    icon VARCHAR(64) DEFAULT 'MessageSquare' NOT NULL,
    color VARCHAR(32) DEFAULT 'emerald' NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    is_system BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS discussion_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_code VARCHAR(32) REFERENCES forum_boards(code) ON DELETE RESTRICT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    is_pinned BOOLEAN DEFAULT FALSE NOT NULL,
    is_locked BOOLEAN DEFAULT FALSE NOT NULL,
    views_count INT DEFAULT 0 NOT NULL,
    posts_count INT DEFAULT 0 NOT NULL,
    last_post_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID REFERENCES discussion_topics(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reply_to_id UUID REFERENCES forum_posts(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS direct_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    receiver_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 10. 多语言题名与实体版本快照审计流
CREATE TABLE IF NOT EXISTS work_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID REFERENCES works(id) ON DELETE CASCADE NOT NULL,
    language_code VARCHAR(16) NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary TEXT,
    aliases TEXT[] DEFAULT '{}' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uni_work_translation_lang UNIQUE (work_id, language_code)
);

CREATE TABLE IF NOT EXISTS artist_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artist_id UUID REFERENCES artists(id) ON DELETE CASCADE NOT NULL,
    language_code VARCHAR(16) NOT NULL,
    name VARCHAR(255) NOT NULL,
    biography TEXT,
    aliases TEXT[] DEFAULT '{}' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uni_artist_translation_lang UNIQUE (artist_id, language_code)
);

CREATE TABLE IF NOT EXISTS franchise_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    franchise_id UUID REFERENCES franchises(id) ON DELETE CASCADE NOT NULL,
    language_code VARCHAR(16) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uni_franchise_translation_lang UNIQUE (franchise_id, language_code)
);

CREATE TABLE IF NOT EXISTS entity_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(32) NOT NULL,
    entity_id UUID NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    snapshot JSONB NOT NULL,
    delta JSONB,
    source_urls TEXT[] DEFAULT '{}' NOT NULL,
    edit_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NOT NULL,
    target_id VARCHAR(64) NOT NULL,
    details JSONB DEFAULT '{}'::jsonb NOT NULL,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS system_plugins (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    type VARCHAR(32) NOT NULL,
    version VARCHAR(32) NOT NULL,
    description TEXT,
    author VARCHAR(128),
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    config JSONB DEFAULT '{}'::jsonb NOT NULL,
    dependencies JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_works_title_trgm ON works USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_artists_name_trgm ON artists USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_releases_work_id ON releases(work_id);
CREATE INDEX IF NOT EXISTS idx_mediums_release_id ON mediums(release_id);
CREATE INDEX IF NOT EXISTS idx_tracks_medium_id ON tracks(medium_id);
CREATE INDEX IF NOT EXISTS idx_canonical_entries_work_id ON canonical_entries(work_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationships_source ON entity_relationships(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationships_target ON entity_relationships(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_direct_messages_participants ON direct_messages(sender_id, receiver_id);
