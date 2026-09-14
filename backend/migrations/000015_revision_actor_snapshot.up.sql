-- 修订历史的作者名不再靠 JOIN auth.users 取得，改为写入时落快照。
--
-- 背景：账号拆成独立服务后 auth schema 归账号服务所有，目录侧的 LEFT JOIN auth.users
-- 属于跨服务读表（两个系统在数据层重新耦合，也让"各用各的库"变成不可能）。
-- 修订本就是审计记录，存"当时的用户名与角色"比每次回表查更新值更正确：
-- 用户改名之后，历史修订仍应显示当时是谁改的。
--
-- 存量行的一次性回填：只有在 auth.users 还在同一实例里时才做（拆库部署上不存在这张表），
-- 回填后即可完全断开对该表的依赖。缺 actor_id 或已删号的行留空，读取侧回退为 system。

ALTER TABLE catalog.revisions ADD COLUMN IF NOT EXISTS actor_name text NOT NULL DEFAULT '';
ALTER TABLE catalog.revisions ADD COLUMN IF NOT EXISTS actor_role text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    UPDATE catalog.revisions r
    SET actor_name = u.username, actor_role = u.role
    FROM auth.users u
    WHERE u.id = r.actor_id AND r.actor_name = '';
  END IF;
END $$;
