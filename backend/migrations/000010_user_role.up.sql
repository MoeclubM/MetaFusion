-- 角色三层化：普通用户（user，内容需审核）→ editor（可直接发布自己的条目）→ admin。
-- 与 internal/catalog/schema.sql 的 users 定义保持一致；幂等。
ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE auth.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('user','editor','admin'));
