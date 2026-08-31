-- ==============================================================================
-- MetaFusion Database Schema (PostgreSQL 16)
-- MusicBrainz-Grade Multi-Media FRBR Catalog, CAS S3 Assets & Community Platform
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ------------------------------------------------------------------------------
-- 1. 枚举与通用常量类型定义 (Enums)
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 2. 用户、邀请与认证体系 (Users, Invitations & Auth)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(64) UNIQUE NOT NULL,
    display_name VARCHAR(128),                     -- 昵称，独立于 username/email，可为空，显示时 fallback 到 username
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role DEFAULT 'member' NOT NULL,
    invite_code VARCHAR(64) UNIQUE,                -- 专属邀请码
    invites_remaining INT DEFAULT 2 NOT NULL,      -- 剩余可用邀请名额
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    avatar_url VARCHAR(512),
    bio TEXT,
    favorites_public BOOLEAN DEFAULT TRUE NOT NULL,-- 收藏夹公开隐私开关
    email_public BOOLEAN DEFAULT FALSE NOT NULL,   -- 邮箱公开隐私开关
    is_email_verified BOOLEAN DEFAULT FALSE NOT NULL,
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
    token_hash VARCHAR(64) NOT NULL UNIQUE,        -- SHA256(hex) 长度 64
    prefix VARCHAR(12) NOT NULL,                   -- 明文前缀前 8 字符用于列表展示识别
    scopes TEXT[] DEFAULT '{read}' NOT NULL,       -- read, write, edit, upload, community, admin
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    target_type VARCHAR(16) NOT NULL,              -- 'work', 'release', 'artist', 'franchise'
    target_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uni_fav_user_target UNIQUE (user_id, target_type, target_id)
);

-- ------------------------------------------------------------------------------
-- 3. 动态形态、多维标签与虚拟货架体系 (Media Types, Tags & Shelves)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_types (
    code VARCHAR(32) PRIMARY KEY,                  -- 如 'movie', 'tv_series', 'anime', 'music', 'game'
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) NOT NULL,
    names JSONB DEFAULT '{}'::jsonb NOT NULL,      -- 多语言字典: {"zh-CN": "...", "en-US": "...", "ja": "..."}
    description TEXT DEFAULT '',
    icon VARCHAR(64) DEFAULT 'Layers',
    sort_order INT DEFAULT 0 NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    clc_prefix VARCHAR(16),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS virtual_shelves (
    slug VARCHAR(64) PRIMARY KEY,
    parent_slug VARCHAR(64) REFERENCES virtual_shelves(slug) ON DELETE CASCADE,
    name_zh VARCHAR(128) NOT NULL,
    name_en VARCHAR(128) NOT NULL,
    names JSONB DEFAULT '{}'::jsonb NOT NULL,
    description TEXT,
    descriptions JSONB DEFAULT '{}'::jsonb NOT NULL,
    icon VARCHAR(64),
    sort_order INT DEFAULT 0 NOT NULL,
    query_tags TEXT[] DEFAULT '{}' NOT NULL,
    require_all_tags BOOLEAN DEFAULT FALSE NOT NULL,
    exclude_tags TEXT[] DEFAULT '{}' NOT NULL
);

CREATE TABLE IF NOT EXISTS user_custom_shelves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    slug VARCHAR(64) NOT NULL,
    name_zh VARCHAR(128) NOT NULL,
    name_en VARCHAR(128) DEFAULT '' NOT NULL,
    names JSONB DEFAULT '{}'::jsonb NOT NULL,
    description TEXT DEFAULT '' NOT NULL,
    descriptions JSONB DEFAULT '{}'::jsonb NOT NULL,
    icon VARCHAR(64) DEFAULT 'Sparkles' NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    query_tags TEXT[] DEFAULT '{}' NOT NULL,
    require_all_tags BOOLEAN DEFAULT FALSE NOT NULL,
    exclude_tags TEXT[] DEFAULT '{}' NOT NULL,
    is_public BOOLEAN DEFAULT FALSE NOT NULL,
    view_count INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(owner_id, slug)
);

CREATE TABLE IF NOT EXISTS user_home_layouts (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    hidden_system_slugs TEXT[] DEFAULT '{}' NOT NULL,
    order_json JSONB DEFAULT '[]' NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) UNIQUE NOT NULL,
    group_type VARCHAR(32) NOT NULL,               -- format / medium / genre / theme / general / topic
    category_scope VARCHAR(32)[] DEFAULT '{}'      -- 适用媒介范围 (空数组表示全媒介通用)
);

CREATE TABLE IF NOT EXISTS tag_translations (
    tag_id INT REFERENCES tags(id) ON DELETE CASCADE NOT NULL,
    locale VARCHAR(16) NOT NULL,                   -- zh-CN, en-US, ja, ko, zh-TW
    name VARCHAR(64) NOT NULL,
    PRIMARY KEY (tag_id, locale)
);

-- ------------------------------------------------------------------------------
-- 4. 创作者、机构与演职主体 (Artists / Creators / Studios / Labels / Characters)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entity_type_definitions (
    code VARCHAR(64) PRIMARY KEY,                  -- person, group, orchestra, studio, publisher, virtual_character
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) NOT NULL,
    names JSONB DEFAULT '{}'::jsonb NOT NULL,
    desc_zh TEXT DEFAULT '',
    desc_en TEXT DEFAULT '',
    color VARCHAR(32) DEFAULT 'amber' NOT NULL,
    bg_color VARCHAR(32) DEFAULT 'bg-amber-500/10' NOT NULL,
    border_color VARCHAR(32) DEFAULT 'border-amber-500/30' NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_system BOOLEAN DEFAULT FALSE NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS artists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255),
    disambiguation VARCHAR(255),
    entity_type VARCHAR(32) DEFAULT 'person' NOT NULL REFERENCES entity_type_definitions(code) ON UPDATE CASCADE ON DELETE RESTRICT,
    avatar_url TEXT DEFAULT '' NOT NULL,           -- 一等公民头像/标识图（非 attributes）
    country VARCHAR(64),
    biography TEXT,
    begin_date VARCHAR(16),                        -- 出生日期 / 成立年份 (如 "1979-01-18" 或 "1994")
    end_date VARCHAR(16),                          -- 逝世日期 / 解散年份 (如 "2011-05")
    ended BOOLEAN DEFAULT FALSE NOT NULL,          -- 是否已故 / 已解散
    language VARCHAR(16) DEFAULT 'zh-CN' NOT NULL, -- 默认语种主码
    external_ids JSONB DEFAULT '{}'::jsonb NOT NULL,
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL, -- 仅承载纯物理/技术参数，头像与关系禁止入此
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS artist_translations (
    artist_id UUID REFERENCES artists(id) ON DELETE CASCADE NOT NULL,
    locale VARCHAR(16) NOT NULL,
    name VARCHAR(255),
    biography TEXT,
    PRIMARY KEY (artist_id, locale)
);

-- ------------------------------------------------------------------------------
-- 5. FRBR 概念模型 - 跨媒介企划与抽象核心作品 (Franchises & Works)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS franchises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    original_title VARCHAR(255) DEFAULT '',
    aliases VARCHAR(255)[] DEFAULT '{}',
    disambiguation VARCHAR(255) DEFAULT '',
    summary TEXT DEFAULT '',
    cover_image_url VARCHAR(512) DEFAULT '',
    begin_date VARCHAR(16) DEFAULT '',
    end_date VARCHAR(16) DEFAULT '',
    ended BOOLEAN DEFAULT FALSE NOT NULL,
    country VARCHAR(64) DEFAULT '',
    language VARCHAR(16) DEFAULT 'zh-CN' NOT NULL,
    external_ids JSONB DEFAULT '{}'::jsonb NOT NULL,
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    catalog_metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS franchise_translations (
    franchise_id UUID REFERENCES franchises(id) ON DELETE CASCADE NOT NULL,
    locale VARCHAR(16) NOT NULL,
    title VARCHAR(255) DEFAULT '',
    summary TEXT DEFAULT '',
    PRIMARY KEY (franchise_id, locale)
);

CREATE TABLE IF NOT EXISTS franchise_tag_relations (
    franchise_id UUID REFERENCES franchises(id) ON DELETE CASCADE NOT NULL,
    tag_id INT REFERENCES tags(id) ON DELETE CASCADE NOT NULL,
    PRIMARY KEY (franchise_id, tag_id)
);

CREATE TABLE IF NOT EXISTS works (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    original_title VARCHAR(255),
    aliases VARCHAR(255)[] DEFAULT '{}',
    release_date DATE,
    begin_date VARCHAR(16),                        -- 连载/播映/创作起始日期 (如 "2011-10-01")
    end_date VARCHAR(16),                          -- 完结/停刊日期 (如 "2012-03-31")
    ended BOOLEAN DEFAULT FALSE NOT NULL,          -- 是否已完结
    country VARCHAR(64),
    language VARCHAR(64) DEFAULT 'zh-CN',          -- 默认显示元数据语言 BCP-47
    original_language VARCHAR(16) DEFAULT '' NOT NULL, -- 作品内容原生语言 ISO 639-1 (zh/ja/en/ko...)
    summary TEXT,
    cover_image_url VARCHAR(512),
    cover_aspect VARCHAR(8) DEFAULT '' NOT NULL,   -- 手动指定封面比例 ("1:1", "2:3", "3:4", "4:3", 空串=自动)
    content_rating VARCHAR(32) DEFAULT 'General',
    status VARCHAR(32) DEFAULT 'completed',
    view_count BIGINT DEFAULT 0 NOT NULL,
    external_ids JSONB DEFAULT '{}'::jsonb NOT NULL,
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    catalog_metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS work_translations (
    work_id UUID REFERENCES works(id) ON DELETE CASCADE NOT NULL,
    locale VARCHAR(16) NOT NULL,
    title VARCHAR(255),
    summary TEXT,
    PRIMARY KEY (work_id, locale)
);

CREATE TABLE IF NOT EXISTS work_tag_relations (
    work_id UUID REFERENCES works(id) ON DELETE CASCADE NOT NULL,
    tag_id INT REFERENCES tags(id) ON DELETE CASCADE NOT NULL,
    PRIMARY KEY (work_id, tag_id)
);

CREATE TABLE IF NOT EXISTS work_artist_relations (
    id SERIAL PRIMARY KEY,
    work_id UUID REFERENCES works(id) ON DELETE CASCADE NOT NULL,
    artist_id UUID REFERENCES artists(id) ON DELETE CASCADE NOT NULL,
    role VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ------------------------------------------------------------------------------
-- 6. FRBR 概念模型 - 发行版与载体层 (Releases, Mediums & Manifestations)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID REFERENCES works(id) ON DELETE CASCADE NOT NULL,
    publisher_id UUID REFERENCES artists(id) ON DELETE SET NULL, -- 精准关联到签约发行机构/厂牌/出版社
    edition_name VARCHAR(128) NOT NULL,            -- 如: "2CD + 1BDMV 初回限定纪念箱", "第01卷"
    catalog_number VARCHAR(128),                   -- 唱片号/出版号 (如: VIZL-9081, ISBN 978-4-04-867760-8)
    barcode VARCHAR(64),                           -- EAN-13 / UPC 条形码
    publisher VARCHAR(128),                        -- 出版社/发行厂牌/压制组 (展示文本冗余/回退)
    packaging VARCHAR(64) DEFAULT 'box_set',       -- 'box_set', 'jewel_case', 'digipak', 'hardcover', 'paperback'
    edition_date DATE,
    country VARCHAR(64) DEFAULT '',
    language VARCHAR(64) DEFAULT '',
    distribution_channel VARCHAR(32) DEFAULT 'mixed' NOT NULL, -- retail, digital, comic_market, event, fanclub, mixed
    external_ids JSONB DEFAULT '{}'::jsonb NOT NULL,
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    catalog_metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    uploader_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_master_verified BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS mediums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id UUID REFERENCES releases(id) ON DELETE CASCADE NOT NULL,
    position INT NOT NULL,                         -- 碟片/分卷序号 (1, 2, 3...)
    name VARCHAR(128) NOT NULL,                    -- 碟片/分卷名 (如: "Disc 1: Original Soundtrack", "Booklet 设定集")
    format VARCHAR(64) NOT NULL,                   -- 'CD', 'SACD', 'Blu-ray', 'DVD', 'Vinyl', 'Book', 'Digital'
    media_category VARCHAR(32) NOT NULL REFERENCES media_types(code) ON UPDATE CASCADE ON DELETE RESTRICT,
    track_count INT DEFAULT 0 NOT NULL,
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL
);

-- ------------------------------------------------------------------------------
-- 7. 母版条目与轨道分集 (Canonical Entries & Tracks)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    sort_title VARCHAR(255),
    duration_seconds INT,
    isrc VARCHAR(32),
    isbn VARCHAR(32),
    artist_credit VARCHAR(255),
    recording_date VARCHAR(16),                    -- 录音/制作完成日期 (如 "2001-09-15" 或 "2001")
    work_id UUID REFERENCES works(id) ON DELETE SET NULL,
    external_ids JSONB DEFAULT '{}'::jsonb NOT NULL,
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medium_id UUID REFERENCES mediums(id) ON DELETE CASCADE NOT NULL,
    canonical_entry_id UUID REFERENCES canonical_entries(id) ON DELETE SET NULL,
    work_id UUID REFERENCES works(id) ON DELETE SET NULL,
    position INT NOT NULL,
    title VARCHAR(255),                            -- 允许为空（回退继承 canonical_entry 标题）
    title_override VARCHAR(255),                   -- 本发行版特有题名覆盖
    duration_seconds INT,
    isrc VARCHAR(32),
    artist_credit VARCHAR(255),
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL
);

-- ------------------------------------------------------------------------------
-- 8. 物理资产、内容寻址与多态挂载 (Asset Files, CAS & Polymorphic Bindings)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id UUID REFERENCES releases(id) ON DELETE CASCADE NOT NULL,
    medium_id UUID REFERENCES mediums(id) ON DELETE SET NULL,
    track_id UUID REFERENCES tracks(id) ON DELETE SET NULL,
    canonical_entry_id UUID REFERENCES canonical_entries(id) ON DELETE SET NULL,
    file_role file_role DEFAULT 'master_archive' NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    s3_bucket VARCHAR(64) NOT NULL,
    s3_key VARCHAR(1024) NOT NULL,
    file_size BIGINT NOT NULL,
    sha256_hash VARCHAR(64) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    technical_specs JSONB DEFAULT '{}'::jsonb NOT NULL,
    transcode_status transcode_status DEFAULT 'pending' NOT NULL,
    transcode_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sha256_hash VARCHAR(64) UNIQUE NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    s3_bucket VARCHAR(64) NOT NULL,
    s3_key VARCHAR(1024) NOT NULL,
    storage_tier VARCHAR(32) DEFAULT 'hot_s3' NOT NULL,
    technical_specs JSONB DEFAULT '{}'::jsonb NOT NULL,
    transcode_status VARCHAR(32) DEFAULT 'pending' NOT NULL,
    transcode_error TEXT,
    derivatives JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID REFERENCES asset_registry(id) ON DELETE CASCADE NOT NULL,
    target_entity_type VARCHAR(32) NOT NULL,       -- 'medium', 'track', 'canonical_entry', 'release', 'work'
    target_entity_id UUID NOT NULL,
    binding_role VARCHAR(64) DEFAULT 'master_archive' NOT NULL, -- 'disc_image', 'track_audio', 'scans', 'video', 'bonus'
    display_order INT DEFAULT 0 NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ------------------------------------------------------------------------------
-- 9. 动态关系本体与知识图谱连线 (Dynamic Relation Types & Entity Relationships)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS relation_types (
    code VARCHAR(64) PRIMARY KEY,                  -- 'signed_with', 'voice_actor_of', 'soundtrack_of', 'adapted_from', 'spin_off_of'
    domain VARCHAR(32) NOT NULL,                   -- 'agent_agent', 'agent_work', 'work_work', 'agent_release', 'work_franchise'
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) NOT NULL,
    names JSONB DEFAULT '{}'::jsonb NOT NULL,
    description TEXT DEFAULT '',
    forward_label_zh VARCHAR(64) NOT NULL,
    reverse_label_zh VARCHAR(64) NOT NULL,
    forward_label_en VARCHAR(64) NOT NULL,
    reverse_label_en VARCHAR(64) NOT NULL,
    allowed_source_types VARCHAR(32)[] DEFAULT '{}',
    allowed_target_types VARCHAR(32)[] DEFAULT '{}',
    is_symmetric BOOLEAN DEFAULT FALSE NOT NULL,
    is_hierarchical BOOLEAN DEFAULT FALSE NOT NULL,
    attribute_schema JSONB DEFAULT '[]'::jsonb NOT NULL,
    color VARCHAR(32) DEFAULT 'sky' NOT NULL,
    icon VARCHAR(64) DEFAULT 'Link' NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_system BOOLEAN DEFAULT FALSE NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR(32) NOT NULL,              -- 'artist', 'work', 'release', 'franchise', 'expression'
    source_id UUID NOT NULL,
    target_type VARCHAR(32) NOT NULL,              -- 'artist', 'work', 'release', 'franchise', 'expression'
    target_id UUID NOT NULL,
    relationship_type VARCHAR(64) NOT NULL,        -- 关联 relation_types(code)
    qualifier VARCHAR(64) DEFAULT '' NOT NULL,     -- 同类多边限定符 (如配音语种 'ja'/'zh-CN' 或角色别名)
    begin_date VARCHAR(16),                        -- 生效起始
    end_date VARCHAR(16),                          -- 生效截止
    ended BOOLEAN DEFAULT FALSE NOT NULL,          -- 是否已终结
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT entity_relationships_edge_unique UNIQUE (source_type, source_id, target_type, target_id, relationship_type, qualifier)
);

CREATE TABLE IF NOT EXISTS entity_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type VARCHAR(32) NOT NULL,              -- 'work', 'artist', 'release', 'canonical_entry', 'franchise'
    target_id UUID NOT NULL,
    editor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    edit_type VARCHAR(32) NOT NULL,                -- 'create', 'update', 'delete', 'merge', 'rollback'
    summary VARCHAR(255) DEFAULT '' NOT NULL,      -- 变更概要
    edit_note TEXT DEFAULT '' NOT NULL,            -- 编辑附言/修改理由 (MusicBrainz Edit Note)
    source_urls TEXT[] DEFAULT '{}' NOT NULL,      -- 参考来源网址/考据出处
    before_state JSONB DEFAULT '{}'::jsonb NOT NULL,
    after_state JSONB DEFAULT '{}'::jsonb NOT NULL,
    diff JSONB DEFAULT '{}'::jsonb NOT NULL,       -- 结构化 Diff
    status VARCHAR(16) DEFAULT 'applied' NOT NULL, -- 'applied', 'pending', 'rejected', 'reverted'
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ------------------------------------------------------------------------------
-- 10. 论坛与社区协作生态 (Forum Boards, Discussions, Posts & Revisions)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forum_boards (
    code VARCHAR(32) PRIMARY KEY,
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) DEFAULT '',
    names JSONB DEFAULT '{}'::jsonb NOT NULL,
    description TEXT DEFAULT '',
    descriptions JSONB DEFAULT '{}'::jsonb NOT NULL,
    color VARCHAR(16) DEFAULT 'emerald' NOT NULL CHECK (color IN ('emerald','amber','sky','purple','cyan','rose','indigo','teal')),
    icon VARCHAR(32) DEFAULT 'BookOpen' NOT NULL CHECK (icon IN ('BookOpen','Cpu','Archive','Coffee','Layers','Hash','Tag','Sparkles','Flame','Bookmark','MessageSquare','Globe','Megaphone','Bug','MessageCircle')),
    sort_order INT DEFAULT 0 NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    show_in_feed BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS user_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(64) UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    permissions JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS user_group_members (
    user_group_id UUID REFERENCES user_groups(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    PRIMARY KEY (user_group_id, user_id)
);

CREATE TABLE IF NOT EXISTS discussion_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    board_code VARCHAR(32) DEFAULT 'announcement' NOT NULL REFERENCES forum_boards(code) ON UPDATE CASCADE ON DELETE RESTRICT,
    work_id UUID REFERENCES works(id) ON DELETE SET NULL,
    release_id UUID REFERENCES releases(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    language VARCHAR(16) DEFAULT 'zh-CN' NOT NULL,
    view_count INT DEFAULT 0 NOT NULL,
    reply_count INT DEFAULT 0 NOT NULL,
    is_pinned BOOLEAN DEFAULT FALSE NOT NULL,
    pinned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID REFERENCES discussion_topics(id) ON DELETE CASCADE NOT NULL,
    post_number INT NOT NULL,                      -- #1 是主题初始正文，#2+ 为楼层回复
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    content TEXT NOT NULL,
    reply_to_post_number INT,
    reply_to_post_id UUID REFERENCES forum_posts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(topic_id, post_number)
);

CREATE TABLE IF NOT EXISTS topic_translations (
    topic_id UUID REFERENCES discussion_topics(id) ON DELETE CASCADE NOT NULL,
    locale VARCHAR(16) NOT NULL,
    title VARCHAR(255),
    content TEXT,
    PRIMARY KEY (topic_id, locale)
);

CREATE TABLE IF NOT EXISTS topic_tag_relations (
    topic_id UUID REFERENCES discussion_topics(id) ON DELETE CASCADE NOT NULL,
    tag_id INT REFERENCES tags(id) ON DELETE CASCADE NOT NULL,
    PRIMARY KEY (topic_id, tag_id)
);

CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID REFERENCES discussion_topics(id) ON DELETE CASCADE,
    work_id UUID REFERENCES works(id) ON DELETE CASCADE,
    release_id UUID REFERENCES releases(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS direct_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    receiver_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role VARCHAR(32),
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(32),
    target_id VARCHAR(64),
    detail JSONB DEFAULT '{}'::jsonb NOT NULL,
    ip INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ------------------------------------------------------------------------------
-- 11. 全量索引与高性能查询优化 (Comprehensive Indexes & Query Optimization)
-- ------------------------------------------------------------------------------
-- 11.1 用户与认证
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);
CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON api_tokens(prefix);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_target ON favorites(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_favorites_created_at ON favorites(created_at);

-- 11.2 标签与分类
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE INDEX IF NOT EXISTS idx_tags_group_type ON tags(group_type);
CREATE INDEX IF NOT EXISTS idx_tags_category_scope_gin ON tags USING GIN (category_scope);
CREATE INDEX IF NOT EXISTS idx_tag_translations_locale ON tag_translations(locale);
CREATE INDEX IF NOT EXISTS idx_media_types_enabled_sort ON media_types(is_enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_virtual_shelves_query_tags_gin ON virtual_shelves USING GIN (query_tags);
CREATE INDEX IF NOT EXISTS idx_virtual_shelves_exclude_tags_gin ON virtual_shelves USING GIN (exclude_tags);
CREATE INDEX IF NOT EXISTS idx_user_custom_shelves_owner ON user_custom_shelves(owner_id);
CREATE INDEX IF NOT EXISTS idx_user_custom_shelves_slug ON user_custom_shelves(slug);
CREATE INDEX IF NOT EXISTS idx_user_custom_shelves_public ON user_custom_shelves(is_public) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_custom_shelves_query_tags_gin ON user_custom_shelves USING GIN (query_tags);

-- 11.3 创作者与实体
CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);
CREATE INDEX IF NOT EXISTS idx_artists_name_trgm ON artists USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_artists_entity_type ON artists(entity_type);
CREATE INDEX IF NOT EXISTS idx_artists_created_by ON artists(created_by);
CREATE INDEX IF NOT EXISTS idx_artists_temporal ON artists(ended, begin_date);
CREATE INDEX IF NOT EXISTS idx_artists_external_ids_gin ON artists USING GIN (external_ids);
CREATE INDEX IF NOT EXISTS idx_artists_attributes_gin ON artists USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_artist_translations_locale ON artist_translations(locale);

-- 11.4 企划与世界观
CREATE INDEX IF NOT EXISTS idx_franchises_title ON franchises(title);
CREATE INDEX IF NOT EXISTS idx_franchises_title_trgm ON franchises USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_franchises_created_at ON franchises(created_at);
CREATE INDEX IF NOT EXISTS idx_franchises_aliases_gin ON franchises USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_franchises_external_ids_gin ON franchises USING GIN (external_ids);
CREATE INDEX IF NOT EXISTS idx_franchises_catalog_metadata_gin ON franchises USING GIN (catalog_metadata);
CREATE INDEX IF NOT EXISTS idx_franchise_translations_locale ON franchise_translations(locale);

-- 11.5 作品
CREATE INDEX IF NOT EXISTS idx_works_release_date ON works(release_date);
CREATE INDEX IF NOT EXISTS idx_works_language ON works(language);
CREATE INDEX IF NOT EXISTS idx_works_original_language ON works(original_language);
CREATE INDEX IF NOT EXISTS idx_works_cover_aspect ON works(cover_aspect);
CREATE INDEX IF NOT EXISTS idx_works_status ON works(status);
CREATE INDEX IF NOT EXISTS idx_works_view_count ON works(view_count);
CREATE INDEX IF NOT EXISTS idx_works_created_at ON works(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_works_temporal ON works(ended, begin_date);
CREATE INDEX IF NOT EXISTS idx_works_title_trgm ON works USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_works_aliases_gin ON works USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_works_catalog_metadata ON works USING GIN (catalog_metadata);
CREATE INDEX IF NOT EXISTS idx_works_external_ids_gin ON works USING GIN (external_ids);
CREATE INDEX IF NOT EXISTS idx_works_attributes_gin ON works USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_work_translations_locale ON work_translations(locale);

-- 11.6 发行版与载体
CREATE INDEX IF NOT EXISTS idx_releases_work ON releases(work_id);
CREATE INDEX IF NOT EXISTS idx_releases_publisher_id ON releases(publisher_id);
CREATE INDEX IF NOT EXISTS idx_releases_catalog_number ON releases(catalog_number);
CREATE INDEX IF NOT EXISTS idx_releases_barcode ON releases(barcode);
CREATE INDEX IF NOT EXISTS idx_releases_edition_date ON releases(edition_date);
CREATE INDEX IF NOT EXISTS idx_releases_catalog_metadata_gin ON releases USING GIN (catalog_metadata);
CREATE INDEX IF NOT EXISTS idx_releases_external_ids_gin ON releases USING GIN (external_ids);
CREATE INDEX IF NOT EXISTS idx_releases_attributes_gin ON releases USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_mediums_release ON mediums(release_id);
CREATE INDEX IF NOT EXISTS idx_mediums_media_category ON mediums(media_category);

-- 11.7 母版与轨道
CREATE INDEX IF NOT EXISTS idx_canonical_entries_work ON canonical_entries(work_id);
CREATE INDEX IF NOT EXISTS idx_canonical_entries_title_trgm ON canonical_entries USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_canonical_entries_external_ids_gin ON canonical_entries USING GIN (external_ids);
CREATE INDEX IF NOT EXISTS idx_canonical_entries_attributes_gin ON canonical_entries USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_tracks_medium ON tracks(medium_id);
CREATE INDEX IF NOT EXISTS idx_tracks_canonical_entry ON tracks(canonical_entry_id);
CREATE INDEX IF NOT EXISTS idx_tracks_work ON tracks(work_id);

-- 11.8 资产与绑定
CREATE INDEX IF NOT EXISTS idx_asset_files_release ON asset_files(release_id);
CREATE INDEX IF NOT EXISTS idx_asset_files_medium ON asset_files(medium_id);
CREATE INDEX IF NOT EXISTS idx_asset_files_canonical_entry ON asset_files(canonical_entry_id);
CREATE INDEX IF NOT EXISTS idx_asset_files_hash ON asset_files(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_asset_files_specs ON asset_files USING GIN (technical_specs);
CREATE INDEX IF NOT EXISTS idx_asset_registry_hash ON asset_registry(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_asset_registry_specs_gin ON asset_registry USING GIN (technical_specs);
CREATE INDEX IF NOT EXISTS idx_asset_registry_derivatives_gin ON asset_registry USING GIN (derivatives);
CREATE INDEX IF NOT EXISTS idx_asset_bindings_asset ON asset_bindings(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_bindings_target ON asset_bindings(target_entity_type, target_entity_id);

-- 11.9 图谱关系与审计修订
CREATE INDEX IF NOT EXISTS idx_entity_rel_source ON entity_relationships(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_entity_rel_target ON entity_relationships(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_entity_rel_type ON entity_relationships(relationship_type);
CREATE INDEX IF NOT EXISTS idx_entity_rel_temporal ON entity_relationships(source_id, relationship_type, ended, begin_date);
CREATE INDEX IF NOT EXISTS idx_entity_rel_target_temporal ON entity_relationships(target_id, relationship_type, ended, begin_date);
CREATE INDEX IF NOT EXISTS idx_entity_rel_attributes_gin ON entity_relationships USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_relation_types_domain ON relation_types(domain);
CREATE INDEX IF NOT EXISTS idx_revisions_target ON entity_revisions(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revisions_editor ON entity_revisions(editor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revisions_status ON entity_revisions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revisions_diff_gin ON entity_revisions USING GIN (diff);
CREATE INDEX IF NOT EXISTS idx_revisions_before_state_gin ON entity_revisions USING GIN (before_state);
CREATE INDEX IF NOT EXISTS idx_revisions_after_state_gin ON entity_revisions USING GIN (after_state);

-- 11.10 社区、帖子与消息
CREATE INDEX IF NOT EXISTS idx_topics_board_code ON discussion_topics(board_code);
CREATE INDEX IF NOT EXISTS idx_topics_work ON discussion_topics(work_id);
CREATE INDEX IF NOT EXISTS idx_topics_release ON discussion_topics(release_id);
CREATE INDEX IF NOT EXISTS idx_topics_user ON discussion_topics(user_id);
CREATE INDEX IF NOT EXISTS idx_topics_language ON discussion_topics(language);
CREATE INDEX IF NOT EXISTS idx_topics_pinned ON discussion_topics(is_pinned, pinned_at DESC) WHERE is_pinned = TRUE;
CREATE INDEX IF NOT EXISTS idx_topics_created_at ON discussion_topics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topics_title_trgm ON discussion_topics USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_topics_content_trgm ON discussion_topics USING GIN (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_topic_translations_locale ON topic_translations(locale);
CREATE INDEX IF NOT EXISTS idx_topic_tags_topic ON topic_tag_relations(topic_id);
CREATE INDEX IF NOT EXISTS idx_topic_tags_tag ON topic_tag_relations(tag_id);
CREATE INDEX IF NOT EXISTS idx_forum_posts_topic_number ON forum_posts(topic_id, post_number);
CREATE INDEX IF NOT EXISTS idx_forum_posts_user ON forum_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_forum_posts_created_at ON forum_posts(created_at);
CREATE INDEX IF NOT EXISTS idx_comments_work ON comments(work_id);
CREATE INDEX IF NOT EXISTS idx_comments_release ON comments(release_id);
CREATE INDEX IF NOT EXISTS idx_comments_topic ON comments(topic_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_dm_sender_receiver ON direct_messages(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_dm_receiver_read ON direct_messages(receiver_id, is_read);
CREATE INDEX IF NOT EXISTS idx_dm_created_at ON direct_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON admin_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON admin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_target ON admin_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_detail_gin ON admin_audit_logs USING GIN (detail);

-- ------------------------------------------------------------------------------
-- 12. 基础系统字典与核心实体类型初始化 (Core System Dictionaries Seed)
-- ------------------------------------------------------------------------------
INSERT INTO entity_type_definitions (code, name_zh, name_en, names, desc_zh, desc_en, color, bg_color, border_color, sort_order, is_system, is_enabled) VALUES
('person',            '个人创作者',        'Individual Creator', '{"zh-CN":"个人创作者","en-US":"Individual Creator"}', '导演、著者、作曲家、编曲、作词、画师、声优等', 'Director, author, composer, arranger, lyricist, illustrator, voice actor, etc.', 'text-amber-400', 'bg-amber-500/10', 'border-amber-500/30', 10, TRUE, TRUE),
('virtual_character', '角色 / 人物',    'Character',  '{"zh-CN":"角色 / 人物","en-US":"Character"}', '动漫、游戏、影视等作品中的登场角色与人物形象（含 Vtuber、虚拟企划人物）', 'Fictional characters in anime, games, film and other works (incl. VTubers and franchise personas).', 'text-rose-400', 'bg-rose-500/10', 'border-rose-500/30', 15, TRUE, TRUE),
('studio',            '制作机构 / 工作室',  'Studio',             '{"zh-CN":"制作机构 / 工作室","en-US":"Studio"}',             '动画工作室、影视制作公司、开发组等', 'Animation studio, production company, dev team, etc.', 'text-purple-400', 'bg-purple-500/10', 'border-purple-500/30', 20, TRUE, TRUE),
('publisher',         '出版社 / 发行厂牌',  'Publisher / Label',  '{"zh-CN":"出版社 / 发行厂牌","en-US":"Publisher / Label"}',  '出版机构、发行厂牌、唱片公司、独立厂牌与子品牌等', 'Publishing houses, distributors, record labels, imprints and sub-brands, etc.', 'text-sky-400', 'bg-sky-500/10', 'border-sky-500/30', 30, TRUE, TRUE),
('orchestra',         '管弦乐团 / 歌剧团',  'Orchestra',          '{"zh-CN":"管弦乐团 / 歌剧团","en-US":"Orchestra"}',          '交响乐团、室内乐团、爱乐乐团等', 'Symphony, chamber orchestra, philharmonic, etc.', 'text-emerald-400', 'bg-emerald-500/10', 'border-emerald-500/30', 40, TRUE, TRUE),
('group',             '乐队 / 组合',        'Band / Group',       '{"zh-CN":"乐队 / 组合","en-US":"Band / Group"}',       '摇滚乐队、偶像团体、声优组合、室内乐、同人社团与企划内虚构乐队等演职团体', 'Rock bands, idol groups, voice-actor units, chamber ensembles, doujin circles and in-universe franchise bands.', 'text-rose-400', 'bg-rose-500/10', 'border-rose-500/30', 50, TRUE, TRUE)
ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    names = EXCLUDED.names,
    desc_zh = EXCLUDED.desc_zh,
    desc_en = EXCLUDED.desc_en,
    color = EXCLUDED.color,
    bg_color = EXCLUDED.bg_color,
    border_color = EXCLUDED.border_color,
    sort_order = EXCLUDED.sort_order;

-- 实体类型合并迁移：独立厂牌(label)并入出版机构(publisher)，同人社团(circle)并入团体(group)
-- （对新库为空操作；对存量库将既有主体迁移后移除废弃字典项）
UPDATE artists SET entity_type = 'publisher' WHERE entity_type = 'label';
UPDATE artists SET entity_type = 'group' WHERE entity_type = 'circle';
DELETE FROM entity_type_definitions WHERE code IN ('label', 'circle');

INSERT INTO media_types (code, name_zh, name_en, names, description, icon, sort_order, is_enabled, clc_prefix) VALUES
('movie',       '电影',       'Movies',            '{"zh-CN":"电影","en-US":"Movies"}',            '院线长片、动画剧场版与纪录电影',        'Film',         10, TRUE, 'J9'),
('tv_series',   '电视剧集',   'TV Series',         '{"zh-CN":"电视剧集","en-US":"TV Series"}',      '连续剧、迷你剧与电视节目',                'Tv',           20, TRUE, 'J94'),
('anime',       '动画番剧',   'Anime',             '{"zh-CN":"动画番剧","en-US":"Anime"}',          'TV 动画与网络番剧',                     'Sparkles',     30, TRUE, 'J954'),
('performance', '现场演出',   'Live / Performance','{"zh-CN":"现场演出","en-US":"Live / Performance"}','演唱会、舞台剧与现场录像',             'Clapperboard', 35, TRUE, 'J8'),
('music',       '音乐',       'Music',             '{"zh-CN":"音乐","en-US":"Music"}',             'Hi-Res 音乐、原声与古典录音',           'Music',        40, TRUE, 'J6'),
('audiobook',   '有声书',     'Audiobooks',        '{"zh-CN":"有声书","en-US":"Audiobooks"}',      '有声书、广播剧与有声文献',              'Headphones',   50, TRUE, 'I247'),
('podcast',     '播客',       'Podcasts',          '{"zh-CN":"播客","en-US":"Podcasts"}',          '播客节目、访谈与声音纪录片',            'Mic',          55, TRUE, 'G23'),
('novel',       '图书',       'Books',             '{"zh-CN":"图书","en-US":"Books"}',             '图书文献、轻小说与数字出版',            'BookOpen',     60, TRUE, 'I'),
('comic',       '漫画',       'Comics',            '{"zh-CN":"漫画","en-US":"Comics"}',            '漫画与条漫',                            'Layers',       70, TRUE, 'J2'),
('gallery',     '画集',       'Artbooks',          '{"zh-CN":"画集","en-US":"Artbooks"}',          '艺术画集、设定集与原画档案',            'Palette',      80, TRUE, 'J21'),
('game',        '游戏',       'Games',             '{"zh-CN":"游戏","en-US":"Games"}',             '电子游戏、视觉小说与互动影像',          'Gamepad2',     85, TRUE, 'TP31'),
('software',    '软件',       'Software',          '{"zh-CN":"软件","en-US":"Software"}',          '工具软件、数据集与模拟器镜像',          'Cpu',          90, TRUE, 'TP31')
ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    names = EXCLUDED.names,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order,
    clc_prefix = EXCLUDED.clc_prefix;

INSERT INTO forum_boards (code, name_zh, name_en, description, color, icon, sort_order, is_enabled, show_in_feed, names) VALUES
('announcement', '站点公告',   'Announcements',          '站点公告与运营通知',                   'amber',   'Megaphone',     10, TRUE, TRUE,  '{"zh-CN":"站点公告","en-US":"Announcements"}'),
('casual',       '闲聊杂谈',   'Casual Chat',            '轻松闲聊与站内日常交流',               'purple',  'Coffee',        20, TRUE, TRUE,  '{"zh-CN":"闲聊杂谈","en-US":"Casual Chat"}'),
('qa',           '求助答疑',   'Q&A',                    '使用问题、编目与功能答疑',             'teal',    'Hash',          30, TRUE, TRUE,  '{"zh-CN":"求助答疑","en-US":"Q&A"}'),
('reviews',      '考据评注',   'Archive Reviews',        '版本考证、原盘评析与文献释读',         'emerald', 'BookOpen',      40, TRUE, TRUE,  '{"zh-CN":"考据评注","en-US":"Archive Reviews"}'),
('bug_report',   '反馈与建议', 'Feedback & Bug Reports', '缺陷反馈、功能建议与复现信息',         'rose',    'Bug',           50, TRUE, TRUE,  '{"zh-CN":"反馈与建议","en-US":"Feedback & Bug Reports"}'),
('comment',      '评论专用',   'Comments',               '作品与讨论的评论承载区，不进入信息流与全站聚合', 'sky',     'MessageCircle', 60, TRUE, FALSE, '{"zh-CN":"评论专用","en-US":"Comments"}')
ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    description = EXCLUDED.description,
    color = EXCLUDED.color,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order,
    is_enabled = EXCLUDED.is_enabled,
    show_in_feed = EXCLUDED.show_in_feed,
    names = EXCLUDED.names;

INSERT INTO system_settings (key, value) VALUES
('registration_enabled', 'true'),
('invite_required', 'true')
ON CONFLICT (key) DO NOTHING;
