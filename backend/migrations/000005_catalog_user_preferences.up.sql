-- 用户首页推荐偏好：用户可自定义首页展示哪些推荐分区及其顺序。
-- 只存"展示顺序 + 隐藏项"，分区内容仍由 catalog.shelves 规则驱动，
-- 因此管理台调整规则时用户偏好无需迁移。用户可留空表示使用默认顺序。
CREATE TABLE IF NOT EXISTS catalog.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES catalog.users(id) ON DELETE CASCADE,
  home_shelves jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
