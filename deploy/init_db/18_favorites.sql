-- 18_favorites.sql — 用户收藏与资料隐私开关
-- 收藏支持 work / release / artist 三类目标，user_id + target 唯一
-- 隐私默认值：收藏公开（favorites_public=true）、邮箱私密（email_public=false）

CREATE TABLE IF NOT EXISTS favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    target_type VARCHAR(16) NOT NULL, -- 'work', 'release', 'artist'
    target_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uni_fav_user_target UNIQUE (user_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_created_at ON favorites(created_at);
CREATE INDEX IF NOT EXISTS idx_favorites_target ON favorites(target_type, target_id);

-- 资料隐私开关（AutoMigrate 在旧库上可能因历史约束名差异中断，这里幂等补齐）
ALTER TABLE users ADD COLUMN IF NOT EXISTS favorites_public BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_public BOOLEAN NOT NULL DEFAULT FALSE;
