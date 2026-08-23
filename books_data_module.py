# -*- coding: utf-8 -*-
"""
MetaFusion Complete Book & Webnovel Catalog Data (55 works) Generator
"""

import json

def sql_str(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"

def sql_arr(items):
    if not items:
        return "'{}'"
    escaped = []
    for item in items:
        clean = str(item).replace('\\', '\\\\').replace('"', '\\"')
        escaped.append(f'"{clean}"')
    return "'{" + ",".join(escaped) + "}'"

def sql_json(d):
    if not d:
        return "'{}'::jsonb"
    return sql_str(json.dumps(d, ensure_ascii=False)) + "::jsonb"

def get_uuid(section, idx):
    return f"bb000000-0000-4000-8000-{section:04d}0000{idx:04d}"

TAGS = [
    ("图书", "format"),
    ("小说", "format"),
    ("网络文学", "format"),
    ("轻小说", "format"),
    ("设定集", "format"),
    ("资料集", "format"),
    ("画集", "format"),
    ("奇幻", "genre"),
    ("科幻", "genre"),
    ("硬科幻", "genre"),
    ("仙侠", "genre"),
    ("修真", "genre"),
    ("悬疑", "genre"),
    ("推理", "genre"),
    ("武侠", "genre"),
    ("历史架空", "genre"),
    ("克苏鲁", "genre"),
    ("蒸汽朋克", "genre"),
    ("赛博朋克", "genre"),
    ("反乌托邦", "genre"),
    ("魔幻现实主义", "genre"),
    ("文学", "genre"),
    ("哲学", "genre"),
    ("心理", "genre"),
    ("恋爱", "genre"),
    ("日常", "genre"),
    ("校园", "genre"),
    ("战争", "genre"),
    ("游戏竞技", "genre"),
    ("异世界", "genre"),
    ("转生", "genre"),
    ("热血", "genre"),
    ("黑暗奇幻", "genre"),
    ("群像", "genre"),
    ("冒险", "genre"),
    ("探险", "genre"),
    ("太空歌剧", "genre"),
    ("末日废土", "genre"),
    ("雨果奖", "theme"),
    ("星云奖", "theme"),
    ("诺贝尔文学奖", "theme"),
    ("名著", "theme"),
    ("阅文集团", "theme"),
    ("起点中文网", "theme"),
    ("电击文库", "theme"),
    ("MF文库J", "theme"),
    ("角川Sneaker文库", "theme"),
    ("讲谈社BOX", "theme"),
    ("三体", "theme"),
    ("刘慈欣", "theme"),
    ("艾尔登法环", "theme"),
    ("赛博朋克2077", "theme"),
    ("魔兽世界", "theme"),
    ("塞尔达传说", "theme"),
    ("黑暗之魂", "theme"),
    ("魂系", "theme")
]

ARTISTS = [
    # 1-15 网文大神
    (1, "爱潜水的乌贼", "袁野", "网络文学白金作家 / 诡秘之主作者", "person", "中国", "阅文集团白金作家，以严密宏大的西幻与克苏鲁设定著称，代表作《诡秘之主》《宿命之环》《一世之尊》。", "1985", {"zh_wiki": "爱潜水的乌贼"}, {"en-US": ("Cuttlefish That Loves Diving", "Platinum web novelist known for Lord of the Mysteries.")}),
    (2, "蝴蝶蓝", "王冬", "网络文学白金作家 / 全职高手作者", "person", "中国", "以幽默群像与电竞网游题材闻名，代表作《全职高手》《独闯天涯》《天醒之路》。", "1983-11-13", {}, {"en-US": ("Butterfly Blue", "Author of The King's Avatar.")}),
    (3, "狐尾的笔", "狐尾的笔", "中式民俗克苏鲁仙侠代表作家", "person", "中国", "以惊艳的中式恐怖民俗与克苏鲁修仙风格风靡全网，代表作《道诡异仙》《诡秘地海》。", "1994", {}, {"en-US": ("Huwei De Bi", "Author of Dao of the Bizarre Immortal.")}),
    (4, "唐家三少", "张威", "网络文学代表人物 / 斗罗大陆作者", "person", "中国", "中国作协主席团委员，代表作《斗罗大陆》系列、《神印王座》《光之子》。", "1981-03-24", {}, {"en-US": ("Tang Jia San Shao", "Author of Soul Land series.")}),
    (5, "猫腻", "张晓舟", "网络文学宗师 / 庆余年作者", "person", "中国", "文风细腻深刻，充满人文关怀与权谋哲思，代表作《庆余年》《间客》《将夜》《择天记》。", "1977-11-18", {}, {"en-US": ("Mao Ni", "Author of Joy of Life and Nightfall.")}),
    (6, "卖报小郎君", "卖报小郎君", "大奉打更人作者 / 仙侠推理作家", "person", "中国", "擅长本格破案与幽默修仙日常，代表作《大奉打更人》《灵境行者》。", "1990", {}, {"en-US": ("Newspaper Boy", "Author of Nightwatcher of Dafeng.")}),
    (7, "忘语", "丁凌涛", "凡人流修仙开山宗师", "person", "中国", "开创网络文学'凡人修仙流'，代表作《凡人修仙传》《凡人修仙之仙界篇》《魔天记》。", "1976-10", {}, {"en-US": ("Wang Yu", "Creator of Mortal Cultivation genre, author of A Record of a Mortal's Journey to Immortality.")}),
    (8, "辰东", "杨振东", "遮天三部曲作者 / 东方玄幻巨匠", "person", "中国", "以恢弘磅礴的远古神话格局与九龙拉棺等宏大意象闻名，代表作《遮天》《完美世界》《圣墟》《神墓》。", "1982", {}, {"en-US": ("Chen Dong", "Master of Eastern Fantasy, author of Shrouding the Heavens and Perfect World.")}),
    (9, "烽火戏诸侯", "陈政", "雪中悍刀行 / 剑来作者", "person", "中国", "文笔卓绝、格局高远，代表作《雪中悍刀行》《剑来》《陈二狗的妖孽人生》。", "1985-11-08", {}, {"en-US": ("Fenghuo Xi Zhuhou", "Author of The Snowy Path of the Heroic Blade and Jian Lai.")}),
    (10, "我吃西红柿", "朱洪志", "吞噬星空 / 盘龙作者", "person", "中国", "网络文学白金作家，擅长爽快宏大的升级换图与宇宙冒险，代表作《星辰变》《盘龙》《吞噬星空》《莽荒纪》。", "1987-05-05", {}, {"en-US": ("I Eat Tomatoes", "Author of Swallowed Star, Coiling Dragon, and Stellar Transformations.")}),
    (11, "耳根", "刘勇", "仙逆 / 求魔 / 一念永恒作者", "person", "中国", "作品极具宿命感与哲学意蕴，代表作《仙逆》《求魔》《我欲封天》《一念永恒》。", "1980", {}, {"en-US": ("Er Gen", "Author of Renegade Immortal and I Shall Seal the Heavens.")}),
    (12, "天蚕土豆", "李虎", "斗破苍穹 / 武动乾坤作者", "person", "中国", "开创少年热血废柴退婚流，代表作《斗破苍穹》《武动乾坤》《大主宰》《元尊》。", "1989-08-01", {}, {"en-US": ("Tian Can Tu Dou", "Author of Battle Through the Heavens.")}),
    (13, "蛊真人", "贾文生", "蛊真人作者 / 暗黑玄幻代表作家", "person", "中国", "以极具理智的枭雄人设与独特的蛊虫修真体系闻名，代表作《蛊真人》《无限血核》。", "1987", {}, {"en-US": ("Gu Zhenren", "Author of Reverend Insanity.")}),
    (14, "宅猪", "徐爽", "牧神记 / 临渊行 / 择日飞升作者", "person", "中国", "文风幽默中饱含家国哲思与变法精神，代表作《牧神记》《临渊行》《择日飞升》《独步天下》。", "1978", {}, {"en-US": ("Zhai Zhu", "Author of Tales of Herding Gods and Lin Yuan Xing.")}),
    (15, "二目", "二目", "放开那个女巫作者 / 攀科技种田流先驱", "person", "中国", "将现代工业工程与奇幻世界融合的领军作家，代表作《放开那个女巫》。", "1986", {}, {"en-US": ("Er Mu", "Author of Release That Witch.")}),

    # 16-30 文学大师与科幻宗师
    (16, "刘慈欣", "Liu Cixin", "中国科幻第一人 / 雨果奖得主", "person", "中国", "首位荣获雨果奖最佳长篇小说的亚洲作家，代表作《三体》三部曲、《流浪地球》《球状闪电》《乡村教师》。", "1963-06-23", {"wikidata": "Q463422"}, {"en-US": ("Liu Cixin", "Asia's first Hugo Award winner for The Three-Body Problem.")}),
    (17, "艾萨克·阿西莫夫", "Isaac Asimov", "科幻三巨头之一 / 基地与机器人系列作者", "person", "美国", "世界著名科普作家与科幻大师，创立机器人三大法则与心理史学，代表作《基地》系列、《银河帝国》系列、《机器人》系列。", "1920-01-02", {"wikidata": "Q34981"}, {"en-US": ("Isaac Asimov", "Grand Master of Sci-Fi, author of Foundation and Robot series.")}),
    (18, "弗兰克·赫伯特", "Frank Herbert", "沙丘之父 / 科幻史诗宗师", "person", "美国", "代表作《沙丘》六部曲，融合生态学、宗教、政治与人类演化，斩获雨果奖与星云奖双奖。", "1920-10-08", {"wikidata": "Q188981"}, {"en-US": ("Frank Herbert", "Author of the landmark sci-fi epic Dune series.")}),
    (19, "加夫列尔·加西亚·马尔克斯", "Gabriel García Márquez", "诺贝尔文学奖得主 / 魔幻现实主义大师", "person", "哥伦比亚", "拉丁美洲魔幻现实主义文学代表人物，1982年诺贝尔文学奖得主，代表作《百年孤独》《霍乱时期的爱情》。", "1927-03-06", {"wikidata": "Q5878"}, {"en-US": ("Gabriel García Márquez", "Nobel laureate and author of One Hundred Years of Solitude.")}),
    (20, "菲利普·K·迪克", "Philip K. Dick", "赛博朋克与科幻哲人 / 银翼杀手原著作者", "person", "美国", "探讨真实与虚幻、人性与机器的科幻先驱，代表作《仿生人会梦见电子羊吗？》《高堡奇人》《少数派报告》。", "1928-12-16", {"wikidata": "Q171091"}, {"en-US": ("Philip K. Dick", "Visionary sci-fi master behind Blade Runner and Ubik.")}),
    (21, "乔治·奥威尔", "George Orwell", "反乌托邦文学大师", "person", "英国", "著名英国作家、政论家，代表作《一九八四》《动物庄园》，深刻揭示极权主义与语言异化。", "1903-06-25", {"wikidata": "Q3335"}, {"en-US": ("George Orwell", "Author of Nineteen Eighty-Four and Animal Farm.")}),
    (22, "道格拉斯·亚当斯", "Douglas Adams", "幽默科幻大师 / 银河系漫游指南作者", "person", "英国", "代表作《银河系漫游指南》系列，以荒诞幽默解构宇宙与存在哲学，'不要恐慌'与'42'享誉全球。", "1952-03-11", {"wikidata": "Q42"}, {"en-US": ("Douglas Adams", "Author of The Hitchhiker's Guide to the Galaxy.")}),
    (23, "丹·西蒙斯", "Dan Simmons", "海伯利安作者 / 雨果奖得主", "person", "美国", "当代跨界文学巨匠，横跨科幻、奇幻、恐怖与历史悬疑，代表作《海伯利安》四部曲、《极地恶灵》。", "1948-04-04", {"wikidata": "Q297538"}, {"en-US": ("Dan Simmons", "Hugo Award-winning author of Hyperion Cantos.")}),
    (24, "阿瑟·C·克拉克", "Arthur C. Clarke", "科幻三巨头之一 / 2001太空漫游作者", "person", "英国", "著名科幻作家、发明家与未来学家，提出地球同步卫星通信理论，代表作《2001太空漫游》《与拉玛相会》《童年的终结》。", "1917-12-16", {"wikidata": "Q32761"}, {"en-US": ("Arthur C. Clarke", "Grand Master of Sci-Fi behind 2001: A Space Odyssey and Rendezvous with Rama.")}),
    (25, "斯坦尼斯瓦夫·莱姆", "Stanisław Lem", "波兰哲学科幻大师 / 索拉里斯星作者", "person", "波兰", "欧洲最具哲思深度的科幻文学宗师，探讨人类认识论局限与地外智慧，代表作《索拉里斯星》《惨败》《无敌号》。", "1921-09-12", {"wikidata": "Q6527"}, {"en-US": ("Stanisław Lem", "Philosophical sci-fi giant, author of Solaris.")}),
    (26, "威廉·吉布森", "William Gibson", "赛博朋克运动教父 / 神经漫游者作者", "person", "美国", "开创'赛博朋克'流派，创造'赛博空间'概念，代表作《神经漫游者》《零伯爵》《蒙娜丽莎过载》。", "1948-03-17", {"wikidata": "Q189870"}, {"en-US": ("William Gibson", "Father of Cyberpunk, author of Neuromancer.")}),
    (27, "厄休拉·勒古恩", "Ursula K. Le Guin", "地海传说 / 黑暗的左手作者", "person", "美国", "享誉全球的文学大师，斩获8次雨果奖与6次星云奖，代表作《黑暗的左手》《地海传说》六部曲、《一无所有》。", "1929-10-21", {"wikidata": "Q181659"}, {"en-US": ("Ursula K. Le Guin", "Celebrated master of speculative fiction, author of The Left Hand of Darkness.")}),
    (28, "赫尔曼·黑塞", "Hermann Hesse", "诺贝尔文学奖得主 / 德语文坛巨擘", "person", "德国", "1946年诺贝尔文学奖得主，探索心灵觉醒与东方哲理，代表作《悉达多》《荒原狼》《玻璃球游戏》《德米安》。", "1877-07-02", {"wikidata": "Q25973"}, {"en-US": ("Hermann Hesse", "Nobel laureate author of Siddhartha and Steppenwolf.")}),
    (29, "弗兰茨·卡夫卡", "Franz Kafka", "西方现代派文学宗师 / 变形记作者", "person", "奥地利", "二十世纪最具影响力的现代主义作家之一，揭示荒诞存在与官僚异化，代表作《变形记》《审判》《城堡》。", "1883-07-03", {"wikidata": "Q905"}, {"en-US": ("Franz Kafka", "Pioneering existential author of The Metamorphosis and The Trial.")}),
    (30, "威廉·萨默塞特·毛姆", "W. Somerset Maugham", "英国现代小说巨匠 / 月亮与六便士作者", "person", "英国", "著名现实主义小说家与剧作家，以敏锐的人性洞察著称，代表作《月亮与六便士》《人性的枷锁》《刀锋》。", "1874-01-25", {"wikidata": "Q134958"}, {"en-US": ("W. Somerset Maugham", "Distinguished English author of The Moon and Sixpence.")}),

    # 31-42 轻小说名家
    (31, "理不尽な孫の手", "理不尽な孫の手", "无职转生作者 / 异世界流转生鼻祖", "person", "日本", "日本网络小说与轻小说作家，代表作《无职转生 ~到了异世界就拿出真本事~》。", "1975", {}, {"en-US": ("Rifujin na Magonote", "Author of Mushoku Tensei: Jobless Reincarnation.")}),
    (32, "丸山黄金", "丸山くがね", "OVERLORD 不死者之王作者", "person", "日本", "日本轻小说作家，以严谨的世界观与反派主角设定风靡全球，代表作《OVERLORD》。", "1970", {}, {"en-US": ("Kugane Maruyama", "Author of OVERLORD series.")}),
    (33, "伏濑", "伏瀬", "关于我转生变成史莱姆这档事作者", "person", "日本", "日本知名轻小说作家，代表作《关于我转生变成史莱姆这档事》。", "1975", {}, {"en-US": ("Fuse", "Author of That Time I Got Reincarnated as a Slime.")}),
    (34, "秋", "秋", "魔王学院的不适任者作者", "person", "日本", "日本网络小说家、轻小说作家，代表作《魔王学院的不适任者》。", "1985", {}, {"en-US": ("Shu", "Author of The Misfit of Demon King Academy.")}),
    (35, "西尾维新", "西尾 維新", "物语系列 / 戏言系列作者", "person", "日本", "日本鬼才作家，以超高产与高密度双关语对话风格闻名，代表作《物语系列》（化物语等）、《戏言系列》、《美少年侦探团》。", "1981", {"wikidata": "Q718376"}, {"en-US": ("Nisio Isin", "Prolific author of the Monogatari series and Zaregoto series.")}),
    (36, "谷川流", "谷川 流", "凉宫春日系列作者 / Sneaker大奖得主", "person", "日本", "日本轻小说作家，开创平成轻小说黄金时代，代表作《凉宫春日的忧郁》系列、《逃离学校》。", "1970-12-19", {"wikidata": "Q462947"}, {"en-US": ("Nagaru Tanigawa", "Author of The Melancholy of Haruhi Suzumiya.")}),
    (37, "支仓冻砂", "支倉 凍砂", "狼与香辛料作者 / 电击小说大奖得主", "person", "日本", "日本知名轻小说作家，擅长经济奇幻与温情旅途刻画，代表作《狼与香辛料》《狼与羊皮纸》《梦沉抹大拉》。", "1982-12-27", {"wikidata": "Q1333158"}, {"en-US": ("Isuna Hasekura", "Author of Spice and Wolf.")}),
    (38, "时雨泽惠一", "時雨沢 恵一", "奇诺之旅作者 / 枪械文化爱好者", "person", "日本", "日本著名轻小说作家，代表作《奇诺之旅》《刀剑神域Alternative GGO》《艾莉森》。", "1972", {"wikidata": "Q1196417"}, {"en-US": ("Keiichi Sigsawa", "Author of Kino's Journey.")}),
    (39, "安里朝都", "安里 アサト", "86-不存在的战区-作者 / 电击大奖得主", "person", "日本", "日本女性轻小说作家，第23届电击小说大奖大奖得主，代表作《86-不存在的战区-》。", "1985", {}, {"en-US": ("Asato Asato", "Author of 86 -EIGHTY-SIX-.")}),
    (40, "Carlo Zen", "カルロ・ゼン", "幼女战记作者 / 硬核战记作家", "person", "日本", "日本小说家，擅长架空历史军事与现代经济学融入战记，代表作《幼女战记》《约生之国》。", "1980", {}, {"en-US": ("Carlo Zen", "Author of The Saga of Tanya the Evil.")}),
    (41, "衣笠彰梧", "衣笠 彰梧", "欢迎来到实力至上主义的教室作者", "person", "日本", "日本游戏剧本家、轻小说作家，擅长心理战与校园智斗，代表作《欢迎来到实力至上主义的教室》《小恶魔缇亚与断罪之六花》。", "1985", {}, {"en-US": ("Shogo Kinugasa", "Author of Classroom of the Elite.")}),
    (42, "日向夏", "日向 夏", "药屋少女的呢喃作者 / 宫廷推理作家", "person", "日本", "日本网络小说家、轻小说作家，代表作《药屋少女的呢喃》。", "1985", {}, {"en-US": ("Natsu Hyuuga", "Author of The Apothecary Diaries.")}),

    # 43-46 官方游戏艺术与设定工作室
    (43, "FromSoftware", "株式会社フロム・ソフトウェア", "黑魂/艾尔登法环制作团队", "studio", "日本", "世界顶级动作角色扮演游戏开发商，魂系游戏开创者，代表作《艾尔登法环》《黑暗之魂》《只狼》《血源诅咒》。", "1986-11-01", {}, {"en-US": ("FromSoftware", "Renowned developer of Elden Ring, Dark Souls, Sekiro, and Bloodborne.")}),
    (44, "CD PROJEKT RED", "CD PROJEKT S.A.", "赛博朋克2077 / 巫师制作方", "studio", "波兰", "波兰知名游戏与世界观开发商，代表作《赛博朋克2077》《巫师3：狂猎》。", "1994-05-01", {}, {"en-US": ("CD PROJEKT RED", "Developers of Cyberpunk 2077 and The Witcher 3.")}),
    (45, "暴雪娱乐", "Blizzard Entertainment", "魔兽世界/暗黑破坏神开发商", "studio", "美国", "世界著名游戏与奇幻宇宙开发商，代表作《魔兽世界》《星际争霸》《暗黑破坏神》《守望先锋》。", "1991-02-08", {}, {"en-US": ("Blizzard Entertainment", "Creators of World of Warcraft, StarCraft, and Diablo.")}),
    (46, "任天堂企划制作本部", "Nintendo EPD", "塞尔达传说制作团队", "studio", "日本", "全球电子游戏巨头任天堂核心开发部门，代表作《塞尔达传说：旷野之息》《超级马力欧：奥德赛》。", "2015-09-16", {}, {"en-US": ("Nintendo EPD", "Creators of The Legend of Zelda: Breath of the Wild.")}),

    # 47-50 出版社与平台
    (47, "阅文集团", "China Literature Limited", "中国网络文学出版与IP孵化巨头", "publisher", "中国", "旗下拥有起点中文网、QQ阅读、创世中文网等，孵化中国海量顶级网络文学IP。", "2015-03", {}, {"en-US": ("China Literature", "Leading online literature and IP platform in China.")}),
    (48, "重庆出版社", "Chongqing Publishing House", "中国知名综合性出版社 / 三体首发出版方", "publisher", "中国", "出版发行刘慈欣《三体》三部曲及大量社科人文优秀图书。", "1950", {}, {"en-US": ("Chongqing Publishing House", "Original publisher of The Three-Body Problem.")}),
    (49, "新经典文化", "Thinkingdom Media Group", "中国民营图书策划与出版龙头", "publisher", "中国", "引进出版马尔克斯《百年孤独》、东野圭吾《白夜行》、黑塞《悉达多》等全球名著。", "2002", {}, {"en-US": ("Thinkingdom Media Group", "Major publisher of world literature classics in China.")}),
    (50, "角川集团", "KADOKAWA CORPORATION", "日本大型综合出版与泛娱乐集团", "publisher", "日本", "旗下拥有电击文库、MF文库J、角川Sneaker文库、Fami通等核心ACG出版品牌。", "1945-11-10", {}, {"en-US": ("KADOKAWA", "Leading Japanese publishing conglomerate behind Dengeki Bunko and MF Bunko J.")})
]
