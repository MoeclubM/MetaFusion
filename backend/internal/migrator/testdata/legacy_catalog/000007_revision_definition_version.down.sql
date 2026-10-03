-- 回滚 000007：definition_version 只是追溯引用，删列不影响修订主体；重建方式为 `mf-migrate up`。
ALTER TABLE catalog.revisions DROP COLUMN IF EXISTS definition_version;
