-- 同语种多标题：翻译行新增 aliases 数组（主标题仍为行内 title/name 字段）。
-- original_language 仅作“原始语言”标记：原语言标题归属对应语种翻译行，
-- 不再把原语言标题塞进实体级 aliases。
ALTER TABLE work_translations ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE artist_translations ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE franchise_translations ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}';
