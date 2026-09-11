-- 000009 回滚：移除 PKCE 列（已签发未兑付的 PKCE 码将无法校验，按过期自然失效）。
ALTER TABLE auth.oauth_codes DROP COLUMN IF EXISTS code_challenge_method;
ALTER TABLE auth.oauth_codes DROP COLUMN IF EXISTS code_challenge;
