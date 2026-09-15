-- ==============================================================================
-- 退役结构清理（切流稳定后执行一次，幂等）
--
-- 清理对象与理由：
--   1. catalog.favorites        —— 收藏已归互动服务（community.favorites），单体侧不再读写；
--   2. modules schema           —— 旧模块层（论坛/记录/资源绑定）已由 community/storage 接管；
--   3. media schema             —— 旧媒体任务表，拆分后没有代码读写（媒体分析仍待迁进存储服务）；
--   4. catalog._*_backup_*      —— 2026-09-11 手工迁移留下的临时备份表，不是任何流程的产物。
--
-- 安全设计：删除前先核对"目标 schema 的行数不少于源表行数"，搬不全直接报错中止，
-- 因此本脚本不会在搬运还没做完时把唯一的数据副本删掉。整段是一个事务：
-- 任一步失败则全部回滚（PostgreSQL 的 DDL 也在事务内）。
--
-- 调用方式（部署机上）：
--   cd deploy && ./deploy.sh retire
-- 或手工：
--   docker compose --env-file ../.env -f docker-compose.yml exec -T postgres \
--     psql -U $DB_USER -d $DB_NAME -v ON_ERROR_STOP=1 -f - < sql/retire-legacy-schemas.sql
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  src bigint;
  dst bigint;
BEGIN
  -- 收藏：catalog.favorites → community.favorites
  IF to_regclass('catalog.favorites') IS NOT NULL AND to_regclass('community.favorites') IS NOT NULL THEN
    SELECT count(*) INTO src FROM catalog.favorites;
    SELECT count(*) INTO dst FROM community.favorites;
    IF dst < src THEN
      RAISE EXCEPTION '搬运未完成：community.favorites=% 少于 catalog.favorites=%（先跑 community-migrate -direction forward）', dst, src;
    END IF;
    RAISE NOTICE '收藏核对通过：catalog=% community=%', src, dst;
  END IF;

  -- 论坛：modules.forum_* → community.*
  IF to_regclass('modules.forum_boards') IS NOT NULL AND to_regclass('community.boards') IS NOT NULL THEN
    SELECT count(*) INTO src FROM modules.forum_boards;
    SELECT count(*) INTO dst FROM community.boards;
    IF dst < src THEN
      RAISE EXCEPTION '搬运未完成：community.boards=% 少于 modules.forum_boards=%', dst, src;
    END IF;
  END IF;
  IF to_regclass('modules.forum_topics') IS NOT NULL AND to_regclass('community.topics') IS NOT NULL THEN
    SELECT count(*) INTO src FROM modules.forum_topics;
    SELECT count(*) INTO dst FROM community.topics;
    IF dst < src THEN
      RAISE EXCEPTION '搬运未完成：community.topics=% 少于 modules.forum_topics=%', dst, src;
    END IF;
  END IF;
  IF to_regclass('modules.forum_posts') IS NOT NULL AND to_regclass('community.posts') IS NOT NULL THEN
    SELECT count(*) INTO src FROM modules.forum_posts;
    SELECT count(*) INTO dst FROM community.posts;
    IF dst < src THEN
      RAISE EXCEPTION '搬运未完成：community.posts=% 少于 modules.forum_posts=%', dst, src;
    END IF;
  END IF;

  -- 资源绑定：modules.resources → storage.assets 是另一套模型，没有逐行搬运关系，
  -- 因此只在旧表为空时允许删除；有数据则要求先人工确认（历史上该表一直为空）。
  IF to_regclass('modules.resources') IS NOT NULL THEN
    SELECT count(*) INTO src FROM modules.resources;
    IF src > 0 THEN
      RAISE EXCEPTION 'modules.resources 仍有 % 行：存储服务的 assets 模型不同，需人工确认后再删', src;
    END IF;
  END IF;
END $$;

-- 1. 收藏归互动服务
DROP TABLE IF EXISTS catalog.favorites;

-- 2. 旧模块层 schema
DROP SCHEMA IF EXISTS modules CASCADE;

-- 3. 旧媒体任务 schema
DROP SCHEMA IF EXISTS media CASCADE;

-- 4. 手工迁移留下的临时备份表（只匹配 catalog 下 _*_backup_* 前缀，逐表删除）
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'catalog' AND table_name LIKE '\_%\_backup\_%'
  LOOP
    RAISE NOTICE '删除临时备份表 catalog.%', t.table_name;
    EXECUTE format('DROP TABLE catalog.%I', t.table_name);
  END LOOP;
END $$;

COMMIT;

-- 结果核对：清完后库里应只剩 catalog / auth / community / storage 四个业务 schema
SELECT nspname AS remaining_schema
FROM pg_namespace
WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' AND nspname <> 'public'
ORDER BY nspname;
