-- 回滚 000004：按 000001 基线原样恢复列与索引。
ALTER TABLE IF EXISTS catalog.entities ADD COLUMN IF NOT EXISTS redirect_id uuid REFERENCES catalog.entities(id);
ALTER TABLE IF EXISTS catalog.deliveries ADD COLUMN IF NOT EXISTS delivered_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE IF EXISTS catalog.user_preferences ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- 注意：索引随表落在 catalog schema（CREATE INDEX … ON catalog.entities），
-- search_path 默认不含 catalog，因此 DROP 必须带 schema 限定，否则打空。
CREATE INDEX IF NOT EXISTS entities_search ON catalog.entities USING gin (to_tsvector('simple',title));
CREATE INDEX IF NOT EXISTS entities_document ON catalog.entities USING gin (document jsonb_path_ops);
