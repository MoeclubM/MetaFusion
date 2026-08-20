-- 07_system_settings.sql — 站点开关：注册/邀请（幂等）

CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- registration_enabled: 是否开放注册（true/false）
-- invite_required: 注册是否必须邀请码（true/false）
INSERT INTO system_settings(key, value) VALUES
  ('registration_enabled', 'true'),
  ('invite_required', 'true')
ON CONFLICT (key) DO NOTHING;
