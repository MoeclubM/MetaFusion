-- 回滚：本迁移是退役清理，语义上不可逆——被删列与旧词表收藏行不保留原始值。
-- 因此回滚只撤销"收藏 CHECK 归一"这一项可恢复的部分，删列不重建（避免造出空列
-- 反而与 schema.sql 的定义冲突）。如需完整旧结构，应从迁移前的备份恢复。
ALTER TABLE catalog.favorites DROP CONSTRAINT IF EXISTS favorites_target_type_check;
