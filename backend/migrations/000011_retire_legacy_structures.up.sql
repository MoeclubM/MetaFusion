-- 退役结构清理：从启动 SQL 迁出，改由版本化迁移执行。
--
-- 背景：shelves/external_databases 早前以 name_zh/name_en 双列存名称，收藏用旧
-- work/release/artist/franchise/canonical_entry 词表。现名称只走 names 多语言映射、
-- target_type 即实体 kind（固定八骨架）。这里是**一次性数据迁移**：删列、归一旧词表、
-- 重建收藏 CHECK。它不应在每次启动时重复承担，故从 schema.sql 移入本迁移；全部语句
-- 幂等（IF EXISTS / NOT IN），在既有无历史数据的实例上也是空操作。

ALTER TABLE catalog.shelves DROP COLUMN IF EXISTS name_zh;
ALTER TABLE catalog.shelves DROP COLUMN IF EXISTS name_en;
ALTER TABLE catalog.external_databases DROP COLUMN IF EXISTS name_zh;
ALTER TABLE catalog.external_databases DROP COLUMN IF EXISTS name_en;
-- 来源适用范围旧词表（artist/franchise/canonical_entry）归一到对应实体 kind；
-- 旧值已不在新词表内，不归一会让这些来源在新 kind 的详情页永远筛不出来。
UPDATE catalog.external_databases SET category = CASE category
  WHEN 'artist' THEN 'agent'
  WHEN 'franchise' THEN 'collection'
  WHEN 'canonical_entry' THEN 'expression'
  ELSE category END
WHERE category IN ('artist','franchise','canonical_entry');
DELETE FROM catalog.favorites WHERE target_type NOT IN ('agent','collection','work','content_unit','expression','release','medium','track');
-- 收藏旧词表 CHECK 的约束名不固定（内联列约束由 PG 命名），按定义匹配而不按名字。
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'catalog.favorites'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%target_type%'
      AND pg_get_constraintdef(oid) NOT LIKE '%content_unit%'
  LOOP
    EXECUTE format('ALTER TABLE catalog.favorites DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'catalog.favorites'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%content_unit%'
  ) THEN
    ALTER TABLE catalog.favorites ADD CONSTRAINT favorites_target_type_check
      CHECK (target_type IN ('agent','collection','work','content_unit','expression','release','medium','track'));
  END IF;
END $$;
