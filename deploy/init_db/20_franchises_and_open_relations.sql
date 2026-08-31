-- 20_franchises_and_open_relations.sql
-- Franchise 枢纽 + 开放关系图（qualifier / 端点）+ Release 地区渠道 + 解开 artists.entity_type CHECK

-- 1) 企划 / 世界观
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
    external_ids JSONB DEFAULT '{}'::jsonb NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_franchises_title ON franchises(title);
CREATE INDEX IF NOT EXISTS idx_franchises_created_at ON franchises(created_at);

-- 2) 解开 artists.entity_type 硬编码 CHECK，改为引用字典
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'artists'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%entity_type%'
    LOOP
        EXECUTE format('ALTER TABLE artists DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_artists_entity_type') THEN
        ALTER TABLE artists ADD CONSTRAINT fk_artists_entity_type
            FOREIGN KEY (entity_type) REFERENCES entity_type_definitions(code)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 3) 关系同类多边：qualifier + 新唯一约束
ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS qualifier VARCHAR(64) NOT NULL DEFAULT '';

DO $$ BEGIN
    ALTER TABLE entity_relationships DROP CONSTRAINT IF EXISTS entity_relationships_source_type_source_id_target_type_target_id_relationship_type_key;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'entity_relationships'::regclass AND contype = 'u'
    LOOP
        EXECUTE format('ALTER TABLE entity_relationships DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'entity_relationships_edge_unique' AND conrelid = 'entity_relationships'::regclass
    ) THEN
        ALTER TABLE entity_relationships ADD CONSTRAINT entity_relationships_edge_unique
            UNIQUE (source_type, source_id, target_type, target_id, relationship_type, qualifier);
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 4) Release 地区 / 语种 / 渠道 / 编目 JSON
ALTER TABLE releases ADD COLUMN IF NOT EXISTS country VARCHAR(64) DEFAULT '';
ALTER TABLE releases ADD COLUMN IF NOT EXISTS language VARCHAR(64) DEFAULT '';
ALTER TABLE releases ADD COLUMN IF NOT EXISTS distribution_channel VARCHAR(32) DEFAULT 'mixed' NOT NULL;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS catalog_metadata JSONB DEFAULT '{}'::jsonb NOT NULL;

-- 5) works.category_code 可空（Categories 已废弃）
ALTER TABLE works ALTER COLUMN category_code DROP NOT NULL;
ALTER TABLE works ALTER COLUMN category_code SET DEFAULT '';

-- 6) 关系词表增量与放宽
INSERT INTO relation_types (
    code, domain, name_zh, name_en, names, description,
    forward_label_zh, reverse_label_zh, forward_label_en, reverse_label_en,
    allowed_source_types, allowed_target_types,
    is_symmetric, is_hierarchical, attribute_schema, color, icon, sort_order, is_system, is_enabled
) VALUES
(
    'part_of_franchise', 'work_franchise', '企划归属', 'Part of Franchise',
    jsonb_build_object('zh-CN', '企划归属', 'en-US', 'Part of Franchise'),
    '作品、子企划或主体归属于某跨媒介企划/世界观',
    '属于企划', '企划包含', 'is part of franchise', 'contains',
    ARRAY['work', 'franchise', 'artist', 'person', 'group', 'virtual_character', 'studio', 'publisher'],
    ARRAY['franchise'],
    FALSE, TRUE, '[]'::jsonb, 'indigo', 'Layers', 306, TRUE, TRUE
),
(
    'unofficial_of', 'work_work', '非官方 / 同人衍生', 'Unofficial Of',
    jsonb_build_object('zh-CN', '非官方衍生', 'en-US', 'Unofficial Of'),
    '网络上传、未出版或同人作品相对于官方作品',
    '为该作的非官方衍生', '拥有非官方衍生', 'is unofficial of', 'has unofficial derivative',
    ARRAY['work'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'rose', 'GitFork', 335, TRUE, TRUE
),
(
    'imprint_of', 'agent_franchise', '企划子厂牌 / 品牌', 'Imprint Of',
    jsonb_build_object('zh-CN', '企划子厂牌', 'en-US', 'Imprint Of'),
    '音乐厂牌或子品牌隶属于某跨媒介企划（如塞壬唱片）',
    '为该企划的厂牌/品牌', '旗下厂牌', 'is imprint of', 'has imprint',
    ARRAY['publisher', 'studio', 'artist'], ARRAY['franchise'],
    FALSE, TRUE, '[]'::jsonb, 'teal', 'Disc', 55, TRUE, TRUE
),
(
    'alternate_form_of', 'agent_agent', '角色变体 / 形态', 'Alternate Form Of',
    jsonb_build_object('zh-CN', '角色变体', 'en-US', 'Alternate Form Of'),
    '同一角色的不同形态（如 Saber Alter）',
    '为该角色的变体', '拥有变体形态', 'is alternate form of', 'has alternate form',
    ARRAY['virtual_character'], ARRAY['virtual_character'],
    FALSE, FALSE,
    '[{"key": "form_name", "type": "string", "label": "形态名"}]'::jsonb,
    'purple', 'Sparkles', 37, TRUE, TRUE
),
(
    'crossover_with', 'work_work', '跨界联动', 'Crossover With',
    jsonb_build_object('zh-CN', '跨界联动', 'en-US', 'Crossover With'),
    '作品或企划之间的联动活动',
    '联动于', '联动于', 'crossovers with', 'crossovers with',
    ARRAY['work', 'franchise'], ARRAY['work', 'franchise'],
    TRUE, FALSE, '[]'::jsonb, 'amber', 'Handshake', 336, TRUE, TRUE
),
(
    'creator_of', 'agent_franchise', '世界观原作 / 创企划', 'Creator Of Franchise',
    jsonb_build_object('zh-CN', '创企划', 'en-US', 'Creator Of'),
    '作者或团队创立可被衍生的世界观/企划（与单部作品的 author 分工）',
    '创立了企划', '企划原作为', 'created franchise', 'was created by',
    ARRAY['person', 'group', 'studio', 'artist'], ARRAY['franchise'],
    FALSE, FALSE, '[]'::jsonb, 'emerald', 'Award', 38, TRUE, TRUE
),
(
    'included_in', 'work_work', '收录于', 'Included In',
    jsonb_build_object('zh-CN', '收录于', 'en-US', 'Included In'),
    '单曲或曲目母版被专辑/合集收录',
    '收录于', '收录了', 'is included in', 'includes',
    ARRAY['work', 'canonical_entry'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'cyan', 'Disc', 337, TRUE, TRUE
),
(
    'expansion_of', 'work_work', '资料片 / 扩展', 'Expansion Of',
    jsonb_build_object('zh-CN', '资料片', 'en-US', 'Expansion Of'),
    '独立发售的 DLC/资料片相对于本体作品（分服客户端不要用此关系）',
    '为该作的资料片', '拥有资料片', 'is expansion of', 'has expansion',
    ARRAY['work'], ARRAY['work'],
    FALSE, FALSE, '[]'::jsonb, 'sky', 'PackagePlus', 338, TRUE, TRUE
)
ON CONFLICT (code) DO UPDATE SET
    domain = EXCLUDED.domain,
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    names = EXCLUDED.names,
    description = EXCLUDED.description,
    forward_label_zh = EXCLUDED.forward_label_zh,
    reverse_label_zh = EXCLUDED.reverse_label_zh,
    forward_label_en = EXCLUDED.forward_label_en,
    reverse_label_en = EXCLUDED.reverse_label_en,
    allowed_source_types = EXCLUDED.allowed_source_types,
    allowed_target_types = EXCLUDED.allowed_target_types,
    is_symmetric = EXCLUDED.is_symmetric,
    is_hierarchical = EXCLUDED.is_hierarchical,
    attribute_schema = EXCLUDED.attribute_schema,
    color = EXCLUDED.color,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order,
    is_system = EXCLUDED.is_system,
    is_enabled = EXCLUDED.is_enabled,
    updated_at = NOW();

-- 放宽既有谓词
UPDATE relation_types SET
    allowed_source_types = ARRAY['person', 'virtual_character'],
    allowed_target_types = ARRAY['group', 'orchestra', 'studio', 'publisher'],
    updated_at = NOW()
WHERE code = 'member_of';

UPDATE relation_types SET
    allowed_source_types = ARRAY['virtual_character'],
    allowed_target_types = ARRAY['work', 'franchise'],
    updated_at = NOW()
WHERE code = 'character_in';

UPDATE relation_types SET
    allowed_source_types = ARRAY['person', 'group', 'orchestra', 'studio', 'publisher', 'virtual_character'],
    allowed_target_types = ARRAY['person', 'group', 'orchestra', 'studio', 'publisher', 'virtual_character'],
    updated_at = NOW()
WHERE code = 'collaborates_with';

UPDATE relation_types SET
    attribute_schema = '[{"key": "locale", "type": "string", "label": "配音语种"}, {"key": "region", "type": "string", "label": "地区"}, {"key": "character_name", "type": "string", "label": "角色全名"}, {"key": "is_original_cast", "type": "boolean", "label": "初代/原案声优"}]'::jsonb,
    updated_at = NOW()
WHERE code = 'voice_actor_of';
