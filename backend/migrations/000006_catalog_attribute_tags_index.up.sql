-- 标签按容器包含过滤（attributes.tags @> [...]）需要函数索引，否则每次按标签
-- 检索都会退化为全表扫描。jsonb_path_ops 对 @> 的匹配最省空间也最快。
CREATE INDEX IF NOT EXISTS entities_attribute_tags
  ON catalog.entities USING gin ((document->'attributes'->'tags') jsonb_path_ops);
