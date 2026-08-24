-- ==============================================================================
-- MetaFusion Database Seed Data (PostgreSQL 16)
-- Complete Multi-Media Taxonomy (3+ works per media type)
-- Fully Linked Creators, Co-Authors, Studios, Publishers, Boxsets, Tracks & Assets
-- ==============================================================================

-- 1. 预置管理员与初始用户 (开发环境种子账号，首次登录后请立即修改密码)
-- admin 初始密码: AdminPassword2026! ；archivist_prime 与 admin 同哈希（开发占位）
INSERT INTO users (id, username, display_name, email, password_hash, role, invites_remaining, favorites_public, email_public) VALUES
('00000000-0000-0000-0000-000000000001', 'admin', '首席馆长', 'admin@metafusion.internal', '$2b$10$tEvp/mxeztlHPVxKErHLle30.Ya94POXXC.y2oLuiQ8YwkFYzwPxq', 'admin', 999, TRUE, FALSE),
('00000000-0000-0000-0000-000000000002', 'archivist_prime', '高保真档案员', 'archivist@metafusion.internal', '$2a$10$BSREI5h6HDVBhV5K.Hi2u..T2uOZLYy2Q2nn7s8shJ9asLji8DVt6', 'archivist', 10, TRUE, FALSE)
ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    role = EXCLUDED.role;

-- 2. 预置创世邀请码
INSERT INTO invitations (code, inviter_id, is_used, expires_at) VALUES
('METAFUSION-ALPHA-GENESIS-2026', '00000000-0000-0000-0000-000000000001', FALSE, NOW() + INTERVAL '365 days'),
('HIRES-ARCHIVE-VIP-8888', '00000000-0000-0000-0000-000000000001', FALSE, NOW() + INTERVAL '365 days')
ON CONFLICT (code) DO NOTHING;

-- 3. 预置图书馆级分类体系 (CLC 中国图书馆分类法)
INSERT INTO categories (code, parent_code, name_zh, name_en, names, media_type, sort_order, clc_prefix) VALUES
('movie', NULL, '电影', 'Movies', '{"zh-CN":"电影","en-US":"Movies"}', 'movie', 10, 'J9'),
('movie_feature', 'movie', '院线故事片', 'Feature Films', '{"zh-CN":"院线故事片","en-US":"Feature Films"}', 'movie', 11, 'J952'),
('movie_documentary', 'movie', '人文与科学纪录片', 'Documentaries', '{"zh-CN":"人文与科学纪录片","en-US":"Documentaries"}', 'movie', 12, 'J953'),
('movie_anime', 'movie', '动画电影与剧场版', 'Animated Feature Films', '{"zh-CN":"动画电影与剧场版","en-US":"Animated Feature Films"}', 'movie', 13, 'J954'),
('tv_series', NULL, '电视剧集', 'TV Series', '{"zh-CN":"电视剧集","en-US":"TV Series"}', 'tv_series', 20, 'J94'),
('anime', NULL, '动漫动画', 'Anime', '{"zh-CN":"动漫动画","en-US":"Anime"}', 'anime', 30, 'J954'),
('anime_tv', 'anime', 'TV 动画番剧', 'Anime Series', '{"zh-CN":"TV 动画番剧","en-US":"Anime Series"}', 'anime', 31, 'J954'),
('anime_movie', 'anime', '动画剧场版', 'Anime Movies', '{"zh-CN":"动画剧场版","en-US":"Anime Movies"}', 'anime', 32, 'J954'),
('music', NULL, 'Hi-Res 音乐', 'Hi-Res Music', '{"zh-CN":"Hi-Res 音乐","en-US":"Hi-Res Music"}', 'music', 40, 'J6'),
('music_classical', 'music', '古典管弦乐', 'Classical', '{"zh-CN":"古典管弦乐","en-US":"Classical"}', 'music', 41, 'J65'),
('music_soundtrack', 'music', '影视与游戏原声 (OST)', 'Soundtracks', '{"zh-CN":"影视与游戏原声 (OST)","en-US":"Soundtracks"}', 'music', 42, 'J653'),
('music_audiophile', 'music', '发烧人声与爵士', 'Audiophile Vocal & Jazz', '{"zh-CN":"发烧人声与爵士","en-US":"Audiophile Vocal & Jazz"}', 'music', 43, 'J642'),
('audiobook', NULL, '有声书与广播剧', 'Audiobooks & Drama', '{"zh-CN":"有声书与广播剧","en-US":"Audiobooks & Drama"}', 'audiobook', 50, 'I247'),
('novel', NULL, '图书文献', 'Books & Literature', '{"zh-CN":"图书文献","en-US":"Books & Literature"}', 'novel', 60, 'I'),
('novel_literature', 'novel', '经典文学与名著', 'World Literature', '{"zh-CN":"经典文学与名著","en-US":"World Literature"}', 'novel', 61, 'I1'),
('novel_scifi', 'novel', '科幻与奇幻小说', 'Sci-Fi & Fantasy', '{"zh-CN":"科幻与奇幻小说","en-US":"Sci-Fi & Fantasy"}', 'novel', 62, 'I247.55'),
('novel_light', 'novel', '轻小说与连载文库', 'Light Novels', '{"zh-CN":"轻小说与连载文库","en-US":"Light Novels"}', 'novel', 63, 'I313.45'),
('comic', NULL, '漫画画册', 'Comics & Artbooks', '{"zh-CN":"漫画画册","en-US":"Comics & Artbooks"}', 'comic', 70, 'J2'),
('comic_manga', 'comic', '日漫与连环画', 'Manga', '{"zh-CN":"日漫与连环画","en-US":"Manga"}', 'comic', 71, 'J228'),
('gallery', NULL, '艺术画册与设定集', 'Artbooks & Key Animation', '{"zh-CN":"艺术画册与设定集","en-US":"Artbooks & Key Animation"}', 'gallery', 80, 'J21')
ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    names = EXCLUDED.names,
    media_type = EXCLUDED.media_type,
    sort_order = EXCLUDED.sort_order,
    clc_prefix = EXCLUDED.clc_prefix;

-- 3.1 预置外挂式虚拟分类与货架系统 (Virtual Shelves / Taxonomy Views)
INSERT INTO virtual_shelves (slug, parent_slug, name_zh, name_en, names, description, icon, sort_order, query_tags, require_all_tags, exclude_tags) VALUES
-- 电影频道
('movies', NULL, '电影与长片', 'Movies & Films', '{"zh-CN": "电影与长片", "en-US": "Movies & Films", "ja": "映画・長編"}'::jsonb, '收录院线故事片、动画剧场版与纪录长片', 'Film', 10, ARRAY['电影', '长片'], FALSE, '{}'),
('anime-movies', 'movies', '动画剧场版', 'Anime Movies', '{"zh-CN": "动画剧场版", "en-US": "Anime Movies", "ja": "劇場アニメ"}'::jsonb, '院线动画长片与剧场版母盘', 'Sparkles', 11, ARRAY['电影', '动画'], TRUE, '{}'),
('feature-films', 'movies', '院线故事片', 'Feature Films', '{"zh-CN": "院线故事片", "en-US": "Feature Films", "ja": "長編映画"}'::jsonb, '真人实拍故事片与经典电影', 'Clapperboard', 12, ARRAY['电影', '实拍'], TRUE, '{}'),
('doc-films', 'movies', '纪录电影', 'Documentary Films', '{"zh-CN": "纪录电影", "en-US": "Documentary Films", "ja": "ドキュメンタリー"}'::jsonb, '自然探索、人文历史与科学纪录长片', 'Globe', 13, ARRAY['电影', '纪录'], TRUE, '{}'),

-- 剧集频道
('series', NULL, '剧集与节目', 'Series & Shows', '{"zh-CN": "剧集与节目", "en-US": "Series & Shows", "ja": "ドラマ・番組"}'::jsonb, '收录电视连续剧、TV 动画番剧与微电影', 'Tv', 20, ARRAY['剧集', '连续剧'], FALSE, '{}'),
('anime-series', 'series', 'TV 动画番剧', 'Anime Series', '{"zh-CN": "TV 动画番剧", "en-US": "Anime Series", "ja": "TVアニメ"}'::jsonb, '日本及全球电视动画与网络番剧', 'Flame', 21, ARRAY['剧集', '动画'], TRUE, '{}'),
('live-series', 'series', '电视连续剧', 'Drama Series', '{"zh-CN": "电视连续剧", "en-US": "Drama Series", "ja": "テレビドラマ"}'::jsonb, '中外经典电视剧与迷你剧', 'MonitorPlay', 22, ARRAY['剧集', '实拍'], TRUE, '{}'),

-- 动漫专区 (跨形态聚合)
('anime-hub', NULL, '动漫专区', 'Anime Hub', '{"zh-CN": "动漫专区", "en-US": "Anime Hub", "ja": "アニメ特設"}'::jsonb, '聚合所有动画电影、TV 番剧、漫画与画集', 'Zap', 30, ARRAY['动画', '漫画', '轻小说'], FALSE, '{}'),

-- 音乐频道
('music', NULL, '音乐与声音', 'Music & Audio', '{"zh-CN": "音乐与声音", "en-US": "Music & Audio", "ja": "音楽・サウンド"}'::jsonb, '高解析无损音乐、原声大碟与古典交响', 'Music', 40, ARRAY['音乐', '专辑', '原声'], FALSE, '{}'),
('soundtracks', 'music', '影视与游戏原声', 'Soundtracks & OST', '{"zh-CN": "影视与游戏原声", "en-US": "Soundtracks & OST", "ja": "サントラ・劇伴"}'::jsonb, '电影配乐、动画 OST、游戏原声大碟', 'Disc', 41, ARRAY['原声'], FALSE, '{}'),
('classical', 'music', '古典交响乐', 'Classical', '{"zh-CN": "古典交响乐", "en-US": "Classical", "ja": "クラシック"}'::jsonb, '交响乐、协奏曲与室内乐母带', 'Radio', 42, ARRAY['古典'], FALSE, '{}'),
('audiobooks', 'music', '广播剧与有声书', 'Audio Drama', '{"zh-CN": "广播剧与有声书", "en-US": "Audio Drama", "ja": "ボイスドラマ・オーディオブック"}'::jsonb, '全景声广播剧与名家演播有声书', 'Headphones', 43, ARRAY['广播剧', '有声书'], FALSE, '{}'),

-- 图书文献
('books', NULL, '图书与文献', 'Books & Literature', '{"zh-CN": "图书与文献", "en-US": "Books & Literature", "ja": "書籍・文学"}'::jsonb, '世界名著、科幻奇幻小说与出版文献', 'BookOpen', 50, ARRAY['图书', '小说', '名著'], FALSE, '{}'),
('scifi-books', 'books', '科幻与奇幻文学', 'Sci-Fi & Fantasy', '{"zh-CN": "科幻与奇幻文学", "en-US": "Sci-Fi & Fantasy", "ja": "SF・ファンタジー文学"}'::jsonb, '雨果奖、星云奖与世界硬核科幻小说', 'Compass', 51, ARRAY['科幻'], FALSE, '{}'),
('literature-books', 'books', '经典文学名著', 'World Literature', '{"zh-CN": "经典文学名著", "en-US": "World Literature", "ja": "世界文学・名著"}'::jsonb, '中外文学名著典藏版与校勘本', 'Library', 52, ARRAY['文学', '名著'], FALSE, '{}'),

-- 漫画画册
('comics', NULL, '漫画与画集', 'Comics & Visual Arts', '{"zh-CN": "漫画与画集", "en-US": "Comics & Visual Arts", "ja": "マンガ・画集"}'::jsonb, '连载漫画、艺术设定集与关键帧画册', 'Palette', 60, ARRAY['漫画', '画集', '设定集'], FALSE, '{}'),
('manga', 'comics', '连载漫画', 'Manga & Comics', '{"zh-CN": "连载漫画", "en-US": "Manga & Comics", "ja": "マンガ"}'::jsonb, '高分辨率完全版与典藏版连载漫画', 'Layers', 61, ARRAY['漫画'], FALSE, '{}'),
('artbooks', 'comics', '原画与美术设定集', 'Artbooks & Gallery', '{"zh-CN": "原画与美术设定集", "en-US": "Artbooks & Gallery", "ja": "画集・設定資料集"}'::jsonb, '官方美术设定集、分镜稿与概念画册', 'Image', 62, ARRAY['画集', '设定集'], FALSE, '{}'),

-- 特色专题货架（内容标签，不是碟片规格）
('special-ghibli', NULL, '吉卜力工作室专题', 'Studio Ghibli Archive', '{"zh-CN": "吉卜力工作室专题", "en-US": "Studio Ghibli Archive", "ja": "スタジオジブリ特集"}'::jsonb, '宫崎骏、高畑勋执导动画与久石让配乐全集', 'Heart', 70, ARRAY['吉卜力'], FALSE, '{}')
ON CONFLICT (slug) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    names = EXCLUDED.names,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order,
    query_tags = EXCLUDED.query_tags,
    require_all_tags = EXCLUDED.require_all_tags,
    exclude_tags = EXCLUDED.exclude_tags;

-- 3.2 预置多维正交本体标签字典 (Multi-Dimensional Tag Ontology)
INSERT INTO tags (name, group_type, category_scope) VALUES
-- 1) 形态 (format: 作品基本形态)
('电影', 'format', '{}'),
('剧集', 'format', '{}'),
('短片', 'format', '{}'),
('长片', 'format', '{}'),
('连续剧', 'format', '{}'),
('动画番剧', 'format', '{}'),
('动画剧场版', 'format', '{}'),
('OVA', 'format', '{}'),
('专辑', 'format', '{}'),
('单曲', 'format', '{}'),
('EP', 'format', '{}'),
('迷你专辑', 'format', '{}'),
('原声带', 'format', '{}'),
('图书', 'format', '{}'),
('漫画', 'format', '{}'),
('画集', 'format', '{}'),
('游戏', 'format', '{}'),
('视觉小说', 'format', '{}'),
('音乐', 'format', '{}'),
('软件', 'format', '{}'),
('播客', 'format', '{}'),
('现场演出', 'format', '{}'),
('广播剧', 'format', '{}'),
('有声书', 'format', '{}'),

-- 2) 制作手法与声学表达 (medium)
('动画', 'medium', '{}'),
('实拍', 'medium', '{}'),
('定格动画', 'medium', '{}'),
('管弦乐', 'medium', '{}'),
('室内乐', 'medium', '{}'),
('电子乐', 'medium', '{}'),
('原声', 'medium', '{}'),
('爵士乐', 'medium', '{}'),
('摇滚乐', 'medium', '{}'),
('金属乐', 'medium', '{}'),
('流行乐', 'medium', '{}'),
('民谣', 'medium', '{}'),
('嘻哈', 'medium', '{}'),
('纯音乐', 'medium', '{}'),

-- 3) 流派题材 (genre)
('科幻', 'genre', '{}'),
('奇幻', 'genre', '{}'),
('赛博朋克', 'genre', '{}'),
('蒸汽朋克', 'genre', '{}'),
('冒险', 'genre', '{}'),
('热血', 'genre', '{}'),
('悬疑', 'genre', '{}'),
('推理', 'genre', '{}'),
('治愈', 'genre', '{}'),
('催泪', 'genre', '{}'),
('恋爱', 'genre', '{}'),
('校园', 'genre', '{}'),
('日常', 'genre', '{}'),
('喜剧', 'genre', '{}'),
('历史', 'genre', '{}'),
('战争', 'genre', '{}'),
('动作', 'genre', '{}'),
('惊悚', 'genre', '{}'),
('恐怖', 'genre', '{}'),
('古典', 'genre', '{}'),
('发烧人声', 'genre', '{}'),
('文学', 'genre', '{}'),
('名著', 'genre', '{}'),
('轻小说', 'genre', '{}'),
('后摇', 'genre', '{}'),
('流行摇滚', 'genre', '{}'),
('交响原声', 'genre', '{}'),
('另类摇滚', 'genre', '{}'),
('爵士嘻哈', 'genre', '{}'),
('电子舞曲', 'genre', '{}'),

-- 4) 专题与宇宙企划 (theme)
('跨媒介', 'theme', '{}'),
('吉卜力', 'theme', '{}'),
('宫崎骏', 'theme', '{}'),
('久石让', 'theme', '{}'),
('EVA', 'theme', '{}'),
('庵野秀明', 'theme', '{}'),
('诺兰', 'theme', '{}'),
('刘慈欣', 'theme', '{}'),
('奥斯卡', 'theme', '{}'),
('刀剑神域', 'theme', '{}'),
('葬送的芙莉莲', 'theme', '{}'),
('孤独摇滚', 'theme', '{}'),
('紫罗兰永恒花园', 'theme', '{}'),
('Re:从零开始的异世界生活', 'theme', '{}'),
('进击的巨人', 'theme', '{}'),
('明日方舟', 'theme', '{}'),
('BanG Dream', 'theme', '{}'),
('Fate', 'theme', '{}'),
('学园都市', 'theme', '{}'),
('Vocaloid', 'theme', '{}'),

-- 5) 社区讨论与考据标签 (topic)
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
('新人报到', 'topic', '{}'),
('资源分享', 'topic', '{}'),
('编目探讨', 'topic', '{}')
ON CONFLICT (name) DO UPDATE SET
    group_type = EXCLUDED.group_type,
    category_scope = EXCLUDED.category_scope;

-- 3.3 默认论坛系统分区确保激活
INSERT INTO forum_boards (code, name_zh, name_en, description, color, icon, sort_order, is_enabled, show_in_feed, names) VALUES
('announcement', '站点公告',   'Announcements',          '站点公告与运营通知',                   'amber',   'Megaphone',     10, TRUE, TRUE,  '{"zh-CN":"站点公告","en-US":"Announcements"}'),
('casual',       '闲聊杂谈',   'Casual Chat',            '轻松闲聊与站内日常交流',               'purple',  'Coffee',        20, TRUE, TRUE,  '{"zh-CN":"闲聊杂谈","en-US":"Casual Chat"}'),
('qa',           '求助答疑',   'Q&A',                    '使用问题、编目与功能答疑',             'teal',    'Hash',          30, TRUE, TRUE,  '{"zh-CN":"求助答疑","en-US":"Q&A"}'),
('reviews',      '考据评注',   'Archive Reviews',        '版本考证、原盘评析与文献释读',         'emerald', 'BookOpen',      40, TRUE, TRUE,  '{"zh-CN":"考据评注","en-US":"Archive Reviews"}'),
('bug_report',   '反馈与建议', 'Feedback & Bug Reports', '缺陷反馈、功能建议与复现信息',         'rose',    'Bug',           50, TRUE, TRUE,  '{"zh-CN":"反馈与建议","en-US":"Feedback & Bug Reports"}'),
('comment',      '评论专用',   'Comments',               '作品与讨论的评论承载区，不进入信息流与全站聚合', 'sky',     'MessageCircle', 60, TRUE, FALSE, '{"zh-CN":"评论专用","en-US":"Comments"}')
ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    description = EXCLUDED.description,
    color = EXCLUDED.color,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order,
    is_enabled = TRUE,
    show_in_feed = EXCLUDED.show_in_feed,
    names = EXCLUDED.names;

-- ------------------------------------------------------------------------------
-- 4. 社区出厂初始指南与欢迎主题 (Initial Genesis Announcement & Site Guide)
-- ------------------------------------------------------------------------------
-- 清理旧版测试占位假连续 UUID
DELETE FROM discussion_topics WHERE id = '00000000-0000-4000-8000-000000000001'::uuid;

INSERT INTO discussion_topics (
    id, user_id, board_code, title, content, language, view_count, reply_count, is_pinned, pinned_at, created_at, updated_at
) VALUES (
    'c4a8f921-6b3e-4d5a-9f12-8e7b3c2a1d0e',
    '00000000-0000-0000-0000-000000000001',
    'announcement',
    '欢迎来到 MetaFusion：新世代高保真多媒介数字馆藏与协作知识库',
    '# 欢迎来到 MetaFusion 数字档案与编目协作平台

MetaFusion 是一个基于 **FRBR / LRM 概念模型** 与 **内容寻址存储（CAS）** 打造的新一代多媒介高保真数字馆藏、实体图谱与考据社区。

---

## 🏛️ 核心编目架构与理念

1. **LRM 混合实体模型**：
   - **Work（抽象作品）**：承载作品纯净题名、多语言题名、创作起止与跨媒介属性。
   - **CanonicalEntry（典范条目 / 表现层 Expression）**：可跨发行版复用的具体创作表达（如录音母版/分集正片/连载单话/典范章节），杜绝同内容重复录入。
   - **Release（发行版 / Manifestation）**：记录商品规格、发行厂牌、ISBN、EAN-13 条形码与分卷/分服。
   - **Medium（载体介质）**：解决单发行箱套内多碟片、不同媒介（如 2CD + 1BDMV + 设定集）的精准物理分级。
   - **AssetFile / CAS（无损资产）**：基于 SHA-256 唯一指纹与 S3 兼容对象存储，实现位完全精确的母盘保全与流媒体自适应转码。

2. **多维正交标签与虚拟货架**：
   - 彻底告别传统硬编码的树状死板分类；
   - 通过 `format（形态）` + `medium（制作手法）` + `genre（流派）` + `theme（企划宇宙）` 灵活编目，由虚拟货架动态聚合呈现。

3. **开放语义关系图谱**：
   - 支持跨主体（签约、隶属、合作）、主体与作品（作曲、导演、原画、配音角色）、作品间（改编、衍生、原声大碟）的全时序与限定词关联网络。

---

## 📚 社区协作与考据准则

- **干净题名**：作品主标题请勿拼接 `（同名专辑）`、`（第一季）` 等注释，版本信息应置于 Release / 关系层。
- **严谨考据**：版本评析与压制日志欢迎提供 CRC32/SHA256 校验、EAC/XLD 抓轨日志与 Mediainfo 报告。
- **尊重版权与知识共享**：所有元数据遵循开放档案规范，共同维护高保真数字遗产。

欢迎各位档案员在 **求助答疑**、**考据评注** 与 **闲聊杂谈** 分区展开交流！',
    'zh-CN',
    42,
    0,
    TRUE,
    NOW(),
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    is_pinned = TRUE,
    pinned_at = EXCLUDED.pinned_at;

-- 帖子流第 1 楼 (Discourse 风格统一流)
INSERT INTO forum_posts (
    id, topic_id, post_number, user_id, content, created_at, updated_at
) VALUES (
    'd5b9a032-7c4f-4e6b-a023-9f8c4d3b2e1f',
    'c4a8f921-6b3e-4d5a-9f12-8e7b3c2a1d0e',
    1,
    '00000000-0000-0000-0000-000000000001',
    '# 欢迎来到 MetaFusion 数字档案与编目协作平台

MetaFusion 是一个基于 **FRBR / LRM 概念模型** 与 **内容寻址存储（CAS）** 打造的新一代多媒介高保真数字馆藏、实体图谱与考据社区。

---

## 🏛️ 核心编目架构与理念

1. **LRM 混合实体模型**：
   - **Work（抽象作品）**：承载作品纯净题名、多语言题名、创作起止与跨媒介属性。
   - **CanonicalEntry（典范条目 / 表现层 Expression）**：可跨发行版复用的具体创作表达（如录音母版/分集正片/连载单话/典范章节），杜绝同内容重复录入。
   - **Release（发行版 / Manifestation）**：记录商品规格、发行厂牌、ISBN、EAN-13 条形码与分卷/分服。
   - **Medium（载体介质）**：解决单发行箱套内多碟片、不同媒介（如 2CD + 1BDMV + 设定集）的精准物理分级。
   - **AssetFile / CAS（无损资产）**：基于 SHA-256 唯一指纹与 S3 兼容对象存储，实现位完全精确的母盘保全与流媒体自适应转码。

2. **多维正交标签与虚拟货架**：
   - 彻底告别传统硬编码的树状死板分类；
   - 通过 `format（形态）` + `medium（制作手法）` + `genre（流派）` + `theme（企划宇宙）` 灵活编目，由虚拟货架动态聚合呈现。

3. **开放语义关系图谱**：
   - 支持跨主体（签约、隶属、合作）、主体与作品（作曲、导演、原画、配音角色）、作品间（改编、衍生、原声大碟）的全时序与限定词关联网络。

---

## 📚 社区协作与考据准则

- **干净题名**：作品主标题请勿拼接 `（同名专辑）`、`（第一季）` 等注释，版本信息应置于 Release / 关系层。
- **严谨考据**：版本评析与压制日志欢迎提供 CRC32/SHA256 校验、EAC/XLD 抓轨日志与 Mediainfo 报告。
- **尊重版权与知识共享**：所有元数据遵循开放档案规范，共同维护高保真数字遗产。

欢迎各位档案员在 **求助答疑**、**考据评注** 与 **闲聊杂谈** 分区展开交流！',
    NOW(),
    NOW()
)
ON CONFLICT (topic_id, post_number) DO UPDATE SET
    content = EXCLUDED.content;

-- 欢迎贴多语言翻译 (en-US)
INSERT INTO topic_translations (topic_id, locale, title, content) VALUES (
    'c4a8f921-6b3e-4d5a-9f12-8e7b3c2a1d0e',
    'en-US',
    'Welcome to MetaFusion: Next-Gen Lossless Multi-Media Catalog & Knowledge Base',
    '# Welcome to MetaFusion Digital Archive & Cataloging Platform

MetaFusion is a next-generation multi-media lossless digital repository, entity graph, and community built on the **FRBR / LRM conceptual model** and **Content-Addressed Storage (CAS)**.

---

## 🏛️ Core Architecture & Cataloging Principles

1. **FRBR / LRM Hybrid Entity Model**:
   - **Work**: Canonical pure titles, multi-language localization, temporal spans, and cross-media properties.
   - **CanonicalEntry (Expression)**: Reusable creative expressions (master recordings, film/episode cuts, book chapters, manga chapters) across releases.
   - **Release**: Commercial manifestations, barcodes (EAN-13), publisher labels, and physical editions.
   - **Medium**: Discs/volumes (e.g. 2CD + 1BDMV box set).
   - **AssetFile / CAS**: Bit-exact SHA-256 S3 assets with automated transcoding.

2. **Orthogonal Tag Taxonomy & Virtual Shelves**:
   - Multi-dimensional classification via Format, Medium, Genre, and Theme facets.
   - Dynamic real-time querying and curated views.

3. **Open Knowledge Graph**:
   - Rich temporal entity relationships connecting creators, institutions, characters, works, and releases.

Enjoy archiving and exploring on MetaFusion!'
)
ON CONFLICT (topic_id, locale) DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content;

-- 关联初始标签
INSERT INTO topic_tag_relations (topic_id, tag_id)
SELECT 'c4a8f921-6b3e-4d5a-9f12-8e7b3c2a1d0e'::uuid, t.id
FROM tags t
WHERE t.name IN ('公告', '考据', '新人报到')
ON CONFLICT DO NOTHING;
