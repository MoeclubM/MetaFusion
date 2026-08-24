-- ==============================================================================
-- 000002_seed_initial_data.up.sql
-- Seed Initial Ontology Definitions, Relation Types & System Settings
-- ==============================================================================

-- 1. 实体类型定义 (Entity Types)
INSERT INTO entity_type_definitions (code, name_zh, name_en, names, description, icon, color, sort_order, is_active, is_system) VALUES
('person', '自然人', 'Person', '{"zh-CN": "自然人", "en-US": "Person", "ja-JP": "個人"}'::jsonb, '单个自然人创作者、艺术家、作家、音乐家', 'User', 'sky', 10, true, true),
('group', '团体 / 组合', 'Group', '{"zh-CN": "团体 / 组合", "en-US": "Group", "ja-JP": "グループ"}'::jsonb, '乐队、创作者团体、偶像组合、制作委员会', 'Users', 'indigo', 20, true, true),
('studio', '动画 / 影视制作公司', 'Animation Studio', '{"zh-CN": "制作公司", "en-US": "Studio", "ja-JP": "スタジオ"}'::jsonb, '影视动画主创与制作机构 (如 ufotable, 京阿尼)', 'Film', 'purple', 30, true, true),
('circle', '同人社团', 'Doujin Circle', '{"zh-CN": "同人社团", "en-US": "Circle", "ja-JP": "同人サークル"}'::jsonb, '独立同人创作团队、独立游戏工坊', 'Sparkles', 'rose', 40, true, true),
('developer', '游戏开发商', 'Game Developer', '{"zh-CN": "游戏开发商", "en-US": "Developer", "ja-JP": "開発元"}'::jsonb, '游戏研发制作团队 (如 FromSoftware)', 'Gamepad2', 'emerald', 50, true, true),
('publisher', '出版 / 发行机构', 'Publisher', '{"zh-CN": "出版/发行商", "en-US": "Publisher", "ja-JP": "出版社/販売元"}'::jsonb, '出版社、唱片厂牌、游戏发行商', 'Building2', 'amber', 60, true, true)
ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    names = EXCLUDED.names,
    description = EXCLUDED.description;

-- 2. 关系类型定义 (Relation Types)
INSERT INTO relation_types (code, name_zh, name_en, names, reverse_code, source_type, target_type, description, is_temporal, is_active, is_system) VALUES
('adaptation_of', '改编自', 'Adaptation Of', '{"zh-CN": "改编自", "en-US": "Adaptation Of", "ja-JP": "原作"}'::jsonb, 'adapted_to', 'work', 'work', '跨媒介作品改编关系（如动画改编自轻小说）', true, true, true),
('soundtrack_of', '原声集属于', 'Soundtrack Of', '{"zh-CN": "原声集属于", "en-US": "Soundtrack Of", "ja-JP": "劇伴・サントラ"}'::jsonb, 'has_soundtrack', 'work', 'work', '音乐原声、OST 所属的影视/游戏作品', false, true, true),
('sequel_of', '正统续作', 'Sequel Of', '{"zh-CN": "正统续作", "en-US": "Sequel Of", "ja-JP": "続編"}'::jsonb, 'prequel_of', 'work', 'work', '同一世界观时间线下的正统后续作品', true, true, true),
('prequel_of', '前传作品', 'Prequel Of', '{"zh-CN": "前传作品", "en-US": "Prequel Of", "ja-JP": "前日譚"}'::jsonb, 'sequel_of', 'work', 'work', '时间线在前的前传作品', true, true, true),
('spin_off_of', '衍生作品', 'Spin-off Of', '{"zh-CN": "衍生作品", "en-US": "Spin-off Of", "ja-JP": "スピンオフ"}'::jsonb, 'has_spin_off', 'work', 'work', '番外篇、独立衍生剧场或分支作品', false, true, true),
('remake_of', '重制版本', 'Remake Of', '{"zh-CN": "重制版本", "en-US": "Remake Of", "ja-JP": "リメイク"}'::jsonb, 'remade_as', 'work', 'work', '全流程高清重制或重构作品', true, true, true),
('member_of', '从属于企划', 'Member Of Franchise', '{"zh-CN": "从属于企划", "en-US": "Member Of", "ja-JP": "所属シリーズ"}'::jsonb, 'has_member', 'work', 'franchise', '作品收录于指定跨媒介企划/宏大宇宙', false, true, true)
ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    names = EXCLUDED.names,
    description = EXCLUDED.description;

-- 3. 外部数据库定义 (External Databases)
INSERT INTO external_database_definitions (code, name_zh, name_en, names, url_template, icon, color, applicable_types, sort_order, is_active, is_system) VALUES
('musicbrainz', 'MusicBrainz', 'MusicBrainz', '{"zh-CN": "MusicBrainz", "en-US": "MusicBrainz"}'::jsonb, 'https://musicbrainz.org/release/{id}', 'Music', 'purple', '{work,release,artist}', 10, true, true),
('bangumi', 'Bangumi 番组计划', 'Bangumi', '{"zh-CN": "Bangumi 番组计划", "en-US": "Bangumi"}'::jsonb, 'https://bgm.tv/subject/{id}', 'Tv', 'rose', '{work,artist}', 20, true, true),
('tmdb', 'The Movie Database (TMDB)', 'TMDB', '{"zh-CN": "TMDB 影视库", "en-US": "TMDB"}'::jsonb, 'https://www.themoviedb.org/movie/{id}', 'Film', 'sky', '{work,release,artist}', 30, true, true),
('vndb', 'VNDB 视觉小说库', 'VNDB', '{"zh-CN": "VNDB 视觉小说库", "en-US": "VNDB"}'::jsonb, 'https://vndb.org/v{id}', 'BookOpen', 'emerald', '{work,release,artist}', 40, true, true),
('douban', '豆瓣', 'Douban', '{"zh-CN": "豆瓣", "en-US": "Douban"}'::jsonb, 'https://movie.douban.com/subject/{id}', 'Bookmark', 'emerald', '{work,release,artist}', 50, true, true),
('wikidata', 'Wikidata', 'Wikidata', '{"zh-CN": "Wikidata 维基数据", "en-US": "Wikidata"}'::jsonb, 'https://www.wikidata.org/wiki/{id}', 'Globe', 'slate', '{work,artist,franchise}', 60, true, true)
ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    names = EXCLUDED.names,
    url_template = EXCLUDED.url_template;

-- 4. 社区公共板块 (Forum Boards)
INSERT INTO forum_boards (code, name_zh, name_en, description_zh, description_en, icon, color, sort_order, is_active, is_system) VALUES
('general', '综合讨论', 'General', '跨媒介作品探讨、平台使用交流与自由闲聊', 'General discussion about multimedia works and platform', 'MessageSquare', 'emerald', 10, true, true),
('curation', '编目治理', 'Catalog Curation', '元数据校勘、LRM 关系拓扑审议与规范制定', 'Metadata cataloging, LRM topology and schema proposals', 'Library', 'amber', 20, true, true),
('announcements', '官方公告', 'Announcements', '系统版本更新、维护通知与开放计划', 'System release notes, maintenance notices and roadmaps', 'Bell', 'sky', 30, true, true)
ON CONFLICT (code) DO NOTHING;

-- 5. 系统设置 (System Settings)
INSERT INTO system_settings (key, value, description) VALUES
('registration_enabled', 'true', '用户注册全局开关'),
('invite_required', 'false', '注册是否必须填写真实邀请码'),
('storage_quota_mb', '20480', '普通用户初始存储配额 (MB)')
ON CONFLICT (key) DO NOTHING;
