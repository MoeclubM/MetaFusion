-- 账号系统独立化：把 users/sessions/oauth_* 从 catalog schema 迁到 auth schema，
-- 并断开 catalog 侧指向 catalog.users 的 7 处外键，改为裸 UUID + 应用层校验。
--
-- 幂等：与 internal/catalog/schema.sql 中的 DO 块一致，重复执行为空操作。
-- 之所以两处都放，是因为 Initialize() 在启动时必跑 schema.sql，而 migrate 是
-- 独立版本化轨道；任一先执行都能把数据搬到 auth，不会出现"代码读 auth 但
-- 数据还在 catalog"的窗口。
-- 独立账号 schema：与 internal/catalog/schema.sql 保持同一定义。
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
 id uuid PRIMARY KEY, username text NOT NULL UNIQUE, email text NOT NULL DEFAULT '', password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('editor','admin'))
);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS auth.sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS auth.oauth_clients (
 id text PRIMARY KEY, secret_hash text NOT NULL, name text NOT NULL,
 redirect_uris text[] NOT NULL DEFAULT '{}', trusted boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth.oauth_codes (
 code text PRIMARY KEY, client_id text NOT NULL REFERENCES auth.oauth_clients(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 redirect_uri text NOT NULL, scope text NOT NULL DEFAULT 'profile',
 expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS auth.oauth_tokens (
 token_hash text PRIMARY KEY, client_id text NOT NULL REFERENCES auth.oauth_clients(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 scope text NOT NULL DEFAULT 'profile', expires_at timestamptz NOT NULL
);

-- 搬迁数据并删除遗留表（幂等）。
DO $$
DECLARE c record;
BEGIN
  IF to_regclass('catalog.users') IS NULL THEN
    RETURN; -- 已搬迁过（或全新库，auth.users 由 schema.sql 建好）
  END IF;
  INSERT INTO auth.users(id, username, email, password_hash, role)
    SELECT id, username, email, password_hash, role FROM catalog.users
    ON CONFLICT (id) DO NOTHING;
  IF to_regclass('catalog.sessions') IS NOT NULL THEN
    INSERT INTO auth.sessions(token_hash, user_id, expires_at)
      SELECT token_hash, user_id, expires_at FROM catalog.sessions
      WHERE user_id IN (SELECT id FROM auth.users)
      ON CONFLICT (token_hash) DO NOTHING;
  END IF;
  IF to_regclass('catalog.oauth_clients') IS NOT NULL THEN
    INSERT INTO auth.oauth_clients(id, secret_hash, name, redirect_uris, trusted, created_at)
      SELECT id, secret_hash, name, redirect_uris, trusted, created_at FROM catalog.oauth_clients
      ON CONFLICT (id) DO NOTHING;
  END IF;
  IF to_regclass('catalog.oauth_codes') IS NOT NULL THEN
    INSERT INTO auth.oauth_codes(code, client_id, user_id, redirect_uri, scope, expires_at, used)
      SELECT code, client_id, user_id, redirect_uri, scope, expires_at, used FROM catalog.oauth_codes
      WHERE user_id IN (SELECT id FROM auth.users)
      ON CONFLICT (code) DO NOTHING;
  END IF;
  IF to_regclass('catalog.oauth_tokens') IS NOT NULL THEN
    INSERT INTO auth.oauth_tokens(token_hash, client_id, user_id, scope, expires_at)
      SELECT token_hash, client_id, user_id, scope, expires_at FROM catalog.oauth_tokens
      WHERE user_id IN (SELECT id FROM auth.users)
      ON CONFLICT (token_hash) DO NOTHING;
  END IF;
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype='f' AND confrelid = to_regclass('catalog.users')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
  DROP TABLE IF EXISTS catalog.oauth_tokens, catalog.oauth_codes, catalog.oauth_clients,
                       catalog.sessions, catalog.users CASCADE;
END $$;
