-- 32_music_discography_samples.sql
-- ==============================================================================
-- MetaFusion 音乐与唱片典藏编目种子数据 (PostgreSQL 16)
-- 包含 52 部世界级与华语殿堂级音乐专辑、单曲 EP、黑胶唱片与原声大碟 OST
-- 固定 UUID 前缀: c001cafe-0000-4000-8000-
-- 
-- 规范遵循:
-- 1. 严格遵循 LRM 模型：作品 Work 标题保持纯净，绝不拼接 (专辑)/(CD) 等括号。
-- 2. 发行版 Release 呈现具体出版版本（CD、黑胶 Vinyl、Hi-Res 数字流媒体、厂牌品番、包装规格）。
-- 3. 标签体系：#音乐 #专辑 #单曲 #原声带 #摇滚 #流行 #电子 #古典 #爵士 #民谣 #发烧碟 #Hip-Hop #金属 等。
-- 4. 封面比例：显式设定 cover_aspect = '1:1'，配备 Unsplash/高质方图封面。
-- 5. 多语言：配置 work_translations (zh-CN, en-US, ja)。
-- 6. 创作者实体：关联歌手、乐队、作曲家、编曲家、制作人及音乐厂牌。
-- 7. 轨道与母版：配置 Medium 载体及 Track/Canonical Entry 分轨信息。
-- ==============================================================================

BEGIN;

SELECT setval(pg_get_serial_sequence('tags', 'id'), COALESCE((SELECT MAX(id) FROM tags), 1));

-- ---------------------------------------------------------------------------
-- 0. 标签扩充 (流派、形态与主题)
-- ---------------------------------------------------------------------------
INSERT INTO tags (name, group_type, category_scope) VALUES
('音乐', 'format', '{}'),
('专辑', 'format', '{}'),
('单曲', 'format', '{}'),
('EP', 'format', '{}'),
('原声带', 'format', '{}'),
('精选集', 'format', '{}'),
('流行', 'genre', '{}'),
('摇滚', 'genre', '{}'),
('流行摇滚', 'genre', '{}'),
('前卫摇滚', 'genre', '{}'),
('硬摇滚', 'genre', '{}'),
('重金属', 'genre', '{}'),
('电子', 'genre', '{}'),
('电子乐', 'genre', '{}'),
('古典', 'genre', '{}'),
('管弦乐', 'genre', '{}'),
('交响原声', 'genre', '{}'),
('爵士', 'genre', '{}'),
('民谣', 'genre', '{}'),
('发烧碟', 'genre', '{}'),
('R&B', 'genre', '{}'),
('Hip-Hop', 'genre', '{}'),
('独立音乐', 'genre', '{}'),
('新世纪音乐', 'genre', '{}'),
('游戏原声', 'theme', '{}'),
('影视原声', 'theme', '{}'),
('动漫原声', 'theme', '{}'),
('华语金曲', 'theme', '{}'),
('世界经典', 'theme', '{}'),
('发烧天碟', 'theme', '{}'),
('黑胶典藏', 'theme', '{}')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1. 创作者与厂牌实体 (Artists / Groups / Composers / Labels)
-- ---------------------------------------------------------------------------
INSERT INTO artists (id, name, original_name, disambiguation, entity_type, country, biography, begin_date, end_date, ended, language, external_ids) VALUES
-- 华语音乐人
('c001cafe-0000-4000-8000-000000000001', '周杰伦', 'Jay Chou', '华语流行音乐天王/词曲创作人', 'person', '中国台湾', '华语流行乐坛领军人物，开创中国风与现代R&B融合先河。', '1979-01-18', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a001"}'),
('c001cafe-0000-4000-8000-000000000002', '陈奕迅', 'Eason Chan', '华语流行男歌手', 'person', '中国香港', '华语乐坛指标性人物，以极具感染力的人声演绎著称。', '1974-07-27', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a002"}'),
('c001cafe-0000-4000-8000-000000000003', '孙燕姿', 'Stefanie Sun', '华语流行天后', 'person', '新加坡', '新加坡国宝级女歌手，金曲奖最佳国语女歌手。', '1978-07-23', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a003"}'),
('c001cafe-0000-4000-8000-000000000004', '王菲', 'Faye Wong', '华语传奇空灵天后', 'person', '中国', '华语乐坛传奇女歌手，以空灵声线与先锋音乐审美闻名全球。', '1969-08-08', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a004"}'),
('c001cafe-0000-4000-8000-000000000005', '五月天', 'Mayday', '华语摇滚天团', 'group', '中国台湾', '由阿信、怪兽、石头、玛莎和冠佑组成的华语顶级摇滚乐队。', '1997-03-29', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a005"}'),
('c001cafe-0000-4000-8000-000000000006', '万能青年旅店', 'Omnipotent Youth Society', '中国独立摇滚与艺术摇滚乐队', 'group', '中国', '来自石家庄的独立摇滚乐队，以诗性歌词与管乐编配著称。', '2002', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a006"}'),
('c001cafe-0000-4000-8000-000000000007', '朴树', 'Pu Shu', '中国民谣摇滚创作歌手', 'person', '中国', '代表作《生如夏花》《平凡之路》，具独特诗意与人文精神。', '1973-11-08', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a007"}'),
('c001cafe-0000-4000-8000-000000000008', '崔健', 'Cui Jian', '中国摇滚之父', 'person', '中国', '中国摇滚乐开创者，以铜管与摇滚融合开辟中国摇滚新纪元。', '1961-08-02', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a008"}'),
('c001cafe-0000-4000-8000-000000000009', '张学友', 'Jacky Cheung', '华语歌神', 'person', '中国香港', '九十年代华语歌坛巅峰代表，唱片销量位居全球前列。', '1961-07-10', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a009"}'),
('c001cafe-0000-4000-8000-000000000010', '陶喆', 'David Tao', '华语 R&B 教父', 'person', '中国台湾', '将现代 R&B 与灵魂乐完美引入华语流行乐的先驱音乐人。', '1969-07-11', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a010"}'),
('c001cafe-0000-4000-8000-000000000011', '罗大佑', 'Lo Ta-you', '华语流行音乐教父', 'person', '中国台湾', '以敏锐时代观察与深刻诗性词曲改写华语流行音乐史。', '1954-07-20', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a011"}'),
('c001cafe-0000-4000-8000-000000000012', '李宗盛', 'Jonathan Lee', '华语百万制作人/音乐教父', 'person', '中国台湾', '华语乐坛传奇词曲作家与制作人，创作无数时代金曲。', '1958-07-19', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a012"}'),
('c001cafe-0000-4000-8000-000000000013', 'Beyond', 'Beyond', '中国香港殿堂级摇滚乐队', 'group', '中国香港', '由黄家驹等人创立，作品传唱海内外，象征和平与自由。', '1983', '2005', TRUE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a013"}'),
('c001cafe-0000-4000-8000-000000000014', '蔡依林', 'Jolin Tsai', '亚洲流行天后', 'person', '中国台湾', '华语舞曲与概念专辑标杆，多次斩获金曲奖最佳国语专辑。', '1980-09-15', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a014"}'),
('c001cafe-0000-4000-8000-000000000015', '林俊杰', 'JJ Lin', '行走的 CD/华语创作天王', 'person', '新加坡', '新加坡华裔创作歌手、音乐制作人，金曲奖最佳男歌手。', '1981-03-27', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a015"}'),
('c001cafe-0000-4000-8000-000000000016', '莫文蔚', 'Karen Mok', '华语百变天后', 'person', '中国香港', '集演唱、创作与戏剧于一身的华语乐坛先锋女艺人。', '1970-06-02', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a016"}'),
('c001cafe-0000-4000-8000-000000000017', '草东没有派对', 'No Party For Cao Dong', '台湾独立摇滚乐队', 'group', '中国台湾', '以低靡粗粝与爆发力并存的曲风横扫金曲奖，时代青年发声者。', '2012', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a017"}'),
('c001cafe-0000-4000-8000-000000000018', '窦唯', 'Dou Wei', '先锋音乐家/摇滚传奇', 'person', '中国', '前黑豹乐队主唱，后投身氛围音乐、新民乐与实验探索。', '1969-10-14', '', FALSE, 'zh-CN', '{"musicbrainz":"977f6890-1ba1-4475-b6d4-8d9e2fb7a018"}'),

-- 国际流行与发烧大师
('c001cafe-0000-4000-8000-000000000019', 'Michael Jackson', 'Michael Joseph Jackson', '流行音乐之王 (King of Pop)', 'person', '美国', '全球流行文化偶像，历史上最成功的音乐艺术家之一。', '1958-08-29', '2009-06-25', TRUE, 'en-US', '{"musicbrainz":"f27ec8db-af05-4f36-916e-3d57f91ecf5e"}'),
('c001cafe-0000-4000-8000-000000000020', 'The Beatles', 'The Beatles', '英国传奇摇滚乐队', 'group', '英国', '摇滚乐历史上最伟大且最具影响力的四人乐队。', '1960', '1970', TRUE, 'en-US', '{"musicbrainz":"b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"}'),
('c001cafe-0000-4000-8000-000000000021', 'Pink Floyd', 'Pink Floyd', '前卫摇滚与迷幻摇滚传奇', 'group', '英国', '以前卫概念专辑、哲学哲理歌词与宏大声学实验著称。', '1965', '2014', TRUE, 'en-US', '{"musicbrainz":"83d91898-d9f2-4914-8742-b0544a4918e9"}'),
('c001cafe-0000-4000-8000-000000000022', 'Queen', 'Queen', '英国国宝级摇滚乐队', 'group', '英国', '融合歌剧、华丽摇滚与硬摇滚的传奇乐队，主唱为 Freddie Mercury。', '1970', '', FALSE, 'en-US', '{"musicbrainz":"0383dadf-2a4e-4d10-a46a-e9e041da8eb3"}'),
('c001cafe-0000-4000-8000-000000000023', 'Taylor Swift', 'Taylor Alison Swift', '全球顶级创作巨星', 'person', '美国', '四夺格莱美年度专辑的历史级创作巨星与文化现象。', '1989-12-13', '', FALSE, 'en-US', '{"musicbrainz":"20244d07-534f-4eff-b4d4-930878889970"}'),
('c001cafe-0000-4000-8000-000000000024', 'Adele', 'Adele Laurie Blue Adkins', '英国灵魂乐唱作天后', 'person', '英国', '以极富穿透力与叙事感的人声享誉全球的格莱美得主。', '1988-05-05', '', FALSE, 'en-US', '{"musicbrainz":"cc2c9c3c-b7bc-4b8b-84d8-4fbd8779e493"}'),
('c001cafe-0000-4000-8000-000000000025', 'Radiohead', 'Radiohead', '英国另类摇滚与实验电子名团', 'group', '英国', '由 Thom Yorke 领衔，不断突破摇滚与电子边界的先锋乐队。', '1985', '', FALSE, 'en-US', '{"musicbrainz":"a74b1b7f-71a5-4011-9441-d0b5e4122711"}'),
('c001cafe-0000-4000-8000-000000000026', 'Nirvana', 'Nirvana', 'Grunge 垃圾摇滚传奇', 'group', '美国', '由 Kurt Cobain 创立，改变九十年代摇滚历史的标志性乐队。', '1987', '1994', TRUE, 'en-US', '{"musicbrainz":"9282c8b4-a4ce-463d-ad45-4fa7f9fb0950"}'),
('c001cafe-0000-4000-8000-000000000027', 'Eagles', 'Eagles', '美国乡村摇滚传奇乐队', 'group', '美国', '代表作《加州旅馆》为全球发烧音响试音终极试金石。', '1971', '', FALSE, 'en-US', '{"musicbrainz":"f46bd55-a126-4b6e-9562-b7b5f0ef3d60"}'),
('c001cafe-0000-4000-8000-000000000028', 'Daft Punk', 'Daft Punk', '法国电子音乐传奇双人组', 'group', '法国', '由 Thomas Bangalter 与 Guy-Manuel 组成的电子音乐殿堂组合。', '1993', '2021', TRUE, 'en-US', '{"musicbrainz":"056e4f3e-d505-4dad-8ec1-d04f521cbb56"}'),
('c001cafe-0000-4000-8000-000000000029', 'David Bowie', 'David Robert Jones', '摇滚变色龙/跨界艺术大师', 'person', '英国', '二十世纪流行音乐与视觉艺术最具颠覆性的先锋大师。', '1947-01-08', '2016-01-10', TRUE, 'en-US', '{"musicbrainz":"5441c29d-ab36-41ec-8777-b47fc24edd14"}'),
('c001cafe-0000-4000-8000-000000000030', 'Fleetwood Mac', 'Fleetwood Mac', '英美经典软摇滚乐队', 'group', '英国', '专辑《Rumours》全球销量破4000万张的发烧史诗。', '1967', '', FALSE, 'en-US', '{"musicbrainz":"bd13908f-1ec1-47a8-970f-90e1634b22c7"}'),
('c001cafe-0000-4000-8000-000000000031', 'Led Zeppelin', 'Led Zeppelin', '硬摇滚与重金属始祖', 'group', '英国', '以吉米·佩奇与罗伯特·普兰特为核心的硬摇滚四人神话。', '1968', '1980', TRUE, 'en-US', '{"musicbrainz":"678d88b2-13e0-40da-aaac-e0dd83ec21bf"}'),
('c001cafe-0000-4000-8000-000000000032', 'Miles Davis', 'Miles Dewey Davis III', '现代爵士乐巨匠', 'person', '美国', '开创酷派爵士、调式爵士与融合爵士的绝对宗师。', '1926-05-26', '1991-09-28', TRUE, 'en-US', '{"musicbrainz":"561d854a-6a28-4aa7-8c99-324e25e0b1f0"}'),
('c001cafe-0000-4000-8000-000000000033', 'Norah Jones', 'Geetali Norah Jones Shankar', '格莱美爵士人声天后', 'person', '美国', '九座格莱美奖得主，首张专辑《Come Away with Me》发烧人声标杆。', '1979-03-30', '', FALSE, 'en-US', '{"musicbrainz":"985c709c-7771-4de3-9024-7b7b2be3297a"}'),
('c001cafe-0000-4000-8000-000000000034', 'Billie Eilish', 'Billie Eilish Pirate Baird O''Connell', '新世代暗黑流行先锋', 'person', '美国', '包揽格莱美四大通类大奖与奥斯卡最佳原创歌曲的现象级巨星。', '2001-12-18', '', FALSE, 'en-US', '{"musicbrainz":"f4abc0b5-3f7a-4eff-8f78-ac783db9275e"}'),
('c001cafe-0000-4000-8000-000000000035', 'Coldplay', 'Coldplay', '英国当代体育场摇滚霸主', 'group', '英国', '由 Chris Martin 领衔，作品旋律优美、兼具流行与宏大氛围。', '1996', '', FALSE, 'en-US', '{"musicbrainz":"cc197dae-bc70-4ccf-9721-a53e258d6326"}'),

-- 影视/游戏/动漫原声作曲家
('c001cafe-0000-4000-8000-000000000036', '川井宪次', '川井 憲次 (Kenji Kawai)', '日本影视与动画配乐大师', 'person', '日本', '以《攻壳机动队》民俗傀儡谣配乐蜚声国际的东方配乐大师。', '1957-04-23', '', FALSE, 'ja', '{"musicbrainz":"84b6cb41-3997-4ebc-b3b4-a4f65d6c8b93"}'),
('c001cafe-0000-4000-8000-000000000037', 'Hans Zimmer', 'Hans Florian Zimmer', '好莱坞史诗级配乐大师', 'person', '德国', '以《星际穿越》《盗梦空间》《沙丘》等作品闻名好莱坞的电影配乐巨擘。', '1957-09-12', '', FALSE, 'en-US', '{"musicbrainz":"e6da7d27-dd82-49b8-a904-f51d74f28680"}'),
('c001cafe-0000-4000-8000-000000000038', '久石让', '久石 譲 (Joe Hisaishi)', '日本国宝级配乐家/指挥家', 'person', '日本', '宫崎骏动画电影御用配乐家，作品旋律极富治愈力与生命厚度。', '1950-12-06', '', FALSE, 'ja', '{"musicbrainz":"37b51b32-e0f6-4903-88ee-12fe57d8ec71"}'),
('c001cafe-0000-4000-8000-000000000039', '冈部启一', '岡部 啓一 (Keiichi Okabe)', '日本游戏音乐制作人/MONACA代表', 'person', '日本', '《尼尔：机械纪元》《龙背上的骑兵》配乐灵魂创作者。', '1969-05-26', '', FALSE, 'ja', '{"musicbrainz":"72d73fc1-5ff1-45a4-baee-149826359f13"}'),
('c001cafe-0000-4000-8000-000000000040', '植松伸夫', '植松 伸夫 (Nobuo Uematsu)', '最终幻想音乐之父', 'person', '日本', '《最终幻想》系列传奇作曲家，电子游戏音乐殿堂级大师。', '1959-03-21', '', FALSE, 'ja', '{"musicbrainz":"090b8d5a-1918-472d-88f8-b3d95cba271a"}'),
('c001cafe-0000-4000-8000-000000000041', '藤井志帆', '藤井 志帆 (Manaka Kataoka)', '任天堂首席游戏配乐家', 'person', '日本', '操刀《塞尔达传说：旷野之息》《动物森友会》钢琴与环境音画。', '1984', '', FALSE, 'ja', '{"musicbrainz":"a01bc182-1200-4000-8000-000000000041"}'),
('c001cafe-0000-4000-8000-000000000042', '陈致逸', 'Yu-Peng Chen', '中国交响与影视游戏配乐作曲家', 'person', '中国', 'HOYO-MiX 前音乐总监，为《原神》创作蒙德、璃月、稻妻、须弥交响原声。', '1984-01-15', '', FALSE, 'zh-CN', '{"musicbrainz":"a01bc182-1200-4000-8000-000000000042"}'),
('c001cafe-0000-4000-8000-000000000043', '菅野洋子', '菅野 よう子 (Yoko Kanno)', '日本跨流派配乐天才', 'person', '日本', '《星际牛仔》《攻壳机动队SAC》《超时空要塞Plus》作曲家。', '1963-03-18', '', FALSE, 'ja', '{"musicbrainz":"a4f21db5-19e3-4c91-a185-1d07ec6c8e31"}'),
('c001cafe-0000-4000-8000-000000000044', '泽野弘之', '澤野 弘之 (Hiroyuki Sawano)', '热血燃系配乐大师', 'person', '日本', '《进击的巨人》《机动战士高达UC》《罪恶王冠》作曲家。', '1980-09-12', '', FALSE, 'ja', '{"musicbrainz":"398ad14a-f5e1-4569-b5d1-4dbfa0ce94fb"}'),
('c001cafe-0000-4000-8000-000000000045', 'John Williams', 'John Towner Williams', '电影配乐泰斗', 'person', '美国', '《星球大战》《辛德勒的名单》《哈利·波特》作曲家，获54次奥斯卡提名。', '1932-02-08', '', FALSE, 'en-US', '{"musicbrainz":"53b106e7-0cc6-42cc-ac95-ed8d30a3a98e"}'),
('c001cafe-0000-4000-8000-000000000046', 'Ennio Morricone', 'Ennio Morricone', '意大利配乐宗师', 'person', '意大利', '《海上钢琴师》《天堂电影院》《荒野大镖客》作曲家。', '1928-11-10', '2020-07-06', TRUE, 'it', '{"musicbrainz":"a896f64e-7876-46c9-8d77-62a222e845c4"}'),
('c001cafe-0000-4000-8000-000000000047', '平泽进', '平沢 進 (Susumu Hirasawa)', '电幻神游与交互电子配乐大师', 'person', '日本', '《红辣椒》《千年女优》《剑风传奇》标志性前卫电子作曲家。', '1954-04-02', '', FALSE, 'ja', '{"musicbrainz":"e4a9058b-e68f-4aa7-ae66-51e600572e90"}'),
('c001cafe-0000-4000-8000-000000000048', 'HOYO-MiX', 'HOYO-MiX', '米哈游旗下音乐工作室', 'studio', '中国', '专注于跨媒介游戏原声音乐创作的交响与电子制作团队。', '2014', '', FALSE, 'zh-CN', '{"musicbrainz":"a01bc182-1200-4000-8000-000000000048"}'),

-- 唱片公司与发行厂牌 (Labels)
('c001cafe-0000-4000-8000-000000000051', '杰威尔音乐', 'JVR Music', '周杰伦创立的独立唱片与经纪公司', 'label', '中国台湾', '由周杰伦、杨峻荣与方文山于2007年创立。', '2007-01-26', '', FALSE, 'zh-CN', '{"musicbrainz":"a01bc182-1200-4000-8000-000000000051"}'),
('c001cafe-0000-4000-8000-000000000052', '环球唱片', 'Universal Music Group', '全球最大唱片音乐集团', 'label', '美国', '全球三大唱片集团之首，旗下汇聚海量殿堂级经典母带。', '1934', '', FALSE, 'en-US', '{"musicbrainz":"a01bc182-1200-4000-8000-000000000052"}'),
('c001cafe-0000-4000-8000-000000000053', '索尼音乐', 'Sony Music Entertainment', '全球三大唱片集团之一', 'label', '美国', '拥有哥伦比亚唱片、RCA 与 Epic 等众多传奇厂牌。', '1929', '', FALSE, 'en-US', '{"musicbrainz":"a01bc182-1200-4000-8000-000000000053"}'),
('c001cafe-0000-4000-8000-000000000054', '华纳音乐', 'Warner Music Group', '全球三大唱片集团之一', 'label', '美国', '旗下拥有大西洋唱片、华纳唱片及 Elektra 等知名厂牌。', '1958', '', FALSE, 'en-US', '{"musicbrainz":"a01bc182-1200-4000-8000-000000000054"}'),
('c001cafe-0000-4000-8000-000000000055', '滚石唱片', 'Rock Records', '华语独立唱片传奇旗舰', 'label', '中国台湾', '创立于1980年，见证并引领华语流行乐黄金二十年。', '1980', '', FALSE, 'zh-CN', '{"musicbrainz":"a01bc182-1200-4000-8000-000000000055"}'),
('c001cafe-0000-4000-8000-000000000056', 'SQUARE ENIX MUSIC', 'スクウェア・エニックス・ミュージック', 'SE 官方游戏音乐厂牌', 'label', '日本', '负责《最终幻想》《尼尔》《王国之心》等游戏原声发行。', '1998', '', FALSE, 'ja', '{"musicbrainz":"a01bc182-1200-4000-8000-000000000056"}'),
('c001cafe-0000-4000-8000-000000000057', 'WaterTower Music', 'WaterTower Music', '华纳兄弟探索旗下影视音乐厂牌', 'label', '美国', '发行《星际穿越》《蝙蝠侠：黑暗骑士》《沙丘》等电影原声。', '2000', '', FALSE, 'en-US', '{"musicbrainz":"a01bc182-1200-4000-8000-000000000057"}')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    original_name = EXCLUDED.original_name,
    disambiguation = EXCLUDED.disambiguation,
    country = EXCLUDED.country,
    biography = EXCLUDED.biography;

-- ---------------------------------------------------------------------------
-- 2. 52 部纯净核心作品 (Works)
-- ---------------------------------------------------------------------------
INSERT INTO works (id, category_code, title, original_title, aliases, release_date, begin_date, end_date, ended, country, language, original_language, summary, cover_image_url, cover_aspect, content_rating, status, created_by, catalog_metadata) VALUES

-- ==========================================
-- 分组 1: 华语流行、摇滚与独立经典 (20部)
-- ==========================================
-- 01. 范特西
('c001cafe-0000-4000-8000-000000000101', '', '范特西', 'Fantasy',
    '{"Fantasy","周杰伦第2张专辑","Jay Chou Fantasy"}', '2001-09-14', '2001-09-14', '2001-09-14', TRUE, '中国台湾', 'zh-CN', 'zh',
    '周杰伦于2001年发行的第2张录音室专辑，斩获第13届台湾金曲奖最佳流行音乐演唱专辑等五项大奖，确立了其华语天王地位。',
    'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Pop","R&B","Hip-Hop"],"tracks_count":10}'),

-- 02. 叶惠美
('c001cafe-0000-4000-8000-000000000102', '', '叶惠美', 'Yeh Hui-Mei',
    '{"Ye Hui Mei","以母亲命名的专辑"}', '2003-07-31', '2003-07-31', '2003-07-31', TRUE, '中国台湾', 'zh-CN', 'zh',
    '以母亲名字命名的第4张录音室专辑，包含《以父之名》《晴天》《东风破》等神作，荣获金曲奖最佳流行音乐演唱专辑奖。',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Pop","Classical Crossover","Chinoiserie"],"tracks_count":11}'),

-- 03. 七里香
('c001cafe-0000-4000-8000-000000000103', '', '七里香', 'Common Jasmine Orange',
    '{"Common Jasmine Orange","周杰伦第5张专辑"}', '2004-08-03', '2004-08-03', '2004-08-03', TRUE, '中国台湾', 'zh-CN', 'zh',
    '周杰伦第5张录音室专辑，亚洲销量突破300万张，同名主打歌与《止战之殇》《借口》传唱至今。',
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Pop","Folk Pop"],"tracks_count":10}'),

-- 04. U87
('c001cafe-0000-4000-8000-000000000104', '', 'U87', 'U87',
    '{"Eason Chan U87","纽曼U87麦克风专辑"}', '2005-06-07', '2005-06-07', '2005-06-07', TRUE, '中国香港', 'zh-CN', 'zh',
    '陈奕迅加盟新艺宝后的首张粤语大碟，以传奇录音麦克风 Neumann U87 命名，被时代杂志评为当年五大最值得购买大碟之一。',
    'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Cantopop","Pop Rock"],"tracks_count":12}'),

-- 05. Special Thanks To...
('c001cafe-0000-4000-8000-000000000105', '', 'Special Thanks To...', 'Special Thanks To...',
    '{"陈奕迅第3张国语专辑","Special Thanks To"}', '2002-04-02', '2002-04-02', '2002-04-02', TRUE, '中国香港', 'zh-CN', 'zh',
    '陈奕迅经典国语专辑，包揽金曲奖最佳国语流行音乐演唱专辑奖与最佳国语男演唱人奖，收录《你的背包》《谢谢侬》。',
    'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Mandopop","Pop Rock"],"tracks_count":13}'),

-- 06. 风筝
('c001cafe-0000-4000-8000-000000000106', '', '风筝', 'Kite',
    '{"Stefanie Sun Kite","孙燕姿第3张专辑"}', '2001-07-09', '2001-07-09', '2001-07-09', TRUE, '中国台湾', 'zh-CN', 'zh',
    '孙燕姿第3张国语专辑，收录《风筝》《绿光》《任性》，开创了华语流行电子舞曲与民谣抒情的全新时代。',
    'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Mandopop","Dance-Pop","Folk"],"tracks_count":10}'),

-- 07. 寓言
('c001cafe-0000-4000-8000-000000000107', '', '寓言', 'Fable',
    '{"Faye Wong Fable","王菲概念专辑寓言"}', '2000-10-20', '2000-10-20', '2000-10-20', TRUE, '中国香港', 'zh-CN', 'zh',
    '王菲第17张录音室大碟，前五首由王菲亲自作曲、张亚东编曲、林夕作词的寓言五部曲（《寒武纪》《新房客》《香奈儿》《阿修罗》《彼岸花》）被誉为华语概念艺术巅峰。',
    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Art Pop","Trip-Hop","Dream Pop"],"tracks_count":12}'),

-- 08. 浮躁
('c001cafe-0000-4000-8000-000000000108', '', '浮躁', 'Restless',
    '{"Fu Zao","王菲浮躁专辑"}', '1996-06-03', '1996-06-03', '1996-06-03', TRUE, '中国香港', 'zh-CN', 'zh',
    '王菲携手窦唯与 Cocteau Twins 打造的极简迷幻与独立流行巅峰之作，开创华语前卫流行先河。',
    'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Dream Pop","Indie Pop","Ambient"],"tracks_count":10}'),

-- 09. 后来的我们
('c001cafe-0000-4000-8000-000000000109', '', '后来的我们', 'Here, After, Us',
    '{"Here After Us Single","五月天单曲后来的我们"}', '2016-07-21', '2016-07-21', '2016-07-21', TRUE, '中国台湾', 'zh-CN', 'zh',
    '五月天第9张专辑《自传》中的核心叙事单曲，阿信作词、怪兽作曲，讲述时光荏苒中青涩记忆的深情释怀。',
    'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Pop Rock","Ballad"],"tracks_count":1}'),

-- 10. 第二人生
('c001cafe-0000-4000-8000-000000000110', '', '第二人生', 'Second Round',
    '{"Second Round","五月天第8张专辑"}', '2011-12-16', '2011-12-16', '2011-12-16', TRUE, '中国台湾', 'zh-CN', 'zh',
    '五月天获得第23届金曲奖最佳国语专辑、最佳乐团等六项大奖的末日与明日概念双版专辑。',
    'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Pop Rock","Alternative Rock"],"tracks_count":16}'),

-- 11. 万能青年旅店
('c001cafe-0000-4000-8000-000000000111', '', '万能青年旅店', 'Omnipotent Youth Society',
    '{"万青首专","万能青年旅店同名专辑"}', '2010-11-12', '2010-11-12', '2010-11-12', TRUE, '中国', 'zh-CN', 'zh',
    '石家庄摇滚乐队万能青年旅店的首张同名专辑，收录《杀死那个石家庄人》《秦皇岛》，中国独立摇滚历史丰碑。',
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Indie Rock","Art Rock","Chamber Pop"],"tracks_count":9}'),

-- 12. 冀西南林路行
('c001cafe-0000-4000-8000-000000000112', '', '冀西南林路行', 'Inside the Cable Temple',
    '{"万青二专","Inside the Cable Temple"}', '2020-12-22', '2020-12-22', '2020-12-22', TRUE, '中国', 'zh-CN', 'zh',
    '万能青年旅店历时十年推出的第2张概念专辑，以太行山工业变迁与自然为题材，打破多项独立音乐数字销量纪录。',
    'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Progressive Rock","Free Jazz","Art Rock"],"tracks_count":8}'),

-- 13. 生如夏花
('c001cafe-0000-4000-8000-000000000113', '', '生如夏花', 'Born Like Summer Flowers',
    '{"Born Like Summer Flowers","朴树生如夏花"}', '2003-11-08', '2003-11-08', '2003-11-08', TRUE, '中国', 'zh-CN', 'zh',
    '朴树第2张录音室专辑，张亚东担任制作人，收录《生如夏花》《且听风吟》《傻子才悲伤》，极富异域风情与哲思。',
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Folk Rock","Indie Pop","Worldbeat"],"tracks_count":11}'),

-- 14. 新长征路上的摇滚
('c001cafe-0000-4000-8000-000000000114', '', '新长征路上的摇滚', 'Rock ''N'' Roll on the New Long March',
    '{"Rock ''N'' Roll on the New Long March","一无所有"}', '1989-02-01', '1989-02-01', '1989-02-01', TRUE, '中国', 'zh-CN', 'zh',
    '崔健发行的中国内地第一张原创摇滚乐专辑，收录《一无所有》《假行僧》《花房姑娘》，开启中国摇滚历史新篇章。',
    'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Roots Rock","Blues Rock","Folk Rock"],"tracks_count":9}'),

-- 15. 吻别
('c001cafe-0000-4000-8000-000000000115', '', '吻别', 'The Goodbye Kiss',
    '{"The Goodbye Kiss","张学友吻别"}', '1993-03-05', '1993-03-05', '1993-03-05', TRUE, '中国香港', 'zh-CN', 'zh',
    '张学友第5张国语大碟，年度销量超400万张，创下华人唱片全球销量神话。',
    'https://images.unsplash.com/photo-1520523839898-5071282543e2?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Mandopop","Adult Contemporary"],"tracks_count":10}'),

-- 16. David Tao
('c001cafe-0000-4000-8000-000000000116', '', 'David Tao', 'David Tao',
    '{"陶喆同名专辑","陶喆首专"}', '1997-12-06', '1997-12-06', '1997-12-06', TRUE, '中国台湾', 'zh-CN', 'zh',
    '陶喆首张同名全创作专辑，将西方经典 R&B、Acappella 与台湾本土民谣融合，收录《爱，很简单》《沙滩》。',
    'https://images.unsplash.com/photo-1487180144351-b8472da7d491?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["R&B","Soul","Contemporary Pop"],"tracks_count":10}'),

-- 17. 之乎者也
('c001cafe-0000-4000-8000-000000000117', '', '之乎者也', 'Zhi Hu Zhe Ye',
    '{"Zhi Hu Zhe Ye","罗大佑首张专辑"}', '1982-04-21', '1982-04-21', '1982-04-21', TRUE, '中国台湾', 'zh-CN', 'zh',
    '罗大佑首张个人创作专辑，被《台湾流行音乐百佳专辑》评为第一名，收录《童年》《光阴的故事》《鹿港小镇》。',
    'https://images.unsplash.com/photo-1469488865564-c2de10f69f96?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Folk Rock","Roots Rock"],"tracks_count":10}'),

-- 18. 乐与怒
('c001cafe-0000-4000-8000-000000000118', '', '乐与怒', 'Rock ''n'' Roll',
    '{"Beyond 乐与怒","海阔天空专辑"}', '1993-05-14', '1993-05-14', '1993-05-14', TRUE, '中国香港', 'zh-CN', 'zh',
    'Beyond 乐队在黄家驹生前的最后一张录音室大碟，收录华语殿堂级金曲《海阔天空》《情人》《命运派对》。',
    'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Hard Rock","Pop Rock"],"tracks_count":12}'),

-- 19. 丑奴儿
('c001cafe-0000-4000-8000-000000000119', '', '丑奴儿', 'The Servile',
    '{"The Servile","草东首专"}', '2016-02-19', '2016-02-19', '2016-02-19', TRUE, '中国台湾', 'zh-CN', 'zh',
    '草东没有派对的首张全长专辑，斩获金曲奖最佳新人、最佳乐团及年度歌曲三项大奖，收录《大风吹》《山海》。',
    'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Indie Rock","Post-Punk","Grunge"],"tracks_count":12}'),

-- 20. 黑梦
('c001cafe-0000-4000-8000-000000000120', '', '黑梦', 'Black Dream',
    '{"Black Dream","窦唯首专"}', '1994-05-01', '1994-05-01', '1994-05-01', TRUE, '中国', 'zh-CN', 'zh',
    '窦唯离开黑豹乐队后发行的首张个人专辑，魔岩三杰代表作，收录《高级动物》《黑色梦中》，中国哥特与后朋克经典。',
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Post-Punk","Gothic Rock","Alternative"],"tracks_count":10}'),

-- ==========================================
-- 分组 2: 世界流行、摇滚与发烧天碟 (18部)
-- ==========================================
-- 21. Thriller
('c001cafe-0000-4000-8000-000000000121', '', 'Thriller', 'Thriller',
    '{"颤栗","Michael Jackson Thriller"}', '1982-11-30', '1982-11-30', '1982-11-30', TRUE, '美国', 'en-US', 'en',
    '流行音乐史上最畅销专辑，全球销量突破7000万张，收录《Billie Jean》《Beat It》《Thriller》，狂揽8座格莱美奖。',
    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Pop","Post-Disco","Funk","Rock"],"tracks_count":9}'),

-- 22. Bad
('c001cafe-0000-4000-8000-000000000122', '', 'Bad', 'Bad',
    '{"真棒","MJ Bad"}', '1987-08-31', '1987-08-31', '1987-08-31', TRUE, '美国', 'en-US', 'en',
    '迈克尔·杰克逊第7张录音室专辑，创造单张专辑诞生5首 Billboard 冠军单曲的历史纪录，收录《Smooth Criminal》。',
    'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Pop","Funk","Rock","Dance-Pop"],"tracks_count":11}'),

-- 23. Abbey Road
('c001cafe-0000-4000-8000-000000000123', '', 'Abbey Road', 'Abbey Road',
    '{"修道院路","披头士阿比路"}', '1969-09-26', '1969-09-26', '1969-09-26', TRUE, '英国', 'en-US', 'en',
    '披头士乐队四位成员共同录制的最后一张录音室专辑，著名的斑马线封面与 B 面组曲成为摇滚史永恒象征。',
    'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Rock","Pop Rock","Progressive Rock"],"tracks_count":17}'),

-- 24. The Dark Side of the Moon
('c001cafe-0000-4000-8000-000000000124', '', 'The Dark Side of the Moon', 'The Dark Side of the Moon',
    '{"月之暗面","Pink Floyd 月之暗面"}', '1973-03-01', '1973-03-01', '1973-03-01', TRUE, '英国', 'en-US', 'en',
    '平克·弗洛伊德前卫概念专辑巅峰，在 Billboard 专辑榜创下在榜超过900周的史诗纪录，全球发烧音响试音终极圣碟。',
    'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Progressive Rock","Psychedelic Rock","Art Rock"],"tracks_count":10}'),

-- 25. 1989
('c001cafe-0000-4000-8000-000000000125', '', '1989', '1989',
    '{"泰勒斯威夫特1989","Taylor Swift 1989"}', '2014-10-27', '2014-10-27', '2014-10-27', TRUE, '美国', 'en-US', 'en',
    '泰勒·斯威夫特转型流行乐的里程碑大作，获格莱美年度专辑与最佳流行演唱专辑，收录《Blank Space》《Shake It Off》。',
    'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Synth-Pop","Dance-Pop"],"tracks_count":13}'),

-- 26. A Night at the Opera
('c001cafe-0000-4000-8000-000000000126', '', 'A Night at the Opera', 'A Night at the Opera',
    '{"歌剧之夜","Queen 歌剧之夜"}', '1975-11-21', '1975-11-21', '1975-11-21', TRUE, '英国', 'en-US', 'en',
    '皇后乐队第4张录音室专辑，收录长达6分钟的摇滚歌剧史诗《Bohemian Rhapsody》（波西米亚狂想曲）。',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Progressive Rock","Glam Rock","Opera Rock"],"tracks_count":12}'),

-- 27. 21
('c001cafe-0000-4000-8000-000000000127', '', '21', '21',
    '{"Adele 21","阿黛尔21"}', '2011-01-24', '2011-01-24', '2011-01-24', TRUE, '英国', 'en-US', 'en',
    '阿黛尔第2张录音室专辑，全球销量突破3100万张，包揽第54届格莱美奖年度专辑与年度制作等6座大奖，收录《Rolling in the Deep》。',
    'https://images.unsplash.com/photo-1520523839898-5071282543e2?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Soul","Pop","Blues","R&B"],"tracks_count":11}'),

-- 28. OK Computer
('c001cafe-0000-4000-8000-000000000128', '', 'OK Computer', 'OK Computer',
    '{"OK计算机","Radiohead OK Computer"}', '1997-05-21', '1997-05-21', '1997-05-21', TRUE, '英国', 'en-US', 'en',
    '电台司令第3张录音室大碟，以反乌托邦与信息化异化为主题，被各大权威乐评机构评选为九十年代最伟大的另类摇滚专辑。',
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Art Rock","Alternative Rock","Electronic"],"tracks_count":12}'),

-- 29. Nevermind
('c001cafe-0000-4000-8000-000000000129', '', 'Nevermind', 'Nevermind',
    '{"涅槃从不介意","Nirvana Nevermind"}', '1991-09-24', '1991-09-24', '1991-09-24', TRUE, '美国', 'en-US', 'en',
    '涅槃乐队第2张录音室专辑，以《Smells Like Teen Spirit》将西雅图 Grunge 垃圾摇滚推向全球主流视野。',
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Grunge","Alternative Rock"],"tracks_count":12}'),

-- 30. Hotel California
('c001cafe-0000-4000-8000-000000000130', '', 'Hotel California', 'Hotel California',
    '{"加州旅馆","老鹰乐队加州旅馆"}', '1976-12-08', '1976-12-08', '1976-12-08', TRUE, '美国', 'en-US', 'en',
    '老鹰乐队第5张录音室专辑，全球发烧音响试音王牌，同名主打歌长达两分多钟的双吉他 Solo 成为摇滚史永恒经典。',
    'https://images.unsplash.com/photo-1469488865564-c2de10f69f96?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Classic Rock","Country Rock","Soft Rock"],"tracks_count":9}'),

-- 31. Random Access Memories
('c001cafe-0000-4000-8000-000000000131', '', 'Random Access Memories', 'Random Access Memories',
    '{"超时空记忆","Daft Punk RAM"}', '2013-05-17', '2013-05-17', '2013-05-17', TRUE, '法国', 'en-US', 'en',
    '傻朋克第4张录音室专辑，回归七八十年代模拟合成器与全真人实录音色，斩获格莱美年度专辑与最佳电子舞曲专辑。',
    'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Disco","Funk","Electronic","Synth-Pop"],"tracks_count":13}'),

-- 32. The Rise and Fall of Ziggy Stardust
('c001cafe-0000-4000-8000-000000000132', '', 'The Rise and Fall of Ziggy Stardust and the Spiders from Mars', 'The Rise and Fall of Ziggy Stardust and the Spiders from Mars',
    '{"Ziggy Stardust","鲍伊齐格星尘"}', '1972-06-16', '1972-06-16', '1972-06-16', TRUE, '英国', 'en-US', 'en',
    '大卫·鲍伊塑造外星摇滚巨星 Ziggy Stardust 的华丽摇滚概念大碟，开启跨性别美学与摇滚剧场演出新纪元。',
    'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Glam Rock","Art Rock","Proto-Punk"],"tracks_count":11}'),

-- 33. Rumours
('c001cafe-0000-4000-8000-000000000133', '', 'Rumours', 'Rumours',
    '{"谣言","Fleetwood Mac 谣言"}', '1977-02-04', '1977-02-04', '1977-02-04', TRUE, '英国', 'en-US', 'en',
    '佛利伍麦克合唱团最伟大的录音室专辑，全球销量突破4000万张，收录《Dreams》《Go Your Own Way》《The Chain》。',
    'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Pop Rock","Soft Rock","Folk Rock"],"tracks_count":11}'),

-- 34. Led Zeppelin IV
('c001cafe-0000-4000-8000-000000000134', '', 'Led Zeppelin IV', 'Led Zeppelin IV',
    '{"齐柏林飞艇4","Stairway to Heaven"}', '1971-11-08', '1971-11-08', '1971-11-08', TRUE, '英国', 'en-US', 'en',
    '齐柏林飞艇无题第4张录音室专辑，硬摇滚与民谣的至高结合，收录摇滚圣歌《Stairway to Heaven》（天国的阶梯）。',
    'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Hard Rock","Heavy Metal","Folk Rock"],"tracks_count":8}'),

-- 35. Kind of Blue
('c001cafe-0000-4000-8000-000000000135', '', 'Kind of Blue', 'Kind of Blue',
    '{"泛蓝调调","Miles Davis 泛蓝调调"}', '1959-08-17', '1959-08-17', '1959-08-17', TRUE, '美国', 'en-US', 'en',
    '迈尔斯·戴维斯调式爵士（Modal Jazz）巅峰开山之作，被全人类公认为爵士乐历史上最伟大、最畅销的唱片。',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Modal Jazz","Cool Jazz"],"tracks_count":5}'),

-- 36. Come Away with Me
('c001cafe-0000-4000-8000-000000000136', '', 'Come Away with Me', 'Come Away with Me',
    '{"远走高飞","Norah Jones 远走高飞"}', '2002-02-26', '2002-02-26', '2002-02-26', TRUE, '美国', 'en-US', 'en',
    '诺拉·琼斯首张录音室专辑，席卷格莱美年度专辑、年度制作、年度歌曲等8项大奖，温暖细腻的人声试音天碟。',
    'https://images.unsplash.com/photo-1487180144351-b8472da7d491?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Vocal Jazz","Contemporary Folk","Country Pop"],"tracks_count":14}'),

-- 37. WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?
('c001cafe-0000-4000-8000-000000000137', '', 'WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?', 'WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?',
    '{"怪奇比莉首专","Billie Eilish WWAFAWDWG"}', '2019-03-29', '2019-03-29', '2019-03-29', TRUE, '美国', 'en-US', 'en',
    '碧梨首张录音室大碟，以卧室制作呈现超凡低频与暗黑流行空间感，横扫格莱美四大通类大奖。',
    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Electropop","Dark Pop","Avant-Pop"],"tracks_count":14}'),

-- 38. A Rush of Blood to the Head
('c001cafe-0000-4000-8000-000000000138', '', 'A Rush of Blood to the Head', 'A Rush of Blood to the Head',
    '{"玩酷人生/心血来潮","Coldplay 2专"}', '2002-08-26', '2002-08-26', '2002-08-26', TRUE, '英国', 'en-US', 'en',
    '酷玩乐队第2张录音室专辑，获格莱美最佳另类音乐专辑与年度制作奖，收录《The Scientist》《Clocks》《In My Place》。',
    'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Post-Britpop","Alternative Rock","Piano Rock"],"tracks_count":11}'),

-- ==========================================
-- 分组 3: 动漫/游戏/影视神级原声 OST (14部)
-- ==========================================
-- 39. GHOST IN THE SHELL
('c001cafe-0000-4000-8000-000000000139', '', 'GHOST IN THE SHELL', 'GHOST IN THE SHELL (Original Soundtrack)',
    '{"攻壳机动队原声带","Ghost In The Shell OST","川井宪次傀儡谣"}', '1995-11-22', '1995-11-22', '1995-11-22', TRUE, '日本', 'ja', 'ja',
    '川井宪次操刀的押井守剧场版动画《攻壳机动队》原声大碟，以神道民俗合唱与保加利亚声乐打造的《傀儡谣》享誉全球影坛。',
    'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Soundtrack","Choral","Tribal Ambient","Electronic"],"tracks_count":11}'),

-- 40. Interstellar
('c001cafe-0000-4000-8000-000000000140', '', 'Interstellar', 'Interstellar (Original Motion Picture Soundtrack)',
    '{"星际穿越原声带","Hans Zimmer Interstellar OST"}', '2014-11-17', '2014-11-17', '2014-11-17', TRUE, '美国', 'en-US', 'en',
    '汉斯·季默为克里斯托弗·诺兰科幻巨作《星际穿越》量身打造的原声带，以伦敦圣殿教堂四层管风琴实录展现浩瀚宇宙与深沉父爱。',
    'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Soundtrack","Modern Classical","Pipe Organ","Minimalism"],"tracks_count":16}'),

-- 41. 千与千寻 原声集
('c001cafe-0000-4000-8000-000000000141', '', '千与千寻 原声集', '千と千尋の神隠し サウンドトラック',
    '{"Spirited Away OST","久石让千与千寻原声"}', '2001-07-18', '2001-07-18', '2001-07-18', TRUE, '日本', 'ja', 'ja',
    '久石让操刀、新日本爱乐交响乐团演奏的宫崎骏动画奥斯卡大作《千与千寻》官方原声大碟，收录《那个夏天》《一日之川》《总是一次又一次》。',
    'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Soundtrack","Orchestral","Modern Classical"],"tracks_count":21}'),

-- 42. NieR:Automata Original Soundtrack
('c001cafe-0000-4000-8000-000000000142', '', 'NieR:Automata Original Soundtrack', 'NieR:Automata Original Soundtrack',
    '{"尼尔机械纪元原声带","NieR Automata OST"}', '2017-03-29', '2017-03-29', '2017-03-29', TRUE, '日本', 'ja', 'ja',
    '冈部启一领衔 MONACA 制作的《尼尔：机械纪元》3CD 官方原声大碟，以造语人声与哀婉交响荣获 TGA 最佳游戏原声音乐大奖。',
    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Video Game Soundtrack","Choral","Ambient","Industrial"],"tracks_count":46}'),

-- 43. FINAL FANTASY VII ORIGINAL SOUNDTRACK
('c001cafe-0000-4000-8000-000000000143', '', 'FINAL FANTASY VII ORIGINAL SOUNDTRACK', 'FINAL FANTASY VII ORIGINAL SOUNDTRACK',
    '{"最终幻想7原声带","FF7 OST","植松伸夫片翼天使"}', '1997-02-10', '1997-02-10', '1997-02-10', TRUE, '日本', 'ja', 'ja',
    '植松伸夫操刀的《最终幻想VII》4CD 原声大碟，收录电子游戏配乐历史上最著名的神作《片翼的天使》《爱丽丝主题曲》。',
    'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Video Game Soundtrack","Chamber Music","Orchestral"],"tracks_count":85}'),

-- 44. 塞尔达传说：旷野之息 原声带
('c001cafe-0000-4000-8000-000000000144', '', '塞尔达传说：旷野之息 原声带', 'ゼルダの伝説 ブレス オブ ザ ワイルド オリジナルサウンドトラック',
    '{"The Legend of Zelda: Breath of the Wild OST","荒野之息原声带"}', '2018-04-25', '2018-04-25', '2018-04-25', TRUE, '日本', 'ja', 'ja',
    '任天堂官方发行的《塞尔达传说：旷野之息》5CD 原声大碟，以极简主义钢琴点缀海拉鲁大陆的自然风貌与冒险历程。',
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Video Game Soundtrack","Minimalism","Piano","Atmospheric"],"tracks_count":211}'),

-- 45. 皎月云间之梦
('c001cafe-0000-4000-8000-000000000145', '', '皎月云间之梦', 'Jade Moon Upon a Sea of Clouds',
    '{"原神璃月篇原声带","Genshin Impact Liyue OST","陈致逸皎月云间之梦"}', '2020-11-06', '2020-11-06', '2020-11-06', TRUE, '中国', 'zh-CN', 'zh',
    'HOYO-MiX 出品、陈致逸作曲、上海交响乐团实录演奏的《原神》璃月篇交响原声专辑，将传统国风民乐与西方交响乐宏大融合。',
    'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Video Game Soundtrack","Symphonic","Chinese Traditional"],"tracks_count":69}'),

-- 46. COWBOY BEBOP
('c001cafe-0000-4000-8000-000000000146', '', 'COWBOY BEBOP', 'COWBOY BEBOP (Original Soundtrack)',
    '{"星际牛仔原声带","Cowboy Bebop OST","菅野洋子星际牛仔"}', '1998-05-21', '1998-05-21', '1998-05-21', TRUE, '日本', 'ja', 'ja',
    '菅野洋子携手 Seatbelts 乐队为渡边信一郎动画神作《星际牛仔》创作的爵士狂想大碟，收录《Tank!》《Rush》。',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Soundtrack","Big Band","Bebop","Blues"],"tracks_count":17}'),

-- 47. 进击的巨人 Season 1 Original Soundtrack
('c001cafe-0000-4000-8000-000000000147', '', '进击的巨人 Season 1 Original Soundtrack', '「進撃の巨人」オリジナルサウンドトラック',
    '{"Attack on Titan OST 1","泽野弘之巨人原声"}', '2013-06-28', '2013-06-28', '2013-06-28', TRUE, '日本', 'ja', 'ja',
    '泽野弘之操刀的《进击的巨人》第1季动画原声大碟，收录《ətˈæk 0N tάɪtn》《Vogel im Käfig》《立body機motion》等热血神曲。',
    'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Soundtrack","Epic Orchestral","Vocal Rock"],"tracks_count":16}'),

-- 48. Star Wars: Episode IV - A New Hope
('c001cafe-0000-4000-8000-000000000148', '', 'Star Wars: Episode IV - A New Hope', 'Star Wars: Episode IV - A New Hope (Original Motion Picture Soundtrack)',
    '{"星球大战原声带","Star Wars OST","约翰威廉姆斯星球大战"}', '1977-06-01', '1977-06-01', '1977-06-01', TRUE, '美国', 'en-US', 'en',
    '约翰·威廉姆斯执棒伦敦交响乐团演奏的科幻电影里程碑原声，获奥斯卡最佳原创音乐奖，确立了好莱坞主导交响配乐范式。',
    'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Soundtrack","Film Score","Late Romantic Orchestral"],"tracks_count":16}'),

-- 49. The Legend of 1900
('c001cafe-0000-4000-8000-000000000149', '', 'The Legend of 1900', 'The Legend of 1900 (Original Soundtrack)',
    '{"海上钢琴师原声带","莫里康内海上钢琴师"}', '1998-10-28', '1998-10-28', '1998-10-28', TRUE, '意大利', 'en-US', 'it',
    '埃尼奥·莫里康内操刀的影史殿堂级配乐，斩获金球奖最佳原创配乐，收录《Playing Love》《Magic Waltz》《The Crave》。',
    'https://images.unsplash.com/photo-1520523839898-5071282543e2?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Soundtrack","Ragtime","Solo Piano","Romantic Orchestral"],"tracks_count":21}'),

-- 50. Paprika Original Soundtrack
('c001cafe-0000-4000-8000-000000000150', '', 'Paprika Original Soundtrack', '「パプリカ」オリジナルサウンドトラック',
    '{"红辣椒原声带","平泽进红辣椒原声"}', '2006-11-23', '2006-11-23', '2006-11-23', TRUE, '日本', 'ja', 'ja',
    '平泽进为今敏导演造梦神作《红辣椒》（盗梦侦探）打造的电幻先锋原声大碟，收录《白虎野之娘》《游行 Parade》。',
    'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Soundtrack","Techno-Pop","Avant-Garde Electronic"],"tracks_count":13}'),

-- 51. Inception
('c001cafe-0000-4000-8000-000000000151', '', 'Inception', 'Inception (Music from the Motion Picture)',
    '{"盗梦空间原声带","Inception OST","Hans Zimmer Time"}', '2010-07-13', '2010-07-13', '2010-07-13', TRUE, '美国', 'en-US', 'en',
    '汉斯·季默为诺兰《盗梦空间》打造的划时代配乐，引入震撼管乐与强劲电子低频，收录催人泪下的不朽神曲《Time》。',
    'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Soundtrack","Electronic Orchestral","Ambient"],"tracks_count":12}'),

-- 52. 幽灵公主 原声集
('c001cafe-0000-4000-8000-000000000152', '', '幽灵公主 原声集', 'もののけ姫 サウンドトラック',
    '{"Princess Mononoke OST","久石让幽灵公主"}', '1997-07-02', '1997-07-02', '1997-07-02', TRUE, '日本', 'ja', 'ja',
    '久石让操刀、东京爱乐交响乐团演奏的吉卜力壮阔自然史诗《幽灵公主》官方原声大碟，以太鼓与交响乐描绘人与自然的抗争与共生。',
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1000&q=80', '1:1', 'General', 'completed', '00000000-0000-0000-0000-000000000001', '{"genres":["Soundtrack","Symphonic Poem","Traditional Japanese"],"tracks_count":33}')

ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    original_title = EXCLUDED.original_title,
    aliases = EXCLUDED.aliases,
    release_date = EXCLUDED.release_date,
    begin_date = EXCLUDED.begin_date,
    end_date = EXCLUDED.end_date,
    country = EXCLUDED.country,
    language = EXCLUDED.language,
    original_language = EXCLUDED.original_language,
    summary = EXCLUDED.summary,
    cover_image_url = EXCLUDED.cover_image_url,
    cover_aspect = EXCLUDED.cover_aspect,
    catalog_metadata = EXCLUDED.catalog_metadata;

-- ---------------------------------------------------------------------------
-- 3. 多语言题名与翻译 (Work Translations)
-- ---------------------------------------------------------------------------
INSERT INTO work_translations (work_id, locale, title, summary) VALUES
('c001cafe-0000-4000-8000-000000000101', 'en-US', 'Fantasy', 'Jay Chou''s landmark 2nd studio album released in 2001, winning 5 Golden Melody Awards.'),
('c001cafe-0000-4000-8000-000000000101', 'ja', 'ファンタジー (Fantasy)', '2001年にリリースされた周杰倫（ジェイ・チョウ）の代表作。金曲奨で5部門を受賞。'),
('c001cafe-0000-4000-8000-000000000102', 'en-US', 'Yeh Hui-Mei', 'Jay Chou''s 4th studio album named after his mother, featuring "In the Name of the Father" and "Dong-Feng-Po".'),
('c001cafe-0000-4000-8000-000000000102', 'ja', 'イエ・ホイメイ (葉恵美)', '母の名を冠したジェイ・チョウの4thアルバム。「以父之名」「晴天」などを収録。'),
('c001cafe-0000-4000-8000-000000000104', 'en-US', 'U87', 'Eason Chan''s legendary 2005 Cantonese album named after the iconic Neumann U87 microphone.'),
('c001cafe-0000-4000-8000-000000000106', 'en-US', 'Kite', 'Stefanie Sun''s 3rd album featuring "Green Light" and "Kite".'),
('c001cafe-0000-4000-8000-000000000107', 'en-US', 'Fable', 'Faye Wong''s avant-garde concept album featuring the five-part philosophical Fable suite.'),
('c001cafe-0000-4000-8000-000000000111', 'en-US', 'Omnipotent Youth Society', 'Self-titled debut album by the legendary Chinese indie art-rock band from Shijiazhuang.'),
('c001cafe-0000-4000-8000-000000000112', 'en-US', 'Inside the Cable Temple', 'Omnipotent Youth Society''s critically acclaimed 2nd progressive rock concept album.'),
('c001cafe-0000-4000-8000-000000000114', 'en-US', 'Rock ''N'' Roll on the New Long March', 'Cui Jian''s groundbreaking 1989 album that birthed Chinese rock music.'),
('c001cafe-0000-4000-8000-000000000121', 'zh-CN', '颤栗 (Thriller)', '迈克尔·杰克逊1982年划时代巨作，全球最畅销专辑，销量超7000万张。'),
('c001cafe-0000-4000-8000-000000000121', 'en-US', 'Thriller', 'The world''s best-selling album of all time by Michael Jackson, produced by Quincy Jones.'),
('c001cafe-0000-4000-8000-000000000123', 'zh-CN', '阿比路 (Abbey Road)', '披头士乐队1969年发行的录音室绝响，收录经典B面组曲与 Come Together。'),
('c001cafe-0000-4000-8000-000000000123', 'en-US', 'Abbey Road', 'The 11th studio album by the English rock band the Beatles, featuring the iconic zebra crossing.'),
('c001cafe-0000-4000-8000-000000000124', 'zh-CN', '月之暗面 (The Dark Side of the Moon)', '平克·弗洛伊德前卫摇滚丰碑，在榜超900周的声学奇迹。'),
('c001cafe-0000-4000-8000-000000000124', 'en-US', 'The Dark Side of the Moon', 'Pink Floyd''s landmark concept album exploring life, greed, time, and mental illness.'),
('c001cafe-0000-4000-8000-000000000126', 'zh-CN', '歌剧之夜 (A Night at the Opera)', '皇后乐队华丽摇滚巅峰，收录摇滚歌剧史诗《波西米亚狂想曲》。'),
('c001cafe-0000-4000-8000-000000000126', 'en-US', 'A Night at the Opera', 'Queen''s 4th studio album featuring the historic masterpiece "Bohemian Rhapsody".'),
('c001cafe-0000-4000-8000-000000000130', 'zh-CN', '加州旅馆 (Hotel California)', '老鹰乐队全球试音圣碟，同名主打歌双吉他Solo载入史册。'),
('c001cafe-0000-4000-8000-000000000130', 'en-US', 'Hotel California', 'Eagles'' fifth studio album, a pinnacle of 1970s American rock and audiophile benchmark.'),
('c001cafe-0000-4000-8000-000000000131', 'zh-CN', '超时空记忆 (Random Access Memories)', '傻朋克格莱美年度大碟，回归全模拟硬件实录的电子殿堂神作。'),
('c001cafe-0000-4000-8000-000000000131', 'en-US', 'Random Access Memories', 'Daft Punk''s Grammy-winning fourth album paying tribute to late 1970s and early 1980s American music.'),
('c001cafe-0000-4000-8000-000000000135', 'zh-CN', '泛蓝调调 (Kind of Blue)', '迈尔斯·戴维斯调式爵士宗师之作，爵士乐历史最伟大唱片。'),
('c001cafe-0000-4000-8000-000000000135', 'en-US', 'Kind of Blue', 'Miles Davis'' timeless modal jazz masterpiece, universally regarded as the greatest jazz album.'),
('c001cafe-0000-4000-8000-000000000139', 'zh-CN', '攻壳机动队 原声大碟', '川井宪次操刀的押井守经典剧场版动画原声，神道民俗傀儡谣。'),
('c001cafe-0000-4000-8000-000000000139', 'en-US', 'GHOST IN THE SHELL (Original Soundtrack)', 'Kenji Kawai''s haunting score for Mamoru Oshii''s cyber-noir masterpiece.'),
('c001cafe-0000-4000-8000-000000000140', 'zh-CN', '星际穿越 电影原声带', '汉斯·季默为诺兰科幻巨作创作的管风琴史诗配乐。'),
('c001cafe-0000-4000-8000-000000000140', 'en-US', 'Interstellar (Original Soundtrack)', 'Hans Zimmer''s Oscar-nominated pipe organ masterpiece for Christopher Nolan''s sci-fi epic.'),
('c001cafe-0000-4000-8000-000000000141', 'zh-CN', '千与千寻 动画电影原声集', '久石让操刀、新日本爱乐交响乐团演奏的吉卜力奥斯卡动画配乐。'),
('c001cafe-0000-4000-8000-000000000141', 'en-US', 'Spirited Away (Original Soundtrack)', 'Joe Hisaishi''s magical orchestral score for Hayao Miyazaki''s Academy Award-winning film.'),
('c001cafe-0000-4000-8000-000000000142', 'zh-CN', '尼尔：机械纪元 官方原声大碟', '冈部启一操刀的造语人声与哀婉交响，荣获TGA最佳音乐大奖。'),
('c001cafe-0000-4000-8000-000000000142', 'en-US', 'NieR:Automata Original Soundtrack', 'Keiichi Okabe and MONACA''s TGA-winning dynamic soundtrack with invented chaos language.'),
('c001cafe-0000-4000-8000-000000000143', 'zh-CN', '最终幻想VII 官方原声带', '植松伸夫传世之作，收录《片翼天使》《爱丽丝主题曲》。'),
('c001cafe-0000-4000-8000-000000000143', 'en-US', 'FINAL FANTASY VII Original Soundtrack', 'Nobuo Uematsu''s legendary 4CD video game soundtrack featuring One-Winged Angel.'),
('c001cafe-0000-4000-8000-000000000144', 'zh-CN', '塞尔达传说：旷野之息 官方原声带', '任天堂官方5CD原声大碟，极简主义钢琴与海拉鲁自然环境交响。'),
('c001cafe-0000-4000-8000-000000000144', 'en-US', 'The Legend of Zelda: Breath of the Wild Original Soundtrack', 'Nintendo''s 5CD complete ambient score celebrating freedom in Hyrule.'),
('c001cafe-0000-4000-8000-000000000145', 'zh-CN', '皎月云间之梦 (原神璃月篇原声带)', '陈致逸作曲、上海交响乐团实录演奏的璃月国风交响原声大碟。'),
('c001cafe-0000-4000-8000-000000000145', 'en-US', 'Jade Moon Upon a Sea of Clouds', 'HOYO-MiX and Yu-Peng Chen''s majestic Chinese orchestral soundtrack for Genshin Impact''s Liyue.')
ON CONFLICT (work_id, locale) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary;

-- ---------------------------------------------------------------------------
-- 4. 作品与艺术家关联 (Work Artist Relations)
-- ---------------------------------------------------------------------------
INSERT INTO work_artist_relations (work_id, artist_id, role) VALUES
('c001cafe-0000-4000-8000-000000000101', 'c001cafe-0000-4000-8000-000000000001', 'composer'),
('c001cafe-0000-4000-8000-000000000101', 'c001cafe-0000-4000-8000-000000000001', 'performer'),
('c001cafe-0000-4000-8000-000000000102', 'c001cafe-0000-4000-8000-000000000001', 'composer'),
('c001cafe-0000-4000-8000-000000000102', 'c001cafe-0000-4000-8000-000000000001', 'performer'),
('c001cafe-0000-4000-8000-000000000103', 'c001cafe-0000-4000-8000-000000000001', 'composer'),
('c001cafe-0000-4000-8000-000000000103', 'c001cafe-0000-4000-8000-000000000001', 'performer'),
('c001cafe-0000-4000-8000-000000000104', 'c001cafe-0000-4000-8000-000000000002', 'performer'),
('c001cafe-0000-4000-8000-000000000105', 'c001cafe-0000-4000-8000-000000000002', 'performer'),
('c001cafe-0000-4000-8000-000000000106', 'c001cafe-0000-4000-8000-000000000003', 'performer'),
('c001cafe-0000-4000-8000-000000000107', 'c001cafe-0000-4000-8000-000000000004', 'performer'),
('c001cafe-0000-4000-8000-000000000107', 'c001cafe-0000-4000-8000-000000000004', 'composer'),
('c001cafe-0000-4000-8000-000000000108', 'c001cafe-0000-4000-8000-000000000004', 'performer'),
('c001cafe-0000-4000-8000-000000000108', 'c001cafe-0000-4000-8000-000000000018', 'producer'),
('c001cafe-0000-4000-8000-000000000109', 'c001cafe-0000-4000-8000-000000000005', 'band'),
('c001cafe-0000-4000-8000-000000000110', 'c001cafe-0000-4000-8000-000000000005', 'band'),
('c001cafe-0000-4000-8000-000000000111', 'c001cafe-0000-4000-8000-000000000006', 'band'),
('c001cafe-0000-4000-8000-000000000112', 'c001cafe-0000-4000-8000-000000000006', 'band'),
('c001cafe-0000-4000-8000-000000000113', 'c001cafe-0000-4000-8000-000000000007', 'composer'),
('c001cafe-0000-4000-8000-000000000113', 'c001cafe-0000-4000-8000-000000000007', 'performer'),
('c001cafe-0000-4000-8000-000000000114', 'c001cafe-0000-4000-8000-000000000008', 'composer'),
('c001cafe-0000-4000-8000-000000000114', 'c001cafe-0000-4000-8000-000000000008', 'performer'),
('c001cafe-0000-4000-8000-000000000115', 'c001cafe-0000-4000-8000-000000000009', 'performer'),
('c001cafe-0000-4000-8000-000000000116', 'c001cafe-0000-4000-8000-000000000010', 'composer'),
('c001cafe-0000-4000-8000-000000000116', 'c001cafe-0000-4000-8000-000000000010', 'performer'),
('c001cafe-0000-4000-8000-000000000117', 'c001cafe-0000-4000-8000-000000000011', 'composer'),
('c001cafe-0000-4000-8000-000000000117', 'c001cafe-0000-4000-8000-000000000011', 'performer'),
('c001cafe-0000-4000-8000-000000000118', 'c001cafe-0000-4000-8000-000000000013', 'band'),
('c001cafe-0000-4000-8000-000000000119', 'c001cafe-0000-4000-8000-000000000017', 'band'),
('c001cafe-0000-4000-8000-000000000120', 'c001cafe-0000-4000-8000-000000000018', 'composer'),
('c001cafe-0000-4000-8000-000000000120', 'c001cafe-0000-4000-8000-000000000018', 'performer'),

-- 国际流行与发烧
('c001cafe-0000-4000-8000-000000000121', 'c001cafe-0000-4000-8000-000000000019', 'performer'),
('c001cafe-0000-4000-8000-000000000122', 'c001cafe-0000-4000-8000-000000000019', 'performer'),
('c001cafe-0000-4000-8000-000000000123', 'c001cafe-0000-4000-8000-000000000020', 'band'),
('c001cafe-0000-4000-8000-000000000124', 'c001cafe-0000-4000-8000-000000000021', 'band'),
('c001cafe-0000-4000-8000-000000000125', 'c001cafe-0000-4000-8000-000000000023', 'composer'),
('c001cafe-0000-4000-8000-000000000125', 'c001cafe-0000-4000-8000-000000000023', 'performer'),
('c001cafe-0000-4000-8000-000000000126', 'c001cafe-0000-4000-8000-000000000022', 'band'),
('c001cafe-0000-4000-8000-000000000127', 'c001cafe-0000-4000-8000-000000000024', 'performer'),
('c001cafe-0000-4000-8000-000000000128', 'c001cafe-0000-4000-8000-000000000025', 'band'),
('c001cafe-0000-4000-8000-000000000129', 'c001cafe-0000-4000-8000-000000000026', 'band'),
('c001cafe-0000-4000-8000-000000000130', 'c001cafe-0000-4000-8000-000000000027', 'band'),
('c001cafe-0000-4000-8000-000000000131', 'c001cafe-0000-4000-8000-000000000028', 'band'),
('c001cafe-0000-4000-8000-000000000132', 'c001cafe-0000-4000-8000-000000000029', 'composer'),
('c001cafe-0000-4000-8000-000000000132', 'c001cafe-0000-4000-8000-000000000029', 'performer'),
('c001cafe-0000-4000-8000-000000000133', 'c001cafe-0000-4000-8000-000000000030', 'band'),
('c001cafe-0000-4000-8000-000000000134', 'c001cafe-0000-4000-8000-000000000031', 'band'),
('c001cafe-0000-4000-8000-000000000135', 'c001cafe-0000-4000-8000-000000000032', 'composer'),
('c001cafe-0000-4000-8000-000000000135', 'c001cafe-0000-4000-8000-000000000032', 'performer'),
('c001cafe-0000-4000-8000-000000000136', 'c001cafe-0000-4000-8000-000000000033', 'performer'),
('c001cafe-0000-4000-8000-000000000137', 'c001cafe-0000-4000-8000-000000000034', 'performer'),
('c001cafe-0000-4000-8000-000000000138', 'c001cafe-0000-4000-8000-000000000035', 'band'),

-- 影视与游戏原声
('c001cafe-0000-4000-8000-000000000139', 'c001cafe-0000-4000-8000-000000000036', 'composer'),
('c001cafe-0000-4000-8000-000000000140', 'c001cafe-0000-4000-8000-000000000037', 'composer'),
('c001cafe-0000-4000-8000-000000000141', 'c001cafe-0000-4000-8000-000000000038', 'composer'),
('c001cafe-0000-4000-8000-000000000142', 'c001cafe-0000-4000-8000-000000000039', 'composer'),
('c001cafe-0000-4000-8000-000000000143', 'c001cafe-0000-4000-8000-000000000040', 'composer'),
('c001cafe-0000-4000-8000-000000000144', 'c001cafe-0000-4000-8000-000000000041', 'composer'),
('c001cafe-0000-4000-8000-000000000145', 'c001cafe-0000-4000-8000-000000000042', 'composer'),
('c001cafe-0000-4000-8000-000000000145', 'c001cafe-0000-4000-8000-000000000048', 'studio'),
('c001cafe-0000-4000-8000-000000000146', 'c001cafe-0000-4000-8000-000000000043', 'composer'),
('c001cafe-0000-4000-8000-000000000147', 'c001cafe-0000-4000-8000-000000000044', 'composer'),
('c001cafe-0000-4000-8000-000000000148', 'c001cafe-0000-4000-8000-000000000045', 'composer'),
('c001cafe-0000-4000-8000-000000000149', 'c001cafe-0000-4000-8000-000000000046', 'composer'),
('c001cafe-0000-4000-8000-000000000150', 'c001cafe-0000-4000-8000-000000000047', 'composer'),
('c001cafe-0000-4000-8000-000000000151', 'c001cafe-0000-4000-8000-000000000037', 'composer'),
('c001cafe-0000-4000-8000-000000000152', 'c001cafe-0000-4000-8000-000000000038', 'composer')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. 标签绑定 (Work Tag Relations)
-- ---------------------------------------------------------------------------
INSERT INTO work_tag_relations (work_id, tag_id)
SELECT w.id, t.id FROM (VALUES
    ('c001cafe-0000-4000-8000-000000000101'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000101'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000101'::uuid, '流行'), ('c001cafe-0000-4000-8000-000000000101'::uuid, '华语金曲'),
    ('c001cafe-0000-4000-8000-000000000102'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000102'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000102'::uuid, '流行'), ('c001cafe-0000-4000-8000-000000000102'::uuid, '华语金曲'),
    ('c001cafe-0000-4000-8000-000000000103'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000103'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000103'::uuid, '流行'), ('c001cafe-0000-4000-8000-000000000103'::uuid, '华语金曲'),
    ('c001cafe-0000-4000-8000-000000000104'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000104'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000104'::uuid, '流行'), ('c001cafe-0000-4000-8000-000000000104'::uuid, '华语金曲'),
    ('c001cafe-0000-4000-8000-000000000105'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000105'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000105'::uuid, '流行'), ('c001cafe-0000-4000-8000-000000000105'::uuid, '华语金曲'),
    ('c001cafe-0000-4000-8000-000000000106'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000106'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000106'::uuid, '流行'), ('c001cafe-0000-4000-8000-000000000106'::uuid, '华语金曲'),
    ('c001cafe-0000-4000-8000-000000000107'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000107'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000107'::uuid, '流行'), ('c001cafe-0000-4000-8000-000000000107'::uuid, '发烧天碟'),
    ('c001cafe-0000-4000-8000-000000000108'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000108'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000108'::uuid, '独立音乐'), ('c001cafe-0000-4000-8000-000000000108'::uuid, '华语金曲'),
    ('c001cafe-0000-4000-8000-000000000109'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000109'::uuid, '单曲'), ('c001cafe-0000-4000-8000-000000000109'::uuid, '流行摇滚'),
    ('c001cafe-0000-4000-8000-000000000110'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000110'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000110'::uuid, '摇滚'),
    ('c001cafe-0000-4000-8000-000000000111'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000111'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000111'::uuid, '摇滚'), ('c001cafe-0000-4000-8000-000000000111'::uuid, '独立音乐'),
    ('c001cafe-0000-4000-8000-000000000112'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000112'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000112'::uuid, '前卫摇滚'), ('c001cafe-0000-4000-8000-000000000112'::uuid, '爵士'),
    ('c001cafe-0000-4000-8000-000000000113'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000113'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000113'::uuid, '民谣'), ('c001cafe-0000-4000-8000-000000000113'::uuid, '华语金曲'),
    ('c001cafe-0000-4000-8000-000000000114'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000114'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000114'::uuid, '摇滚'), ('c001cafe-0000-4000-8000-000000000114'::uuid, '华语金曲'),
    ('c001cafe-0000-4000-8000-000000000115'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000115'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000115'::uuid, '流行'), ('c001cafe-0000-4000-8000-000000000115'::uuid, '华语金曲'),
    ('c001cafe-0000-4000-8000-000000000116'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000116'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000116'::uuid, 'R&B'), ('c001cafe-0000-4000-8000-000000000116'::uuid, '华语金曲'),
    ('c001cafe-0000-4000-8000-000000000117'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000117'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000117'::uuid, '民谣'), ('c001cafe-0000-4000-8000-000000000117'::uuid, '华语金曲'),
    ('c001cafe-0000-4000-8000-000000000118'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000118'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000118'::uuid, '摇滚'), ('c001cafe-0000-4000-8000-000000000118'::uuid, '华语金曲'),
    ('c001cafe-0000-4000-8000-000000000119'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000119'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000119'::uuid, '独立音乐'), ('c001cafe-0000-4000-8000-000000000119'::uuid, '摇滚'),
    ('c001cafe-0000-4000-8000-000000000120'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000120'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000120'::uuid, '摇滚'), ('c001cafe-0000-4000-8000-000000000120'::uuid, '华语金曲'),

    -- 国际流行发烧
    ('c001cafe-0000-4000-8000-000000000121'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000121'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000121'::uuid, '流行'), ('c001cafe-0000-4000-8000-000000000121'::uuid, '世界经典'),
    ('c001cafe-0000-4000-8000-000000000122'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000122'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000122'::uuid, '流行'), ('c001cafe-0000-4000-8000-000000000122'::uuid, '世界经典'),
    ('c001cafe-0000-4000-8000-000000000123'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000123'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000123'::uuid, '摇滚'), ('c001cafe-0000-4000-8000-000000000123'::uuid, '世界经典'),
    ('c001cafe-0000-4000-8000-000000000124'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000124'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000124'::uuid, '前卫摇滚'), ('c001cafe-0000-4000-8000-000000000124'::uuid, '发烧天碟'),
    ('c001cafe-0000-4000-8000-000000000125'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000125'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000125'::uuid, '流行'),
    ('c001cafe-0000-4000-8000-000000000126'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000126'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000126'::uuid, '摇滚'), ('c001cafe-0000-4000-8000-000000000126'::uuid, '世界经典'),
    ('c001cafe-0000-4000-8000-000000000127'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000127'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000127'::uuid, '流行'), ('c001cafe-0000-4000-8000-000000000127'::uuid, '发烧天碟'),
    ('c001cafe-0000-4000-8000-000000000128'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000128'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000128'::uuid, '摇滚'), ('c001cafe-0000-4000-8000-000000000128'::uuid, '独立音乐'),
    ('c001cafe-0000-4000-8000-000000000129'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000129'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000129'::uuid, '摇滚'),
    ('c001cafe-0000-4000-8000-000000000130'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000130'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000130'::uuid, '摇滚'), ('c001cafe-0000-4000-8000-000000000130'::uuid, '发烧天碟'),
    ('c001cafe-0000-4000-8000-000000000131'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000131'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000131'::uuid, '电子'), ('c001cafe-0000-4000-8000-000000000131'::uuid, '发烧天碟'),
    ('c001cafe-0000-4000-8000-000000000132'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000132'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000132'::uuid, '摇滚'), ('c001cafe-0000-4000-8000-000000000132'::uuid, '世界经典'),
    ('c001cafe-0000-4000-8000-000000000133'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000133'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000133'::uuid, '摇滚'), ('c001cafe-0000-4000-8000-000000000133'::uuid, '发烧天碟'),
    ('c001cafe-0000-4000-8000-000000000134'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000134'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000134'::uuid, '重金属'), ('c001cafe-0000-4000-8000-000000000134'::uuid, '世界经典'),
    ('c001cafe-0000-4000-8000-000000000135'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000135'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000135'::uuid, '爵士'), ('c001cafe-0000-4000-8000-000000000135'::uuid, '发烧天碟'),
    ('c001cafe-0000-4000-8000-000000000136'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000136'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000136'::uuid, '爵士'), ('c001cafe-0000-4000-8000-000000000136'::uuid, '发烧天碟'),
    ('c001cafe-0000-4000-8000-000000000137'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000137'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000137'::uuid, '流行'), ('c001cafe-0000-4000-8000-000000000137'::uuid, '电子'),
    ('c001cafe-0000-4000-8000-000000000138'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000138'::uuid, '专辑'), ('c001cafe-0000-4000-8000-000000000138'::uuid, '摇滚'),

    -- 影视动漫游戏原声
    ('c001cafe-0000-4000-8000-000000000139'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000139'::uuid, '原声带'), ('c001cafe-0000-4000-8000-000000000139'::uuid, '动漫原声'), ('c001cafe-0000-4000-8000-000000000139'::uuid, '交响原声'),
    ('c001cafe-0000-4000-8000-000000000140'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000140'::uuid, '原声带'), ('c001cafe-0000-4000-8000-000000000140'::uuid, '影视原声'), ('c001cafe-0000-4000-8000-000000000140'::uuid, '古典'),
    ('c001cafe-0000-4000-8000-000000000141'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000141'::uuid, '原声带'), ('c001cafe-0000-4000-8000-000000000141'::uuid, '动漫原声'), ('c001cafe-0000-4000-8000-000000000141'::uuid, '管弦乐'),
    ('c001cafe-0000-4000-8000-000000000142'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000142'::uuid, '原声带'), ('c001cafe-0000-4000-8000-000000000142'::uuid, '游戏原声'), ('c001cafe-0000-4000-8000-000000000142'::uuid, '交响原声'),
    ('c001cafe-0000-4000-8000-000000000143'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000143'::uuid, '原声带'), ('c001cafe-0000-4000-8000-000000000143'::uuid, '游戏原声'), ('c001cafe-0000-4000-8000-000000000143'::uuid, '管弦乐'),
    ('c001cafe-0000-4000-8000-000000000144'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000144'::uuid, '原声带'), ('c001cafe-0000-4000-8000-000000000144'::uuid, '游戏原声'),
    ('c001cafe-0000-4000-8000-000000000145'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000145'::uuid, '原声带'), ('c001cafe-0000-4000-8000-000000000145'::uuid, '游戏原声'), ('c001cafe-0000-4000-8000-000000000145'::uuid, '管弦乐'),
    ('c001cafe-0000-4000-8000-000000000146'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000146'::uuid, '原声带'), ('c001cafe-0000-4000-8000-000000000146'::uuid, '动漫原声'), ('c001cafe-0000-4000-8000-000000000146'::uuid, '爵士'),
    ('c001cafe-0000-4000-8000-000000000147'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000147'::uuid, '原声带'), ('c001cafe-0000-4000-8000-000000000147'::uuid, '动漫原声'), ('c001cafe-0000-4000-8000-000000000147'::uuid, '交响原声'),
    ('c001cafe-0000-4000-8000-000000000148'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000148'::uuid, '原声带'), ('c001cafe-0000-4000-8000-000000000148'::uuid, '影视原声'), ('c001cafe-0000-4000-8000-000000000148'::uuid, '古典'),
    ('c001cafe-0000-4000-8000-000000000149'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000149'::uuid, '原声带'), ('c001cafe-0000-4000-8000-000000000149'::uuid, '影视原声'), ('c001cafe-0000-4000-8000-000000000149'::uuid, '古典'),
    ('c001cafe-0000-4000-8000-000000000150'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000150'::uuid, '原声带'), ('c001cafe-0000-4000-8000-000000000150'::uuid, '动漫原声'), ('c001cafe-0000-4000-8000-000000000150'::uuid, '电子'),
    ('c001cafe-0000-4000-8000-000000000151'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000151'::uuid, '原声带'), ('c001cafe-0000-4000-8000-000000000151'::uuid, '影视原声'), ('c001cafe-0000-4000-8000-000000000151'::uuid, '电子'),
    ('c001cafe-0000-4000-8000-000000000152'::uuid, '音乐'), ('c001cafe-0000-4000-8000-000000000152'::uuid, '原声带'), ('c001cafe-0000-4000-8000-000000000152'::uuid, '动漫原声'), ('c001cafe-0000-4000-8000-000000000152'::uuid, '管弦乐')
) AS w(id, tag_name)
JOIN tags t ON t.name = w.tag_name
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. 发行版 (Releases)
-- ---------------------------------------------------------------------------
INSERT INTO releases (id, work_id, publisher_id, edition_name, catalog_number, barcode, publisher, packaging, edition_date, country, language, distribution_channel, catalog_metadata, uploader_id, is_master_verified) VALUES
-- 华语经典发行版
('c001cafe-0000-4000-8000-000000000201', 'c001cafe-0000-4000-8000-000000000101', 'c001cafe-0000-4000-8000-000000000053', '首版 CD (红衣封面)', 'BM-01002', '4719760000119', '阿尔发音乐 / 索尼音乐', 'jewel_case', '2001-09-14', '中国台湾', 'zh-TW', 'retail', '{"format":"CD","bitrate":"16bit/44.1kHz"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000202', 'c001cafe-0000-4000-8000-000000000101', 'c001cafe-0000-4000-8000-000000000051', '20周年纪念 黑胶重制版 180g LP', 'JVR-LP-2020-02', '4710149666023', '杰威尔音乐', 'hardcover', '2020-11-06', '中国台湾', 'zh-TW', 'retail', '{"format":"Vinyl","rpm":33,"weight":"180g"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000203', 'c001cafe-0000-4000-8000-000000000102', 'c001cafe-0000-4000-8000-000000000053', '首发豪华版 CD+VCD', 'BM-03001', '4719760000300', '阿尔发音乐 / 索尼音乐', 'digipak', '2003-07-31', '中国台湾', 'zh-TW', 'retail', '{"format":"CD+VCD"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000204', 'c001cafe-0000-4000-8000-000000000104', 'c001cafe-0000-4000-8000-000000000052', '首版 纸盒装 CD', '9883582', '0602498835821', '新艺宝唱片 / 环球唱片', 'digipak', '2005-06-07', '中国香港', 'zh-HK', 'retail', '{"format":"CD"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000205', 'c001cafe-0000-4000-8000-000000000106', 'c001cafe-0000-4000-8000-000000000054', '台湾首版 CD', '8573887962', '685738879621', '华纳唱片', 'jewel_case', '2001-07-09', '中国台湾', 'zh-TW', 'retail', '{"format":"CD"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000206', 'c001cafe-0000-4000-8000-000000000107', 'c001cafe-0000-4000-8000-000000000052', '首版 24K 纯金碟 典藏版', '5492422', '0724354924228', '百代唱片 (EMI) / 环球唱片', 'jewel_case', '2000-10-20', '中国香港', 'zh-HK', 'retail', '{"format":"Gold CD 24K"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000207', 'c001cafe-0000-4000-8000-000000000109', 'c001cafe-0000-4000-8000-000000000055', '数字单曲 Hi-Res 24bit/96kHz', 'BIN-DIGI-2016-07', '4712755011099', '相信音乐', 'digital', '2016-07-21', '中国台湾', 'zh-TW', 'digital', '{"audio_spec":"Hi-Res FLAC 24bit/96kHz"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000208', 'c001cafe-0000-4000-8000-000000000111', NULL, '首版 独立发行限量 CD (牛皮纸封套)', 'OYS-2010-01', '9787880931234', '独立发行', 'paperback', '2010-11-12', '中国', 'zh-CN', 'retail', '{"packaging":"Craft Paper Digipak"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000209', 'c001cafe-0000-4000-8000-000000000112', NULL, '数字专辑 24bit/96kHz 母带级', 'OYS-2020-02', '9787880935567', '独立发行', 'digital', '2020-12-22', '中国', 'zh-CN', 'digital', '{"audio_spec":"Master Quality FLAC 24/96"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000210', 'c001cafe-0000-4000-8000-000000000114', 'c001cafe-0000-4000-8000-000000000052', '中国旅游声像 首版黑胶 LP', 'WL-001', '7880010019', '中国旅游声像出版社 / 环球唱片', 'hardcover', '1989-02-01', '中国', 'zh-CN', 'retail', '{"format":"Vinyl LP 33 RPM"}', '00000000-0000-0000-0000-000000000001', TRUE),

-- 世界流行与发烧天碟发行版
('c001cafe-0000-4000-8000-000000000211', 'c001cafe-0000-4000-8000-000000000121', 'c001cafe-0000-4000-8000-000000000053', 'Mobile Fidelity Sound Lab 顶级发烧 Ultradisc One-Step 45转黑胶 (限量版)', 'UD1S-2-025', '821797202528', 'Epic / Mobile Fidelity Sound Lab', 'box_set', '2022-11-18', '美国', 'en-US', 'retail', '{"format":"2x Vinyl 45 RPM One-Step","audiophile":true}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000212', 'c001cafe-0000-4000-8000-000000000123', 'c001cafe-0000-4000-8000-000000000052', '50周年纪念 超级豪华限定箱 3CD+1BDMV (Dolby Atmos & 5.1 Surround)', '0602577921124', '602577921124', 'Apple Records / Universal Music', 'box_set', '2019-09-27', '英国', 'en-US', 'retail', '{"format":"3CD + 1Blu-ray Audio","mix":"Dolby Atmos"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000213', 'c001cafe-0000-4000-8000-000000000124', 'c001cafe-0000-4000-8000-000000000054', '50周年纪念 SACD 多声道发烧版', 'PFRLP8', '0190295996901', 'Harvest / Pink Floyd Records', 'digipak', '2023-10-13', '英国', 'en-US', 'retail', '{"format":"Hybrid SACD","channels":"5.1 Surround & Stereo DSD"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000214', 'c001cafe-0000-4000-8000-000000000126', 'c001cafe-0000-4000-8000-000000000052', '30周年纪念版 CD+DVD-Audio 96kHz/24bit', '0602498701089', '602498701089', 'Hollywood Records / Universal Music', 'box_set', '2005-11-21', '英国', 'en-US', 'retail', '{"format":"CD + DVD-Audio"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000215', 'c001cafe-0000-4000-8000-000000000130', 'c001cafe-0000-4000-8000-000000000054', 'DCC Compact Classics 24K 金碟 发烧试音珍藏版', 'GZS-1024', '010963102422', 'Asylum / DCC Compact Classics', 'jewel_case', '1992-05-12', '美国', 'en-US', 'retail', '{"format":"Gold CD 24K","mastering":"Steve Hoffman"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000216', 'c001cafe-0000-4000-8000-000000000131', 'c001cafe-0000-4000-8000-000000000053', '10周年纪念 3LP 180g 重磅黑胶 Boxset (含未公开录音)', '19658773731', '196587737318', 'Columbia / Sony Music', 'box_set', '2023-05-12', '法国', 'en-US', 'retail', '{"format":"3x Vinyl LP 180g"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000217', 'c001cafe-0000-4000-8000-000000000135', 'c001cafe-0000-4000-8000-000000000053', 'Analogue Productions 45转 200g Clarity 双黑胶', 'APJ-8163-45', '753088816375', 'Columbia / Analogue Productions', 'hardcover', '2021-03-26', '美国', 'en-US', 'retail', '{"format":"2x Vinyl 45 RPM 200g Clarity"}', '00000000-0000-0000-0000-000000000001', TRUE),

-- 原声大碟发行版
('c001cafe-0000-4000-8000-000000000218', 'c001cafe-0000-4000-8000-000000000139', 'c001cafe-0000-4000-8000-000000000052', '日本首版 CD (Victor 压片)', 'VICL-724', '4988002324989', 'Victor Entertainment', 'jewel_case', '1995-11-22', '日本', 'ja', 'retail', '{"format":"CD"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000219', 'c001cafe-0000-4000-8000-000000000140', 'c001cafe-0000-4000-8000-000000000057', '星光典藏 2CD 加长发烧限量版 (Illuminated Star Projection Edition)', '39517', '794043180425', 'WaterTower Music', 'box_set', '2014-12-08', '美国', 'en-US', 'retail', '{"format":"2CD Boxset"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000220', 'c001cafe-0000-4000-8000-000000000141', 'c001cafe-0000-4000-8000-000000000052', '德间书店 首版 CD (日版吉卜力官方)', 'TKCA-72165', '4988008611139', '徳間ジャパンコミュニケーションズ', 'jewel_case', '2001-07-18', '日本', 'ja', 'retail', '{"format":"CD"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000221', 'c001cafe-0000-4000-8000-000000000142', 'c001cafe-0000-4000-8000-000000000056', '初回生产限定版 3CD (Digipak 典藏黑匣)', 'SQEX-10589-91', '4988601465380', 'SQUARE ENIX MUSIC', 'box_set', '2017-03-29', '日本', 'ja', 'retail', '{"format":"3CD"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000222', 'c001cafe-0000-4000-8000-000000000143', 'c001cafe-0000-4000-8000-000000000056', '日版 DigiCube 初版 4CD 典藏盒装', 'SSCX-10004', '4920063100041', 'DigiCube / SQUARE ENIX', 'box_set', '1997-02-10', '日本', 'ja', 'retail', '{"format":"4CD Boxset"}', '00000000-0000-0000-0000-000000000001', TRUE),
('c001cafe-0000-4000-8000-000000000223', 'c001cafe-0000-4000-8000-000000000145', NULL, '数字流媒体 Hi-Res 24bit/96kHz 无损母带', 'HYX-2020-004', '9787880949999', 'HOYO-MiX', 'digital', '2020-11-06', '中国', 'zh-CN', 'digital', '{"audio_spec":"Apple Digital Master 24/96"}', '00000000-0000-0000-0000-000000000001', TRUE)
ON CONFLICT (id) DO UPDATE SET
    edition_name = EXCLUDED.edition_name,
    catalog_number = EXCLUDED.catalog_number,
    publisher = EXCLUDED.publisher,
    packaging = EXCLUDED.packaging,
    catalog_metadata = EXCLUDED.catalog_metadata;

-- ---------------------------------------------------------------------------
-- 7. 载体介质 (Mediums)
-- ---------------------------------------------------------------------------
INSERT INTO mediums (id, release_id, position, name, format, media_category, track_count) VALUES
('c001cafe-0000-4000-8000-000000000301', 'c001cafe-0000-4000-8000-000000000201', 1, 'Compact Disc', 'CD', 'music', 10),
('c001cafe-0000-4000-8000-000000000302', 'c001cafe-0000-4000-8000-000000000202', 1, 'Vinyl Side A', 'Vinyl', 'music', 5),
('c001cafe-0000-4000-8000-000000000303', 'c001cafe-0000-4000-8000-000000000202', 2, 'Vinyl Side B', 'Vinyl', 'music', 5),
('c001cafe-0000-4000-8000-000000000304', 'c001cafe-0000-4000-8000-000000000204', 1, 'Disc 1 (Audio CD)', 'CD', 'music', 12),
('c001cafe-0000-4000-8000-000000000305', 'c001cafe-0000-4000-8000-000000000208', 1, '万能青年旅店 CD', 'CD', 'music', 9),
('c001cafe-0000-4000-8000-000000000306', 'c001cafe-0000-4000-8000-000000000209', 1, '冀西南林路行 Hi-Res', 'Digital', 'music', 8),
('c001cafe-0000-4000-8000-000000000307', 'c001cafe-0000-4000-8000-000000000211', 1, 'Disc 1: Thriller Side A (45 RPM)', 'Vinyl', 'music', 4),
('c001cafe-0000-4000-8000-000000000308', 'c001cafe-0000-4000-8000-000000000211', 2, 'Disc 2: Thriller Side B (45 RPM)', 'Vinyl', 'music', 5),
('c001cafe-0000-4000-8000-000000000309', 'c001cafe-0000-4000-8000-000000000212', 1, 'Disc 1: 2019 Stereo Mix', 'CD', 'music', 17),
('c001cafe-0000-4000-8000-000000000310', 'c001cafe-0000-4000-8000-000000000213', 1, 'SACD Surround & Stereo', 'SACD', 'music', 10),
('c001cafe-0000-4000-8000-000000000311', 'c001cafe-0000-4000-8000-000000000215', 1, 'Gold CD 24K Master', 'CD', 'music', 9),
('c001cafe-0000-4000-8000-000000000312', 'c001cafe-0000-4000-8000-000000000218', 1, 'Ghost in the Shell OST CD', 'CD', 'music', 11),
('c001cafe-0000-4000-8000-000000000313', 'c001cafe-0000-4000-8000-000000000219', 1, 'Disc 1: Original Motion Picture Soundtrack', 'CD', 'music', 16),
('c001cafe-0000-4000-8000-000000000314', 'c001cafe-0000-4000-8000-000000000220', 1, '千と千尋の神隠し サントラ CD', 'CD', 'music', 21),
('c001cafe-0000-4000-8000-000000000315', 'c001cafe-0000-4000-8000-000000000221', 1, 'Disc 1: ニーア オートマタ OST', 'CD', 'music', 16),
('c001cafe-0000-4000-8000-000000000316', 'c001cafe-0000-4000-8000-000000000223', 1, '皎月云间之梦 Disc 1 琉璃明月', 'Digital', 'music', 33)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    format = EXCLUDED.format,
    track_count = EXCLUDED.track_count;

-- ---------------------------------------------------------------------------
-- 8. 母版条目与分轨 (Canonical Entries & Tracks)
-- ---------------------------------------------------------------------------
INSERT INTO canonical_entries (id, title, sort_title, duration_seconds, isrc, artist_credit, recording_date, work_id) VALUES
-- 范特西
('c001cafe-0000-4000-8000-000000000401', '爱在西元前', 'Ai Zai Xi Yuan Qian', 234, 'TWA450101001', '周杰伦', '2001', 'c001cafe-0000-4000-8000-000000000101'),
('c001cafe-0000-4000-8000-000000000402', '爸我回来了', 'Ba Wo Hui Lai Le', 248, 'TWA450101002', '周杰伦', '2001', 'c001cafe-0000-4000-8000-000000000101'),
('c001cafe-0000-4000-8000-000000000403', '简单爱', 'Jian Dan Ai', 270, 'TWA450101003', '周杰伦', '2001', 'c001cafe-0000-4000-8000-000000000101'),
('c001cafe-0000-4000-8000-000000000404', '忍者', 'Ren Zhe', 158, 'TWA450101004', '周杰伦', '2001', 'c001cafe-0000-4000-8000-000000000101'),
('c001cafe-0000-4000-8000-000000000405', '开不了口', 'Kai Bu Liao Kou', 284, 'TWA450101005', '周杰伦', '2001', 'c001cafe-0000-4000-8000-000000000101'),
('c001cafe-0000-4000-8000-000000000406', '上海一九四三', 'Shang Hai Yi Jiu Si San', 201, 'TWA450101006', '周杰伦', '2001', 'c001cafe-0000-4000-8000-000000000101'),
('c001cafe-0000-4000-8000-000000000407', '对不起', 'Dui Bu Qi', 225, 'TWA450101007', '周杰伦', '2001', 'c001cafe-0000-4000-8000-000000000101'),
('c001cafe-0000-4000-8000-000000000408', '威廉古堡', 'Wei Lian Gu Bao', 236, 'TWA450101008', '周杰伦', '2001', 'c001cafe-0000-4000-8000-000000000101'),
('c001cafe-0000-4000-8000-000000000409', '双截棍', 'Shuang Jie Gun', 201, 'TWA450101009', '周杰伦', '2001', 'c001cafe-0000-4000-8000-000000000101'),
('c001cafe-0000-4000-8000-000000000410', '安静', 'An Jing', 334, 'TWA450101010', '周杰伦', '2001', 'c001cafe-0000-4000-8000-000000000101'),

-- 万能青年旅店
('c001cafe-0000-4000-8000-000000000411', '杀死那个石家庄人', 'Sha Si Na Ge Shi Jia Zhuang Ren', 345, 'CNA011000123', '万能青年旅店', '2010', 'c001cafe-0000-4000-8000-000000000111'),
('c001cafe-0000-4000-8000-000000000412', '秦皇岛', 'Qin Huang Dao', 516, 'CNA011000124', '万能青年旅店', '2010', 'c001cafe-0000-4000-8000-000000000111'),
('c001cafe-0000-4000-8000-000000000413', '十万嬉皮', 'Shi Wan Xi Pi', 288, 'CNA011000125', '万能青年旅店', '2010', 'c001cafe-0000-4000-8000-000000000111'),

-- Thriller
('c001cafe-0000-4000-8000-000000000421', 'Billie Jean', 'Billie Jean', 294, 'USSM18200001', 'Michael Jackson', '1982', 'c001cafe-0000-4000-8000-000000000121'),
('c001cafe-0000-4000-8000-000000000422', 'Beat It', 'Beat It', 258, 'USSM18200002', 'Michael Jackson', '1982', 'c001cafe-0000-4000-8000-000000000121'),
('c001cafe-0000-4000-8000-000000000423', 'Thriller', 'Thriller', 357, 'USSM18200003', 'Michael Jackson', '1982', 'c001cafe-0000-4000-8000-000000000121'),

-- Hotel California
('c001cafe-0000-4000-8000-000000000431', 'Hotel California', 'Hotel California', 391, 'USPR37600001', 'Eagles', '1976', 'c001cafe-0000-4000-8000-000000000130'),

-- 原声大碟曲目
('c001cafe-0000-4000-8000-000000000441', 'M01 謡I-Making of Cyborg', 'Making of Cyborg', 268, 'JPVI09500001', '川井憲次', '1995', 'c001cafe-0000-4000-8000-000000000139'),
('c001cafe-0000-4000-8000-000000000442', 'M04 謡II-Ghost City', 'Ghost City', 277, 'JPVI09500002', '川井憲次', '1995', 'c001cafe-0000-4000-8000-000000000139'),
('c001cafe-0000-4000-8000-000000000443', 'Cornfield Chase', 'Cornfield Chase', 126, 'USWT11400001', 'Hans Zimmer', '2014', 'c001cafe-0000-4000-8000-000000000140'),
('c001cafe-0000-4000-8000-000000000444', 'No Time for Caution', 'No Time for Caution', 246, 'USWT11400002', 'Hans Zimmer', '2014', 'c001cafe-0000-4000-8000-000000000140'),
('c001cafe-0000-4000-8000-000000000445', 'あの夏へ (One Summer''s Day)', 'One Summer''s Day', 189, 'JPTK00100001', '久石譲', '2001', 'c001cafe-0000-4000-8000-000000000141'),
('c001cafe-0000-4000-8000-000000000446', 'Weight of the World (English Version)', 'Weight of the World', 344, 'JPSQ01700001', '岡部啓一', '2017', 'c001cafe-0000-4000-8000-000000000142'),
('c001cafe-0000-4000-8000-000000000447', '片翼の天使 (One-Winged Angel)', 'One-Winged Angel', 438, 'JPSQ09700001', '植松伸夫', '1997', 'c001cafe-0000-4000-8000-000000000143'),
('c001cafe-0000-4000-8000-000000000448', '璃月 (Liyue)', 'Liyue', 276, 'CNHY02000001', '陈致逸 / HOYO-MiX', '2020', 'c001cafe-0000-4000-8000-000000000145')
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    duration_seconds = EXCLUDED.duration_seconds,
    artist_credit = EXCLUDED.artist_credit;

-- 挂载分轨到 Medium
INSERT INTO tracks (id, medium_id, canonical_entry_id, work_id, position, title, duration_seconds, isrc, artist_credit) VALUES
-- 范特西 CD
('c001cafe-0000-4000-8000-000000000501', 'c001cafe-0000-4000-8000-000000000301', 'c001cafe-0000-4000-8000-000000000401', 'c001cafe-0000-4000-8000-000000000101', 1, '爱在西元前', 234, 'TWA450101001', '周杰伦'),
('c001cafe-0000-4000-8000-000000000502', 'c001cafe-0000-4000-8000-000000000301', 'c001cafe-0000-4000-8000-000000000402', 'c001cafe-0000-4000-8000-000000000101', 2, '爸我回来了', 248, 'TWA450101002', '周杰伦'),
('c001cafe-0000-4000-8000-000000000503', 'c001cafe-0000-4000-8000-000000000301', 'c001cafe-0000-4000-8000-000000000403', 'c001cafe-0000-4000-8000-000000000101', 3, '简单爱', 270, 'TWA450101003', '周杰伦'),
('c001cafe-0000-4000-8000-000000000504', 'c001cafe-0000-4000-8000-000000000301', 'c001cafe-0000-4000-8000-000000000404', 'c001cafe-0000-4000-8000-000000000101', 4, '忍者', 158, 'TWA450101004', '周杰伦'),
('c001cafe-0000-4000-8000-000000000505', 'c001cafe-0000-4000-8000-000000000301', 'c001cafe-0000-4000-8000-000000000405', 'c001cafe-0000-4000-8000-000000000101', 5, '开不了口', 284, 'TWA450101005', '周杰伦'),
('c001cafe-0000-4000-8000-000000000506', 'c001cafe-0000-4000-8000-000000000301', 'c001cafe-0000-4000-8000-000000000406', 'c001cafe-0000-4000-8000-000000000101', 6, '上海一九四三', 201, 'TWA450101006', '周杰伦'),
('c001cafe-0000-4000-8000-000000000507', 'c001cafe-0000-4000-8000-000000000301', 'c001cafe-0000-4000-8000-000000000407', 'c001cafe-0000-4000-8000-000000000101', 7, '对不起', 225, 'TWA450101007', '周杰伦'),
('c001cafe-0000-4000-8000-000000000508', 'c001cafe-0000-4000-8000-000000000301', 'c001cafe-0000-4000-8000-000000000408', 'c001cafe-0000-4000-8000-000000000101', 8, '威廉古堡', 236, 'TWA450101008', '周杰伦'),
('c001cafe-0000-4000-8000-000000000509', 'c001cafe-0000-4000-8000-000000000301', 'c001cafe-0000-4000-8000-000000000409', 'c001cafe-0000-4000-8000-000000000101', 9, '双截棍', 201, 'TWA450101009', '周杰伦'),
('c001cafe-0000-4000-8000-000000000510', 'c001cafe-0000-4000-8000-000000000301', 'c001cafe-0000-4000-8000-000000000410', 'c001cafe-0000-4000-8000-000000000101', 10, '安静', 334, 'TWA450101010', '周杰伦'),

-- 万青首专
('c001cafe-0000-4000-8000-000000000511', 'c001cafe-0000-4000-8000-000000000305', 'c001cafe-0000-4000-8000-000000000411', 'c001cafe-0000-4000-8000-000000000111', 1, '杀死那个石家庄人', 345, 'CNA011000123', '万能青年旅店'),
('c001cafe-0000-4000-8000-000000000512', 'c001cafe-0000-4000-8000-000000000305', 'c001cafe-0000-4000-8000-000000000412', 'c001cafe-0000-4000-8000-000000000111', 2, '秦皇岛', 516, 'CNA011000124', '万能青年旅店'),
('c001cafe-0000-4000-8000-000000000513', 'c001cafe-0000-4000-8000-000000000305', 'c001cafe-0000-4000-8000-000000000413', 'c001cafe-0000-4000-8000-000000000111', 3, '十万嬉皮', 288, 'CNA011000125', '万能青年旅店'),

-- Thriller
('c001cafe-0000-4000-8000-000000000521', 'c001cafe-0000-4000-8000-000000000307', 'c001cafe-0000-4000-8000-000000000423', 'c001cafe-0000-4000-8000-000000000121', 1, 'Thriller', 357, 'USSM18200003', 'Michael Jackson'),
('c001cafe-0000-4000-8000-000000000522', 'c001cafe-0000-4000-8000-000000000308', 'c001cafe-0000-4000-8000-000000000422', 'c001cafe-0000-4000-8000-000000000121', 1, 'Beat It', 258, 'USSM18200002', 'Michael Jackson'),
('c001cafe-0000-4000-8000-000000000523', 'c001cafe-0000-4000-8000-000000000308', 'c001cafe-0000-4000-8000-000000000421', 'c001cafe-0000-4000-8000-000000000121', 2, 'Billie Jean', 294, 'USSM18200001', 'Michael Jackson'),

-- Hotel California
('c001cafe-0000-4000-8000-000000000531', 'c001cafe-0000-4000-8000-000000000311', 'c001cafe-0000-4000-8000-000000000431', 'c001cafe-0000-4000-8000-000000000130', 1, 'Hotel California', 391, 'USPR37600001', 'Eagles'),

-- 原声大碟
('c001cafe-0000-4000-8000-000000000541', 'c001cafe-0000-4000-8000-000000000312', 'c001cafe-0000-4000-8000-000000000441', 'c001cafe-0000-4000-8000-000000000139', 1, 'M01 謡I-Making of Cyborg', 268, 'JPVI09500001', '川井憲次'),
('c001cafe-0000-4000-8000-000000000542', 'c001cafe-0000-4000-8000-000000000312', 'c001cafe-0000-4000-8000-000000000442', 'c001cafe-0000-4000-8000-000000000139', 2, 'M04 謡II-Ghost City', 277, 'JPVI09500002', '川井憲次'),
('c001cafe-0000-4000-8000-000000000543', 'c001cafe-0000-4000-8000-000000000313', 'c001cafe-0000-4000-8000-000000000443', 'c001cafe-0000-4000-8000-000000000140', 1, 'Cornfield Chase', 126, 'USWT11400001', 'Hans Zimmer'),
('c001cafe-0000-4000-8000-000000000544', 'c001cafe-0000-4000-8000-000000000313', 'c001cafe-0000-4000-8000-000000000444', 'c001cafe-0000-4000-8000-000000000140', 2, 'No Time for Caution', 246, 'USWT11400002', 'Hans Zimmer'),
('c001cafe-0000-4000-8000-000000000545', 'c001cafe-0000-4000-8000-000000000314', 'c001cafe-0000-4000-8000-000000000445', 'c001cafe-0000-4000-8000-000000000141', 1, 'あの夏へ (One Summer''s Day)', 189, 'JPTK00100001', '久石譲'),
('c001cafe-0000-4000-8000-000000000546', 'c001cafe-0000-4000-8000-000000000315', 'c001cafe-0000-4000-8000-000000000446', 'c001cafe-0000-4000-8000-000000000142', 1, 'Weight of the World (English Version)', 344, 'JPSQ01700001', '岡部啓一'),
('c001cafe-0000-4000-8000-000000000547', 'c001cafe-0000-4000-8000-000000000316', 'c001cafe-0000-4000-8000-000000000448', 'c001cafe-0000-4000-8000-000000000145', 1, '璃月 (Liyue)', 276, 'CNHY02000001', '陈致逸 / HOYO-MiX')
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    duration_seconds = EXCLUDED.duration_seconds,
    artist_credit = EXCLUDED.artist_credit;

COMMIT;
