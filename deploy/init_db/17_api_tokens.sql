-- 17_api_tokens.sql — MusicBrainz 风格外部 API 接入：个人访问令牌 (PAT) 与速率限制支撑
-- 支持类似 MusicBrainz WS/2 的机器接入：用户可创建 mfp_ 前缀的长期令牌供外部应用/agent 调用
-- 令牌仅存储 SHA256 哈希，原文明文仅在创建时返回一次

CREATE TABLE IF NOT EXISTS api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(64) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA256(hex) 长度 64
    prefix VARCHAR(12) NOT NULL, -- 明文前缀前 8 字符用于列表展示识别
    scopes TEXT[] DEFAULT '{read}' NOT NULL, -- read, write, edit, upload, community, admin
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON api_tokens(prefix);

-- 辅助更新 updated_at 触发器
CREATE OR REPLACE FUNCTION update_api_tokens_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_api_tokens_updated_at ON api_tokens;
CREATE TRIGGER trg_api_tokens_updated_at BEFORE UPDATE ON api_tokens
FOR EACH ROW EXECUTE FUNCTION update_api_tokens_updated_at();
