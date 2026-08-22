-- ==============================================================================
-- MetaFusion Database Seed Data (PostgreSQL 16)
-- Complete Multi-Media Taxonomy (3+ works per media type)
-- Fully Linked Creators, Co-Authors, Studios, Publishers, Boxsets, Tracks & Assets
-- ==============================================================================

-- 1. 预置管理员与初始用户 (开发环境种子账号，首次登录后请立即修改密码)
-- admin 初始密码: AdminPassword2026! ；archivist_prime 与 admin 同哈希（开发占位）
INSERT INTO users (id, username, email, password_hash, role, invites_remaining) VALUES
('00000000-0000-0000-0000-000000000001', 'admin', 'admin@metafusion.internal', '$2b$10$tEvp/mxeztlHPVxKErHLle30.Ya94POXXC.y2oLuiQ8YwkFYzwPxq', 'admin', 999),
('00000000-0000-0000-0000-000000000002', 'archivist_prime', 'archivist@metafusion.internal', '$2a$10$BSREI5h6HDVBhV5K.Hi2u..T2uOZLYy2Q2nn7s8shJ9asLji8DVt6', 'archivist', 10);

-- 2. 预置创世邀请码
INSERT INTO invitations (code, inviter_id, is_used, expires_at) VALUES
('METAFUSION-ALPHA-GENESIS-2026', '00000000-0000-0000-0000-000000000001', FALSE, NOW() + INTERVAL '365 days'),
('HIRES-ARCHIVE-VIP-8888', '00000000-0000-0000-0000-000000000001', FALSE, NOW() + INTERVAL '365 days');

-- 3. 预置图书馆级分类体系 (CLC 中国图书馆分类法)
INSERT INTO categories (code, parent_code, name_zh, name_en, media_type, sort_order, clc_prefix) VALUES
('movie', NULL, '电影', 'Movies', 'movie', 10, 'J9'),
('movie_feature', 'movie', '院线故事片', 'Feature Films', 'movie', 11, 'J952'),
('movie_documentary', 'movie', '人文与科学纪录片', 'Documentaries', 'movie', 12, 'J953'),
('movie_anime', 'movie', '动画电影与剧场版', 'Animated Feature Films', 'movie', 13, 'J954'),
('tv_series', NULL, '电视剧集', 'TV Series', 'tv_series', 20, 'J94'),
('anime', NULL, '动漫动画', 'Anime', 'anime', 30, 'J954'),
('anime_tv', 'anime', 'TV 动画番剧', 'Anime Series', 'anime', 31, 'J954'),
('anime_movie', 'anime', '动画剧场版', 'Anime Movies', 'anime', 32, 'J954'),
('music', NULL, 'Hi-Res 音乐', 'Hi-Res Music', 'music', 40, 'J6'),
('music_classical', 'music', '古典管弦乐', 'Classical', 'music', 41, 'J65'),
('music_soundtrack', 'music', '影视与游戏原声 (OST)', 'Soundtracks', 'music', 42, 'J653'),
('music_audiophile', 'music', '发烧人声与爵士', 'Audiophile Vocal & Jazz', 'music', 43, 'J642'),
('audiobook', NULL, '有声书与广播剧', 'Audiobooks & Drama', 'audiobook', 50, 'I247'),
('novel', NULL, '图书文献', 'Books & Literature', 'novel', 60, 'I'),
('novel_literature', 'novel', '经典文学与名著', 'World Literature', 'novel', 61, 'I1'),
('novel_scifi', 'novel', '科幻与奇幻小说', 'Sci-Fi & Fantasy', 'novel', 62, 'I247.55'),
('novel_light', 'novel', '轻小说与连载文库', 'Light Novels', 'novel', 63, 'I313.45'),
('comic', NULL, '漫画画册', 'Comics & Artbooks', 'comic', 70, 'J2'),
('comic_manga', 'comic', '日漫与连环画', 'Manga', 'comic', 71, 'J228'),
('gallery', NULL, '艺术画册与设定集', 'Artbooks & Key Animation', 'gallery', 80, 'J21');

-- 3.1 预置外挂式虚拟分类与货架系统 (Virtual Shelves / Taxonomy Views)
INSERT INTO virtual_shelves (slug, parent_slug, name_zh, name_en, description, icon, sort_order, query_tags, require_all_tags, exclude_tags) VALUES
-- 电影频道
('movies', NULL, '电影与长片', 'Movies & Films', '收录院线故事片、动画剧场版与纪录长片', 'Film', 10, ARRAY['电影', '长片'], FALSE, '{}'),
('anime-movies', 'movies', '动画剧场版', 'Anime Movies', '院线动画长片与剧场版母盘', 'Sparkles', 11, ARRAY['电影', '动画'], TRUE, '{}'),
('feature-films', 'movies', '院线故事片', 'Feature Films', '真人实拍故事片与经典电影', 'Clapperboard', 12, ARRAY['电影', '实拍'], TRUE, '{}'),
('doc-films', 'movies', '纪录电影', 'Documentary Films', '自然探索、人文历史与科学纪录长片', 'Globe', 13, ARRAY['电影', '纪录'], TRUE, '{}'),

-- 剧集频道
('series', NULL, '剧集与节目', 'Series & Shows', '收录电视连续剧、TV 动画番剧与微电影', 'Tv', 20, ARRAY['剧集', '连续剧'], FALSE, '{}'),
('anime-series', 'series', 'TV 动画番剧', 'Anime Series', '日本及全球电视动画与网络番剧', 'Flame', 21, ARRAY['剧集', '动画'], TRUE, '{}'),
('live-series', 'series', '电视连续剧', 'Drama Series', '中外经典电视剧与迷你剧', 'MonitorPlay', 22, ARRAY['剧集', '实拍'], TRUE, '{}'),

-- 动漫专区 (跨形态聚合)
('anime-hub', NULL, '动漫专区', 'Anime Hub', '聚合所有动画电影、TV 番剧、漫画与画集', 'Zap', 30, ARRAY['动画', '漫画', '轻小说'], FALSE, '{}'),

-- 音乐频道
('music', NULL, '音乐与声音', 'Music & Audio', '高解析无损音乐、原声大碟与古典交响', 'Music', 40, ARRAY['音乐', '专辑', '原声'], FALSE, '{}'),
('soundtracks', 'music', '影视与游戏原声', 'Soundtracks & OST', '电影配乐、动画 OST、游戏原声大碟', 'Disc', 41, ARRAY['原声'], FALSE, '{}'),
('classical', 'music', '古典交响乐', 'Classical', '交响乐、协奏曲与室内乐母带', 'Radio', 42, ARRAY['古典'], FALSE, '{}'),
('audiobooks', 'music', '广播剧与有声书', 'Audio Drama', '全景声广播剧与名家演播有声书', 'Headphones', 43, ARRAY['广播剧', '有声书'], FALSE, '{}'),

-- 图书文献
('books', NULL, '图书与文献', 'Books & Literature', '世界名著、科幻奇幻小说与出版文献', 'BookOpen', 50, ARRAY['图书', '小说', '名著'], FALSE, '{}'),
('scifi-books', 'books', '科幻与奇幻文学', 'Sci-Fi & Fantasy', '雨果奖、星云奖与世界硬核科幻小说', 'Compass', 51, ARRAY['科幻'], FALSE, '{}'),
('literature-books', 'books', '经典文学名著', 'World Literature', '中外文学名著典藏版与校勘本', 'Library', 52, ARRAY['文学', '名著'], FALSE, '{}'),

-- 漫画画册
('comics', NULL, '漫画与画集', 'Comics & Visual Arts', '连载漫画、艺术设定集与关键帧画册', 'Palette', 60, ARRAY['漫画', '画集', '设定集'], FALSE, '{}'),
('manga', 'comics', '连载漫画', 'Manga & Comics', '高分辨率完全版与典藏版连载漫画', 'Layers', 61, ARRAY['漫画'], FALSE, '{}'),
('artbooks', 'comics', '原画与美术设定集', 'Artbooks & Gallery', '官方美术设定集、分镜稿与概念画册', 'Image', 62, ARRAY['画集', '设定集'], FALSE, '{}'),

-- 特色专题货架（内容标签，不是碟片规格）
('special-ghibli', NULL, '吉卜力工作室专题', 'Studio Ghibli Archive', '宫崎骏、高畑勋执导动画与久石让配乐全集', 'Heart', 70, ARRAY['吉卜力'], FALSE, '{}');

-- 3.2 预置多维正交标签本体库 (Multi-Dimensional Tag Ontology)
INSERT INTO tags (name, group_type, category_scope) VALUES
-- 形态 (Work form: 电影/游戏/专辑… 不是碟片规格)
('电影', 'format', '{}'),
('剧集', 'format', '{}'),
('短片', 'format', '{}'),
('专辑', 'format', '{}'),
('单曲', 'format', '{}'),
('图书', 'format', '{}'),
('漫画', 'format', '{}'),
('画集', 'format', '{}'),
('长片', 'format', '{}'),
('连续剧', 'format', '{}'),
('游戏', 'format', '{}'),
('音乐', 'format', '{}'),
('动画番剧', 'format', '{}'),

-- 制作手法 (Medium / Technique)
('动画', 'medium', '{}'),
('实拍', 'medium', '{}'),
('定格动画', 'medium', '{}'),
('管弦乐', 'medium', '{}'),
('电子乐', 'medium', '{}'),
('广播剧', 'medium', '{}'),
('有声书', 'medium', '{}'),

-- 流派题材 (Genre)
('科幻', 'genre', '{}'),
('奇幻', 'genre', '{}'),
('赛博朋克', 'genre', '{}'),
('纪录', 'genre', '{}'),
('历史', 'genre', '{}'),
('剧情', 'genre', '{}'),
('古典', 'genre', '{}'),
('原声', 'genre', '{}'),
('发烧人声', 'genre', '{}'),
('文学', 'genre', '{}'),
('名著', 'genre', '{}'),
('轻小说', 'genre', '{}'),

-- 专题与宇宙 (Theme)
('吉卜力', 'theme', '{}'),
('宫崎骏', 'theme', '{}'),
('久石让', 'theme', '{}'),
('EVA', 'theme', '{}'),
('庵野秀明', 'theme', '{}'),
('诺兰', 'theme', '{}'),
('刘慈欣', 'theme', '{}'),
('奥斯卡', 'theme', '{}')
ON CONFLICT (name) DO NOTHING;

-- 4. 作品 / 主体 / 发行版编目改由 99_z_cross_media_catalog_samples.sql 提供（真实跨媒介样例）。
-- 旧演示条目（星际穿越、攻壳等）已按部署要求移除。必须排在本文件之后，以便用户与标签序号就绪。
