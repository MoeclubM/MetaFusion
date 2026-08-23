-- 34_community_genesis_uuid_migration.sql
-- 规整旧版种子数据中具有规律假占位特征的 UUID（如 00000000-0000-4000-8000-000000000001）
-- 保证历史库实例平滑升级，清理旧测试占位，由 99_seed.sql 重新播种标准 UUIDv4

DO $$
BEGIN
    -- 级联清理旧的连续假 UUID 测试帖（关联的 forum_posts / translations / tags 会通过 FK 级联自动清理）
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'discussion_topics') THEN
        DELETE FROM discussion_topics WHERE id = '00000000-0000-4000-8000-000000000001'::uuid;
    END IF;
END $$;
