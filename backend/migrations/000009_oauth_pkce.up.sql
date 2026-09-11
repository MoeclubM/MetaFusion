-- OAuth 授权码表补 PKCE 列（code_challenge / code_challenge_method=S256|plain）。
-- schema.sql 终态已含这两列；本迁移让 mf-migrate up 的存量库对齐。
ALTER TABLE auth.oauth_codes ADD COLUMN IF NOT EXISTS code_challenge text NOT NULL DEFAULT '';
ALTER TABLE auth.oauth_codes ADD COLUMN IF NOT EXISTS code_challenge_method text NOT NULL DEFAULT '';
