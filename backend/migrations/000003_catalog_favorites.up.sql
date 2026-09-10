-- 用户收藏：详情页收藏按钮与"我的收藏/用户收藏"列表共用。
-- target_type 保留前端既有词表（work/release/artist/franchise/canonical_entry），
-- 落库时校验目标实体存在且可见，避免收藏到不存在的 ID。
CREATE TABLE IF NOT EXISTS catalog.favorites (
 user_id uuid NOT NULL REFERENCES catalog.users(id) ON DELETE CASCADE,
 target_type text NOT NULL CHECK (target_type IN ('work','release','artist','franchise','canonical_entry')),
 target_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS favorites_target ON catalog.favorites(target_type, target_id);
CREATE INDEX IF NOT EXISTS favorites_user_created ON catalog.favorites(user_id, created_at DESC);
