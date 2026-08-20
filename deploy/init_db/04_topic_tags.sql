-- 04_topic_tags.sql — 论坛标签系统与检索优化
-- 幂等，可重复执行

-- 1) 论坛主题 ↔ 标签 多对多关联表
CREATE TABLE IF NOT EXISTS topic_tag_relations (
    topic_id UUID REFERENCES discussion_topics(id) ON DELETE CASCADE NOT NULL,
    tag_id INT REFERENCES tags(id) ON DELETE CASCADE NOT NULL,
    PRIMARY KEY (topic_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_tags_topic ON topic_tag_relations(topic_id);
CREATE INDEX IF NOT EXISTS idx_topic_tags_tag ON topic_tag_relations(tag_id);

-- 2) 论坛标题/正文 trigram 索引（加速 ILIKE 搜索）
CREATE INDEX IF NOT EXISTS idx_topics_title_trgm ON discussion_topics USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_topics_content_trgm ON discussion_topics USING GIN (content gin_trgm_ops);

-- 3) 预置标签词库（复用 catalog tags 表，group_type=topic 表示论坛标签）
INSERT INTO tags (name, group_type, category_scope) VALUES
('考据', 'topic', '{}'),
('压制日志', 'topic', '{}'),
('无损抓轨', 'topic', '{music}'),
('4K Remux', 'topic', '{movie}'),
('HDR', 'topic', '{movie}'),
('求助', 'topic', '{}'),
('心得', 'topic', '{}'),
('公告', 'topic', '{}'),
('设定集', 'topic', '{gallery}'),
('OST', 'topic', '{music}'),
('原盘', 'topic', '{movie,anime}'),
('字幕', 'topic', '{movie,anime}'),
('设备', 'topic', '{music}'),
('新人报到', 'topic', '{}')
ON CONFLICT (name) DO NOTHING;

-- 4) 为存量示例主题回填标签（演示用）
DO $$
DECLARE
  tid UUID;
  tag考据 INT; tag压制 INT; tag无损 INT; tag求助 INT;
BEGIN
  SELECT id INTO tag考据 FROM tags WHERE name='考据';
  SELECT id INTO tag压制 FROM tags WHERE name='压制日志';
  SELECT id INTO tag无损 FROM tags WHERE name='无损抓轨';
  SELECT id INTO tag求助 FROM tags WHERE name='求助';

  SELECT id INTO tid FROM discussion_topics WHERE title LIKE '%IMAX%' LIMIT 1;
  IF tid IS NOT NULL AND tag考据 IS NOT NULL THEN
    INSERT INTO topic_tag_relations(topic_id, tag_id) VALUES (tid, tag考据) ON CONFLICT DO NOTHING;
  END IF;
  IF tid IS NOT NULL AND tag压制 IS NOT NULL THEN
    INSERT INTO topic_tag_relations(topic_id, tag_id) VALUES (tid, tag压制) ON CONFLICT DO NOTHING;
  END IF;

  SELECT id INTO tid FROM discussion_topics WHERE title LIKE '%卡拉扬%' LIMIT 1;
  IF tid IS NOT NULL AND tag无损 IS NOT NULL THEN
    INSERT INTO topic_tag_relations(topic_id, tag_id) VALUES (tid, tag无损) ON CONFLICT DO NOTHING;
  END IF;
END $$;
