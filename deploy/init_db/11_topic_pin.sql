-- 11_topic_pin.sql — 置顶能力：is_pinned + pinned_at（幂等，最小化）
ALTER TABLE discussion_topics ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE discussion_topics ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_topics_pinned ON discussion_topics(is_pinned, pinned_at DESC) WHERE is_pinned = TRUE;
