-- ==============================================================================
-- 23_external_database_definitions.sql
-- 动态可配置的外部权威数据库预设表 (External Database Identifiers / Remote Link Definitions)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS external_database_definitions (
    code VARCHAR(64) PRIMARY KEY,
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) NOT NULL,
    names JSONB DEFAULT '{}'::jsonb NOT NULL,
    category VARCHAR(32) DEFAULT 'all' NOT NULL, -- 'all', 'work', 'artist', 'release', 'franchise', 'canonical_entry'
    url_pattern VARCHAR(512) NOT NULL,
    icon VARCHAR(64) DEFAULT 'Globe' NOT NULL,
    icon_url VARCHAR(512) DEFAULT '' NOT NULL,
    validation_regex VARCHAR(255) DEFAULT '' NOT NULL,
    description TEXT DEFAULT '' NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    is_system BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ext_db_category ON external_database_definitions(category);
CREATE INDEX IF NOT EXISTS idx_ext_db_enabled ON external_database_definitions(is_enabled);
CREATE INDEX IF NOT EXISTS idx_ext_db_sort ON external_database_definitions(sort_order);

-- 确保 works 与 releases 表具备 external_ids 列与 GIN 索引
ALTER TABLE works ADD COLUMN IF NOT EXISTS external_ids JSONB DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS external_ids JSONB DEFAULT '{}'::jsonb NOT NULL;

CREATE INDEX IF NOT EXISTS idx_works_external_ids_gin ON works USING GIN (external_ids);
CREATE INDEX IF NOT EXISTS idx_releases_external_ids_gin ON releases USING GIN (external_ids);

-- 预设主流外部数据库定义
INSERT INTO external_database_definitions 
(code, name_zh, name_en, names, category, url_pattern, icon, icon_url, validation_regex, description, sort_order, is_enabled, is_system)
VALUES
-- 知识库与维基
('wikipedia', '维基百科', 'Wikipedia', '{"zh-CN":"维基百科","en-US":"Wikipedia","ja":"ウィキペディア"}'::jsonb, 'all', 'https://zh.wikipedia.org/wiki/{id}', 'Globe', '', '', '全球多语言自由百科全书（填词条标题或完整 URL）', 10, true, true),
('wikidata', '维基数据', 'Wikidata', '{"zh-CN":"维基数据","en-US":"Wikidata"}'::jsonb, 'all', 'https://www.wikidata.org/wiki/{id}', 'Database', '', '^Q\d+$', '维基媒体结构化知识图谱实体项 (如 Q11303)', 20, true, true),

-- 音乐与音频
('musicbrainz', 'MusicBrainz', 'MusicBrainz', '{"zh-CN":"MusicBrainz","en-US":"MusicBrainz"}'::jsonb, 'all', 'https://musicbrainz.org/release-group/{id}', 'Disc3', '', '^[0-9a-fA-F\-]{36}$', '开放音乐元数据百科全书 (MBID UUID)', 30, true, true),
('discogs', 'Discogs', 'Discogs', '{"zh-CN":"Discogs","en-US":"Discogs"}'::jsonb, 'all', 'https://www.discogs.com/master/{id}', 'Disc', '', '^\d+$', '全球权威黑胶与实体唱片数据库 (Master/Release ID)', 40, true, true),
('vgmdb', 'VGMdb', 'VGMdb', '{"zh-CN":"VGMdb","en-US":"VGMdb"}'::jsonb, 'all', 'https://vgmdb.net/album/{id}', 'Music2', '', '^\d+$', '电子游戏与动漫原声音乐专题数据库', 50, true, true),
('spotify', 'Spotify', 'Spotify', '{"zh-CN":"Spotify","en-US":"Spotify"}'::jsonb, 'all', 'https://open.spotify.com/album/{id}', 'PlayCircle', '', '^[0-9A-Za-z]{22}$', '全球流媒体音乐服务平台 (Album / Artist ID)', 60, true, true),
('apple_music', 'Apple Music', 'Apple Music', '{"zh-CN":"Apple Music","en-US":"Apple Music"}'::jsonb, 'all', 'https://music.apple.com/album/{id}', 'Apple', '', '^\d+$', '苹果音乐数字专辑与创作者页面', 70, true, true),

-- 影视与戏剧
('imdb', 'IMDb', 'IMDb', '{"zh-CN":"IMDb 互联网电影资料库","en-US":"IMDb"}'::jsonb, 'work', 'https://www.imdb.com/title/{id}/', 'Film', '', '^tt\d+$', '全球权威互联网电影资料库 (如 tt0816692 / nm0000001)', 80, true, true),
('tmdb', 'TMDB', 'The Movie Database', '{"zh-CN":"TMDB 影视数据库","en-US":"The Movie Database"}'::jsonb, 'work', 'https://www.themoviedb.org/movie/{id}', 'Clapperboard', '', '^\d+$', '开放社区影视元数据与海报媒体库', 90, true, true),
('douban_movie', '豆瓣电影', 'Douban Movie', '{"zh-CN":"豆瓣电影","en-US":"Douban Movie"}'::jsonb, 'work', 'https://movie.douban.com/subject/{id}/', 'Tv', '', '^\d+$', '中文影视与文化评论社区 (条目 ID)', 100, true, true),

-- ACG、视觉小说与游戏
('bangumi', 'Bangumi 番组计划', 'Bangumi', '{"zh-CN":"Bangumi 番组计划","en-US":"Bangumi"}'::jsonb, 'all', 'https://bgm.tv/subject/{id}', 'Tv2', '', '^\d+$', '中文 ACG 二次元动画/漫画/游戏/音乐条目索引', 110, true, true),
('vndb', 'VNDB 视觉小说数据库', 'Visual Novel Database', '{"zh-CN":"VNDB 视觉小说数据库","en-US":"VNDB"}'::jsonb, 'work', 'https://vndb.org/v{id}', 'BookHeart', '', '^v?\d+$', '全球权威视觉小说条目数据库 (如 v17)', 120, true, true),
('steam', 'Steam', 'Steam', '{"zh-CN":"Steam 游戏商店","en-US":"Steam"}'::jsonb, 'work', 'https://store.steampowered.com/app/{id}', 'Gamepad2', '', '^\d+$', 'Valve 旗下一体化数字游戏分发与社群平台 (App ID)', 130, true, true),
('anilist', 'AniList', 'AniList', '{"zh-CN":"AniList","en-US":"AniList"}'::jsonb, 'all', 'https://anilist.co/anime/{id}', 'Sparkles', '', '^\d+$', '现代动画与漫画社交追踪数据库', 140, true, true),

-- 图书与出版物
('goodreads', 'Goodreads', 'Goodreads', '{"zh-CN":"Goodreads","en-US":"Goodreads"}'::jsonb, 'work', 'https://www.goodreads.com/book/show/{id}', 'BookOpen', '', '^\d+.*$', '全球读者书评与阅读记录平台', 150, true, true),
('douban_book', '豆瓣读书', 'Douban Book', '{"zh-CN":"豆瓣读书","en-US":"Douban Book"}'::jsonb, 'work', 'https://book.douban.com/subject/{id}/', 'Book', '', '^\d+$', '中文书籍条目与读书笔记社区', 160, true, true),
('isbndb', 'ISBNdb', 'ISBNdb', '{"zh-CN":"ISBNdb 国际标准书号库","en-US":"ISBNdb"}'::jsonb, 'release', 'https://isbndb.com/book/{id}', 'Barcode', '', '^[0-9\-]{10,17}$', '国际标准书号全球注册库 (ISBN-10 / ISBN-13)', 170, true, true),

-- 创作者与规范档 (Authority Records)
('isni', 'ISNI 国际标准名称标识', 'ISNI', '{"zh-CN":"ISNI 国际标准名称标识","en-US":"ISNI"}'::jsonb, 'artist', 'https://isni.org/isni/{id}', 'UserCheck', '', '^\d{15}[\dX]$', 'ISO 国际标准名称标识符 (16 位数字或 X)', 180, true, true),
('orcid', 'ORCID 学术学者标识', 'ORCID', '{"zh-CN":"ORCID 学者标识","en-US":"ORCID"}'::jsonb, 'artist', 'https://orcid.org/{id}', 'GraduationCap', '', '^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$', '全球科研人员与学者开放唯一标识符', 190, true, true),
('twitter_x', 'X (Twitter)', 'X (Twitter)', '{"zh-CN":"X (原 Twitter)","en-US":"X (Twitter)"}'::jsonb, 'artist', 'https://x.com/{id}', 'AtSign', '', '^[A-Za-z0-9_]{1,15}$', '官方社交媒体账号 ID', 200, true, true)

ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    names = EXCLUDED.names,
    category = EXCLUDED.category,
    url_pattern = EXCLUDED.url_pattern,
    icon = EXCLUDED.icon,
    validation_regex = EXCLUDED.validation_regex,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order,
    is_system = EXCLUDED.is_system;
