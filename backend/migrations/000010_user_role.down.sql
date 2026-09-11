-- 回滚：收回 user 角色。仍有 user 用户时本迁移会因 CHECK 失败而报错，
-- 需先把他们的角色降级处理后再执行（默认拒绝静默删数据）。
ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE auth.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('editor','admin'));
