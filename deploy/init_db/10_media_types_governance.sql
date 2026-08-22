-- 10_media_types_governance.sql — MediaType 可治理化 + 形态扩充 (幂等)
-- 目标: 将锁死的 media_category ENUM 升格为可后台创增的 media_types 表，
--       解耦“形态(顶层 MediaType)”与“题材/流派(Tag/Category)”，使动漫剧场版等可归入 movie+animation
-- 兼容: 存量库 ENUM -> VARCHAR 转换 + 表不存在则创建，重复执行安全

-- 1) 可治理形态表
CREATE TABLE IF NOT EXISTS media_types (
    code VARCHAR(32) PRIMARY KEY,
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) NOT NULL,
    names JSONB DEFAULT '{}'::jsonb NOT NULL,
    description TEXT DEFAULT '',
    icon VARCHAR(64) DEFAULT 'Layers',
    sort_order INT DEFAULT 0 NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    clc_prefix VARCHAR(16),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 回填 names JSONB (若已有则跳过)
DO $$ BEGIN
    UPDATE media_types SET names = jsonb_build_object('zh-CN', name_zh, 'en-US', name_en)
    WHERE (names = '{}'::jsonb OR names IS NULL);
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 2) 形态词表：保留既有 8 类 + 新增 4 类 (game/podcast/software/performance)
--    sort_order 按展示优先级：影视(10-30) > 音声(40-59) > 文字(60-69) > 视觉(70-79) > 交互(80-89) > 工具(90-99)
INSERT INTO media_types (code, name_zh, name_en, names, description, icon, sort_order, is_enabled, clc_prefix) VALUES
('movie',     '电影',       'Movies',        jsonb_build_object('zh-CN','电影','en-US','Movies'),       '院线长片、动画剧场版与纪录电影',        'Film',       10, TRUE, 'J9'),
('tv_series', '电视剧集',   'TV Series',     jsonb_build_object('zh-CN','电视剧集','en-US','TV Series'), '连续剧、迷你剧与电视节目',                'Tv',         20, TRUE, 'J94'),
('anime',     '动画番剧',   'Anime',         jsonb_build_object('zh-CN','动画番剧','en-US','Anime'),     'TV 动画与网络番剧（保留兼容；新编目建议用 movie/tv_series + 动画标签）', 'Sparkles', 30, TRUE, 'J954'),
('music',     '音乐',       'Music',         jsonb_build_object('zh-CN','音乐','en-US','Music'),         'Hi-Res 音乐、原声与古典录音',           'Music',      40, TRUE, 'J6'),
('audiobook', '有声书',     'Audiobooks',    jsonb_build_object('zh-CN','有声书','en-US','Audiobooks'),  '有声书、广播剧与有声文献',              'Headphones', 50, TRUE, 'I247'),
('novel',     '图书',       'Books',         jsonb_build_object('zh-CN','图书','en-US','Books'),         '图书文献与数字出版',                    'BookOpen',   60, TRUE, 'I'),
('comic',     '漫画',       'Comics',        jsonb_build_object('zh-CN','漫画','en-US','Comics'),        '漫画与条漫',                            'Layers',     70, TRUE, 'J2'),
('gallery',   '画集',       'Artbooks',      jsonb_build_object('zh-CN','画集','en-US','Artbooks'),      '艺术画集、设定集与原画档案',            'Palette',    80, TRUE, 'J21'),
('game',      '游戏',       'Games',         jsonb_build_object('zh-CN','游戏','en-US','Games'),         '电子游戏、视觉小说与互动影像',          'Gamepad2',   85, TRUE, 'TP31'),
('podcast',   '播客',       'Podcasts',      jsonb_build_object('zh-CN','播客','en-US','Podcasts'),      '播客节目、访谈与声音纪录片',            'Mic',        55, TRUE, 'G23'),
('software',  '软件',       'Software',      jsonb_build_object('zh-CN','软件','en-US','Software'),      '工具软件、数据集与模拟器镜像',          'Cpu',        90, TRUE, 'TP31'),
('performance','现场演出', 'Live / Performance', jsonb_build_object('zh-CN','现场演出','en-US','Live / Performance'), '演唱会、舞台剧与现场录像',        'Clapperboard', 35, TRUE, 'J8')
ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    names = EXCLUDED.names,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order,
    clc_prefix = EXCLUDED.clc_prefix;

-- 3) 将 ENUM 列转为可扩展的 VARCHAR(32)
--    兼容两种初始状态：ENUM 类型 或 已为 VARCHAR 的二次执行
DO $$
DECLARE
    col_type TEXT;
BEGIN
    -- categories.media_type
    SELECT format_type(atttypid, atttypmod) INTO col_type
    FROM pg_attribute WHERE attrelid='categories'::regclass AND attname='media_type';
    IF col_type LIKE 'media_category%' THEN
        ALTER TABLE categories ALTER COLUMN media_type TYPE VARCHAR(32) USING media_type::text;
    END IF;

    -- works.media_type
    SELECT format_type(atttypid, atttypmod) INTO col_type
    FROM pg_attribute WHERE attrelid='works'::regclass AND attname='media_type';
    IF col_type LIKE 'media_category%' THEN
        ALTER TABLE works ALTER COLUMN media_type TYPE VARCHAR(32) USING media_type::text;
    END IF;

    -- mediums.media_category
    SELECT format_type(atttypid, atttypmod) INTO col_type
    FROM pg_attribute WHERE attrelid='mediums'::regclass AND attname='media_category';
    IF col_type LIKE 'media_category%' THEN
        ALTER TABLE mediums ALTER COLUMN media_category TYPE VARCHAR(32) USING media_category::text;
    END IF;

    -- tags.category_scope (media_category[] -> varchar[])
    SELECT format_type(atttypid, atttypmod) INTO col_type
    FROM pg_attribute WHERE attrelid='tags'::regclass AND attname='category_scope';
    IF col_type LIKE 'media_category%' THEN
        ALTER TABLE tags ALTER COLUMN category_scope TYPE VARCHAR(32)[] USING category_scope::text[]::varchar(32)[];
    END IF;
END $$;

-- 4) 外键（幂等：若已存在则跳过，允许离散值 'all'/'video' 等仅在 virtual_shelves 中，不设 FK）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_categories_media_type') THEN
        ALTER TABLE categories ADD CONSTRAINT fk_categories_media_type FOREIGN KEY (media_type) REFERENCES media_types(code) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_mediums_media_category') THEN
        ALTER TABLE mediums ADD CONSTRAINT fk_mediums_media_category FOREIGN KEY (media_category) REFERENCES media_types(code) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

-- 5) 索引与校验
CREATE INDEX IF NOT EXISTS idx_media_types_enabled_sort ON media_types(is_enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_mediums_media_category ON mediums(media_category);
