-- 记录级动态属性：收录关系（track_contents）与发行对象（release_subjects）
-- 除结构性引用与次序外的全部描述改走 definitions 校验的 JSONB attributes，
-- 不再为每种媒体加专用列。locator 同样改为 JSONB 动态键（原列已是 jsonb）。
-- 两列可空并给默认值，存量行自动获得空对象，行为与迁移前一致。
ALTER TABLE catalog.track_contents ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE catalog.release_subjects ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
