-- 回滚：把账号表搬回 catalog schema 并恢复外键。
-- 注意：外键在搬迁时已被断开，回滚只能恢复"存在性"，不会重建历史数据以外的关联。
DO $$
DECLARE c record;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN;
  END IF;
  CREATE TABLE IF NOT EXISTS catalog.users (
    id uuid PRIMARY KEY, username text NOT NULL UNIQUE, email text NOT NULL DEFAULT '',
    password_hash text NOT NULL, role text NOT NULL CHECK (role IN ('editor','admin'))
  );
  CREATE TABLE IF NOT EXISTS catalog.sessions (
    token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES catalog.users(id), expires_at timestamptz NOT NULL
  );
  CREATE TABLE IF NOT EXISTS catalog.oauth_clients (
    id text PRIMARY KEY, secret_hash text NOT NULL, name text NOT NULL,
    redirect_uris text[] NOT NULL DEFAULT '{}', trusted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS catalog.oauth_codes (
    code text PRIMARY KEY, client_id text NOT NULL REFERENCES catalog.oauth_clients(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES catalog.users(id) ON DELETE CASCADE,
    redirect_uri text NOT NULL, scope text NOT NULL DEFAULT 'profile',
    expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false
  );
  CREATE TABLE IF NOT EXISTS catalog.oauth_tokens (
    token_hash text PRIMARY KEY, client_id text NOT NULL REFERENCES catalog.oauth_clients(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES catalog.users(id) ON DELETE CASCADE,
    scope text NOT NULL DEFAULT 'profile', expires_at timestamptz NOT NULL
  );
  INSERT INTO catalog.users SELECT * FROM auth.users ON CONFLICT (id) DO NOTHING;
  INSERT INTO catalog.sessions SELECT * FROM auth.sessions ON CONFLICT (token_hash) DO NOTHING;
  INSERT INTO catalog.oauth_clients SELECT * FROM auth.oauth_clients ON CONFLICT (id) DO NOTHING;
  INSERT INTO catalog.oauth_codes SELECT * FROM auth.oauth_codes ON CONFLICT (code) DO NOTHING;
  INSERT INTO catalog.oauth_tokens SELECT * FROM auth.oauth_tokens ON CONFLICT (token_hash) DO NOTHING;
  DROP TABLE IF EXISTS auth.oauth_tokens, auth.oauth_codes, auth.oauth_clients, auth.sessions, auth.users CASCADE;
END $$;

-- 恢复 catalog 侧外键（仅在列确实存在时）。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='entities_created_by_fkey') THEN
    ALTER TABLE catalog.entities ADD CONSTRAINT entities_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES catalog.users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='revisions_actor_id_fkey') THEN
    ALTER TABLE catalog.revisions ADD CONSTRAINT revisions_actor_id_fkey
      FOREIGN KEY (actor_id) REFERENCES catalog.users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='favorites_user_id_fkey') THEN
    ALTER TABLE catalog.favorites ADD CONSTRAINT favorites_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES catalog.users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_preferences_user_id_fkey') THEN
    ALTER TABLE catalog.user_preferences ADD CONSTRAINT user_preferences_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES catalog.users(id) ON DELETE CASCADE;
  END IF;
END $$;
