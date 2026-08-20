-- 15_community_edit_and_revisions.sql — 社区编辑版本修订追踪与实体合并系统 (Revisions, Edit Notes, Diffs & Merges)
-- 目标:
-- 1) 记录每次修改的不可变快照 (before_state, after_state, diff) 与编辑附言 (edit_note)；
-- 2) 支持实体合并 (Merge) 追溯与重定向；
-- 3) 支撑 MusicBrainz / Wiki 级别的条目版本历史与审查治理。

CREATE TABLE IF NOT EXISTS entity_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type VARCHAR(32) NOT NULL,              -- 'work', 'artist', 'release', 'canonical_entry'
    target_id UUID NOT NULL,
    editor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    edit_type VARCHAR(32) NOT NULL,                -- 'create', 'update', 'delete', 'merge', 'rollback'
    summary VARCHAR(255) DEFAULT '' NOT NULL,      -- 变更概要
    edit_note TEXT DEFAULT '' NOT NULL,            -- 编辑附言/修改理由 (MusicBrainz Edit Note)
    source_urls TEXT[] DEFAULT '{}' NOT NULL,      -- 参考来源网址/考据出处
    before_state JSONB DEFAULT '{}'::jsonb NOT NULL,
    after_state JSONB DEFAULT '{}'::jsonb NOT NULL,
    diff JSONB DEFAULT '{}'::jsonb NOT NULL,       -- 结构化 Diff 字典: { "field": { "old": "...", "new": "..." } }
    status VARCHAR(16) DEFAULT 'applied' NOT NULL, -- 'applied', 'pending', 'rejected', 'reverted'
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_revisions_target ON entity_revisions(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revisions_editor ON entity_revisions(editor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revisions_status ON entity_revisions(status, created_at DESC);
