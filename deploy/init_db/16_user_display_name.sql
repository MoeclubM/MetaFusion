-- 16_user_display_name.sql — 用户昵称字段 (display_name) 幂等迁移
-- 昵称独立于 username/email，可为空，显示时 fallback 到 username

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(128);
CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);
