CREATE TABLE IF NOT EXISTS forum_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES discussion_topics(id) ON DELETE CASCADE,
  post_number INT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  reply_to_post_number INT,
  reply_to_post_id UUID REFERENCES forum_posts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(topic_id, post_number)
);
CREATE INDEX IF NOT EXISTS idx_forum_posts_topic_number ON forum_posts(topic_id, post_number);
CREATE INDEX IF NOT EXISTS idx_forum_posts_user ON forum_posts(user_id);

-- Backfill: topic initial post as #1 where missing
INSERT INTO forum_posts (id, topic_id, post_number, user_id, content, created_at, updated_at)
SELECT gen_random_uuid(), dt.id, 1, dt.user_id, dt.content, dt.created_at, dt.updated_at
FROM discussion_topics dt
WHERE NOT EXISTS (SELECT 1 FROM forum_posts fp WHERE fp.topic_id = dt.id AND fp.post_number = 1);

-- Backfill: existing comments as #2+ ordered by created_at per topic
-- Use a DO block to assign sequential numbers
DO $$
DECLARE
  r RECORD;
  n INT;
BEGIN
  FOR r IN SELECT id, topic_id, user_id, content, parent_id, created_at FROM comments WHERE topic_id IS NOT NULL ORDER BY topic_id, created_at, id
  LOOP
    SELECT COALESCE(MAX(post_number), 1) + 1 INTO n FROM forum_posts WHERE topic_id = r.topic_id;
    -- map parent_id -> reply_to_post_number if parent exists
    INSERT INTO forum_posts (id, topic_id, post_number, user_id, content, reply_to_post_id, created_at, updated_at)
    VALUES (r.id, r.topic_id, n, r.user_id, r.content, r.parent_id, r.created_at, r.created_at)
    ON CONFLICT DO NOTHING;
  END LOOP;
  -- Fix reply_to_post_number from reply_to_post_id
  UPDATE forum_posts fp SET reply_to_post_number = parent.post_number
  FROM forum_posts parent WHERE fp.reply_to_post_id = parent.id AND fp.reply_to_post_number IS NULL;
  -- Correct reply_count
  UPDATE discussion_topics dt SET reply_count = COALESCE((SELECT COUNT(*) - 1 FROM forum_posts fp WHERE fp.topic_id = dt.id), 0);
END $$;
