-- ==============================================================================
-- 000002_seed_initial_data.up.sql
-- Seed Initial Ontology Definitions, Relation Types & System Settings
-- ==============================================================================

-- 1. 实体类型定义 (Entity Types)
INSERT INTO entity_type_definitions (code, name_zh, name_en, names, desc_zh, desc_en, color, bg_color, border_color, sort_order, is_system, is_enabled) VALUES
('person', '自然人', 'Person', '{"zh-CN": "自然人", "en-US": "Person", "ja-JP": "個人"}'::jsonb, '单个自然人创作者、艺术家、作家、音乐家', 'Individual human creator, artist, author, musician', 'sky', 'bg-sky-500/10', 'border-sky-500/30', 10, true, true),
('group', '团体 / 组合', 'Group', '{"zh-CN": "团体 / 组合", "en-US": "Group", "ja-JP": "グループ"}'::jsonb, '乐队、创作者团体、偶像组合、制作委员会', 'Band, creative group, idol group, production committee', 'indigo', 'bg-indigo-500/10', 'border-indigo-500/30', 20, true, true),
('studio', '动画 / 影视制作公司', 'Animation Studio', '{"zh-CN": "制作公司", "en-US": "Studio", "ja-JP": "スタジオ"}'::jsonb, '影视动画主创与制作机构 (如 ufotable, 京阿尼)', 'Animation studio, film production company', 'purple', 'bg-purple-500/10', 'border-purple-500/30', 30, true, true),
('circle', '同人社团', 'Doujin Circle', '{"zh-CN": "同人社团", "en-US": "Circle", "ja-JP": "同人サークル"}'::jsonb, '独立同人创作团队、独立游戏工坊', 'Independent doujin circle, indie game group', 'rose', 'bg-rose-500/10', 'border-rose-500/30', 40, true, true),
('developer', '游戏开发商', 'Game Developer', '{"zh-CN": "游戏开发商", "en-US": "Developer", "ja-JP": "開発元"}'::jsonb, '游戏研发制作团队 (如 FromSoftware)', 'Game development studio', 'emerald', 'bg-emerald-500/10', 'border-emerald-500/30', 50, true, true),
('publisher', '出版 / 发行机构', 'Publisher', '{"zh-CN": "出版/发行商", "en-US": "Publisher", "ja-JP": "出版社/販売元"}'::jsonb, '出版社、唱片厂牌、游戏发行商', 'Publishing house, record label, game publisher', 'amber', 'bg-amber-500/10', 'border-amber-500/30', 60, true, true)
ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    names = EXCLUDED.names,
    desc_zh = EXCLUDED.desc_zh,
    desc_en = EXCLUDED.desc_en;

-- 2. 关系类型定义 (Relation Types)
INSERT INTO relation_types (code, domain, name_zh, name_en, names, description, forward_label_zh, reverse_label_zh, forward_label_en, reverse_label_en, allowed_source_types, allowed_target_types, is_symmetric, is_hierarchical, color, icon, sort_order, is_system, is_enabled) VALUES
('adaptation_of', 'work_work', '改编自', 'Adaptation Of', '{"zh-CN": "改编自", "en-US": "Adaptation Of", "ja-JP": "原作"}'::jsonb, '跨媒介作品改编关系（如动画改编自轻小说）', '改编自', '被改编为', 'Adaptation of', 'Adapted as', ARRAY['work'], ARRAY['work'], false, true, 'sky', 'Link', 10, true, true),
('soundtrack_of', 'work_work', '原声集属于', 'Soundtrack Of', '{"zh-CN": "原声集属于", "en-US": "Soundtrack Of", "ja-JP": "劇伴・サントラ"}'::jsonb, '音乐原声、OST 所属的影视/游戏作品', '原声集属于', '拥有原声集', 'Soundtrack of', 'Has soundtrack', ARRAY['work'], ARRAY['work'], false, false, 'purple', 'Link', 20, true, true),
('sequel_of', 'work_work', '正统续作', 'Sequel Of', '{"zh-CN": "正统续作", "en-US": "Sequel Of", "ja-JP": "続編"}'::jsonb, '同一世界观时间线下的正统后续作品', '正统续作', '前作', 'Sequel of', 'Prequel of', ARRAY['work'], ARRAY['work'], false, true, 'emerald', 'Link', 30, true, true),
('prequel_of', 'work_work', '前传作品', 'Prequel Of', '{"zh-CN": "前传作品", "en-US": "Prequel Of", "ja-JP": "前日譚"}'::jsonb, '时间线在前的前传作品', '前传作品', '正传/后作', 'Prequel of', 'Sequel of', ARRAY['work'], ARRAY['work'], false, true, 'emerald', 'Link', 40, true, true),
('spin_off_of', 'work_work', '衍生作品', 'Spin-off Of', '{"zh-CN": "衍生作品", "en-US": "Spin-off Of", "ja-JP": "スピンオフ"}'::jsonb, '番外篇、独立衍生剧场或分支作品', '衍生作品', '衍生出', 'Spin-off of', 'Spawned spin-off', ARRAY['work'], ARRAY['work'], false, true, 'amber', 'Link', 50, true, true),
('remake_of', 'work_work', '重制版本', 'Remake Of', '{"zh-CN": "重制版本", "en-US": "Remake Of", "ja-JP": "リメイク"}'::jsonb, '全流程高清重制或重构作品', '重制自', '被重制为', 'Remake of', 'Remade as', ARRAY['work'], ARRAY['work'], false, true, 'rose', 'Link', 60, true, true),
('member_of', 'work_franchise', '从属于企划', 'Member Of Franchise', '{"zh-CN": "从属于企划", "en-US": "Member Of", "ja-JP": "所属シリーズ"}'::jsonb, '作品收录于指定跨媒介企划/宏大宇宙', '从属于企划', '收录作品', 'Member of franchise', 'Includes work', ARRAY['work'], ARRAY['franchise'], false, true, 'indigo', 'Link', 70, true, true)
ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    names = EXCLUDED.names,
    description = EXCLUDED.description;

-- 3. 外部数据库定义 (External Databases)
INSERT INTO external_database_definitions (code, name_zh, name_en, names, category, url_pattern, icon, icon_url, validation_regex, description, sort_order, is_enabled, is_system) VALUES
('musicbrainz', 'MusicBrainz', 'MusicBrainz', '{"zh-CN": "MusicBrainz", "en-US": "MusicBrainz"}'::jsonb, 'music', 'https://musicbrainz.org/release/{id}', 'Globe', '', '', '开放音乐元数据百科', 10, true, true),
('bangumi', 'Bangumi 番组计划', 'Bangumi', '{"zh-CN": "Bangumi 番组计划", "en-US": "Bangumi"}'::jsonb, 'anime', 'https://bgm.tv/subject/{id}', 'Globe', '', '', '二次元动画、游戏、图书词条库', 20, true, true),
('tmdb', 'The Movie Database (TMDB)', 'TMDB', '{"zh-CN": "TMDB 影视库", "en-US": "TMDB"}'::jsonb, 'movie', 'https://www.themoviedb.org/movie/{id}', 'Globe', '', '', '全球影视数据库', 30, true, true),
('vndb', 'VNDB 视觉小说库', 'VNDB', '{"zh-CN": "VNDB 视觉小说库", "en-US": "VNDB"}'::jsonb, 'game', 'https://vndb.org/v{id}', 'Globe', '', '', '视觉小说档案馆', 40, true, true),
('douban', '豆瓣', 'Douban', '{"zh-CN": "豆瓣", "en-US": "Douban"}'::jsonb, 'all', 'https://movie.douban.com/subject/{id}', 'Bookmark', '', '', '中文图书与影视评分评论社区', 50, true, true),
('wikidata', 'Wikidata', 'Wikidata', '{"zh-CN": "Wikidata 维基数据", "en-US": "Wikidata"}'::jsonb, 'all', 'https://www.wikidata.org/wiki/{id}', 'Globe', '', '', '维基媒体知识图谱库', 60, true, true)
ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    names = EXCLUDED.names,
    url_pattern = EXCLUDED.url_pattern;

-- 4. 社区公共板块 (Forum Boards)
INSERT INTO forum_boards (code, name_zh, name_en, names, description, color, icon, sort_order, is_enabled, show_in_feed) VALUES
('general', '综合讨论', 'General', '{"zh-CN": "综合讨论", "en-US": "General"}'::jsonb, '跨媒介作品探讨、平台使用交流与自由闲聊', 'emerald', 'MessageSquare', 10, true, true),
('curation', '编目治理', 'Catalog Curation', '{"zh-CN": "编目治理", "en-US": "Catalog Curation"}'::jsonb, '元数据校勘、LRM 关系拓扑审议与规范制定', 'amber', 'BookOpen', 20, true, true),
('announcements', '官方公告', 'Announcements', '{"zh-CN": "官方公告", "en-US": "Announcements"}'::jsonb, '系统版本更新、维护通知与开放计划', 'sky', 'Megaphone', 30, true, true)
ON CONFLICT (code) DO NOTHING;

-- 5. 系统设置 (System Settings)
INSERT INTO system_settings (key, value) VALUES
('registration_enabled', 'true'),
('invite_required', 'false'),
('storage_quota_mb', '20480')
ON CONFLICT (key) DO NOTHING;
