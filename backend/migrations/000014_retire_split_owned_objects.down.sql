-- 回滚：只恢复目录侧自己的表（空表），不重建 auth schema 的对象。
-- 收藏数据若要一并回到目录侧，属"切回单体"的回滚窗口，按 docs/architecture/cutover-runbook.md
-- 用 community-migrate 的 back 方向搬运，而不是靠这条 down。

CREATE TABLE IF NOT EXISTS catalog.favorites (
 user_id uuid NOT NULL,
 target_type text NOT NULL CHECK (target_type IN ('agent','collection','work','content_unit','expression','release','medium','track')),
 target_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS favorites_target ON catalog.favorites(target_type, target_id);
CREATE INDEX IF NOT EXISTS favorites_user_created ON catalog.favorites(user_id, created_at DESC);
