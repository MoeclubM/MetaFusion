-- 10_user_custom_shelves.sql — 用户自建推荐分组 + 个人首页布局
-- 后台 virtual_shelves 为全站预设；此表为用户级自定义分组（私有默认，可设公开）

CREATE TABLE IF NOT EXISTS user_custom_shelves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    slug VARCHAR(64) NOT NULL,
    name_zh VARCHAR(128) NOT NULL,
    name_en VARCHAR(128) NOT NULL DEFAULT '',
    description TEXT DEFAULT '' NOT NULL,
    icon VARCHAR(64) DEFAULT 'Sparkles' NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    media_type VARCHAR(32) DEFAULT 'all' NOT NULL,
    query_tags TEXT[] DEFAULT '{}' NOT NULL,
    require_all_tags BOOLEAN DEFAULT FALSE NOT NULL,
    exclude_tags TEXT[] DEFAULT '{}' NOT NULL,
    is_public BOOLEAN DEFAULT FALSE NOT NULL,
    view_count INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(owner_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_user_custom_shelves_owner ON user_custom_shelves(owner_id);
CREATE INDEX IF NOT EXISTS idx_user_custom_shelves_public ON user_custom_shelves(is_public) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_custom_shelves_slug ON user_custom_shelves(slug);

-- 个人首页布局：对系统预设的隐藏 + 整体顺序（含系统 slug 与 custom:<uuid>）
CREATE TABLE IF NOT EXISTS user_home_layouts (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    hidden_system_slugs TEXT[] DEFAULT '{}' NOT NULL,
    order_json JSONB DEFAULT '[]' NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
