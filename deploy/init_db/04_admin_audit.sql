-- ==============================================================================
-- 04_admin_audit.sql — 管理后台审计与 banned 角色支持
-- ==============================================================================

-- 1. 扩展 user_role 枚举，增加 banned (若已存在则跳过)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
        WHERE pg_type.typname = 'user_role' AND pg_enum.enumlabel = 'banned'
    ) THEN
        ALTER TYPE user_role ADD VALUE 'banned';
    END IF;
END$$;

-- 2. 确保 users 表存在 invite_code 列 (历史库可能缺少)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'invite_code'
    ) THEN
        ALTER TABLE users ADD COLUMN invite_code VARCHAR(64) UNIQUE;
    END IF;
END$$;

-- 3. 管理审计日志表
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

CREATE INDEX IF NOT EXISTS idx_audit_actor ON admin_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON admin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_target ON admin_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_detail_gin ON admin_audit_logs USING GIN (detail);
