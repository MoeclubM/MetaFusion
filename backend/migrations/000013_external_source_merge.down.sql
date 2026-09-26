-- 回滚外部来源精简迁移：
-- 注意：JSONB 数据迁移不可逆（URL → slug/maker_id 的反向拆分不可靠），
-- 回滚仅恢复 external_databases 表的启用状态与删除新增行，不还原 external_ids 键。

-- 重新启用旧 code
UPDATE catalog.external_databases SET is_enabled = true
WHERE code IN ('bushiroad_music', 'dlsite_maker');

-- 删除 publisher_website（若存在且无外键引用）
DELETE FROM catalog.external_databases WHERE code = 'publisher_website';
