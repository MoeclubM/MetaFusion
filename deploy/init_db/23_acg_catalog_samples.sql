-- 23_acg_catalog_samples.sql
-- 扩充高质量跨媒介经典 ACG 作品数据（轻小说、分卷漫画、TV/剧场版动画、原声音乐、企划 Franchise、创作者与人物实体）。
-- 固定 UUID 前缀 deadbeef-0000-4000-8000-。
-- 遵循规范：
-- 1. 不使用废弃的 media_type，分类以 标签 + 虚拟货架（channel）组织。
-- 2. 轻小说/分卷漫画：多卷归入同一 Work，分卷作为多个 Release 并记录 ISBN / catalog_number。
-- 3. 跨媒介体系：使用 Franchise 串联，并建立 Work-to-Work 改编与衍生关系（adapted_from, soundtrack_of, spin_off_of）。
-- 4. 角色与声优：作为 Artist 实体，通过 voice_actor_of, character_in, work_artist_relations 关联。
-- 5. 多语言：包含主表与 translations（zh-CN, en-US, ja）。
-- 6. 所有 INSERT 使用 ON CONFLICT DO NOTHING 或 DO UPDATE，保证幂等。
-- 7. Work.title 必须是干净作品名：媒介/季数/版本等区分信息写在 Release.edition_name、
--    标签与 Franchise 关系层，禁止拼「（同名专辑）」「（第一季）」等括号注记进标题。

BEGIN;

SELECT setval(pg_get_serial_sequence('tags', 'id'), COALESCE((SELECT MAX(id) FROM tags), 1));

-- ---------------------------------------------------------------------------
-- 0. 标签扩充（形态、题材、流派等）
-- ---------------------------------------------------------------------------
INSERT INTO tags (name, group_type, category_scope) VALUES
('刀剑神域', 'theme', '{}'),
('葬送的芙莉莲', 'theme', '{}'),
('孤独摇滚', 'theme', '{}'),
('紫罗兰永恒花园', 'theme', '{}'),
('Re:从零开始的异世界生活', 'theme', '{}'),
('进击的巨人', 'theme', '{}'),
('日常', 'genre', '{}'),
('冒险', 'genre', '{}'),
('热血', 'genre', '{}'),
('催泪', 'genre', '{}'),
('后摇', 'genre', '{}'),
('流行摇滚', 'genre', '{}'),
('交响原声', 'genre', '{}')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1. 企划枢纽 (Franchises)
-- ---------------------------------------------------------------------------
INSERT INTO franchises (id, title, original_title, aliases, disambiguation, summary, cover_image_url, begin_date, country, created_by, external_ids) VALUES
('deadbeef-0000-4000-8000-000000000001', '刀剑神域', 'ソードアート・オンライン',
    '{"Sword Art Online","SAO","刀剑"}', '川原砾跨媒介科幻企划',
    '以完全潜行虚拟现实技术为背景的科幻冒险企划，涵盖轻小说、TV动画、剧场版长片及衍生原声音乐。',
    'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1200&q=80',
    '2009-04-10', '日本', '00000000-0000-0000-0000-000000000001',
    '{"official":"https://www.swordart-online.net"}'),

('deadbeef-0000-4000-8000-000000000002', '葬送的芙莉莲', '葬送のフリーレン',
    '{"Frieren: Beyond Journey''s End","葬送的芙莉莲"}', '山田钟人与阿部司奇幻后日谈企划',
    '讲述打倒魔王后的精灵魔法使芙莉莲在漫长岁月中追寻人类情感与记忆的奇幻史诗，包含原作连载漫画与高口碑 TV 动画。',
    'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=1200&q=80',
    '2020-04-28', '日本', '00000000-0000-0000-0000-000000000001',
    '{"official":"https://frieren-anime.jp"}'),

('deadbeef-0000-4000-8000-000000000003', '孤独摇滚！', 'ぼっち・ざ・ろっく！',
    '{"BOCCHI THE ROCK!","孤独摇滚","滚妹"}', '芳文社芳华摇滚企划',
    '滨路晶创作的四格音乐漫画及其现象级 TV 动画改编，围绕下北泽高中生少女乐队「结束乐队」展开。',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80',
    '2017-12-19', '日本', '00000000-0000-0000-0000-000000000001',
    '{"official":"https://bocchi.rocks"}'),

('deadbeef-0000-4000-8000-000000000004', '紫罗兰永恒花园', 'ヴァイオレット・エヴァーガーデン',
    '{"Violet Evergarden","京紫"}', '晓佳奈与京都动画跨媒介企划',
    '第5届京都动画大奖唯一大奖得主。讲述战争中作为道具被培养的人偶少女薇尔莉特，在战后成为自动手记人偶探寻「我爱你」含义的感人篇章。',
    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80',
    '2015-12-25', '日本', '00000000-0000-0000-0000-000000000001',
    '{"official":"http://violet-evergarden.jp"}'),

('deadbeef-0000-4000-8000-000000000005', 'Re:从零开始的异世界生活', 'Re:ゼロから始める異世界生活',
    '{"Re:Zero","Re0","从零开始"}', '长月达平异世界奇幻企划',
    '高中生菜月昴被召唤至异世界后获得「死亡回归」能力，为了守护所爱之人经历无数次绝望与重生的史诗企划。',
    'https://images.unsplash.com/photo-1563089145-599997674d42?auto=format&fit=crop&w=1200&q=80',
    '2012-04-20', '日本', '00000000-0000-0000-0000-000000000001',
    '{"official":"http://re-zero-anime.jp"}'),

('deadbeef-0000-4000-8000-000000000006', '进击的巨人', '進撃の巨人',
    '{"Attack on Titan","AOT","巨人"}', '谏山创黑暗奇幻史诗企划',
    '讲述被高墙隔绝的人类与捕食人类的巨人之间抗争的黑暗史诗，涵盖连载漫画、TV全季动画与泽野弘之配乐原声。',
    'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=1200&q=80',
    '2009-09-09', '日本', '00000000-0000-0000-0000-000000000001',
    '{"official":"https://shingeki.tv"}')
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    original_title = EXCLUDED.original_title,
    aliases = EXCLUDED.aliases,
    disambiguation = EXCLUDED.disambiguation,
    summary = EXCLUDED.summary,
    cover_image_url = EXCLUDED.cover_image_url,
    begin_date = EXCLUDED.begin_date,
    country = EXCLUDED.country,
    external_ids = EXCLUDED.external_ids;

INSERT INTO franchise_translations (franchise_id, locale, title, summary) VALUES
('deadbeef-0000-4000-8000-000000000001', 'en-US', 'Sword Art Online', 'Kawahara Reki VR sci-fi franchise spanning novels, TV anime, films, and soundtracks.'),
('deadbeef-0000-4000-8000-000000000002', 'en-US', 'Frieren: Beyond Journey''s End', 'Award-winning fantasy epic by Kanehito Yamada and Tsukasa Abe, following the elf mage Frieren.'),
('deadbeef-0000-4000-8000-000000000003', 'en-US', 'BOCCHI THE ROCK!', 'Music and comedy multimedia franchise about Hitori Gotoh and Kessoku Band.'),
('deadbeef-0000-4000-8000-000000000004', 'en-US', 'Violet Evergarden', 'Kyoto Animation masterpiece following Violet, an Auto Memory Doll seeking the meaning of "I love you".'),
('deadbeef-0000-4000-8000-000000000005', 'en-US', 'Re:ZERO -Starting Life in Another World-', 'Tappei Nagatsuki dark fantasy series featuring Subaru Natsuki and Return by Death.'),
('deadbeef-0000-4000-8000-000000000006', 'en-US', 'Attack on Titan', 'Hajime Isayama dark fantasy manga and anime franchise featuring humanity''s struggle against Titans.')
ON CONFLICT DO NOTHING;

INSERT INTO franchise_tag_relations (franchise_id, tag_id)
SELECT f.id, t.id FROM (VALUES
    ('deadbeef-0000-4000-8000-000000000001'::uuid, '跨媒介'),
    ('deadbeef-0000-4000-8000-000000000001'::uuid, '科幻'),
    ('deadbeef-0000-4000-8000-000000000001'::uuid, '刀剑神域'),
    ('deadbeef-0000-4000-8000-000000000002'::uuid, '跨媒介'),
    ('deadbeef-0000-4000-8000-000000000002'::uuid, '奇幻'),
    ('deadbeef-0000-4000-8000-000000000002'::uuid, '葬送的芙莉莲'),
    ('deadbeef-0000-4000-8000-000000000003'::uuid, '跨媒介'),
    ('deadbeef-0000-4000-8000-000000000003'::uuid, '孤独摇滚'),
    ('deadbeef-0000-4000-8000-000000000004'::uuid, '跨媒介'),
    ('deadbeef-0000-4000-8000-000000000004'::uuid, '紫罗兰永恒花园'),
    ('deadbeef-0000-4000-8000-000000000005'::uuid, '跨媒介'),
    ('deadbeef-0000-4000-8000-000000000005'::uuid, '奇幻'),
    ('deadbeef-0000-4000-8000-000000000005'::uuid, 'Re:从零开始的异世界生活'),
    ('deadbeef-0000-4000-8000-000000000006'::uuid, '跨媒介'),
    ('deadbeef-0000-4000-8000-000000000006'::uuid, '热血'),
    ('deadbeef-0000-4000-8000-000000000006'::uuid, '进击的巨人')
) AS f(id, tag_name)
JOIN tags t ON t.name = f.tag_name
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. 实体库 (Artists: 创作者 / 制作机构 / 角色 / 虚拟乐队 / 出版社)
-- ---------------------------------------------------------------------------
INSERT INTO artists (id, name, original_name, disambiguation, entity_type, country, biography, begin_date, end_date, ended, external_ids) VALUES
-- 创作者 / 监督 / 作曲家
('deadbeef-0000-4000-8000-000000000201', '川原砾', '川原 礫', '刀剑神域/加速世界 原作', 'person', '日本',
    '日本轻小说作家。代表作《刀剑神域》《加速世界》，获第15届电击小说大奖大赏。', '1974-08-17', '', FALSE, '{"bangumi":"6249"}'),
('deadbeef-0000-4000-8000-000000000202', 'abec', 'abec', '刀剑神域轻小说插画', 'person', '日本',
    '日本插画家、原画师。担任《刀剑神域》轻小说原作插画。', '', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000203', '梶浦由记', '梶浦 由記', '刀剑神域/Fate 配乐作曲家', 'person', '日本',
    '日本著名作曲家、音乐制作人。为《刀剑神域》《空之境界》《Fate/Zero》《鬼灭之刃》创作配乐。', '1965-08-06', '', FALSE, '{"musicbrainz":"2924151b-52c6-47b7-849a-e18e47be408a"}'),
('deadbeef-0000-4000-8000-000000000204', '山田钟人', '山田 鐘人', '葬送的芙莉莲 原作编剧', 'person', '日本',
    '日本漫画原作者。《葬送的芙莉莲》故事原作，获2021年漫画大奖。', '', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000205', '阿部司', 'アベ ツカサ', '葬送的芙莉莲 漫画作画', 'person', '日本',
    '日本漫画家、插画家。《葬送的芙莉莲》作画担当。', '1995', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000206', '斋藤圭一郎', '斎藤 圭一郎', '芙莉莲/孤独摇滚 动画监督', 'person', '日本',
    '日本动画导演、演出家。执导《孤独摇滚！》与《葬送的芙莉莲》，以卓越的视听语言与演出节奏广受赞誉。', '1993', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000207', 'Evan Call', 'Evan Call', '芙莉莲/紫罗兰 配乐作曲家', 'person', '美国',
    '活跃于日本动画业界的美国作曲家，为《紫罗兰永恒花园》《葬送的芙莉莲》创作管弦配乐。', '1988-06-29', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000208', '滨路晶', 'はまじ あき', '孤独摇滚！ 原作漫画家', 'person', '日本',
    '日本女性漫画家。芳文社《Manga Time Kirara MAX》连载《孤独摇滚！》。', '', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000209', '晓佳奈', '暁 佳奈', '紫罗兰永恒花园 原作小说家', 'person', '日本',
    '日本小说家。凭借《紫罗兰永恒花园》斩获第5届京都动画大奖小说部门大奖。', '', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000210', '高濑亚贵子', '高瀬 亜貴子', '紫罗兰永恒花园 角色设计/总作监', 'person', '日本',
    '京都动画所属原画师、角色设计师。《紫罗兰永恒花园》角色设计与插画。', '', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000211', '石立太一', '石立 太一', '紫罗兰永恒花园 动画监督', 'person', '日本',
    '京都动画所属动画导演。执导《境界的彼方》《紫罗兰永恒花园》TV及剧场版。', '1979-12-20', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000212', '长月达平', '長月 達平', 'Re:Zero 原作小说家', 'person', '日本',
    '日本轻小说作家。代表作《Re:从零开始的异世界生活》《Vivy -Fluorite Eye''s Song-》。', '1987-03-11', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000213', '大冢真一郎', '大塚 真一郎', 'Re:Zero 原作插画', 'person', '日本',
    '日本插画家、游戏角色设计师。《Re:从零开始的异世界生活》小说插画与角色原案。', '', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000214', '末广健一郎', '末廣 健一郎', 'Re:Zero/少女终末 配乐作曲家', 'person', '日本',
    '日本作曲家、编曲家。为《Re:从零开始的异世界生活》《工作细胞》《黄金神威》配乐。', '1980-12-27', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000215', '谏山创', '諫山 創', '进击的巨人 原作漫画家', 'person', '日本',
    '日本漫画家。代表作《进击的巨人》，创下破亿发行量的现象级漫画神话。', '1986-08-29', '', FALSE, '{"bangumi":"6055"}'),
('deadbeef-0000-4000-8000-000000000216', '荒木哲郎', '荒木 哲郎', '进击的巨人 动画监督', 'person', '日本',
    '日本动画导演。执导《死亡笔记》《进击的巨人》《甲铁城的卡巴内利》。', '1976-11-05', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000217', '泽野弘之', '澤野 弘之', '进击的巨人/高达UC 配乐作曲家', 'person', '日本',
    '日本著名作曲家、音乐制作人。以宏大激昂的交响摇滚风格著称。代表作《进击的巨人》《机动战士高达UC》《罪恶王冠》《Kill la Kill》。', '1980-09-12', '', FALSE, '{"musicbrainz":"2c5f1118-2e06-4df4-a82f-57b12d5e3efc"}'),

-- 声优 (CV)
('deadbeef-0000-4000-8000-000000000220', '松冈祯丞', '松岡 禎丞', '桐人 / 菜月昴 CV', 'person', '日本',
    '日本著名声优，I''m Enterprise所属。饰演桐人、菜月昴、伊之助等。', '1986-09-17', '', FALSE, '{"bangumi":"4991"}'),
('deadbeef-0000-4000-8000-000000000221', '户松遥', '戸松 遥', '亚丝娜 CV', 'person', '日本',
    '日本声优、歌手，Music Ray''n所属。饰演结城明日奈（亚丝娜）。', '1990-02-04', '', FALSE, '{"bangumi":"4443"}'),
('deadbeef-0000-4000-8000-000000000222', '种崎敦美', '種﨑 敦美', '芙莉莲 CV', 'person', '日本',
    '日本实力派声优，东京俳优生活协同组合所属。饰演芙莉莲、安妮亚等。', '1990-09-27', '', FALSE, '{"bangumi":"9899"}'),
('deadbeef-0000-4000-8000-000000000223', '青山吉能', '青山 吉能', '后藤一里 (波奇酱) CV', 'person', '日本',
    '日本声优，81 Produce所属。在《孤独摇滚！》中倾情演绎主角后藤一里。', '1996-05-15', '', FALSE, '{"bangumi":"13456"}'),
('deadbeef-0000-4000-8000-000000000224', '石川由依', '石川 由依', '三笠 / 薇尔莉特 CV', 'person', '日本',
    '日本声优、舞台演员。饰演三笠·阿克曼、薇尔莉特·伊芙加登、2B。', '1989-05-30', '', FALSE, '{"bangumi":"5117"}'),
('deadbeef-0000-4000-8000-000000000225', '高桥李依', '高橋 李依', '爱蜜莉雅 CV', 'person', '日本',
    '日本声优、歌手，81 Produce所属。饰演爱蜜莉雅、惠惠、星野爱等。', '1994-02-27', '', FALSE, '{"bangumi":"18429"}'),
('deadbeef-0000-4000-8000-000000000226', '梶裕贵', '梶 裕貴', '艾伦·耶格尔 CV', 'person', '日本',
    '日本著名声优，VIMS所属。饰演艾伦·耶格尔、轰焦冻等。', '1985-09-03', '', FALSE, '{"bangumi":"4765"}'),

-- 虚拟角色 (Virtual Characters)
('deadbeef-0000-4000-8000-000000000230', '桐人', 'キリト', '桐谷和人 / 黑色剑士', 'virtual_character', '日本',
    '《刀剑神域》男主角，封弊者、双剑使「黑色剑士」。CV 为松冈祯丞。', '', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000231', '亚丝娜', 'アスナ', '结城明日奈 / 闪光', 'virtual_character', '日本',
    '《刀剑神域》女主角，血盟骑士团副团长「闪光」。CV 为户松遥。', '', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000232', '芙莉莲', 'フリーレン', '千年精灵魔法使', 'virtual_character', '日本',
    '《葬送的芙莉莲》主角，活了千年的精灵族大魔法使，勇者辛美尔小队成员。CV 为种崎敦美。', '', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000233', '后藤一里', '後藤 ひとり', '波奇酱 / 吉他英雄', 'virtual_character', '日本',
    '《孤独摇滚！》主角，极度社恐的吉他手「吉他英雄」，结束乐队主音吉他。CV 为青山吉能。', '', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000234', '薇尔莉特·伊芙加登', 'ヴァイオレット・エヴァーガーデン', 'C.H邮政公司自动手记人偶', 'virtual_character', '日本',
    '《紫罗兰永恒花园》主角，前陆军少女战士，战后从事代笔书信的自动手记人偶。CV 为石川由依。', '', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000235', '菜月昴', 'ナツキ・スバル', '拥有死亡回归的少年', 'virtual_character', '日本',
    '《Re:从零开始的异世界生活》男主角，在异世界拥有「死亡回归」能力。CV 为松冈祯丞。', '', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000236', '爱蜜莉雅', 'エミリア', '半精灵王选候补人', 'virtual_character', '日本',
    '《Re:从零开始的异世界生活》女主角，银发紫眸半精灵术士。CV 为高桥李依。', '', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000237', '艾伦·耶格尔', 'エレン・イェーガー', '进击的巨人 / 进击的恶魔', 'virtual_character', '日本',
    '《进击的巨人》主角，持有进击的巨人与始祖巨人。CV 为梶裕贵。', '', '', FALSE, '{}'),
('deadbeef-0000-4000-8000-000000000238', '三笠·阿克曼', 'ミカサ・アッカーマン', '阿克曼一族最强战士', 'virtual_character', '日本',
    '《进击的巨人》女主角，第104期训练兵团首席，阿克曼血统守护者。CV 为石川由依。', '', '', FALSE, '{}'),

-- 虚拟乐队与乐团
('deadbeef-0000-4000-8000-000000000240', '结束乐队', '結束バンド', '孤独摇滚！ 企划虚构乐队', 'fictional_band', '日本',
    '《孤独摇滚！》剧内核心高中生四人少女摇滚乐队，成员包括后藤一里、伊地知虹夏、山田凉、喜多郁代。', '2017', '', FALSE, '{"official":"https://bocchi.rocks/kessokuband"}'),

-- 动画制作公司 (Studios) & 出版社 (Publishers)
('deadbeef-0000-4000-8000-000000000250', 'A-1 Pictures', '株式会社A-1 Pictures', 'SAO/辉夜/孤独摇滚(母公司)制作社', 'studio', '日本',
    '日本著名动画制作公司，Aniplex 全资子公司。制作《刀剑神域》《四月是你的谎言》《辉夜大小姐想让我告白》《86-不存在的战区-》。', '2005-05-09', '', FALSE, '{"official":"https://a1p.jp"}'),
('deadbeef-0000-4000-8000-000000000251', 'Madhouse', '株式会社マッドハウス', '葬送的芙莉莲 动画制作社', 'studio', '日本',
    '日本老牌顶级动画制作公司。制作《葬送的芙莉莲》《一拳超人》《死亡笔记》《猎人 (2011)》。', '1972-10-17', '', FALSE, '{"official":"https://www.madhouse.co.jp"}'),
('deadbeef-0000-4000-8000-000000000252', 'CloverWorks', '株式会社CloverWorks', '孤独摇滚！ 动画制作社', 'studio', '日本',
    '日本知名动画制作公司，原 A-1 Pictures 高圆寺工作室独立。制作《孤独摇滚！》《间谍过家家》《约定的梦幻岛》《更衣人偶坠入爱河》。', '2018-10-01', '', FALSE, '{"official":"https://cloverworks.co.jp"}'),
('deadbeef-0000-4000-8000-000000000253', '京都动画', '株式会社京都アニメーション', '紫罗兰永恒花园 动画制作社', 'studio', '日本',
    '日本业界顶尖动画制作公司，通称「京阿尼」。制作《紫罗兰永恒花园》《凉宫春日的忧郁》《轻音少女》《吹响！上低音号》《CLANNAD》。', '1981-07-12', '', FALSE, '{"official":"https://www.kyotoanimation.co.jp"}'),
('deadbeef-0000-4000-8000-000000000254', 'WHITE FOX', '株式会社WHITE FOX', 'Re:Zero 动画制作社', 'studio', '日本',
    '日本动画制作公司。制作《Re:从零开始的异世界生活》《命运石之门》《斩！赤红之瞳》《少女终末旅行》。', '2006-04', '', FALSE, '{"official":"http://w-fox.co.jp"}'),
('deadbeef-0000-4000-8000-000000000255', 'WIT STUDIO', '株式会社ウィットスタジオ', '进击的巨人 前三季制作社', 'studio', '日本',
    '日本知名动画制作公司，IG Port 旗下子公司。制作《进击的巨人（第1-3季）》《甲铁城的卡巴内利》《冰海战记》《间谍过家家》。', '2012-06-01', '', FALSE, '{"official":"https://witstudio.co.jp"}'),
('deadbeef-0000-4000-8000-000000000256', '小学馆', '株式会社小学館', '芙莉莲 漫画出版方', 'publisher', '日本',
    '日本主要综合性出版社之一，出版《周刊少年Sunday》《葬送的芙莉莲》《名侦探柯南》。', '1922-08-08', '', FALSE, '{"official":"https://www.shogakukan.co.jp"}'),
('deadbeef-0000-4000-8000-000000000257', '芳文社', '株式会社芳文社', '孤独摇滚 漫画出版方', 'publisher', '日本',
    '日本专门出版漫画的出版社，旗下《Manga Time Kirara》系列杂志开创萌系日常芳文风。', '1950-07-10', '', FALSE, '{"official":"https://houbunsha.co.jp"}'),
('deadbeef-0000-4000-8000-000000000258', '讲谈社', '株式会社講談社', '进击的巨人 漫画出版方', 'publisher', '日本',
    '日本最大综合出版社之一，出版《别册少年Magazine》《进击的巨人》。', '1909-11', '', FALSE, '{"official":"https://www.kodansha.co.jp"}'),
('deadbeef-0000-4000-8000-000000000259', '波丽佳音', '株式会社ポニーキャニオン', '进击的巨人 音乐与音像发行', 'publisher', '日本',
    '日本富士产经集团旗下音乐与音像出版大厂，发行《进击的巨人》全系列 OST 与 Blu-ray。', '1966-10-01', '', FALSE, '{"official":"https://www.ponycanyon.co.jp"}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO artist_translations (artist_id, locale, name, biography) VALUES
('deadbeef-0000-4000-8000-000000000201', 'en-US', 'Reki Kawahara', 'Author of Sword Art Online and Accel World.'),
('deadbeef-0000-4000-8000-000000000203', 'en-US', 'Yuki Kajiura', 'Legendary composer of Sword Art Online, Fate/Zero, and Demon Slayer.'),
('deadbeef-0000-4000-8000-000000000206', 'en-US', 'Keiichiro Saito', 'Acclaimed director of BOCCHI THE ROCK! and Frieren: Beyond Journey''s End.'),
('deadbeef-0000-4000-8000-000000000207', 'en-US', 'Evan Call', 'Composer of Violet Evergarden and Frieren: Beyond Journey''s End.'),
('deadbeef-0000-4000-8000-000000000215', 'en-US', 'Hajime Isayama', 'Creator and manga artist of Attack on Titan.'),
('deadbeef-0000-4000-8000-000000000217', 'en-US', 'Hiroyuki Sawano', 'Renowned composer of Attack on Titan, Mobile Suit Gundam UC, and Kill la Kill.'),
('deadbeef-0000-4000-8000-000000000240', 'en-US', 'Kessoku Band', 'Fictional band in BOCCHI THE ROCK! featuring Hitori Gotoh.'),
('deadbeef-0000-4000-8000-000000000253', 'en-US', 'Kyoto Animation', 'World-class studio behind Violet Evergarden, CLANNAD, and K-ON!')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. 作品库 (Works: 小说原著、分卷漫画、TV 动画番剧、剧场版电影、原声大碟)
-- ---------------------------------------------------------------------------
INSERT INTO works (id, category_code, title, original_title, aliases, release_date, begin_date, end_date, ended, country, language, original_language, summary, status, created_by, catalog_metadata) VALUES
-- 1. 刀剑神域 系列
('deadbeef-0000-4000-8000-000000000101', '', '刀剑神域', 'ソードアート・オンライン',
    '{"Sword Art Online Novel","SAO小说","刀剑轻小说"}', '2009-04-10', '2009-04-10', '', FALSE, '日本', 'ja', 'ja',
    '川原砾创作、abec插画的轻小说原著，电击文库刊行。艾恩葛朗特篇至Alicization篇，分卷作为同一 Work 下的多个 Release 编目。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"volumes":28,"label":"電撃文庫","format":"light_novel"}'),

('deadbeef-0000-4000-8000-000000000102', '', '刀剑神域', 'ソードアート・オンライン',
    '{"SAO S1","刀剑神域第1期"}', '2012-07-07', '2012-07-07', '2012-12-22', TRUE, '日本', 'ja', 'ja',
    'A-1 Pictures 制作改编的 TV 动画第 1 季，全 25 话，涵盖艾恩葛朗特篇与妖精之舞篇。配乐为梶浦由记。与轻小说原著同名，以 Franchise 企划与改编关系区分。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"episodes":25,"director":"伊藤智彦","format":"tv_anime","season":1}'),

('deadbeef-0000-4000-8000-000000000103', '', '刀剑神域：序列之争', '劇場版 ソードアート・オンライン -オーディナル・スケール-',
    '{"Sword Art Online The Movie: Ordinal Scale","序列之争"}', '2017-02-18', '2017-02-18', '2017-02-18', TRUE, '日本', 'ja', 'ja',
    '川原砾亲自编写原创故事的动画电影，以 AR 增强现实装置 Augma 为舞台。全球院线上映收获超 43 亿日元票房。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"duration_mins":119,"box_office_jpy":"4.3B"}'),

('deadbeef-0000-4000-8000-000000000104', '', 'Sword Art Online Music Collection', 'Sword Art Online Music Collection',
    '{"刀剑神域 梶浦由记原声精选","SAO OST"}', '2016-01-27', '2016-01-27', '2016-01-27', TRUE, '日本', 'ja', 'ja',
    '梶浦由记操刀的《刀剑神域》TV动画第1&2期及Extra Edition配乐集，4CD收录131首，Aniplex发行（品番 SVWC-70116~9）。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"discs":4,"tracks":131,"catalog":"SVWC-70116"}'),

-- 2. 葬送的芙莉莲 系列
('deadbeef-0000-4000-8000-000000000105', '', '葬送的芙莉莲', '葬送のフリーレン',
    '{"Frieren Manga","葬送的芙莉莲原作漫画"}', '2020-04-28', '2020-04-28', '', FALSE, '日本', 'ja', 'ja',
    '山田钟人原作、阿部司作画的现象级连载漫画，小学馆《周刊少年Sunday》连载。分卷单行本作为同一 Work 下的多个 Release 编目。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"magazine":"周刊少年Sunday","format":"manga"}'),

('deadbeef-0000-4000-8000-000000000106', '', '葬送的芙莉莲', '葬送のフリーレン',
    '{"Frieren Anime","芙莉莲 TV动画"}', '2023-09-29', '2023-09-29', '2024-03-22', TRUE, '日本', 'ja', 'ja',
    'Madhouse 制作的高口碑 TV 动画，监督斋藤圭一郎。首播于日本电视台金曜 Road Show 播出 2 小时特别篇，全 28 话。与漫画原作同名，以 Franchise 企划与改编关系区分。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"episodes":28,"director":"斎藤圭一郎","format":"tv_anime","season":1}'),

('deadbeef-0000-4000-8000-000000000107', '', 'TV 动画「葬送的芙莉莲」Original Soundtrack', 'TVアニメ『葬送のフリーレン』Original Soundtrack',
    '{"芙莉莲 原声带","Frieren OST"}', '2024-04-17', '2024-04-17', '2024-04-17', TRUE, '日本', 'ja', 'ja',
    'Evan Call 创作的《葬送的芙莉莲》官方原声带，东宝动画发行（THCA-60288）。2CD 70首，融合中世纪民谣器乐与恢弘交响。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"discs":2,"tracks":70,"catalog":"THCA-60288"}'),

-- 3. 孤独摇滚！ 系列
('deadbeef-0000-4000-8000-000000000108', '', '孤独摇滚！', 'ぼっち・ざ・ろっく！',
    '{"Bocchi Manga","孤独摇滚原作"}', '2017-12-19', '2017-12-19', '', FALSE, '日本', 'ja', 'ja',
    '滨路晶创作的四格音乐漫画，芳文社《Manga Time Kirara MAX》连载。单行本作为同一 Work 下的多个 Release 编目。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"publisher":"芳文社","format":"manga"}'),

('deadbeef-0000-4000-8000-000000000109', '', '孤独摇滚！', 'ぼっち・ざ・ろっく！',
    '{"Bocchi Anime","孤独摇滚动画第一季"}', '2022-10-08', '2022-10-08', '2022-12-24', TRUE, '日本', 'ja', 'ja',
    'CloverWorks 制作改编的 TV 动画，监督斋藤圭一郎。全 12 话，凭借极其富有创意的演出风格与高水准吉他实录引爆全球二次元与摇滚圈。与漫画原作同名，以 Franchise 企划与改编关系区分。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"episodes":12,"director":"斎藤圭一郎","format":"tv_anime","season":1}'),

('deadbeef-0000-4000-8000-000000000110', '', '結束バンド', '結束バンド',
    '{"Kessoku Band Album","结束乐队首张专辑"}', '2022-12-28', '2022-12-28', '2022-12-28', TRUE, '日本', 'ja', 'ja',
    '剧内乐队「结束乐队」发行的录音室专辑（Aniplex，SVWC-70613）。与虚构乐队 Artist 实体「結束バンド」同名属正常现象，以实体类型区分，不靠标题注记。收录《青春コンプレックス》《あのバンド》《星座になれたら》等14首经典曲目，登顶 Oricon 与 Billboard Japan 榜首。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"tracks":14,"catalog":"SVWC-70613","format":"album"}'),

-- 4. 紫罗兰永恒花园 系列
('deadbeef-0000-4000-8000-000000000111', '', '紫罗兰永恒花园', 'ヴァイオレット・エヴァーガーデン',
    '{"Violet Evergarden Novel","京紫小说"}', '2015-12-25', '2015-12-25', '2020-03-27', TRUE, '日本', 'ja', 'ja',
    '晓佳奈著、高濑亚贵子插画的轻小说。KA Esuma文库刊行（上卷、下卷、外传、After），分卷作为同一 Work 下的 Release 编目。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"volumes":4,"label":"KAエスマ文庫","format":"light_novel"}'),

('deadbeef-0000-4000-8000-000000000112', '', '紫罗兰永恒花园', 'ヴァイオレット・エヴァーガーデン',
    '{"Violet Evergarden TV","京紫TV版"}', '2018-01-10', '2018-01-10', '2018-04-04', TRUE, '日本', 'ja', 'ja',
    '京都动画制作的顶级画质 TV 动画，监督石立太一。全 13 话 + 1 话 OVA，以极其细腻的光影画风与动人情感刻画震撼观众。与轻小说原著同名，以 Franchise 企划与改编关系区分。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"episodes":14,"studio":"京都アニメーション","format":"tv_anime","season":1}'),

('deadbeef-0000-4000-8000-000000000113', '', '紫罗兰永恒花园 剧场版', '劇場版 ヴァイオレット・エヴァーガーデン',
    '{"Violet Evergarden: The Movie","京紫最终剧场版"}', '2020-09-18', '2020-09-18', '2020-09-18', TRUE, '日本', 'ja', 'ja',
    '京都动画制作的完结篇剧场长片，片长 140 分钟。讲述薇尔莉特探寻少佐下落的终章，斩获第44届日本电影学院奖优秀动画作品奖。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"duration_mins":140,"studio":"京都アニメーション"}'),

('deadbeef-0000-4000-8000-000000000114', '', 'VIOLET EVERGARDEN : Automemories', 'VIOLET EVERGARDEN : Automemories',
    '{"紫罗兰永恒花园 原声带","Violet Evergarden OST"}', '2018-03-28', '2018-03-28', '2018-03-28', TRUE, '日本', 'ja', 'ja',
    'Evan Call 操刀的《紫罗兰永恒花园》官方管弦乐原声大碟，Lantis 发行（LACA-9573~4）。2CD 47首，布达佩斯交响乐团实录。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"discs":2,"tracks":47,"catalog":"LACA-9573"}'),

-- 5. Re:从零开始的异世界生活 系列
('deadbeef-0000-4000-8000-000000000115', '', 'Re:从零开始的异世界生活', 'Re:ゼロから始める異世界生活',
    '{"Re:Zero Novel","Re0轻小说"}', '2014-01-24', '2014-01-24', '', FALSE, '日本', 'ja', 'ja',
    '长月达平原作、大冢真一郎插画，MF文库J刊行。包含正篇30+卷及短篇集，分卷作为同一 Work 下的 Release 编目。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"label":"MF文庫J","format":"light_novel"}'),

('deadbeef-0000-4000-8000-000000000116', '', 'Re:从零开始的异世界生活', 'Re:ゼロから始める異世界生活',
    '{"Re:Zero S1","Re0第1季"}', '2016-04-04', '2016-04-04', '2016-09-19', TRUE, '日本', 'ja', 'ja',
    'WHITE FOX 制作的 TV 动画第 1 季，全 25 话。讲述菜月昴在王都、罗兹瓦尔宅邸与白鲸攻略战中的生死轮回。与轻小说原著同名，以 Franchise 企划与改编关系区分。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"episodes":25,"director":"渡邊政治","format":"tv_anime","season":1}'),

-- 6. 进击的巨人 系列
('deadbeef-0000-4000-8000-000000000117', '', '进击的巨人', '進撃の巨人',
    '{"Attack on Titan Manga","巨人原作漫画"}', '2009-09-09', '2009-09-09', '2021-04-09', TRUE, '日本', 'ja', 'ja',
    '谏山创创作的黑暗奇幻漫画，讲谈社《别册少年Magazine》连载，全34卷139话完结。分卷作为同一 Work 下的多个 Release 编目。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"volumes":34,"chapters":139,"publisher":"講談社","format":"manga"}'),

('deadbeef-0000-4000-8000-000000000118', '', '进击的巨人', '進撃の巨人 Season 1',
    '{"Attack on Titan Season 1","巨人第一季动画"}', '2013-04-07', '2013-04-07', '2013-09-29', TRUE, '日本', 'ja', 'ja',
    'WIT STUDIO 制作、荒木哲郎执导的现象级 TV 动画第 1 季，全 25 话。立体机动装置的动态长镜头演出与世界观揭示引爆全球。与漫画原作同名，以 Franchise 企划与改编关系区分。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"episodes":25,"director":"荒木哲郎","format":"tv_anime","season":1}'),

('deadbeef-0000-4000-8000-000000000119', '', '「進撃の巨人」Original Soundtrack', '「進撃の巨人」Original Soundtrack',
    '{"Attack on Titan OST 1","巨人 泽野弘之原声带"}', '2013-06-28', '2013-06-28', '2013-06-28', TRUE, '日本', 'ja', 'ja',
    '泽野弘之谱曲的《进击的巨人》第一季官方原声大碟，波丽佳音发行（PCCG-01351）。收录《ətˈæk 0N tάɪtn》《Vogel im Käfig》《立body機motion》等16首燃曲。',
    'completed', '00000000-0000-0000-0000-000000000001', '{"tracks":16,"catalog":"PCCG-01351"}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO work_translations (work_id, locale, title, summary) VALUES
('deadbeef-0000-4000-8000-000000000101', 'en-US', 'Sword Art Online', 'Light novel series by Reki Kawahara with illustrations by abec, published by Dengeki Bunko.'),
('deadbeef-0000-4000-8000-000000000102', 'en-US', 'Sword Art Online', 'TV anime adaptation by A-1 Pictures covering Aincrad and Fairy Dance arcs. Same title as the light novel; distinguished by Franchise and adaptation relations.'),
('deadbeef-0000-4000-8000-000000000103', 'en-US', 'Sword Art Online The Movie: Ordinal Scale', 'Original animated feature film directed by Tomohiko Ito.'),
('deadbeef-0000-4000-8000-000000000104', 'en-US', 'Sword Art Online Music Collection', '4-CD compilation of Yuki Kajiura''s score for SAO I & II and Extra Edition.'),
('deadbeef-0000-4000-8000-000000000105', 'en-US', 'Frieren: Beyond Journey''s End', 'Original manga series by Kanehito Yamada and Tsukasa Abe in Weekly Shonen Sunday.'),
('deadbeef-0000-4000-8000-000000000106', 'en-US', 'Frieren: Beyond Journey''s End', 'Critically acclaimed 28-episode TV anime series produced by Madhouse. Same title as the manga; distinguished by Franchise and adaptation relations.'),
('deadbeef-0000-4000-8000-000000000107', 'en-US', 'Frieren: Beyond Journey''s End Original Soundtrack', 'Evan Call orchestral and folk soundtrack for Frieren (2CD, 70 tracks).'),
('deadbeef-0000-4000-8000-000000000108', 'en-US', 'BOCCHI THE ROCK!', '4-panel manga series by Aki Hamaji in Manga Time Kirara MAX.'),
('deadbeef-0000-4000-8000-000000000109', 'en-US', 'BOCCHI THE ROCK!', 'Hit TV anime adaptation by CloverWorks directed by Keiichiro Saito. Same title as the manga; distinguished by Franchise and adaptation relations.'),
('deadbeef-0000-4000-8000-000000000110', 'en-US', 'Kessoku Band', 'Debut studio album by fictional in-universe group Kessoku Band, topping Oricon charts. The album shares its name with the band entity itself; no disambiguation suffix in titles.'),
('deadbeef-0000-4000-8000-000000000111', 'en-US', 'Violet Evergarden', 'Award-winning light novel series by Kana Akatsuki, published by KA Esuma Bunko.'),
('deadbeef-0000-4000-8000-000000000112', 'en-US', 'Violet Evergarden', 'Masterpiece TV anime series by Kyoto Animation directed by Taichi Ishidate. Same title as the novel; distinguished by Franchise and adaptation relations.'),
('deadbeef-0000-4000-8000-000000000113', 'en-US', 'Violet Evergarden: The Movie', 'Grand finale theatrical film by Kyoto Animation concluding Violet''s emotional journey.'),
('deadbeef-0000-4000-8000-000000000114', 'en-US', 'VIOLET EVERGARDEN: Automemories', 'Evan Call orchestral soundtrack for Violet Evergarden recorded in Budapest.'),
('deadbeef-0000-4000-8000-000000000115', 'en-US', 'Re:ZERO -Starting Life in Another World-', 'Light novel series by Tappei Nagatsuki illustrated by Shin''ichiro Otsuka.'),
('deadbeef-0000-4000-8000-000000000116', 'en-US', 'Re:ZERO -Starting Life in Another World-', 'TV anime adaptation by WHITE FOX following Subaru Natsuki. Same title as the light novel; distinguished by Franchise and adaptation relations.'),
('deadbeef-0000-4000-8000-000000000117', 'en-US', 'Attack on Titan', 'Legendary dark fantasy manga by Hajime Isayama, completed in 34 volumes.'),
('deadbeef-0000-4000-8000-000000000118', 'en-US', 'Attack on Titan', 'Groundbreaking TV anime series by WIT STUDIO directed by Tetsuro Araki. Same title as the manga; distinguished by Franchise and adaptation relations.'),
('deadbeef-0000-4000-8000-000000000119', 'en-US', 'Attack on Titan Original Soundtrack', 'Hiroyuki Sawano''s iconic orchestral-rock score for Attack on Titan.')
ON CONFLICT (work_id, locale) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary;

-- 标签关系 (Work-Tags) 触发各个虚拟货架聚合
INSERT INTO work_tag_relations (work_id, tag_id)
SELECT w.id, t.id FROM (VALUES
    -- 刀剑神域
    ('deadbeef-0000-4000-8000-000000000101'::uuid, '图书'),
    ('deadbeef-0000-4000-8000-000000000101'::uuid, '轻小说'),
    ('deadbeef-0000-4000-8000-000000000101'::uuid, '科幻'),
    ('deadbeef-0000-4000-8000-000000000101'::uuid, '刀剑神域'),
    ('deadbeef-0000-4000-8000-000000000102'::uuid, '剧集'),
    ('deadbeef-0000-4000-8000-000000000102'::uuid, '动画'),
    ('deadbeef-0000-4000-8000-000000000102'::uuid, '科幻'),
    ('deadbeef-0000-4000-8000-000000000102'::uuid, '刀剑神域'),
    ('deadbeef-0000-4000-8000-000000000103'::uuid, '电影'),
    ('deadbeef-0000-4000-8000-000000000103'::uuid, '动画'),
    ('deadbeef-0000-4000-8000-000000000103'::uuid, '长片'),
    ('deadbeef-0000-4000-8000-000000000103'::uuid, '科幻'),
    ('deadbeef-0000-4000-8000-000000000103'::uuid, '刀剑神域'),
    ('deadbeef-0000-4000-8000-000000000104'::uuid, '音乐'),
    ('deadbeef-0000-4000-8000-000000000104'::uuid, '专辑'),
    ('deadbeef-0000-4000-8000-000000000104'::uuid, '原声'),
    ('deadbeef-0000-4000-8000-000000000104'::uuid, '刀剑神域'),

    -- 葬送的芙莉莲
    ('deadbeef-0000-4000-8000-000000000105'::uuid, '漫画'),
    ('deadbeef-0000-4000-8000-000000000105'::uuid, '奇幻'),
    ('deadbeef-0000-4000-8000-000000000105'::uuid, '冒险'),
    ('deadbeef-0000-4000-8000-000000000105'::uuid, '葬送的芙莉莲'),
    ('deadbeef-0000-4000-8000-000000000106'::uuid, '剧集'),
    ('deadbeef-0000-4000-8000-000000000106'::uuid, '动画'),
    ('deadbeef-0000-4000-8000-000000000106'::uuid, '奇幻'),
    ('deadbeef-0000-4000-8000-000000000106'::uuid, '葬送的芙莉莲'),
    ('deadbeef-0000-4000-8000-000000000107'::uuid, '音乐'),
    ('deadbeef-0000-4000-8000-000000000107'::uuid, '专辑'),
    ('deadbeef-0000-4000-8000-000000000107'::uuid, '原声'),
    ('deadbeef-0000-4000-8000-000000000107'::uuid, '交响原声'),
    ('deadbeef-0000-4000-8000-000000000107'::uuid, '葬送的芙莉莲'),

    -- 孤独摇滚！
    ('deadbeef-0000-4000-8000-000000000108'::uuid, '漫画'),
    ('deadbeef-0000-4000-8000-000000000108'::uuid, '日常'),
    ('deadbeef-0000-4000-8000-000000000108'::uuid, '孤独摇滚'),
    ('deadbeef-0000-4000-8000-000000000109'::uuid, '剧集'),
    ('deadbeef-0000-4000-8000-000000000109'::uuid, '动画'),
    ('deadbeef-0000-4000-8000-000000000109'::uuid, '日常'),
    ('deadbeef-0000-4000-8000-000000000109'::uuid, '孤独摇滚'),
    ('deadbeef-0000-4000-8000-000000000110'::uuid, '音乐'),
    ('deadbeef-0000-4000-8000-000000000110'::uuid, '专辑'),
    ('deadbeef-0000-4000-8000-000000000110'::uuid, '流行摇滚'),
    ('deadbeef-0000-4000-8000-000000000110'::uuid, '孤独摇滚'),

    -- 紫罗兰永恒花园
    ('deadbeef-0000-4000-8000-000000000111'::uuid, '图书'),
    ('deadbeef-0000-4000-8000-000000000111'::uuid, '轻小说'),
    ('deadbeef-0000-4000-8000-000000000111'::uuid, '文学'),
    ('deadbeef-0000-4000-8000-000000000111'::uuid, '紫罗兰永恒花园'),
    ('deadbeef-0000-4000-8000-000000000112'::uuid, '剧集'),
    ('deadbeef-0000-4000-8000-000000000112'::uuid, '动画'),
    ('deadbeef-0000-4000-8000-000000000112'::uuid, '催泪'),
    ('deadbeef-0000-4000-8000-000000000112'::uuid, '紫罗兰永恒花园'),
    ('deadbeef-0000-4000-8000-000000000113'::uuid, '电影'),
    ('deadbeef-0000-4000-8000-000000000113'::uuid, '动画'),
    ('deadbeef-0000-4000-8000-000000000113'::uuid, '长片'),
    ('deadbeef-0000-4000-8000-000000000113'::uuid, '催泪'),
    ('deadbeef-0000-4000-8000-000000000113'::uuid, '紫罗兰永恒花园'),
    ('deadbeef-0000-4000-8000-000000000114'::uuid, '音乐'),
    ('deadbeef-0000-4000-8000-000000000114'::uuid, '专辑'),
    ('deadbeef-0000-4000-8000-000000000114'::uuid, '原声'),
    ('deadbeef-0000-4000-8000-000000000114'::uuid, '交响原声'),
    ('deadbeef-0000-4000-8000-000000000114'::uuid, '紫罗兰永恒花园'),

    -- Re:从零开始的异世界生活
    ('deadbeef-0000-4000-8000-000000000115'::uuid, '图书'),
    ('deadbeef-0000-4000-8000-000000000115'::uuid, '轻小说'),
    ('deadbeef-0000-4000-8000-000000000115'::uuid, '奇幻'),
    ('deadbeef-0000-4000-8000-000000000115'::uuid, 'Re:从零开始的异世界生活'),
    ('deadbeef-0000-4000-8000-000000000116'::uuid, '剧集'),
    ('deadbeef-0000-4000-8000-000000000116'::uuid, '动画'),
    ('deadbeef-0000-4000-8000-000000000116'::uuid, '奇幻'),
    ('deadbeef-0000-4000-8000-000000000116'::uuid, 'Re:从零开始的异世界生活'),

    -- 进击的巨人
    ('deadbeef-0000-4000-8000-000000000117'::uuid, '漫画'),
    ('deadbeef-0000-4000-8000-000000000117'::uuid, '热血'),
    ('deadbeef-0000-4000-8000-000000000117'::uuid, '进击的巨人'),
    ('deadbeef-0000-4000-8000-000000000118'::uuid, '剧集'),
    ('deadbeef-0000-4000-8000-000000000118'::uuid, '动画'),
    ('deadbeef-0000-4000-8000-000000000118'::uuid, '热血'),
    ('deadbeef-0000-4000-8000-000000000118'::uuid, '进击的巨人'),
    ('deadbeef-0000-4000-8000-000000000119'::uuid, '音乐'),
    ('deadbeef-0000-4000-8000-000000000119'::uuid, '专辑'),
    ('deadbeef-0000-4000-8000-000000000119'::uuid, '原声'),
    ('deadbeef-0000-4000-8000-000000000119'::uuid, '进击的巨人')
) AS w(id, tag_name)
JOIN tags t ON t.name = w.tag_name
ON CONFLICT DO NOTHING;

-- 作品-创作者关系 (Work-Artist Relations)
INSERT INTO work_artist_relations (work_id, artist_id, role)
SELECT v.work_id, v.artist_id, v.role
FROM (VALUES
    -- 刀剑神域
    ('deadbeef-0000-4000-8000-000000000101'::uuid, 'deadbeef-0000-4000-8000-000000000201'::uuid, 'author'),
    ('deadbeef-0000-4000-8000-000000000101'::uuid, 'deadbeef-0000-4000-8000-000000000202'::uuid, 'illustrator'),
    ('deadbeef-0000-4000-8000-000000000102'::uuid, 'deadbeef-0000-4000-8000-000000000201'::uuid, 'author'),
    ('deadbeef-0000-4000-8000-000000000102'::uuid, 'deadbeef-0000-4000-8000-000000000250'::uuid, 'studio'),
    ('deadbeef-0000-4000-8000-000000000102'::uuid, 'deadbeef-0000-4000-8000-000000000203'::uuid, 'composer'),
    ('deadbeef-0000-4000-8000-000000000103'::uuid, 'deadbeef-0000-4000-8000-000000000201'::uuid, 'author'),
    ('deadbeef-0000-4000-8000-000000000103'::uuid, 'deadbeef-0000-4000-8000-000000000250'::uuid, 'studio'),
    ('deadbeef-0000-4000-8000-000000000103'::uuid, 'deadbeef-0000-4000-8000-000000000203'::uuid, 'composer'),
    ('deadbeef-0000-4000-8000-000000000104'::uuid, 'deadbeef-0000-4000-8000-000000000203'::uuid, 'composer'),

    -- 葬送的芙莉莲
    ('deadbeef-0000-4000-8000-000000000105'::uuid, 'deadbeef-0000-4000-8000-000000000204'::uuid, 'author'),
    ('deadbeef-0000-4000-8000-000000000105'::uuid, 'deadbeef-0000-4000-8000-000000000205'::uuid, 'illustrator'),
    ('deadbeef-0000-4000-8000-000000000106'::uuid, 'deadbeef-0000-4000-8000-000000000204'::uuid, 'author'),
    ('deadbeef-0000-4000-8000-000000000106'::uuid, 'deadbeef-0000-4000-8000-000000000206'::uuid, 'director'),
    ('deadbeef-0000-4000-8000-000000000106'::uuid, 'deadbeef-0000-4000-8000-000000000251'::uuid, 'studio'),
    ('deadbeef-0000-4000-8000-000000000106'::uuid, 'deadbeef-0000-4000-8000-000000000207'::uuid, 'composer'),
    ('deadbeef-0000-4000-8000-000000000107'::uuid, 'deadbeef-0000-4000-8000-000000000207'::uuid, 'composer'),

    -- 孤独摇滚！
    ('deadbeef-0000-4000-8000-000000000108'::uuid, 'deadbeef-0000-4000-8000-000000000208'::uuid, 'author'),
    ('deadbeef-0000-4000-8000-000000000108'::uuid, 'deadbeef-0000-4000-8000-000000000257'::uuid, 'publisher'),
    ('deadbeef-0000-4000-8000-000000000109'::uuid, 'deadbeef-0000-4000-8000-000000000208'::uuid, 'author'),
    ('deadbeef-0000-4000-8000-000000000109'::uuid, 'deadbeef-0000-4000-8000-000000000206'::uuid, 'director'),
    ('deadbeef-0000-4000-8000-000000000109'::uuid, 'deadbeef-0000-4000-8000-000000000252'::uuid, 'studio'),
    ('deadbeef-0000-4000-8000-000000000110'::uuid, 'deadbeef-0000-4000-8000-000000000240'::uuid, 'performer'),

    -- 紫罗兰永恒花园
    ('deadbeef-0000-4000-8000-000000000111'::uuid, 'deadbeef-0000-4000-8000-000000000209'::uuid, 'author'),
    ('deadbeef-0000-4000-8000-000000000111'::uuid, 'deadbeef-0000-4000-8000-000000000210'::uuid, 'illustrator'),
    ('deadbeef-0000-4000-8000-000000000112'::uuid, 'deadbeef-0000-4000-8000-000000000209'::uuid, 'author'),
    ('deadbeef-0000-4000-8000-000000000112'::uuid, 'deadbeef-0000-4000-8000-000000000211'::uuid, 'director'),
    ('deadbeef-0000-4000-8000-000000000112'::uuid, 'deadbeef-0000-4000-8000-000000000253'::uuid, 'studio'),
    ('deadbeef-0000-4000-8000-000000000112'::uuid, 'deadbeef-0000-4000-8000-000000000207'::uuid, 'composer'),
    ('deadbeef-0000-4000-8000-000000000113'::uuid, 'deadbeef-0000-4000-8000-000000000209'::uuid, 'author'),
    ('deadbeef-0000-4000-8000-000000000113'::uuid, 'deadbeef-0000-4000-8000-000000000211'::uuid, 'director'),
    ('deadbeef-0000-4000-8000-000000000113'::uuid, 'deadbeef-0000-4000-8000-000000000253'::uuid, 'studio'),
    ('deadbeef-0000-4000-8000-000000000113'::uuid, 'deadbeef-0000-4000-8000-000000000207'::uuid, 'composer'),
    ('deadbeef-0000-4000-8000-000000000114'::uuid, 'deadbeef-0000-4000-8000-000000000207'::uuid, 'composer'),

    -- Re:从零开始的异世界生活
    ('deadbeef-0000-4000-8000-000000000115'::uuid, 'deadbeef-0000-4000-8000-000000000212'::uuid, 'author'),
    ('deadbeef-0000-4000-8000-000000000115'::uuid, 'deadbeef-0000-4000-8000-000000000213'::uuid, 'illustrator'),
    ('deadbeef-0000-4000-8000-000000000116'::uuid, 'deadbeef-0000-4000-8000-000000000212'::uuid, 'author'),
    ('deadbeef-0000-4000-8000-000000000116'::uuid, 'deadbeef-0000-4000-8000-000000000254'::uuid, 'studio'),
    ('deadbeef-0000-4000-8000-000000000116'::uuid, 'deadbeef-0000-4000-8000-000000000214'::uuid, 'composer'),

    -- 进击的巨人
    ('deadbeef-0000-4000-8000-000000000117'::uuid, 'deadbeef-0000-4000-8000-000000000215'::uuid, 'author'),
    ('deadbeef-0000-4000-8000-000000000117'::uuid, 'deadbeef-0000-4000-8000-000000000258'::uuid, 'publisher'),
    ('deadbeef-0000-4000-8000-000000000118'::uuid, 'deadbeef-0000-4000-8000-000000000215'::uuid, 'author'),
    ('deadbeef-0000-4000-8000-000000000118'::uuid, 'deadbeef-0000-4000-8000-000000000216'::uuid, 'director'),
    ('deadbeef-0000-4000-8000-000000000118'::uuid, 'deadbeef-0000-4000-8000-000000000255'::uuid, 'studio'),
    ('deadbeef-0000-4000-8000-000000000118'::uuid, 'deadbeef-0000-4000-8000-000000000217'::uuid, 'composer'),
    ('deadbeef-0000-4000-8000-000000000119'::uuid, 'deadbeef-0000-4000-8000-000000000217'::uuid, 'composer'),
    ('deadbeef-0000-4000-8000-000000000119'::uuid, 'deadbeef-0000-4000-8000-000000000259'::uuid, 'producer')
) AS v(work_id, artist_id, role)
WHERE EXISTS (SELECT 1 FROM works w WHERE w.id = v.work_id)
  AND EXISTS (SELECT 1 FROM artists a WHERE a.id = v.artist_id)
  AND NOT EXISTS (
      SELECT 1 FROM work_artist_relations r
      WHERE r.work_id = v.work_id AND r.artist_id = v.artist_id AND r.role = v.role
  );

-- ---------------------------------------------------------------------------
-- 4. 发行版 (Releases: 分卷图书、单行本漫画、TV播出、电影公映、原声CD/数字)
-- ---------------------------------------------------------------------------
INSERT INTO releases (id, work_id, publisher_id, edition_name, catalog_number, barcode, publisher, packaging,
                      edition_date, is_master_verified, notes, country, language, distribution_channel, catalog_metadata) VALUES
-- 刀剑神域
('deadbeef-0000-4000-8000-000000000301', 'deadbeef-0000-4000-8000-000000000101',
    NULL, '轻小说 第1卷 艾恩葛朗特', '978-4-04-867760-8', '9784048677608', '電撃文庫 / アスキー・メディアワークス', 'paperback',
    '2009-04-10', TRUE, '轻小说第1卷。SAO起始篇章。', 'JP', 'ja', 'physical',
    '{"isbn":"9784048677608","volume":1,"arc":"Aincrad"}'),

('deadbeef-0000-4000-8000-000000000302', 'deadbeef-0000-4000-8000-000000000101',
    NULL, '轻小说 第2卷 艾恩葛朗特', '978-4-04-867935-0', '9784048679350', '電撃文庫 / アスキー・メディアワークス', 'paperback',
    '2009-08-10', TRUE, '轻小说第2卷。短篇集（黑衣剑士/红鼻子麋鹿等）。', 'JP', 'ja', 'physical',
    '{"isbn":"9784048679350","volume":2,"arc":"Aincrad"}'),

('deadbeef-0000-4000-8000-000000000303', 'deadbeef-0000-4000-8000-000000000102',
    NULL, 'TV 动画第一季 首播 (TOKYO MX)', 'SAO-S1-BROADCAST', '', 'Aniplex', 'broadcast',
    '2012-07-07', TRUE, '与轻小说原著同名的动画 Work，以「第一季」等版次信息在发行层区分。TOKYO MX 等日本各大电视台首播，全 25 话。', 'JP', 'ja', 'broadcast',
    '{"season":1,"episodes":25}'),

('deadbeef-0000-4000-8000-000000000304', 'deadbeef-0000-4000-8000-000000000103',
    NULL, '日本院线公映版', 'SAO-ORDINAL-SCALE-THEATRICAL', '', 'Aniplex', 'theatrical',
    '2017-02-18', TRUE, '日本全国院线公映。', 'JP', 'ja', 'theatrical',
    '{"channel":"theatrical","box_office":"43亿日元"}'),

('deadbeef-0000-4000-8000-000000000305', 'deadbeef-0000-4000-8000-000000000104',
    NULL, 'Music Collection 4CD 首发盘', 'SVWC-70116~9', '4534530090287', 'Aniplex', 'box_set',
    '2016-01-27', TRUE, '4CD 完全收录 131 首曲目，梶浦由记作曲。', 'JP', 'ja', 'physical',
    '{"catalog":"SVWC-70116","discs":4}'),

-- 葬送的芙莉莲
('deadbeef-0000-4000-8000-000000000306', 'deadbeef-0000-4000-8000-000000000105',
    'deadbeef-0000-4000-8000-000000000256', '漫画单行本 第1卷', '978-4-09-850180-9', '9784098501809', '小学館', 'paperback',
    '2020-08-18', TRUE, '漫画单行本第1卷。第1-7话收录。', 'JP', 'ja', 'physical',
    '{"isbn":"9784098501809","volume":1,"label":"少年サンデーコミックス"}'),

('deadbeef-0000-4000-8000-000000000307', 'deadbeef-0000-4000-8000-000000000105',
    'deadbeef-0000-4000-8000-000000000256', '漫画单行本 第2卷', '978-4-09-850285-1', '9784098502851', '小学館', 'paperback',
    '2020-10-16', TRUE, '漫画单行本第2卷。第8-17话收录。', 'JP', 'ja', 'physical',
    '{"isbn":"9784098502851","volume":2,"label":"少年サンデーコミックス"}'),

('deadbeef-0000-4000-8000-000000000308', 'deadbeef-0000-4000-8000-000000000106',
    NULL, 'TV 动画第一季 首播 (日本电视台 FRIDAY ANIME NIGHT)', 'FRIEREN-S1-BROADCAST', '', '東宝', 'broadcast',
    '2023-09-29', TRUE, '与漫画原作同名的动画 Work，以「第一季」等版次信息在发行层区分。首播包含2小时特别篇，全28话。', 'JP', 'ja', 'broadcast',
    '{"season":1,"episodes":28}'),

('deadbeef-0000-4000-8000-000000000309', 'deadbeef-0000-4000-8000-000000000107',
    NULL, 'Original Soundtrack 2CD', 'THCA-60288', '4988104115881', 'TOHO animation RECORDS', 'jewel_case',
    '2024-04-17', TRUE, '2CD 收录 70 首 Evan Call 创作配乐。', 'JP', 'ja', 'physical',
    '{"catalog":"THCA-60288","discs":2}'),

-- 孤独摇滚！
('deadbeef-0000-4000-8000-000000000310', 'deadbeef-0000-4000-8000-000000000108',
    'deadbeef-0000-4000-8000-000000000257', '漫画单行本 第1卷', '978-4-8322-7072-5', '9784832270725', '芳文社', 'paperback',
    '2019-02-27', TRUE, '四格漫画单行本第1卷。', 'JP', 'ja', 'physical',
    '{"isbn":"9784832270725","volume":1,"label":"まんがタイムKRコミックス"}'),

('deadbeef-0000-4000-8000-000000000311', 'deadbeef-0000-4000-8000-000000000108',
    'deadbeef-0000-4000-8000-000000000257', '漫画单行本 第2卷', '978-4-8322-7170-8', '9784832271708', '芳文社', 'paperback',
    '2020-02-27', TRUE, '四格漫画单行本第2卷。', 'JP', 'ja', 'physical',
    '{"isbn":"9784832271708","volume":2,"label":"まんがタイムKRコミックス"}'),

('deadbeef-0000-4000-8000-000000000312', 'deadbeef-0000-4000-8000-000000000109',
    NULL, 'TV 动画第一季 首播 (TOKYO MX / BS11)', 'BOCCHI-S1-BROADCAST', '', 'Aniplex', 'broadcast',
    '2022-10-08', TRUE, '与漫画原作同名的动画 Work，以「第一季」等版次信息在发行层区分。全 12 话。', 'JP', 'ja', 'broadcast',
    '{"season":1,"episodes":12}'),

('deadbeef-0000-4000-8000-000000000313', 'deadbeef-0000-4000-8000-000000000110',
    NULL, '实体 CD（初回盘）', 'SVWC-70613', '4534530140777', 'Aniplex', 'jewel_case',
    '2022-12-28', TRUE, '专辑名与虚构乐队 Artist 实体同名，属正常同名现象；收录 14 首剧内经典完整版歌曲。', 'JP', 'ja', 'physical',
    '{"catalog":"SVWC-70613","tracks":14}'),

-- 紫罗兰永恒花园
('deadbeef-0000-4000-8000-000000000314', 'deadbeef-0000-4000-8000-000000000111',
    NULL, '轻小说 上卷 (初版)', '978-4-907064-43-3', '9784907064433', '京都アニメーション / KAエスマ文庫', 'paperback',
    '2015-12-25', TRUE, '第5届京都动画大奖大赏得奖原作小说上卷。', 'JP', 'ja', 'physical',
    '{"isbn":"9784907064433","volume":1,"label":"KAエスマ文庫"}'),

('deadbeef-0000-4000-8000-000000000315', 'deadbeef-0000-4000-8000-000000000111',
    NULL, '轻小说 下卷 (初版)', '978-4-907064-44-0', '9784907064440', '京都アニメーション / KAエスマ文庫', 'paperback',
    '2016-12-26', TRUE, '原作小说下卷。', 'JP', 'ja', 'physical',
    '{"isbn":"9784907064440","volume":2,"label":"KAエスマ文庫"}'),

('deadbeef-0000-4000-8000-000000000316', 'deadbeef-0000-4000-8000-000000000112',
    NULL, 'TV 动画第一季 首播 (TOKYO MX / ABC)', 'VIOLET-TV-BROADCAST', '', '京都アニメーション', 'broadcast',
    '2018-01-10', TRUE, '与轻小说原著同名的动画 Work，以「第一季」等版次信息在发行层区分。全 13 话 + OVA。', 'JP', 'ja', 'broadcast',
    '{"season":1,"episodes":14}'),

('deadbeef-0000-4000-8000-000000000317', 'deadbeef-0000-4000-8000-000000000113',
    NULL, '日本全国院线公映版', 'VIOLET-MOVIE-THEATRICAL', '', '松竹', 'theatrical',
    '2020-09-18', TRUE, '最终完结剧场版公映。', 'JP', 'ja', 'theatrical',
    '{"duration_mins":140,"distributor":"松竹"}'),

('deadbeef-0000-4000-8000-000000000318', 'deadbeef-0000-4000-8000-000000000114',
    NULL, 'Automemories 2CD 原声大碟', 'LACA-9573~4', '4540774905737', 'Lantis', 'jewel_case',
    '2018-03-28', TRUE, '2CD 47首，布达佩斯交响乐团录音。', 'JP', 'ja', 'physical',
    '{"catalog":"LACA-9573","discs":2}'),

-- Re:从零开始的异世界生活
('deadbeef-0000-4000-8000-000000000319', 'deadbeef-0000-4000-8000-000000000115',
    NULL, '轻小说 第1卷 (初版)', '978-4-04-066208-4', '9784040662084', 'KADOKAWA / MF文庫J', 'paperback',
    '2014-01-24', TRUE, '轻小说第1卷。王都篇开端。', 'JP', 'ja', 'physical',
    '{"isbn":"9784040662084","volume":1,"label":"MF文庫J"}'),

('deadbeef-0000-4000-8000-000000000320', 'deadbeef-0000-4000-8000-000000000116',
    NULL, 'TV 动画第一季 首播 (东京电视台)', 'REZERO-S1-BROADCAST', '', 'KADOKAWA', 'broadcast',
    '2016-04-04', TRUE, '与轻小说原著同名的动画 Work，以「第一季」等版次信息在发行层区分。全 25 话。', 'JP', 'ja', 'broadcast',
    '{"season":1,"episodes":25}'),

-- 进击的巨人
('deadbeef-0000-4000-8000-000000000321', 'deadbeef-0000-4000-8000-000000000117',
    'deadbeef-0000-4000-8000-000000000258', '漫画单行本 第1卷', '978-4-06-384276-0', '9784063842760', '講談社', 'paperback',
    '2010-03-17', TRUE, '漫画单行本第1卷。第1-4话收录。', 'JP', 'ja', 'physical',
    '{"isbn":"9784063842760","volume":1,"label":"講談社コミックスマガジン"}'),

('deadbeef-0000-4000-8000-000000000322', 'deadbeef-0000-4000-8000-000000000117',
    'deadbeef-0000-4000-8000-000000000258', '漫画单行本 第34卷 (最终卷)', '978-4-06-523416-7', '9784065234167', '講談社', 'paperback',
    '2021-06-09', TRUE, '漫画最终卷，收录第135-139话完结篇。', 'JP', 'ja', 'physical',
    '{"isbn":"9784065234167","volume":34,"is_final":true}'),

('deadbeef-0000-4000-8000-000000000323', 'deadbeef-0000-4000-8000-000000000118',
    'deadbeef-0000-4000-8000-000000000259', 'TV 动画第一季 首播 (MBS / TOKYO MX)', 'AOT-S1-BROADCAST', '', 'ポニーキャニオン', 'broadcast',
    '2013-04-07', TRUE, '与漫画原作同名的动画 Work，以「第一季」等版次信息在发行层区分。全 25 话。', 'JP', 'ja', 'broadcast',
    '{"season":1,"episodes":25}'),

('deadbeef-0000-4000-8000-000000000324', 'deadbeef-0000-4000-8000-000000000119',
    'deadbeef-0000-4000-8000-000000000259', 'Original Soundtrack CD', 'PCCG-01351', '4988013388765', 'ポニーキャニオン', 'jewel_case',
    '2013-06-28', TRUE, '泽野弘之经典配乐，收录 16 首曲目。', 'JP', 'ja', 'physical',
    '{"catalog":"PCCG-01351","tracks":16}')
ON CONFLICT (id) DO NOTHING;

-- 载体层 (Mediums: Book, CD, Digital, Broadcast, Theatrical)
INSERT INTO mediums (id, release_id, position, name, format, media_category, track_count) VALUES
-- 刀剑神域
('deadbeef-0000-4000-8000-000000000401', 'deadbeef-0000-4000-8000-000000000301', 1, '本文', 'Book', 'novel', 0),
('deadbeef-0000-4000-8000-000000000402', 'deadbeef-0000-4000-8000-000000000302', 1, '本文', 'Book', 'novel', 0),
('deadbeef-0000-4000-8000-000000000403', 'deadbeef-0000-4000-8000-000000000305', 1, 'Disc 1 SAO I (Aincrad)', 'CD', 'music', 33),
('deadbeef-0000-4000-8000-000000000404', 'deadbeef-0000-4000-8000-000000000305', 2, 'Disc 2 SAO I (Fairy Dance)', 'CD', 'music', 34),
('deadbeef-0000-4000-8000-000000000405', 'deadbeef-0000-4000-8000-000000000305', 3, 'Disc 3 Extra Edition & SAO II (Phantom Bullet)', 'CD', 'music', 35),
('deadbeef-0000-4000-8000-000000000406', 'deadbeef-0000-4000-8000-000000000305', 4, 'Disc 4 SAO II (Calibur & Mother''s Rosario)', 'CD', 'music', 29),
-- 葬送的芙莉莲
('deadbeef-0000-4000-8000-000000000407', 'deadbeef-0000-4000-8000-000000000306', 1, 'コミックス本文', 'Book', 'comic', 0),
('deadbeef-0000-4000-8000-000000000408', 'deadbeef-0000-4000-8000-000000000307', 1, 'コミックス本文', 'Book', 'comic', 0),
('deadbeef-0000-4000-8000-000000000409', 'deadbeef-0000-4000-8000-000000000309', 1, 'Disc 1', 'CD', 'music', 36),
('deadbeef-0000-4000-8000-000000000410', 'deadbeef-0000-4000-8000-000000000309', 2, 'Disc 2', 'CD', 'music', 34),
-- 孤独摇滚！
('deadbeef-0000-4000-8000-000000000411', 'deadbeef-0000-4000-8000-000000000310', 1, 'コミックス本文', 'Book', 'comic', 0),
('deadbeef-0000-4000-8000-000000000412', 'deadbeef-0000-4000-8000-000000000311', 1, 'コミックス本文', 'Book', 'comic', 0),
('deadbeef-0000-4000-8000-000000000413', 'deadbeef-0000-4000-8000-000000000313', 1, 'CD', 'CD', 'music', 14),
-- 紫罗兰永恒花园
('deadbeef-0000-4000-8000-000000000414', 'deadbeef-0000-4000-8000-000000000314', 1, '本文', 'Book', 'novel', 0),
('deadbeef-0000-4000-8000-000000000415', 'deadbeef-0000-4000-8000-000000000315', 1, '本文', 'Book', 'novel', 0),
('deadbeef-0000-4000-8000-000000000416', 'deadbeef-0000-4000-8000-000000000318', 1, 'Disc 1', 'CD', 'music', 23),
('deadbeef-0000-4000-8000-000000000417', 'deadbeef-0000-4000-8000-000000000318', 2, 'Disc 2', 'CD', 'music', 24),
-- Re:0
('deadbeef-0000-4000-8000-000000000418', 'deadbeef-0000-4000-8000-000000000319', 1, '本文', 'Book', 'novel', 0),
-- 巨人
('deadbeef-0000-4000-8000-000000000419', 'deadbeef-0000-4000-8000-000000000321', 1, 'コミックス本文', 'Book', 'comic', 0),
('deadbeef-0000-4000-8000-000000000420', 'deadbeef-0000-4000-8000-000000000322', 1, 'コミックス本文', 'Book', 'comic', 0),
('deadbeef-0000-4000-8000-000000000421', 'deadbeef-0000-4000-8000-000000000324', 1, 'Soundtrack CD', 'CD', 'music', 16)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. 跨媒介开放关系图 (Entity Relationships)
-- 包含：企划归属 (part_of_franchise)、改编衍生 (adapted_from)、原声带 (soundtrack_of)、
--       剧场版衍生 (spin_off_of/sequel_of)、角色出场 (character_in)、角色声优 (voice_actor_of)
-- ---------------------------------------------------------------------------
INSERT INTO entity_relationships (source_type, source_id, target_type, target_id, relationship_type, qualifier, attributes)
VALUES
-- ==================== 1. 刀剑神域 ====================
('work',      'deadbeef-0000-4000-8000-000000000101', 'franchise', 'deadbeef-0000-4000-8000-000000000001', 'part_of_franchise', '', '{}'),
('work',      'deadbeef-0000-4000-8000-000000000102', 'franchise', 'deadbeef-0000-4000-8000-000000000001', 'part_of_franchise', '', '{}'),
('work',      'deadbeef-0000-4000-8000-000000000103', 'franchise', 'deadbeef-0000-4000-8000-000000000001', 'part_of_franchise', '', '{}'),
('work',      'deadbeef-0000-4000-8000-000000000104', 'franchise', 'deadbeef-0000-4000-8000-000000000001', 'part_of_franchise', '', '{}'),
('artist',    'deadbeef-0000-4000-8000-000000000201', 'franchise', 'deadbeef-0000-4000-8000-000000000001', 'creator_of', '', '{}'),
-- 作品间关系
('work',      'deadbeef-0000-4000-8000-000000000102', 'work',      'deadbeef-0000-4000-8000-000000000101', 'adapted_from', '', '{"note":"TV第一季改编自轻小说第1-4卷"}'),
('work',      'deadbeef-0000-4000-8000-000000000103', 'work',      'deadbeef-0000-4000-8000-000000000102', 'spin_off_of', '', '{"note":"序列之争为承接TV第2季之后的剧场版"}'),
('work',      'deadbeef-0000-4000-8000-000000000104', 'work',      'deadbeef-0000-4000-8000-000000000102', 'soundtrack_of', '', '{"role":"Official Score"}'),
-- 角色与声优
('artist',    'deadbeef-0000-4000-8000-000000000230', 'work',      'deadbeef-0000-4000-8000-000000000101', 'character_in', 'novel', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000230', 'work',      'deadbeef-0000-4000-8000-000000000102', 'character_in', 'anime-s1', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000230', 'work',      'deadbeef-0000-4000-8000-000000000103', 'character_in', 'movie', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000231', 'work',      'deadbeef-0000-4000-8000-000000000101', 'character_in', 'novel', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000231', 'work',      'deadbeef-0000-4000-8000-000000000102', 'character_in', 'anime-s1', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000231', 'work',      'deadbeef-0000-4000-8000-000000000103', 'character_in', 'movie', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000220', 'artist',    'deadbeef-0000-4000-8000-000000000230', 'voice_actor_of', 'ja', '{"locale":"ja","is_original_cast":true,"character_name":"キリト / 桐ヶ谷和人"}'),
('artist',    'deadbeef-0000-4000-8000-000000000221', 'artist',    'deadbeef-0000-4000-8000-000000000231', 'voice_actor_of', 'ja', '{"locale":"ja","is_original_cast":true,"character_name":"アスナ / 結城明日奈"}'),

-- ==================== 2. 葬送的芙莉莲 ====================
('work',      'deadbeef-0000-4000-8000-000000000105', 'franchise', 'deadbeef-0000-4000-8000-000000000002', 'part_of_franchise', '', '{}'),
('work',      'deadbeef-0000-4000-8000-000000000106', 'franchise', 'deadbeef-0000-4000-8000-000000000002', 'part_of_franchise', '', '{}'),
('work',      'deadbeef-0000-4000-8000-000000000107', 'franchise', 'deadbeef-0000-4000-8000-000000000002', 'part_of_franchise', '', '{}'),
('artist',    'deadbeef-0000-4000-8000-000000000204', 'franchise', 'deadbeef-0000-4000-8000-000000000002', 'creator_of', '', '{}'),
-- 作品间关系
('work',      'deadbeef-0000-4000-8000-000000000106', 'work',      'deadbeef-0000-4000-8000-000000000105', 'adapted_from', '', '{"note":"TV第一季改编自漫画第1-60话"}'),
('work',      'deadbeef-0000-4000-8000-000000000107', 'work',      'deadbeef-0000-4000-8000-000000000106', 'soundtrack_of', '', '{"role":"Official Soundtrack"}'),
-- 角色与声优
('artist',    'deadbeef-0000-4000-8000-000000000232', 'work',      'deadbeef-0000-4000-8000-000000000105', 'character_in', 'manga', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000232', 'work',      'deadbeef-0000-4000-8000-000000000106', 'character_in', 'anime-s1', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000222', 'artist',    'deadbeef-0000-4000-8000-000000000232', 'voice_actor_of', 'ja', '{"locale":"ja","is_original_cast":true,"character_name":"フリーレン"}'),

-- ==================== 3. 孤独摇滚！ ====================
('work',      'deadbeef-0000-4000-8000-000000000108', 'franchise', 'deadbeef-0000-4000-8000-000000000003', 'part_of_franchise', '', '{}'),
('work',      'deadbeef-0000-4000-8000-000000000109', 'franchise', 'deadbeef-0000-4000-8000-000000000003', 'part_of_franchise', '', '{}'),
('work',      'deadbeef-0000-4000-8000-000000000110', 'franchise', 'deadbeef-0000-4000-8000-000000000003', 'part_of_franchise', '', '{}'),
('artist',    'deadbeef-0000-4000-8000-000000000208', 'franchise', 'deadbeef-0000-4000-8000-000000000003', 'creator_of', '', '{}'),
('artist',    'deadbeef-0000-4000-8000-000000000240', 'franchise', 'deadbeef-0000-4000-8000-000000000003', 'part_of_franchise', '', '{}'),
-- 作品间关系
('work',      'deadbeef-0000-4000-8000-000000000109', 'work',      'deadbeef-0000-4000-8000-000000000108', 'adapted_from', '', '{"note":"TV动画改编自四格漫画第1-2卷"}'),
('work',      'deadbeef-0000-4000-8000-000000000110', 'work',      'deadbeef-0000-4000-8000-000000000109', 'soundtrack_of', '', '{"role":"Insert Album"}'),
-- 角色与乐队
('artist',    'deadbeef-0000-4000-8000-000000000233', 'artist',    'deadbeef-0000-4000-8000-000000000240', 'member_of', '', '{"position":"lead guitar"}'),
('artist',    'deadbeef-0000-4000-8000-000000000233', 'work',      'deadbeef-0000-4000-8000-000000000108', 'character_in', 'manga', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000233', 'work',      'deadbeef-0000-4000-8000-000000000109', 'character_in', 'anime-s1', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000223', 'artist',    'deadbeef-0000-4000-8000-000000000233', 'voice_actor_of', 'ja', '{"locale":"ja","is_original_cast":true,"character_name":"後藤ひとり"}'),

-- ==================== 4. 紫罗兰永恒花园 ====================
('work',      'deadbeef-0000-4000-8000-000000000111', 'franchise', 'deadbeef-0000-4000-8000-000000000004', 'part_of_franchise', '', '{}'),
('work',      'deadbeef-0000-4000-8000-000000000112', 'franchise', 'deadbeef-0000-4000-8000-000000000004', 'part_of_franchise', '', '{}'),
('work',      'deadbeef-0000-4000-8000-000000000113', 'franchise', 'deadbeef-0000-4000-8000-000000000004', 'part_of_franchise', '', '{}'),
('work',      'deadbeef-0000-4000-8000-000000000114', 'franchise', 'deadbeef-0000-4000-8000-000000000004', 'part_of_franchise', '', '{}'),
('artist',    'deadbeef-0000-4000-8000-000000000209', 'franchise', 'deadbeef-0000-4000-8000-000000000004', 'creator_of', '', '{}'),
-- 作品间关系
('work',      'deadbeef-0000-4000-8000-000000000112', 'work',      'deadbeef-0000-4000-8000-000000000111', 'adapted_from', '', '{"note":"TV动画改编自晓佳奈原作小说"}'),
('work',      'deadbeef-0000-4000-8000-000000000113', 'work',      'deadbeef-0000-4000-8000-000000000112', 'sequel_of', '', '{"note":"剧场版为TV动画完结后续篇"}'),
('work',      'deadbeef-0000-4000-8000-000000000114', 'work',      'deadbeef-0000-4000-8000-000000000112', 'soundtrack_of', '', '{"role":"Original Soundtrack"}'),
-- 角色与声优
('artist',    'deadbeef-0000-4000-8000-000000000234', 'work',      'deadbeef-0000-4000-8000-000000000111', 'character_in', 'novel', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000234', 'work',      'deadbeef-0000-4000-8000-000000000112', 'character_in', 'anime-tv', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000234', 'work',      'deadbeef-0000-4000-8000-000000000113', 'character_in', 'movie', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000224', 'artist',    'deadbeef-0000-4000-8000-000000000234', 'voice_actor_of', 'ja', '{"locale":"ja","is_original_cast":true,"character_name":"ヴァイオレット・エヴァーガーデン"}'),

-- ==================== 5. Re:从零开始的异世界生活 ====================
('work',      'deadbeef-0000-4000-8000-000000000115', 'franchise', 'deadbeef-0000-4000-8000-000000000005', 'part_of_franchise', '', '{}'),
('work',      'deadbeef-0000-4000-8000-000000000116', 'franchise', 'deadbeef-0000-4000-8000-000000000005', 'part_of_franchise', '', '{}'),
('artist',    'deadbeef-0000-4000-8000-000000000212', 'franchise', 'deadbeef-0000-4000-8000-000000000005', 'creator_of', '', '{}'),
-- 作品间关系
('work',      'deadbeef-0000-4000-8000-000000000116', 'work',      'deadbeef-0000-4000-8000-000000000115', 'adapted_from', '', '{"note":"TV第一季改编自小说第1-9卷"}'),
-- 角色与声优
('artist',    'deadbeef-0000-4000-8000-000000000235', 'work',      'deadbeef-0000-4000-8000-000000000115', 'character_in', 'novel', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000235', 'work',      'deadbeef-0000-4000-8000-000000000116', 'character_in', 'anime-s1', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000236', 'work',      'deadbeef-0000-4000-8000-000000000115', 'character_in', 'novel', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000236', 'work',      'deadbeef-0000-4000-8000-000000000116', 'character_in', 'anime-s1', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000220', 'artist',    'deadbeef-0000-4000-8000-000000000235', 'voice_actor_of', 'ja', '{"locale":"ja","is_original_cast":true,"character_name":"ナツキ・スバル"}'),
('artist',    'deadbeef-0000-4000-8000-000000000225', 'artist',    'deadbeef-0000-4000-8000-000000000236', 'voice_actor_of', 'ja', '{"locale":"ja","is_original_cast":true,"character_name":"エミリア"}'),

-- ==================== 6. 进击的巨人 ====================
('work',      'deadbeef-0000-4000-8000-000000000117', 'franchise', 'deadbeef-0000-4000-8000-000000000006', 'part_of_franchise', '', '{}'),
('work',      'deadbeef-0000-4000-8000-000000000118', 'franchise', 'deadbeef-0000-4000-8000-000000000006', 'part_of_franchise', '', '{}'),
('work',      'deadbeef-0000-4000-8000-000000000119', 'franchise', 'deadbeef-0000-4000-8000-000000000006', 'part_of_franchise', '', '{}'),
('artist',    'deadbeef-0000-4000-8000-000000000215', 'franchise', 'deadbeef-0000-4000-8000-000000000006', 'creator_of', '', '{}'),
-- 作品间关系
('work',      'deadbeef-0000-4000-8000-000000000118', 'work',      'deadbeef-0000-4000-8000-000000000117', 'adapted_from', '', '{"note":"TV动画第1季改编自漫画第1-33话"}'),
('work',      'deadbeef-0000-4000-8000-000000000119', 'work',      'deadbeef-0000-4000-8000-000000000118', 'soundtrack_of', '', '{"role":"Original Soundtrack"}'),
-- 角色与声优
('artist',    'deadbeef-0000-4000-8000-000000000237', 'work',      'deadbeef-0000-4000-8000-000000000117', 'character_in', 'manga', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000237', 'work',      'deadbeef-0000-4000-8000-000000000118', 'character_in', 'anime-s1', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000238', 'work',      'deadbeef-0000-4000-8000-000000000117', 'character_in', 'manga', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000238', 'work',      'deadbeef-0000-4000-8000-000000000118', 'character_in', 'anime-s1', '{"role_type":"主角"}'),
('artist',    'deadbeef-0000-4000-8000-000000000226', 'artist',    'deadbeef-0000-4000-8000-000000000237', 'voice_actor_of', 'ja', '{"locale":"ja","is_original_cast":true,"character_name":"エレン・イェーガー"}'),
('artist',    'deadbeef-0000-4000-8000-000000000224', 'artist',    'deadbeef-0000-4000-8000-000000000238', 'voice_actor_of', 'ja', '{"locale":"ja","is_original_cast":true,"character_name":"ミカサ・アッカーマン"}')
ON CONFLICT DO NOTHING;

COMMIT;
