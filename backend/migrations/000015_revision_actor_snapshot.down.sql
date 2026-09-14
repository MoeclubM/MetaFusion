-- 回滚：只删快照列。回填过的显示名随之丢失（需要时可再次 up 回填）。

ALTER TABLE catalog.revisions DROP COLUMN IF EXISTS actor_name;
ALTER TABLE catalog.revisions DROP COLUMN IF EXISTS actor_role;
