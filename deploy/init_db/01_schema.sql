-- ==============================================================================
-- MetaFusion Database Schema (PostgreSQL 16)
-- MusicBrainz-Grade Multi-Media FRBR Catalog, CAS S3 Assets & Community
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- 1. 枚举类型定义
CREATE TYPE media_category AS ENUM (
    'movie',        -- 电影
    'tv_series',     -- 电视剧 / 剧集
    'anime',        -- 动画 / 番剧
    'music',        -- 音乐 / 专辑 / 原声带
    'audiobook',    -- 有声书 / 广播剧
    'novel',        -- 小说 / 文学图书
    'comic',        -- 漫画 / 条漫
    'gallery'       -- 画册 / 图集 / 插画
);

CREATE TYPE user_role AS ENUM ('guest', 'member', 'archivist', 'admin', 'banned');
CREATE TYPE transcode_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'skipped');
CREATE TYPE file_role AS ENUM ('master_archive', 'preview_stream', 'waveform_json', 'thumbnail', 'subtitle', 'cue_sheet', 'log_file');

-- 2. 用户与邀请体系 (Users & Invitations)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(64) UNIQUE NOT NULL,
    display_name VARCHAR(128),                     -- 昵称，独立于 username/email，可为空，显示时 fallback 到 username
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role DEFAULT 'member' NOT NULL,
    invites_remaining INT DEFAULT 2 NOT NULL,      -- 剩余可用邀请名额
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    avatar_url VARCHAR(512),
    bio TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) UNIQUE NOT NULL,
    inviter_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    used_by UUID REFERENCES users(id) ON DELETE SET NULL,
    is_used BOOLEAN DEFAULT FALSE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. 分类与标签图谱体系 (Categories & Tag Ontology)
CREATE TABLE categories (
    code VARCHAR(32) PRIMARY KEY,                  -- 如 'anime', 'music_classical', 'novel_scifi'
    parent_code VARCHAR(32) REFERENCES categories(code) ON DELETE SET NULL,
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) NOT NULL,
    media_type media_category NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    clc_prefix VARCHAR(16)                         -- 中国图书馆分类法前缀 (如 'I247.5')
);

CREATE TABLE virtual_shelves (
    slug VARCHAR(64) PRIMARY KEY,
    parent_slug VARCHAR(64) REFERENCES virtual_shelves(slug) ON DELETE CASCADE,
    name_zh VARCHAR(128) NOT NULL,
    name_en VARCHAR(128) NOT NULL,
    description TEXT,
    icon VARCHAR(64),
    sort_order INT DEFAULT 0 NOT NULL,
    query_tags TEXT[] DEFAULT '{}' NOT NULL,
    require_all_tags BOOLEAN DEFAULT FALSE NOT NULL,
    exclude_tags TEXT[] DEFAULT '{}' NOT NULL
);

CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) UNIQUE NOT NULL,
    group_type VARCHAR(32) NOT NULL,               -- Work: format/medium/genre/theme/general; leftover spec is unused; forum: topic
    category_scope media_category[] DEFAULT '{}'   -- 适用媒介范围 (空数组表示全媒介通用)
);

-- 4. 创作者与演职机构 (Artists / Creators / Studios / Labels / Publishers)
CREATE TABLE artists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255),
    disambiguation VARCHAR(255),
    entity_type VARCHAR(32) DEFAULT 'person' NOT NULL CHECK (entity_type IN ('person', 'group', 'orchestra', 'studio', 'publisher', 'circle', 'label')),
    country VARCHAR(64),
    biography TEXT,
    begin_date VARCHAR(16),                        -- 出生日期 / 成立年份 (如 "1979-01-18" 或 "1994")
    end_date VARCHAR(16),                          -- 逝世日期 / 解散年份 (如 "2011-05")
    ended BOOLEAN DEFAULT FALSE NOT NULL,          -- 是否已故 / 已解散
    external_ids JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 5. FRBR 概念模型 - 核心抽象作品 (Works)
CREATE TABLE works (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_code VARCHAR(64) DEFAULT 'general',
    title VARCHAR(255) NOT NULL,
    original_title VARCHAR(255),
    aliases VARCHAR(255)[] DEFAULT '{}',
    release_date DATE,
    begin_date VARCHAR(16),                        -- 连载/播映/创作起始日期 (如 "2011-10-01")
    end_date VARCHAR(16),                          -- 完结/停刊日期 (如 "2012-03-31")
    ended BOOLEAN DEFAULT FALSE NOT NULL,          -- 是否已完结
    country VARCHAR(64),
    language VARCHAR(64) DEFAULT 'zh-CN',
    summary TEXT,
    cover_image_url VARCHAR(512),
    content_rating VARCHAR(32) DEFAULT 'General',
    status VARCHAR(32) DEFAULT 'completed',
    view_count BIGINT DEFAULT 0 NOT NULL,
    
    -- 图书馆级编目扩展 (ISBN, ISSN, ISRC, CLC, DDC, MusicBrainz ID, TMDB ID, Bangumi ID 等)
    catalog_metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE work_tag_relations (
    work_id UUID REFERENCES works(id) ON DELETE CASCADE NOT NULL,
    tag_id INT REFERENCES tags(id) ON DELETE CASCADE NOT NULL,
    PRIMARY KEY (work_id, tag_id)
);

CREATE TABLE work_artist_relations (
    id SERIAL PRIMARY KEY,
    work_id UUID REFERENCES works(id) ON DELETE CASCADE NOT NULL,
    artist_id UUID REFERENCES artists(id) ON DELETE CASCADE NOT NULL,
    role VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 6. FRBR 概念模型 - 发行版 (Releases / Manifestations)
CREATE TABLE releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID REFERENCES works(id) ON DELETE CASCADE NOT NULL,
    publisher_id UUID REFERENCES artists(id) ON DELETE SET NULL, -- 精准关联到签约发行机构/厂牌/出版社档案
    edition_name VARCHAR(128) NOT NULL,            -- 如: "2CD + 1BDMV 初回限定纪念箱"
    catalog_number VARCHAR(128),                   -- 唱片号/出版号/条形码 (如: VIZL-9081)
    barcode VARCHAR(64),                           -- EAN-13 / UPC
    publisher VARCHAR(128),                        -- 出版社/发行厂牌/压制组 (展示文本冗余/回退)
    packaging VARCHAR(64) DEFAULT 'box_set',       -- 'box_set', 'jewel_case', 'digipak', 'hardcover'
    edition_date DATE,
    uploader_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_master_verified BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_releases_publisher_id ON releases(publisher_id);

-- 7. 载体/碟片层 (Mediums / Discs - 解决同商品多介质的核心)
CREATE TABLE mediums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id UUID REFERENCES releases(id) ON DELETE CASCADE NOT NULL,
    position INT NOT NULL,                         -- 碟片序号 (1, 2, 3, 4)
    name VARCHAR(128) NOT NULL,                    -- 碟片名 (如: "Disc 1: Original Soundtrack", "Disc 2: Bonus BDMV", "Booklet 设定集")
    format VARCHAR(64) NOT NULL,                   -- 'CD', 'SACD', 'Blu-ray', 'DVD', 'Vinyl', 'Book', 'Digital'
    media_category media_category NOT NULL,        -- 'music', 'movie', 'anime', 'novel', 'comic', 'gallery'
    track_count INT DEFAULT 0 NOT NULL
);

-- 8. 母版条目 (Canonical Entries) — 用于跨发行版复用（CN=abc / US=abcd 共享同一录音/分集母版）
CREATE TABLE canonical_entries (
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
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 9. 轨道/分集/章节 (Tracks / Chapters) — medium 上的位次引用，指向 canonical_entries
CREATE TABLE tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medium_id UUID REFERENCES mediums(id) ON DELETE CASCADE NOT NULL,
    canonical_entry_id UUID REFERENCES canonical_entries(id) ON DELETE SET NULL,
    work_id UUID REFERENCES works(id) ON DELETE SET NULL,
    position INT NOT NULL,
    title VARCHAR(255),
    title_override VARCHAR(255),
    duration_seconds INT,
    isrc VARCHAR(32),
    artist_credit VARCHAR(255)
);

-- 10. 物理资产文件与转码状态 (Asset Files)
CREATE TABLE asset_files (
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

-- 11. 通用高级语义关系图谱网络 (Universal Advanced Entity Relationships)
CREATE TABLE IF NOT EXISTS entity_type_definitions (
    code VARCHAR(64) PRIMARY KEY,
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

INSERT INTO entity_type_definitions (code, name_zh, name_en, names, desc_zh, desc_en, color, bg_color, border_color, sort_order, is_system, is_enabled) VALUES
('person',            '个人创作者',        'Individual Creator', '{"zh-CN":"个人创作者","en-US":"Individual Creator"}', '导演、著者、作曲家、编曲、作词、画师、声优等', 'Director, author, composer, arranger, lyricist, illustrator, voice actor, etc.', 'text-amber-400', 'bg-amber-500/10', 'border-amber-500/30', 10, TRUE, TRUE),
('virtual_character', '虚拟角色 / 人物',    'Virtual Character',  '{"zh-CN":"虚拟角色 / 人物","en-US":"Virtual Character"}', '二次元动漫/游戏角色、Vtuber 形象、虚拟企划人物等', 'Anime/Game fictional character, VTuber avatar, fictional persona, etc.', 'text-rose-400', 'bg-rose-500/10', 'border-rose-500/30', 15, TRUE, TRUE),
('fictional_band',    '虚拟组合 / 企划乐队', 'Fictional Band / Group', '{"zh-CN":"虚拟组合 / 企划乐队","en-US":"Fictional Band / Group"}', 'BanG Dream!、偶像大师、LoveLive! 等企划内虚构二次元组合', 'In-universe fictional music band or idol group (e.g. Poppin Party 2D, MyGO!!!!! 2D).', 'text-amber-400', 'bg-amber-500/10', 'border-amber-500/30', 18, TRUE, TRUE),
('studio',            '制作机构 / 工作室',  'Studio',             '{"zh-CN":"制作机构 / 工作室","en-US":"Studio"}',             '动画工作室、影视制作公司、开发组等', 'Animation studio, production company, dev team, etc.', 'text-purple-400', 'bg-purple-500/10', 'border-purple-500/30', 20, TRUE, TRUE),
('publisher',         '出版社 / 发行厂牌',  'Publisher / Label',  '{"zh-CN":"出版社 / 发行厂牌","en-US":"Publisher / Label"}',  '图书出版社、影音发行商、唱片公司等', 'Book publisher, AV distributor, record label, etc.', 'text-sky-400', 'bg-sky-500/10', 'border-sky-500/30', 30, TRUE, TRUE),
('orchestra',         '管弦乐团 / 歌剧团',  'Orchestra',          '{"zh-CN":"管弦乐团 / 歌剧团","en-US":"Orchestra"}',          '交响乐团、室内乐团、爱乐乐团等', 'Symphony, chamber orchestra, philharmonic, etc.', 'text-emerald-400', 'bg-emerald-500/10', 'border-emerald-500/30', 40, TRUE, TRUE),
('group',             '乐队 / 演职团体',    'Band / Group',       '{"zh-CN":"乐队 / 演职团体","en-US":"Band / Group"}',       '声优实装乐队、摇滚乐队、室内乐组合、偶像团体等', 'Real live band, rock band, chamber group, idol group, etc.', 'text-rose-400', 'bg-rose-500/10', 'border-rose-500/30', 50, TRUE, TRUE),
('circle',            '同人社团 / 独立组织', 'Circle',             '{"zh-CN":"同人社团 / 独立组织","en-US":"Circle"}',             '同人音乐社团、独立创作小组等', 'Doujin music circle, indie creative group, etc.', 'text-indigo-400', 'bg-indigo-500/10', 'border-indigo-500/30', 60, TRUE, TRUE),
('label',             '独立厂牌 / 子品牌',  'Indie Label',        '{"zh-CN":"独立厂牌 / 子品牌","en-US":"Indie Label"}',        '出版子厂牌、专项音乐厂牌等', 'Imprint, sub-label, specialty music label, etc.', 'text-teal-400', 'bg-teal-500/10', 'border-teal-500/30', 70, TRUE, TRUE)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE entity_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR(32) NOT NULL,              -- 'artist', 'work', 'release', 'expression'
    source_id UUID NOT NULL,
    target_type VARCHAR(32) NOT NULL,              -- 'artist', 'work', 'release', 'expression'
    target_id UUID NOT NULL,
    relationship_type VARCHAR(64) NOT NULL,        -- 外键关联 relation_types(code)
    begin_date VARCHAR(16),                        -- 生效起始: "2000-01-01" 或 "2000"
    end_date VARCHAR(16),                          -- 生效截止: "2007-03-01" 或 "2007"
    ended BOOLEAN DEFAULT FALSE NOT NULL,          -- 是否已终结
    attributes JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(source_type, source_id, target_type, target_id, relationship_type)
);

-- 12. 论坛分区 (Boards) — announcement=站点公告, casual=闲聊杂谈, qa=求助答疑, reviews=考据评注, bug_report=反馈与建议, comment=评论专用(不进feed)
CREATE TABLE IF NOT EXISTS forum_boards (
    code VARCHAR(32) PRIMARY KEY,
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) DEFAULT '',
    names JSONB DEFAULT '{}'::jsonb NOT NULL,
    description TEXT DEFAULT '',
    color VARCHAR(16) DEFAULT 'emerald' NOT NULL CHECK (color IN ('emerald','amber','sky','purple','cyan','rose','indigo','teal')),
    icon VARCHAR(32) DEFAULT 'BookOpen' NOT NULL CHECK (icon IN ('BookOpen','Cpu','Archive','Coffee','Layers','Hash','Tag','Sparkles','Flame','Bookmark','MessageSquare','Globe','Megaphone','Bug','MessageCircle')),
    sort_order INT DEFAULT 0 NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    show_in_feed BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 13. 社区讨论与文献评注 (Community Discussions & Comments)
CREATE TABLE discussion_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    board_code VARCHAR(32) DEFAULT 'announcement' NOT NULL,
    work_id UUID REFERENCES works(id) ON DELETE SET NULL,
    release_id UUID REFERENCES releases(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    view_count INT DEFAULT 0 NOT NULL,
    reply_count INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID REFERENCES discussion_topics(id) ON DELETE CASCADE,
    work_id UUID REFERENCES works(id) ON DELETE CASCADE,
    release_id UUID REFERENCES releases(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE topic_tag_relations (
    topic_id UUID REFERENCES discussion_topics(id) ON DELETE CASCADE,
    tag_id INT REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (topic_id, tag_id)
);

-- 种子分区（默认：announcement / casual / qa / reviews / bug_report / comment；comment 不进 feed）
INSERT INTO forum_boards (code, name_zh, name_en, description, color, icon, sort_order, is_enabled, show_in_feed, names) VALUES
('announcement', '站点公告',   'Announcements',          '站点公告与运营通知',                   'amber',   'Megaphone',     10, TRUE, TRUE,  '{"zh-CN":"站点公告","en-US":"Announcements"}'),
('casual',       '闲聊杂谈',   'Casual Chat',            '轻松闲聊与站内日常交流',               'purple',  'Coffee',        20, TRUE, TRUE,  '{"zh-CN":"闲聊杂谈","en-US":"Casual Chat"}'),
('qa',           '求助答疑',   'Q&A',                    '使用问题、编目与功能答疑',             'teal',    'Hash',          30, TRUE, TRUE,  '{"zh-CN":"求助答疑","en-US":"Q&A"}'),
('reviews',      '考据评注',   'Archive Reviews',        '版本考证、原盘评析与文献释读',         'emerald', 'BookOpen',      40, TRUE, TRUE,  '{"zh-CN":"考据评注","en-US":"Archive Reviews"}'),
('bug_report',   '反馈与建议', 'Feedback & Bug Reports', '缺陷反馈、功能建议与复现信息',         'rose',    'Bug',           50, TRUE, TRUE,  '{"zh-CN":"反馈与建议","en-US":"Feedback & Bug Reports"}'),
('comment',      '评论专用',   'Comments',               '作品与讨论的评论承载区，不进入信息流与全站聚合', 'sky',     'MessageCircle', 60, TRUE, FALSE, '{"zh-CN":"评论专用","en-US":"Comments"}')
ON CONFLICT (code) DO UPDATE SET name_zh=EXCLUDED.name_zh, name_en=EXCLUDED.name_en, description=EXCLUDED.description, color=EXCLUDED.color, icon=EXCLUDED.icon, sort_order=EXCLUDED.sort_order, is_enabled=EXCLUDED.is_enabled, show_in_feed=EXCLUDED.show_in_feed, names=EXCLUDED.names;

-- FK: 幂等绑定 board_code → forum_boards(code)
DO $$ BEGIN
    BEGIN
        ALTER TABLE discussion_topics DROP CONSTRAINT IF EXISTS discussion_topics_board_code_check;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_topics_board' AND conrelid='discussion_topics'::regclass) THEN
        ALTER TABLE discussion_topics ADD CONSTRAINT fk_topics_board FOREIGN KEY (board_code) REFERENCES forum_boards(code) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

-- 14. 索引与性能优化
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_invitations_code ON invitations(code);
CREATE INDEX idx_works_category ON works(category_code);
CREATE INDEX idx_works_catalog_metadata ON works USING GIN (catalog_metadata);
CREATE INDEX idx_releases_work ON releases(work_id);
CREATE INDEX idx_mediums_release ON mediums(release_id);
CREATE INDEX idx_tracks_medium ON tracks(medium_id);
CREATE INDEX idx_asset_files_release ON asset_files(release_id);
CREATE INDEX idx_asset_files_medium ON asset_files(medium_id);
CREATE INDEX idx_asset_files_hash ON asset_files(sha256_hash);
CREATE INDEX idx_asset_files_specs ON asset_files USING GIN (technical_specs);
CREATE INDEX idx_entity_rel_source ON entity_relationships(source_type, source_id);
CREATE INDEX idx_entity_rel_target ON entity_relationships(target_type, target_id);
CREATE INDEX idx_topics_work ON discussion_topics(work_id);
CREATE INDEX idx_topics_board_code ON discussion_topics(board_code);
CREATE INDEX idx_comments_work ON comments(work_id);
CREATE INDEX idx_comments_topic ON comments(topic_id);
CREATE INDEX idx_works_title_trgm ON works USING GIN (title gin_trgm_ops);
