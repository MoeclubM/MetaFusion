-- 06_i18n.sql — 论坛按语种分站 + 内容多语言 (幂等)
-- 约定 locales = zh-CN / en-US，默认 zh-CN，缺失回退 zh-CN

-- 1) 话题语种
ALTER TABLE discussion_topics ADD COLUMN IF NOT EXISTS language VARCHAR(16) DEFAULT 'zh-CN' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_topics_language ON discussion_topics(language);
DO $$ BEGIN
  UPDATE discussion_topics SET language='zh-CN' WHERE language IS NULL OR language='';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 2) 分类 / 板块多语 JSONB（兼容 name_zh/name_en）
ALTER TABLE categories ADD COLUMN IF NOT EXISTS names JSONB DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE forum_boards ADD COLUMN IF NOT EXISTS names JSONB DEFAULT '{}'::jsonb NOT NULL;
DO $$ BEGIN
  UPDATE categories SET names = jsonb_build_object('zh-CN', name_zh, 'en-US', name_en)
    WHERE (names = '{}'::jsonb OR names IS NULL);
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
  UPDATE forum_boards SET names = jsonb_build_object('zh-CN', name_zh, 'en-US', COALESCE(NULLIF(name_en,''), name_zh))
    WHERE (names = '{}'::jsonb OR names IS NULL);
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 3) 内容翻译表：作品 / 话题 / 标签 / 艺术家
CREATE TABLE IF NOT EXISTS work_translations (
  work_id UUID REFERENCES works(id) ON DELETE CASCADE NOT NULL,
  locale VARCHAR(16) NOT NULL,
  title VARCHAR(255),
  summary TEXT,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (work_id, locale)
);

CREATE TABLE IF NOT EXISTS topic_translations (
  topic_id UUID REFERENCES discussion_topics(id) ON DELETE CASCADE NOT NULL,
  locale VARCHAR(16) NOT NULL,
  title VARCHAR(255),
  content TEXT,
  PRIMARY KEY (topic_id, locale)
);

CREATE TABLE IF NOT EXISTS tag_translations (
  tag_id INT REFERENCES tags(id) ON DELETE CASCADE NOT NULL,
  locale VARCHAR(16) NOT NULL,
  name VARCHAR(64) NOT NULL,
  PRIMARY KEY (tag_id, locale)
);

CREATE TABLE IF NOT EXISTS artist_translations (
  artist_id UUID REFERENCES artists(id) ON DELETE CASCADE NOT NULL,
  locale VARCHAR(16) NOT NULL,
  name VARCHAR(255),
  biography TEXT,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (artist_id, locale)
);

-- 4) 作品语言索引（ListWorks/SearchWorks 过滤用）
CREATE INDEX IF NOT EXISTS idx_works_language ON works(language);
