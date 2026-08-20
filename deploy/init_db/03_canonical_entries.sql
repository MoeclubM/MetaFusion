-- 03_canonical_entries.sql — 增量迁移：母版条目与跨发行复用
-- 幂等，可在已初始化过的库上重复执行（配合 AutoMigrate 使用）

-- 1) 母版条目表
CREATE TABLE IF NOT EXISTS canonical_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    sort_title VARCHAR(255),
    duration_seconds INT,
    isrc VARCHAR(32),
    isbn VARCHAR(32),
    artist_credit VARCHAR(255),
    work_id UUID REFERENCES works(id) ON DELETE SET NULL,
    external_ids JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2) tracks 新增列（若已存在则跳过）
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS canonical_entry_id UUID REFERENCES canonical_entries(id) ON DELETE SET NULL;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS title_override VARCHAR(255);
-- 存量库中 title 曾为 NOT NULL，改为可空以支持纯母版引用
ALTER TABLE tracks ALTER COLUMN title DROP NOT NULL;

ALTER TABLE asset_files ADD COLUMN IF NOT EXISTS canonical_entry_id UUID REFERENCES canonical_entries(id) ON DELETE SET NULL;

-- 3) 索引
CREATE INDEX IF NOT EXISTS idx_canonical_entries_work ON canonical_entries(work_id);
CREATE INDEX IF NOT EXISTS idx_canonical_entries_title_trgm ON canonical_entries USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tracks_canonical_entry ON tracks(canonical_entry_id);
CREATE INDEX IF NOT EXISTS idx_asset_files_canonical_entry ON asset_files(canonical_entry_id);

-- 4) 存量数据回填：为无母版关联的 track 自动创建 canonical_entry（标题/时长/ISRC/署名继承）
--    仅回填一次，重复执行因 WHERE canonical_entry_id IS NULL 不会重复创建
INSERT INTO canonical_entries (id, title, duration_seconds, isrc, artist_credit, work_id)
SELECT gen_random_uuid(), t.title, t.duration_seconds, t.isrc, t.artist_credit, t.work_id
FROM tracks t
WHERE t.canonical_entry_id IS NULL AND t.title IS NOT NULL AND t.title <> '';

-- 将新建母版回绑至对应 track（按 title+work_id+artist_credit 精确匹配，避免跨作品串扰）
UPDATE tracks t SET canonical_entry_id = ce.id
FROM canonical_entries ce
WHERE t.canonical_entry_id IS NULL
  AND ce.title = t.title
  AND COALESCE(ce.work_id::text,'') = COALESCE(t.work_id::text,'')
  AND COALESCE(ce.artist_credit,'') = COALESCE(t.artist_credit,'');
