-- 外部来源精简：厂商官网类 code 合并为通用类别。
-- (a) external_databases 表：停用 bushiroad_music / dlsite_maker，新增 publisher_website。
-- (b) entities.document->'external_ids' JSONB：把旧 code 的键迁移到新 code，
--     slug/maker_id 拼接为完整 URL，零丢失（目标键已存在时保留旧键，不覆盖）。

-- ===== (a) 更新 external_databases 表 =====

-- 停用厂商官网专用 code（保留行用于历史数据读路径校验，不删除）
UPDATE catalog.external_databases SET is_enabled = false
WHERE code IN ('bushiroad_music', 'dlsite_maker');

-- 新增 publisher_website 通用类别（与 official_website 同级，存完整 URL）
INSERT INTO catalog.external_databases (code, names, category, url_pattern, icon, icon_url, validation_regex, description, sort_order, is_enabled, is_system)
VALUES (
  'publisher_website',
  '{"zh-CN":"出版社 / 厂商官网","zh-TW":"出版社 / 廠商官網","ja":"出版社・メーカー公式サイト","ja-JP":"出版社・メーカー公式サイト","en-US":"Publisher Website"}'::jsonb,
  'all',
  '{id}',
  'Building2',
  '',
  '',
  '出版社 / 社团 / 厂商官方主页（存完整 URL）',
  6,
  true,
  true
)
ON CONFLICT (code) DO NOTHING;

-- ===== (b) 迁移 entities.external_ids JSONB =====

-- bushiroad_music → official_website：slug 拼为完整 URL
-- 仅当 official_website 键不存在时迁移（避免覆盖已有值，零丢失）。
UPDATE catalog.entities
SET document = jsonb_set(
  document #- '{external_ids,bushiroad_music}',
  '{external_ids,official_website}',
  to_jsonb('https://bushiroad-music.com/musics/' || (document->'external_ids'->>'bushiroad_music') || '/'),
  true
)
WHERE document->'external_ids' ? 'bushiroad_music'
  AND NOT (document->'external_ids' ? 'official_website');

-- dlsite_maker → publisher_website：maker_id 拼为完整 URL
-- 仅当 publisher_website 键不存在时迁移（避免覆盖已有值，零丢失）。
UPDATE catalog.entities
SET document = jsonb_set(
  document #- '{external_ids,dlsite_maker}',
  '{external_ids,publisher_website}',
  to_jsonb('https://www.dlsite.com/maniax/circle/profile/=/maker_id=' || (document->'external_ids'->>'dlsite_maker') || '.html'),
  true
)
WHERE document->'external_ids' ? 'dlsite_maker'
  AND NOT (document->'external_ids' ? 'publisher_website');
