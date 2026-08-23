# -*- coding: utf-8 -*-
"""
MetaFusion Complete Book & Webnovel Catalog Data (55 works)
"""

import json
from books_data_module import TAGS, ARTISTS

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

# Works structure:
# (idx, title, original_title, aliases, release_date, begin_date, end_date, ended, country, language, original_language, summary, cover_image_url, catalog_metadata, tags, author_artist_idx, translations, releases)
# releases: list of (rel_idx, edition_name, catalog_number, barcode, publisher_artist_idx, publisher_name, packaging, edition_date, country, language, distribution_channel, notes, catalog_metadata, mediums)
# mediums: list of (med_idx, position, name, format, media_category, track_count)

WORKS = [
    # --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    # 1. 网络文学 / 网文经典 (18部)
    # --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    (1, "诡秘之主", "诡秘之主", ["Lord of the Mysteries", "LotM", "克莱恩"], "2018-04-01", "2018-04-01", "2020-05-01", True, "中国", "zh-CN", "zh",
     "爱潜水的乌贼创作的西方玄幻奇幻史诗，完美融合克苏鲁神话、蒸汽朋克风纪与维多利亚时代社会风貌。讲述周明瑞穿越为克莱恩·莫雷蒂，在愚者权柄下探寻非凡与旧日真相。",
     "https://lain.bgm.tv/pic/cover/l/7b/d2/248386_zZf5a.jpg",
     {"chapters": 1432, "words": "446万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "奇幻", "克苏鲁", "蒸汽朋克", "探险", "阅文集团"], 1,
     {"en-US": ("Lord of the Mysteries", "Epic fantasy web novel by Cuttlefish That Loves Diving combining Cthulhu Mythos, Victorian steampunk, and occult mystery."),
      "ja": ("ロード・オブ・ミステリーズ", "愛潜水の烏賊によるヴィクトリア朝風クトゥルフ神話スチームパンク大作ノベル。")},
     [
         (1, "网络连载版（起点中文网首发）", "QD-LOTM-2018", "", 47, "起点中文网 / 阅文集团", "digital", "2018-04-01", "CN", "zh-CN", "digital", "起点中文网官方首发连载版，全8部1432章。", {"volume_count": 8, "status": "completed"}, [(1, 1, "全八部连载章节", "Digital", "novel", 0)]),
         (2, "实体简体典藏版 第一部 小丑篇", "978-7-5594-5123-1", "9787559451231", None, "江苏凤凰文艺出版社", "hardcover", "2020-09-01", "CN", "zh-CN", "retail", "精装典藏版，全彩插画与克莱恩塔罗牌附赠。", {"isbn": "9787559451231", "volume": 1}, [(2, 1, "正文", "Book", "novel", 0)])
     ]),

    (2, "全职高手", "全职高手", ["The King's Avatar", "荣耀", "叶修", "蝴蝶蓝全职"], "2011-02-28", "2011-02-28", "2014-04-28", True, "中国", "zh-CN", "zh",
     "蝴蝶蓝创作的电竞网游小说巅峰之作。讲述被俱乐部驱逐的前职业顶尖高手叶修，在荣耀新开第十区以散人君莫笑重聚伙伴、重返荣耀之巅的燃情故事。",
     "https://lain.bgm.tv/pic/cover/l/7b/d2/248386_zZf5a.jpg",
     {"chapters": 1728, "words": "535万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "游戏竞技", "热血", "群像", "阅文集团"], 2,
     {"en-US": ("The King's Avatar", "Legendary esports web novel by Butterfly Blue following Ye Xiu and the game Glory."),
      "ja": ("マスターオブスキル（全職高手）", "バタフライ・ブルーによる伝説のeスポーツ小説。トッププレイヤー葉修が栄光の頂点を目指す。")},
     [
         (3, "网络连载版（起点中文网首发）", "QD-QZGS-2011", "", 47, "起点中文网 / 阅文集团", "digital", "2011-02-28", "CN", "zh-CN", "digital", "起点连载版全1728章。", {"chapters": 1728}, [(3, 1, "全本连载", "Digital", "novel", 0)]),
         (4, "实体精装典藏版 第一卷", "978-7-5500-1845-7", "9787550018457", None, "百花洲文艺出版社", "paperback", "2016-07-01", "CN", "zh-CN", "retail", "全职高手实体单行本第1卷，收录千机伞与第十区风云。", {"isbn": "9787550018457", "volume": 1}, [(4, 1, "正文", "Book", "novel", 0)])
     ]),

    (3, "道诡异仙", "道诡异仙", ["Dao of the Bizarre Immortal", "李火旺", "坐忘道", "狐尾的笔"], "2021-12-16", "2021-12-16", "2023-05-09", True, "中国", "zh-CN", "zh",
     "狐尾的笔创作的中式民俗克苏鲁修仙现象级巨作。主角李火旺在现代精神病院与充满扭曲邪祟的诡异修仙世界之间分不清虚实，'妈，我真的分不清啊！'。",
     "https://lain.bgm.tv/pic/cover/l/55/54/216584_yS5k1.jpg",
     {"chapters": 1024, "words": "208万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "仙侠", "克苏鲁", "悬疑", "惊悚", "黑暗奇幻", "阅文集团"], 3,
     {"en-US": ("Dao of the Bizarre Immortal", "Groundbreaking Chinese horror folklore and Cthulhu cultivation web novel by Huwei De Bi."),
      "ja": ("道詭異仙", "東洋民俗ホラーとクトゥルフ神話を融合させた奇跡の仙侠サイコホラー巨編。")},
     [
         (5, "网络连载版（起点中文网首发）", "QD-DGYX-2021", "", 47, "起点中文网 / 阅文集团", "digital", "2021-12-16", "CN", "zh-CN", "digital", "连载版，全1024章正文加番外。", {"chapters": 1024}, [(5, 1, "正文连载", "Digital", "novel", 0)]),
         (6, "实体出版典藏版 第1卷", "978-7-5404-9889-4", "9787540498894", None, "湖南文艺出版社", "paperback", "2023-11-01", "CN", "zh-CN", "retail", "收录第一卷完整内容与精美民俗插画。", {"isbn": "9787540498894", "volume": 1}, [(6, 1, "正文", "Book", "novel", 0)])
     ]),

    (4, "斗罗大陆", "斗罗大陆", ["Soul Land", "Douluo Dalu", "唐三", "唐门"], "2008-12-14", "2008-12-14", "2009-12-13", True, "中国", "zh-CN", "zh",
     "唐家三少最具代表性的玄幻巨作。唐门外门弟子唐三穿越到武魂世界斗罗大陆，重铸唐门辉煌，觉醒双生武魂蓝银草与昊天锤，成就海神与修罗神。",
     "https://lain.bgm.tv/pic/cover/l/6a/a2/371981_0hC62.jpg",
     {"chapters": 336, "words": "298万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "玄幻", "异世界", "热血", "穿越"], 4,
     {"en-US": ("Soul Land", "Iconic Chinese fantasy novel by Tang Jia San Shao featuring Tang San and the world of martial spirits."),
      "ja": ("闘羅大陸", "唐家三少による超人気異世界ファンタジー。武魂の覚醒と唐門の再興を描く。")},
     [
         (7, "网络连载版（起点中文网首发）", "QD-DLDL-2008", "", 47, "起点中文网", "digital", "2008-12-14", "CN", "zh-CN", "digital", "起点连载原版。", {"chapters": 336}, [(7, 1, "网络连载全文", "Digital", "novel", 0)]),
         (8, "实体单行本 第1册", "978-7-5358-4235-0", "9787535842350", None, "湖南少年儿童出版社", "paperback", "2009-05-01", "CN", "zh-CN", "retail", "斗罗大陆实体初版第1册。", {"isbn": "9787535842350", "volume": 1}, [(8, 1, "正文", "Book", "novel", 0)])
     ]),

    (5, "庆余年", "庆余年", ["Joy of Life", "范闲", "庆帝", "陈萍萍"], "2007-05-25", "2007-05-25", "2009-02-28", True, "中国", "zh-CN", "zh",
     "猫腻创作的权谋与历史架空经典。讲述身世神秘的少年范闲，自海边小城初出茅庐，历经家族、江湖、庙堂的重重考验与博弈，探寻文明演化与历史真相。",
     "https://lain.bgm.tv/pic/cover/l/c5/4b/304417_F5j6m.jpg",
     {"chapters": 778, "words": "377万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "权谋", "历史架空", "穿越", "科幻", "阅文集团"], 5,
     {"en-US": ("Joy of Life", "Critically acclaimed historical political and mystery novel by Mao Ni following Fan Xian."),
      "ja": ("慶余年", "猫膩による歴史権謀ファンタジーの最高傑作。主人公・范閑の知略と運命の旅路程を描く。")},
     [
         (9, "网络连载版（起点中文网首发）", "QD-QYN-2007", "", 47, "起点中文网 / 阅文集团", "digital", "2007-05-25", "CN", "zh-CN", "digital", "起点连载完整版全七卷。", {"volumes": 7}, [(9, 1, "连载全文", "Digital", "novel", 0)]),
         (10, "典藏精装版 第一卷 远来是客", "978-7-02-015881-2", "9787020158812", None, "人民文学出版社", "hardcover", "2020-01-01", "CN", "zh-CN", "retail", "人民文学出版社精装典藏版。", {"isbn": "9787020158812", "volume": 1}, [(10, 1, "正文", "Book", "novel", 0)])
     ]),

    (6, "大奉打更人", "大奉打更人", ["Nightwatcher of Dafeng", "许七安", "打更人", "卖报小郎君"], "2020-05-18", "2020-05-18", "2021-08-11", True, "中国", "zh-CN", "zh",
     "卖报小郎君创作的探案仙侠爆款小说。警校毕业的许七安穿越大奉王朝，从税银案起步加入打更人衙门，以现代刑侦技术与武道修道结合破尽天下迷局。",
     "https://lain.bgm.tv/pic/cover/l/d0/bb/294246_4kIq0.jpg",
     {"chapters": 809, "words": "380万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "仙侠", "推理", "悬疑", "历史架空", "穿越", "阅文集团"], 6,
     {"en-US": ("Nightwatcher of Dafeng", "Smash-hit mystery and xianxia cultivation web novel by Newspaper Boy."),
      "ja": ("大奉の夜回り（大奉打更人）", "本格推理と仙侠ファンタジーが融合した大ヒットウェブノベル。")},
     [
         (11, "网络连载版（起点中文网首发）", "QD-DFDGR-2020", "", 47, "起点中文网 / 阅文集团", "digital", "2020-05-18", "CN", "zh-CN", "digital", "起点连载版。", {"chapters": 809}, [(11, 1, "正文", "Digital", "novel", 0)]),
         (12, "实体图书 第1册", "978-7-5596-5388-8", "9787559653888", None, "北京联合出版公司", "paperback", "2021-12-01", "CN", "zh-CN", "retail", "实体单行本第1卷，收录税银奇案与桑泊大案。", {"isbn": "9787559653888", "volume": 1}, [(12, 1, "正文", "Book", "novel", 0)])
     ]),

    (7, "凡人修仙传", "凡人修仙传", ["A Record of a Mortal's Journey to Immortality", "韩立", "韩跑跑", "忘语"], "2008-02-20", "2008-02-20", "2013-09-23", True, "中国", "zh-CN", "zh",
     "忘语开创'凡人流'修仙流派的经典巨作。一个普通的山村穷小子韩立，依靠偶然得到的神秘小绿瓶与谨小慎微、杀伐果决的心性，在残酷修仙界一步步飞升仙界。",
     "https://lain.bgm.tv/pic/cover/l/7f/f3/328114_Y73q7.jpg",
     {"chapters": 2451, "words": "771万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "修真", "仙侠", "冒险", "阅文集团"], 7,
     {"en-US": ("A Record of a Mortal's Journey to Immortality", "The quintessential mortal cultivation epic by Wang Yu detailing Han Li's arduous rise to godhood."),
      "ja": ("凡人修仙伝", "凡人流の創始作。平凡な少年・韓立が過酷な修仙界を生き抜く傑作長編。")},
     [
         (13, "网络连载版（起点中文网首发）", "QD-FRXXZ-2008", "", 47, "起点中文网 / 阅文集团", "digital", "2008-02-20", "CN", "zh-CN", "digital", "起点连载人界篇与灵界篇全本。", {"chapters": 2451}, [(13, 1, "人界与灵界篇", "Digital", "novel", 0)]),
         (14, "实体单行本 第一卷 七玄风云", "978-7-5404-4530-0", "9787540445300", None, "湖南文艺出版社", "paperback", "2010-04-01", "CN", "zh-CN", "retail", "韩立拜入七玄门与结识墨大夫篇章。", {"isbn": "9787540445300", "volume": 1}, [(14, 1, "正文", "Book", "novel", 0)])
     ]),

    (8, "遮天", "遮天", ["Shrouding the Heavens", "叶凡", "九龙拉棺", "辰东"], "2010-10-14", "2010-10-14", "2013-05-21", True, "中国", "zh-CN", "zh",
     "辰东创作的东方玄幻宏伟史诗。'冰冷与黑暗并存的宇宙深处，九具庞大的龙尸拉着一口青铜古棺，亘古长行。'叶凡以此登临北斗星域，踏上荒古圣体逆天征程。",
     "https://lain.bgm.tv/pic/cover/l/b8/67/237583_zK0Zq.jpg",
     {"chapters": 1822, "words": "632万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "玄幻", "神话", "热血", "群像", "阅文集团"], 8,
     {"en-US": ("Shrouding the Heavens", "Grand Eastern fantasy epic by Chen Dong starting with nine dragon corpses pulling a bronze coffin across the cosmos."),
      "ja": ("遮天", "九龍棺桶から始まる壮大な宇宙ファンタジー。辰東による代表作。")},
     [
         (15, "网络连载版（起点中文网首发）", "QD-ZT-2010", "", 47, "起点中文网 / 阅文集团", "digital", "2010-10-14", "CN", "zh-CN", "digital", "连载版全本。", {"chapters": 1822}, [(15, 1, "全书章节", "Digital", "novel", 0)]),
         (16, "实体典藏版 第1册 九龙拉棺", "978-7-5492-0690-2", "9787549206902", None, "长江出版社", "paperback", "2011-06-01", "CN", "zh-CN", "retail", "泰山之巅九龙拉棺初遇篇章。", {"isbn": "9787549206902", "volume": 1}, [(16, 1, "正文", "Book", "novel", 0)])
     ]),

    (9, "完美世界", "完美世界", ["Perfect World", "石昊", "荒天帝", "辰东完美世界"], "2013-08-16", "2013-08-16", "2016-08-04", True, "中国", "zh-CN", "zh",
     "辰东遮天三部曲前传。一粒尘可填海，一根草斩尽日月星辰。讲述大荒少年石昊自幼被挖至尊骨，于绝境中涅槃重生，独断万古成就荒天帝的悲壮史诗。",
     "https://lain.bgm.tv/pic/cover/l/d4/06/141444_m0M7z.jpg",
     {"chapters": 2014, "words": "658万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "玄幻", "神话", "热血", "阅文集团"], 8,
     {"en-US": ("Perfect World", "Prequel to Shrouding the Heavens by Chen Dong following Shi Hao's ascent to become the Huang Emperor."),
      "ja": ("パーフェクトワールド（完美世界）", "辰東による東洋神話ファンタジー大作。")},
     [
         (17, "网络连载版（起点中文网首发）", "QD-WMSJ-2013", "", 47, "起点中文网 / 阅文集团", "digital", "2013-08-16", "CN", "zh-CN", "digital", "起点首发连载版。", {"chapters": 2014}, [(17, 1, "正文连载", "Digital", "novel", 0)]),
         (18, "实体图书 第1册", "978-7-5502-2309-7", "9787550223097", None, "京华出版社", "paperback", "2014-01-01", "CN", "zh-CN", "retail", "石村幼童石昊成长初卷。", {"isbn": "9787550223097", "volume": 1}, [(18, 1, "正文", "Book", "novel", 0)])
     ]),

    (10, "雪中悍刀行", "雪中悍刀行", ["The Snowy Path of the Heroic Blade", "徐凤年", "北椋", "烽火戏诸侯"], "2012-04-10", "2012-04-10", "2016-08-07", True, "中国", "zh-CN", "zh",
     "烽火戏诸侯创作的武侠仙侠集大成之作。北椋世子徐凤年千里历练，劣马黄酒六千里，入江湖提凉刀，抗北莽护中原，书写江湖儿女与庙堂气运的浩瀚长卷。",
     "https://lain.bgm.tv/pic/cover/l/21/df/4774_XpC1c.jpg",
     {"chapters": 1002, "words": "461万", "platform": "纵横中文网"},
     ["图书", "小说", "网络文学", "仙侠", "权谋", "群像", "历史架空"], 9,
     {"en-US": ("The Snowy Path of the Heroic Blade", "Masterpiece wuxia and epic fantasy web novel by Fenghuo Xi Zhuhou following Xu Fengnian."),
      "ja": ("雪中悍刀行", "武侠と権謀術数が織りなす大河ファンタジー巨編。")},
     [
         (19, "网络连载版（纵横中文网首发）", "ZH-XZHDX-2012", "", None, "纵横中文网", "digital", "2012-04-10", "CN", "zh-CN", "digital", "纵横首发网络版。", {"chapters": 1002}, [(19, 1, "连载全文", "Digital", "novel", 0)]),
         (20, "实体典藏版 第一卷", "978-7-5404-5939-0", "9787540459390", None, "湖南文艺出版社", "paperback", "2013-05-01", "CN", "zh-CN", "retail", "老黄与世子游历江湖篇章。", {"isbn": "9787540459390", "volume": 1}, [(20, 1, "正文", "Book", "novel", 0)])
     ]),

    (11, "剑来", "剑来", ["Sword Dynasty", "陈平安", "落魄山", "文圣一脉"], "2017-06-01", "2017-06-01", "", False, "中国", "zh-CN", "zh",
     "烽火戏诸侯倾力创作的仙侠巨著。骊珠洞天少年陈平安自泥瓶巷走出，背负长剑走遍浩然天下与蛮荒天下，以规矩与善意砥砺剑心，'大千世界，无奇不有，我陈平安唯有一剑，可搬山，倒海，降妖，镇魔，敕神，摘星，断江，摧城，开天！'。",
     "https://lain.bgm.tv/pic/cover/l/b8/0a/55122_Ggw9Q.jpg",
     {"words": "1100万+", "platform": "纵横中文网", "status": "ongoing"},
     ["图书", "小说", "网络文学", "仙侠", "哲学", "群像"], 9,
     {"en-US": ("Sword Coming (Jian Lai)", "Monumental philosophical xianxia novel by Fenghuo Xi Zhuhou chronicling Chen Ping'an's journey through multiple realms."),
      "ja": ("剣来", "泥の路地から始まる少年・陳平安の果てなき求道譚。")},
     [
         (21, "网络连载版（纵横中文网连载中）", "ZH-JIANLAI-2017", "", None, "纵横中文网", "digital", "2017-06-01", "CN", "zh-CN", "digital", "纵横中文网连载版，突破1100万字。", {"ongoing": True}, [(21, 1, "连载章节", "Digital", "novel", 0)]),
         (22, "实体图书 第1辑 陇上泥瓶", "978-7-5354-9985-1", "9787535499851", None, "长江文艺出版社", "paperback", "2018-03-01", "CN", "zh-CN", "retail", "骊珠洞天风云篇章。", {"isbn": "9787535499851", "volume": 1}, [(22, 1, "正文", "Book", "novel", 0)])
     ]),

    (12, "吞噬星空", "吞噬星空", ["Swallowed Star", "罗峰", "金角巨兽", "我吃西红柿"], "2010-07-21", "2010-07-21", "2012-03-12", True, "中国", "zh-CN", "zh",
     "我吃西红柿创作的未来科幻与东方玄幻融合代表作。大灾变后地球基因变异，少年罗峰从江南基地市武者起步，夺舍金角巨兽，走出银河系横扫原始宇宙与宇宙海。",
     "https://lain.bgm.tv/pic/cover/l/8e/3c/69877_jp.jpg",
     {"chapters": 1485, "words": "477万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "科幻", "太空歌剧", "玄幻", "热血", "阅文集团"], 10,
     {"en-US": ("Swallowed Star", "Blockbuster sci-fi cultivation novel by I Eat Tomatoes featuring Luo Feng exploring cosmic civilizations."),
      "ja": ("呑噬星空", "地球の荒廃から大宇宙の頂点へと駆け上がるSFバトルノベル。")},
     [
         (23, "网络连载版（起点中文网首发）", "QD-TSXK-2010", "", 47, "起点中文网 / 阅文集团", "digital", "2010-07-21", "CN", "zh-CN", "digital", "起点连载全本。", {"chapters": 1485}, [(23, 1, "正文", "Digital", "novel", 0)]),
         (24, "实体图书 第1册", "978-7-5387-3475-1", "9787538734751", None, "时代文艺出版社", "paperback", "2011-04-01", "CN", "zh-CN", "retail", "地球武者篇章。", {"isbn": "9787538734751", "volume": 1}, [(24, 1, "正文", "Book", "novel", 0)])
     ]),

    (13, "宿命之环", "宿命之环", ["Circle of Inevitability", "CoI", "卢米安", "诡秘之主2"], "2023-03-04", "2023-03-04", "", False, "中国", "zh-CN", "zh",
     "爱潜水的乌贼创作的《诡秘之主》正统续作。以因蒂斯共和国为舞台，少年卢米安·李在科尔杜村的灾异中挣扎求生，探索外神与宿命途径的惊悚隐秘。",
     "https://lain.bgm.tv/pic/cover/l/0a/6f/214265_5rZrn.jpg",
     {"platform": "起点中文网", "status": "ongoing"},
     ["图书", "小说", "网络文学", "奇幻", "克苏鲁", "蒸汽朋克", "阅文集团"], 1,
     {"en-US": ("Circle of Inevitability", "Official sequel to Lord of the Mysteries by Cuttlefish That Loves Diving following Lumian Lee in Intis."),
      "ja": ("宿命の環（詭秘之主 第二部）", "愛潜水の烏賊による『ロード・オブ・ミステリーズ』正統続編。")},
     [
         (25, "网络连载版（起点中文网首发）", "QD-COI-2023", "", 47, "起点中文网 / 阅文集团", "digital", "2023-03-04", "CN", "zh-CN", "digital", "起点中文网官方首发连载版。", {"ongoing": True}, [(25, 1, "正文连载", "Digital", "novel", 0)])
     ]),

    (14, "仙逆", "仙逆", ["Renegade Immortal", "王林", "顺为凡逆则仙", "耳根"], "2009-06-08", "2009-06-08", "2012-01-09", True, "中国", "zh-CN", "zh",
     "耳根经典修真代表作。'顺为凡，逆则仙，只在中间颠倒颠。'资质平庸的王林因天逆珠踏入修真界，杀伐果断斩尽强敌，感悟生死轮回因果三极境，执着复活亡妻李慕婉。",
     "https://lain.bgm.tv/pic/cover/l/49/95/122091_j5w1q.jpg",
     {"chapters": 2088, "words": "651万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "修真", "仙侠", "哲学", "阅文集团"], 11,
     {"en-US": ("Renegade Immortal", "Definitive grim xianxia masterpiece by Er Gen following Wang Lin's ruthless yet tragic path of defiance."),
      "ja": ("仙逆", "耳根による本格修仙ノベルの最高峰。凡人・王林の不屈の逆境譚。")},
     [
         (26, "网络连载版（起点中文网首发）", "QD-XIANNI-2009", "", 47, "起点中文网 / 阅文集团", "digital", "2009-06-08", "CN", "zh-CN", "digital", "起点连载版全本。", {"chapters": 2088}, [(26, 1, "全书正文", "Digital", "novel", 0)]),
         (27, "实体单行本 第1册", "978-7-80755-901-6", "9787807559016", None, "花山文艺出版社", "paperback", "2010-09-01", "CN", "zh-CN", "retail", "恒岳派修炼初卷。", {"isbn": "9787807559016", "volume": 1}, [(27, 1, "正文", "Book", "novel", 0)])
     ]),

    (15, "斗破苍穹", "斗破苍穹", ["Battle Through the Heavens", "萧炎", "莫欺少年穷", "天蚕土豆"], "2009-04-14", "2009-04-14", "2011-07-20", True, "中国", "zh-CN", "zh",
     "天蚕土豆开创网络文学玄幻黄金时代的现象级力作。'三十年河东，三十年河西，莫欺少年穷！'天才沦为废柴的萧炎在药老指引下修炼焚决、吞噬异火，踏破苍穹成就炎帝。",
     "https://lain.bgm.tv/pic/cover/l/5b/c2/2_U1555.jpg",
     {"chapters": 1648, "words": "532万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "玄幻", "热血", "重生", "阅文集团"], 12,
     {"en-US": ("Battle Through the Heavens", "Phenomenal fantasy web novel by Tian Can Tu Dou following Xiao Yan collecting heavenly flames to become the Flame Di."),
      "ja": ("バトルスルーザヘブン（闘破蒼穹）", "天蚕土豆による熱血ファンタジーの金字塔。")},
     [
         (28, "网络连载版（起点中文网首发）", "QD-DPCQ-2009", "", 47, "起点中文网 / 阅文集团", "digital", "2009-04-14", "CN", "zh-CN", "digital", "起点连载全本。", {"chapters": 1648}, [(28, 1, "全书正文", "Digital", "novel", 0)]),
         (29, "实体单行本 第一册 废柴少年", "978-7-5358-4560-3", "9787535845603", None, "湖南少年儿童出版社", "paperback", "2009-10-01", "CN", "zh-CN", "retail", "三年之约启程卷。", {"isbn": "9787535845603", "volume": 1}, [(29, 1, "正文", "Book", "novel", 0)])
     ]),

    (16, "蛊真人", "蛊真人", ["Reverend Insanity", "古月方源", "春秋蝉", "大爱仙尊"], "2012-12-15", "2012-12-15", "2019-05-01", True, "中国", "zh-CN", "zh",
     "蛊真人创作的独具一格暗黑神作。古月方源携春秋蝉重生五百年前，以极度理智冷静的枭雄心性追寻永生大道。天地万物皆为蛊，构建出极其宏伟严密的五域九天蛊师体系。",
     "https://lain.bgm.tv/pic/cover/l/f1/b7/111855_0z7bE.jpg",
     {"chapters": 2334, "words": "734万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "修真", "仙侠", "黑暗奇幻", "哲学"], 13,
     {"en-US": ("Reverend Insanity", "Dark, Machiavellian cultivation cult-classic by Gu Zhenren centered on Gu Yue Fang Yuan and his relentless pursuit of eternal life."),
      "ja": ("蠱真人", "冷徹なる合理主義者・古月方源が永生を求めるダーク修仙ノベルの最高傑作。")},
     [
         (30, "网络连载版（起点中文网首发）", "QD-GZR-2012", "", 47, "起点中文网", "digital", "2012-12-15", "CN", "zh-CN", "digital", "网络连载完整版全2334章。", {"chapters": 2334}, [(30, 1, "全书正文", "Digital", "novel", 0)])
     ]),

    (17, "牧神记", "牧神记", ["Tales of Herding Gods", "秦牧", "残老村", "神魔皆道"], "2017-06-06", "2017-06-06", "2019-09-02", True, "中国", "zh-CN", "zh",
     "宅猪创作的哲学思辨宏大玄幻巨著。大墟残老村收养的少年秦牧，走出大墟革新变法，'天圣教立心，延康国变法，民生为本，神为人用'，重塑诸神与凡人秩序。",
     "https://lain.bgm.tv/pic/cover/l/15/22/3351_e3Llb.jpg",
     {"chapters": 1827, "words": "588万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "玄幻", "神话", "哲学", "群像", "阅文集团"], 14,
     {"en-US": ("Tales of Herding Gods", "Epic philosophical fantasy novel by Zhai Zhu following Qin Mu pioneering reform between gods and mortals."),
      "ja": ("牧神記", "大墟の村で育てられた少年・秦牧が神々と人の世界を変革する壮大な叙事詩。")},
     [
         (31, "网络连载版（起点中文网首发）", "QD-MSJ-2017", "", 47, "起点中文网 / 阅文集团", "digital", "2017-06-06", "CN", "zh-CN", "digital", "起点连载版。", {"chapters": 1827}, [(31, 1, "全本正文", "Digital", "novel", 0)]),
         (32, "实体图书 第一卷 残老村出大墟", "978-7-5596-1890-0", "9787559618900", None, "北京联合出版公司", "paperback", "2018-05-01", "CN", "zh-CN", "retail", "残老村九老授艺初卷。", {"isbn": "9787559618900", "volume": 1}, [(32, 1, "正文", "Book", "novel", 0)])
     ]),

    (18, "放开那个女巫", "放开那个女巫", ["Release That Witch", "罗兰·温布顿", "女巫种田", "二目"], "2016-03-04", "2016-03-04", "2018-09-02", True, "中国", "zh-CN", "zh",
     "二目开创的中世纪工业魔法种田流代表作。机械工程师程岩穿越为边陲镇王子罗兰，以近代科学知识与女巫超自然能力深度融合，发起中世纪第一次工业革命抵抗魔潮。",
     "https://lain.bgm.tv/pic/cover/l/0d/18/2591_O54eE.jpg",
     {"chapters": 1498, "words": "336万", "platform": "起点中文网"},
     ["图书", "小说", "网络文学", "奇幻", "异世界", "蒸汽朋克", "穿越", "阅文集团"], 15,
     {"en-US": ("Release That Witch", "Groundbreaking industrial technology meets magic kingdom-building web novel by Er Mu."),
      "ja": ("魔女解放（放開那個女巫）", "近代工学知識と魔女の能力を融合させた中世産業革命ファンタジー。")},
     [
         (33, "网络连载版（起点中文网首发）", "QD-FKNW-2016", "", 47, "起点中文网 / 阅文集团", "digital", "2016-03-04", "CN", "zh-CN", "digital", "起点连载全本。", {"chapters": 1498}, [(33, 1, "正文", "Digital", "novel", 0)]),
         (34, "实体单行本 第1册", "978-7-5594-0899-0", "9787559408990", None, "江苏凤凰文艺出版社", "paperback", "2017-08-01", "CN", "zh-CN", "retail", "边陲小镇初兴篇章。", {"isbn": "9787559408990", "volume": 1}, [(34, 1, "正文", "Book", "novel", 0)])
     ]),

    # --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    # 2. 经典文学与科幻名著 (18部)
    # --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    (19, "三体", "三体", ["The Three-Body Problem", "地球往事", "死神永生", "黑暗森林", "刘慈欣三体"], "2006-05-01", "2006-05-01", "2010-11-01", True, "中国", "zh-CN", "zh",
     "刘慈欣创作的里程碑式硬科幻史诗《地球往事》三部曲（《三体》《黑暗森林》《死神永生》）。第73届雨果奖最佳长篇小说得主。以红岸基地向宇宙发出的信号展开人类与三体文明跨越数百年的生死存亡与宇宙社会学终极博弈。",
     "https://lain.bgm.tv/pic/cover/l/3d/8c/225381_3Uu11.jpg",
     {"volumes": 3, "award": "雨果奖最佳长篇小说 (2015)"},
     ["图书", "小说", "科幻", "硬科幻", "太空歌剧", "三体", "雨果奖", "哲学"], 16,
     {"en-US": ("The Three-Body Problem", "Groundbreaking Hugo Award-winning hard sci-fi trilogy by Liu Cixin exploring the cosmic clash between Earth and the Trisolaran civilization."),
      "ja": ("三体", "劉慈欣による世界的大ヒットSF三部作（第73回ヒューゴー賞受賞作）。地球文明と三体星人の興亡を描く。")},
     [
         (35, "中文首版三部曲套装（重庆出版社）", "978-7-229-04205-0", "9787229042050", 48, "重庆出版社", "box_set", "2012-01-01", "CN", "zh-CN", "retail", "包含《三体》《三体Ⅱ·黑暗森林》《三体Ⅲ·死神永生》三卷全套。", {"volumes": 3, "isbn": "9787229042050"}, [(35, 1, "第1卷 地球往事", "Book", "novel", 0), (36, 2, "第2卷 黑暗森林", "Book", "novel", 0), (37, 3, "第3卷 死神永生", "Book", "novel", 0)]),
         (38, "英文版精装初版 (Tor Books)", "978-0-7653-7706-7", "9780765377067", None, "Tor Books", "hardcover", "2014-11-11", "US", "en-US", "retail", "Ken Liu 译本，荣获第73届雨果奖最佳长篇小说奖。", {"translator": "Ken Liu", "isbn": "9780765377067"}, [(38, 1, "Volume 1: The Three-Body Problem", "Book", "novel", 0)])
     ]),

    (20, "球状闪电", "球状闪电", ["Ball Lightning", "林云", "陈博士", "量子幽灵"], "2004-06-01", "2004-06-01", "2004-06-01", True, "中国", "zh-CN", "zh",
     "刘慈欣极其富有诗意与想象力的硬科幻代表作。讲述研究球状闪电的陈博士与武器专家林云，在探寻大自然未解之谜的过程中揭开宏原子与量子态世界的神秘面纱，为《三体》世界观奠定基石。",
     "https://lain.bgm.tv/pic/cover/l/a0/02/14197_d94N9.jpg",
     {"words": "22万", "label": "中国科幻基石丛书"},
     ["图书", "小说", "科幻", "硬科幻", "三体", "刘慈欣"], 16,
     {"en-US": ("Ball Lightning", "Poetic hard sci-fi novel by Liu Cixin delving into the mysteries of ball lightning and macro-atoms."),
      "ja": ("球状閃電", "劉慈欣が描く硬質でリリカルな本格SF長編。マクロ原子物理の謎に迫る。")},
     [
         (39, "中文单行本初版（四川科学技术出版社）", "978-7-5364-5507-8", "9787536455078", None, "四川科学技术出版社", "paperback", "2004-06-01", "CN", "zh-CN", "retail", "《科幻世界》中国科幻基石丛书初版。", {"isbn": "9787536455078"}, [(39, 1, "正文", "Book", "novel", 0)]),
         (40, "英文版 (Tor Books)", "978-1-250-19266-0", "9781250192660", None, "Tor Books", "hardcover", "2018-08-14", "US", "en-US", "retail", "Joel Martinsen 翻译英译版。", {"isbn": "9781250192660"}, [(40, 1, "Full Novel", "Book", "novel", 0)])
     ]),

    (21, "流浪地球", "流浪地球", ["The Wandering Earth", "太阳氦闪", "流浪地球中短篇集"], "2000-07-01", "2000-07-01", "2000-07-01", True, "中国", "zh-CN", "zh",
     "刘慈欣获第12届中国科幻银河奖特等奖的中篇硬科幻名著。太阳即将发生氦闪爆发毁灭太阳系，人类倾尽全球之力给地球装上万座行星发动机，开启长达两千五百年的逃逸与流浪之旅。",
     "https://lain.bgm.tv/pic/cover/l/49/a2/220722_n3j0A.jpg",
     {"award": "第12届中国科幻银河奖特等奖"},
     ["图书", "小说", "科幻", "硬科幻", "太空歌剧", "末日废土", "刘慈欣"], 16,
     {"en-US": ("The Wandering Earth", "Masterpiece novella by Liu Cixin where humanity drives Earth out of the solar system using colossal planetary engines."),
      "ja": ("流浪地球（さすらう地球）", "第12回中国銀河賞特等賞受賞。地球に巨大エンジンを取り付け太陽系を脱出する驚異の叙事詩。")},
     [
         (41, "中短篇小说典藏集（长江文艺出版社）", "978-7-5354-9988-2", "9787535499882", None, "长江文艺出版社", "paperback", "2019-01-01", "CN", "zh-CN", "retail", "收录《流浪地球》《乡村教师》《微纪元》等经典篇目。", {"isbn": "9787535499882"}, [(41, 1, "流浪地球篇", "Book", "novel", 0)])
     ]),

    (22, "银河帝国：基地", "Foundation", ["Foundation Series", "心理史学", "哈里·谢顿", "阿西莫夫基地"], "1951-01-01", "1951-01-01", "1993-01-01", True, "美国", "en-US", "en",
     "艾萨克·阿西莫夫创作的科幻史诗巅峰，雨果奖'史上最佳系列小说'得主。数学家哈里·谢顿创立心理史学预测银河帝国崩溃，在银河边缘建立基地保存人类文明火种。",
     "https://image.tmdb.org/t/p/original/46R0jMsdY04Z4dsuGzXvhV0e0i4.jpg",
     {"award": "雨果奖史上最佳系列小说", "volumes": 7},
     ["图书", "小说", "科幻", "硬科幻", "太空歌剧", "哲学", "雨果奖", "名著"], 17,
     {"en-US": ("Foundation", "Monumental sci-fi epic by Isaac Asimov introducing psychohistory and Hari Seldon's plan to preserve civilization across millennia."),
      "ja": ("銀河帝国興亡史（ファウンデーション）", "アイザック・アシモフによる歴史的SF巨編。心理歴史学と銀河帝国の興亡。")},
     [
         (42, "英文原版三部曲精装合辑 (Everyman's Library)", "978-0-307-59396-2", "9780307593962", None, "Everyman's Library", "hardcover", "2010-10-05", "US", "en-US", "retail", "Contains Foundation, Foundation and Empire, Second Foundation.", {"isbn": "9780307593962"}, [(42, 1, "The Foundation Trilogy", "Book", "novel", 0)]),
         (43, "中文典藏精装版 第一卷 基地", "978-7-5399-5374-8", "9787539953748", None, "江苏文艺出版社", "hardcover", "2012-09-01", "CN", "zh-CN", "retail", "叶李华译本，读客经典文库。", {"isbn": "9787539953748", "volume": 1}, [(43, 1, "正文", "Book", "novel", 0)])
     ]),

    (23, "沙丘", "Dune", ["Dune Series", "保罗·厄崔迪", "厄拉科斯", "弗兰克赫伯特沙丘"], "1965-08-01", "1965-08-01", "1985-05-01", True, "美国", "en-US", "en",
     "弗兰克·赫伯特创作的科幻史诗珠穆朗玛峰，首部同时斩获雨果奖与星云奖的科幻巨作。在唯一的香料产地沙漠行星厄拉科斯，少年保罗·厄崔迪在权谋背叛中蜕变为救世主穆阿迪布。",
     "https://lain.bgm.tv/pic/cover/l/37/10/2831_jp.jpg",
     {"award": "雨果奖与星云奖双料得主 (1966)"},
     ["图书", "小说", "科幻", "太空歌剧", "哲学", "权谋", "雨果奖", "星云奖", "名著"], 18,
     {"en-US": ("Dune", "Frank Herbert's legendary masterpiece set on the desert planet Arrakis, blending ecology, religion, and politics."),
      "ja": ("デューン 砂の惑星", "フランク・ハーバートによるSF文学最高峰。ヒューゴー賞・ネビュラ賞W受賞。")},
     [
         (44, "英文原版50周年典藏精装版 (Ace Books)", "978-0-441-01359-3", "9780441013593", None, "Ace Books", "hardcover", "2019-10-01", "US", "en-US", "retail", "Deluxe Hardcover Edition with stenciled edges.", {"isbn": "9780441013593"}, [(44, 1, "Full Novel", "Book", "novel", 0)]),
         (45, "中文精装典藏版 第一卷 沙丘", "978-7-5399-9831-2", "9787539998312", None, "江苏凤凰文艺出版社", "hardcover", "2017-02-01", "CN", "zh-CN", "retail", "潘振华等译本，六部曲第一卷。", {"isbn": "9787539998312", "volume": 1}, [(45, 1, "正文", "Book", "novel", 0)])
     ]),

    (24, "百年孤独", "Cien años de soledad", ["One Hundred Years of Solitude", "布恩迪亚家族", "马孔多", "加西亚马尔克斯"], "1967-05-30", "1967-05-30", "1967-05-30", True, "哥伦比亚", "es-CO", "es",
     "加西亚·马尔克斯魔幻现实主义文学巅峰，1982年诺贝尔文学奖核心代表作。描绘布恩迪亚家族七代人在虚构城镇马孔多的兴衰与轮回，展现拉美大陆百年沧桑与无法摆脱的孤独宿命。",
     "https://image.tmdb.org/t/p/original/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
     {"award": "1982年诺贝尔文学奖"},
     ["图书", "小说", "文学", "魔幻现实主义", "哲学", "诺贝尔文学奖", "名著"], 19,
     {"en-US": ("One Hundred Years of Solitude", "Gabriel García Márquez's landmark magical realism masterpiece depicting the Buendía family across seven generations in Macondo."),
      "ja": ("百年の孤独", "ガブリエル・ガルシア＝マルケスによる魔術的リアリズムの世界的金字塔（ノーベル文学賞受賞）。")},
     [
         (46, "中文正版首版精装（南海出版公司）", "978-7-5442-5399-4", "9787544253994", 49, "南海出版公司 / 新经典文化", "hardcover", "2011-05-01", "CN", "zh-CN", "retail", "范晔翻译中文正式授权版。", {"translator": "范晔", "isbn": "9787544253994"}, [(46, 1, "正文", "Book", "novel", 0)]),
         (47, "西班牙语原版初版 (Editorial Sudamericana)", "978-84-397-2077-5", "9788439720775", None, "Editorial Sudamericana", "paperback", "1967-05-30", "AR", "es", "retail", "Edición original en español publicada en Buenos Aires.", {"isbn": "9788439720775"}, [(47, 1, "Texto completo", "Book", "novel", 0)])
     ]),

    (25, "仿生人会梦见电子羊吗？", "Do Androids Dream of Electric Sheep?", ["Blade Runner", "银翼杀手原著", "迪克电子羊", "里克狄卡德"], "1968-03-01", "1968-03-01", "1968-03-01", True, "美国", "en-US", "en",
     "菲利普·K·迪克探讨人性与真实存在界限的哲学科幻经典，电影《银翼杀手》原著小说。核战后废土上赏金猎人里克·狄卡德追捕叛逃仿生人，在共情机与电子宠物之间拷问人类本质。",
     "https://lain.bgm.tv/pic/cover/l/33/c4/3088_jp.jpg",
     {"note": "电影《银翼杀手》原作小说"},
     ["图书", "小说", "科幻", "赛博朋克", "末日废土", "哲学", "心理", "名著"], 20,
     {"en-US": ("Do Androids Dream of Electric Sheep?", "Philip K. Dick's profound dystopian sci-fi novel inspiring Blade Runner, investigating empathy and what makes humans human."),
      "ja": ("アンドロイドは電気羊の夢を見るか?", "フィリップ・K・ディック著。映画『ブレードランナー』原作の不朽の名作SF。")},
     [
         (48, "中文精装版（译林出版社）", "978-7-5447-7108-5", "9787544771085", None, "译林出版社", "hardcover", "2017-10-01", "CN", "zh-CN", "retail", "许东松译本，完整收录原著译文。", {"isbn": "9787544771085"}, [(48, 1, "正文", "Book", "novel", 0)]),
         (49, "英文原版精装 (Del Rey)", "978-0-345-40447-3", "9780345404473", None, "Del Rey / Ballantine Books", "hardcover", "1996-05-28", "US", "en-US", "retail", "Classic Masterworks Edition.", {"isbn": "9780345404473"}, [(49, 1, "Full Novel", "Book", "novel", 0)])
     ]),

    (26, "一九八四", "Nineteen Eighty-Four", ["1984", "老大哥在看着你", "大洋国", "乔治奥威尔1984"], "1949-06-08", "1949-06-08", "1949-06-08", True, "英国", "en-GB", "en",
     "乔治·奥威尔反乌托邦文学三大基石之一。在大洋国真理部工作的温斯顿·史密斯在极权统治'老大哥'无处不在的电幕监控下渴望自由与真爱，探讨极权主义、双重思想与思想罪。",
     "https://image.tmdb.org/t/p/original/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg",
     {"note": "反乌托邦文学三部曲之一"},
     ["图书", "小说", "文学", "反乌托邦", "哲学", "心理", "名著"], 21,
     {"en-US": ("Nineteen Eighty-Four", "George Orwell's chilling dystopian classic exploring totalitarianism, surveillance, and Big Brother."),
      "ja": ("一九八四年（1984）", "ジョージ・オーウェルによるディストピア文学の最高峰。「ビッグ・ブラザーが見ている」。")},
     [
         (50, "中文经典译本（上海译文出版社）", "978-7-5327-8141-6", "9787532781416", 49, "上海译文出版社", "paperback", "2019-06-01", "CN", "zh-CN", "retail", "董乐山经典译本。", {"translator": "董乐山", "isbn": "9787532781416"}, [(50, 1, "正文", "Book", "novel", 0)]),
         (51, "英文原版初版 (Secker & Warburg)", "978-0-451-52493-5", "9780451524935", None, "Secker & Warburg / Signet Classics", "paperback", "1949-06-08", "GB", "en-GB", "retail", "First published June 8, 1949.", {"isbn": "9780451524935"}, [(51, 1, "Complete Text", "Book", "novel", 0)])
     ]),

    (27, "银河系漫游指南", "The Hitchhiker's Guide to the Galaxy", ["42", "毛巾", "不要恐慌", "亚瑟邓特"], "1979-10-12", "1979-10-12", "1992-01-01", True, "英国", "en-GB", "en",
     "道格拉斯·亚当斯创作的幽默科幻圣经。地球因银河超空间通道建设被沃贡人摧毁，幸存者亚瑟·邓特携带着一本封面上印着'不要恐慌'的电子指南与一条毛巾开启荒诞奇妙的宇宙大冒险。关于生命、宇宙以及一切的终极答案是42。",
     "https://lain.bgm.tv/pic/cover/l/f5/a8/23837_vMv7v.jpg",
     {"quote": "Don't Panic and always carry a towel."},
     ["图书", "小说", "科幻", "太空歌剧", "喜剧", "哲学", "名著"], 22,
     {"en-US": ("The Hitchhiker's Guide to the Galaxy", "Douglas Adams' legendary comedy sci-fi classic uncovering the answer to the Ultimate Question of Life, the Universe, and Everything: 42."),
      "ja": ("銀河ヒッチハイク・ガイド", "ダグラス・アダムスによる笑いとナンセンスの傑作SFバイブル。「パニックになるな」。")},
     [
         (52, "英文全五部合辑精装本 (Del Rey)", "978-0-345-45374-7", "9780345453747", None, "Del Rey Books", "hardcover", "2002-04-30", "US", "en-US", "retail", "The Ultimate Hitchhiker's Guide to the Galaxy (5 Novels in 1).", {"isbn": "9780345453747"}, [(52, 1, "Five Books in One", "Book", "novel", 0)]),
         (53, "中文单行本 第一部（上海译文出版社）", "978-7-5327-5484-7", "9787532754847", 49, "上海译文出版社", "paperback", "2011-07-01", "CN", "zh-CN", "retail", "姚向辉翻译第一卷。", {"isbn": "9787532754847"}, [(53, 1, "正文", "Book", "novel", 0)])
     ]),

    (28, "海伯利安", "Hyperion", ["Hyperion Cantos", "伯劳", "光阴冢", "丹西蒙斯"], "1989-05-26", "1989-05-26", "1997-01-01", True, "美国", "en-US", "en",
     "丹·西蒙斯斩获雨果奖的太空歌剧与宗教哲学双巅峰。仿照乔叟《坎特伯雷故事集》架构，七位朝圣者前往偏远星球海伯利安的光阴冢寻找杀戮机械伯劳，在末日阴影下各自倾诉扣人心弦的人生往事。",
     "https://lain.bgm.tv/pic/cover/l/7b/d2/3352_9W1jU.jpg",
     {"award": "雨果奖最佳长篇小说 (1990)"},
     ["图书", "小说", "科幻", "硬科幻", "太空歌剧", "哲学", "雨果奖", "名著"], 23,
     {"en-US": ("Hyperion", "Hugo Award-winning space opera epic by Dan Simmons following seven pilgrims traveling to the Time Tombs on Hyperion."),
      "ja": ("ハイペリオン", "ダン・シモンズによるSF文学の金字塔（ヒューゴー賞受賞）。七人の巡礼者が語る壮絶なる物語。")},
     [
         (54, "英文原版精装初版 (Doubleday)", "978-0-385-24949-2", "9780385249492", None, "Doubleday", "hardcover", "1989-05-26", "US", "en-US", "retail", "First edition hardcover.", {"isbn": "9780385249492"}, [(54, 1, "Hyperion Novel", "Book", "novel", 0)]),
         (55, "中文精装全四部套装（读客 / 译林）", "978-7-5447-4952-7", "9787544749527", None, "译林出版社", "box_set", "2015-01-01", "CN", "zh-CN", "retail", "包含《海伯利安》《海伯利安的陨落》《安迪密恩》《安迪密恩的觉醒》。", {"volumes": 4, "isbn": "9787544749527"}, [(55, 1, "第1部 海伯利安", "Book", "novel", 0), (56, 2, "第2部 陨落", "Book", "novel", 0)])
     ]),

    (29, "2001太空漫游", "2001: A Space Odyssey", ["2001 Space Odyssey", "黑色石碑", "HAL 9000", "阿瑟克拉克"], "1968-07-16", "1968-07-16", "1968-07-16", True, "英国", "en-GB", "en",
     "阿瑟·C·克拉克科幻大师级神作，与斯坦利·库布里克同名电影相辅相成。一块在史前地球与月球被发现的神秘黑色石碑引导人类前往木星，探索人类智能觉醒、人工智能异化与星际婴儿终极蜕变。",
     "https://lain.bgm.tv/pic/cover/l/6a/a2/399868_W126q.jpg",
     {"note": "科幻三巨头阿瑟·克拉克终极代表作"},
     ["图书", "小说", "科幻", "硬科幻", "太空歌剧", "哲学", "名著"], 24,
     {"en-US": ("2001: A Space Odyssey", "Arthur C. Clarke's iconic sci-fi visionary work exploring the Monolith, HAL 9000, and humanity's cosmic evolution."),
      "ja": ("2001年宇宙の旅", "アーサー・C・クラークによる永遠のマスターピース。モノリスとHAL 9000、人類の進化。")},
     [
         (57, "英文初版 (New American Library)", "978-0-451-45799-8", "9780451457998", None, "New American Library", "hardcover", "1968-07-16", "US", "en-US", "retail", "Written concurrently with Stanley Kubrick's film.", {"isbn": "9780451457998"}, [(57, 1, "Full Novel", "Book", "novel", 0)]),
         (58, "中文精装版（上海光启书局 / 读客）", "978-7-5452-1673-8", "9787545216738", None, "上海光启书局", "hardcover", "2019-05-01", "CN", "zh-CN", "retail", "郝明义译本。", {"isbn": "9787545216738"}, [(58, 1, "正文", "Book", "novel", 0)])
     ]),

    (30, "索拉里斯星", "Solaris", ["飞向太空", "索拉里斯", "莱姆", "大洋星"], "1961-01-01", "1961-01-01", "1961-01-01", True, "波兰", "pl-PL", "pl",
     "斯坦尼斯瓦夫·莱姆最负盛名的哲学心理科幻名作。心理学家凯尔文抵达环绕索拉里斯星的空间站，发现这颗行星由具有智慧的浩瀚活体胶质海洋覆盖，海洋能够具象化人类深层潜意识中痛苦与愧疚的幽灵。",
     "https://image.tmdb.org/t/p/original/1Qx68p9lB5fP9r4aGzXvhV0e0i4.jpg",
     {"note": "莱姆哲学科幻代表作"},
     ["图书", "小说", "科幻", "哲学", "心理", "名著"], 25,
     {"en-US": ("Solaris", "Stanisław Lem's profound philosophical novel about scientists attempting to comprehend a sentient oceanic planet that materializes their deepest traumas."),
      "ja": ("ソラリス（ソラリスの陽のもとに）", "スタニスワフ・レムによる思索的SFの最高傑作。生きた海を持つ惑星ソラリスとの邂逅。")},
     [
         (59, "波兰语原版初版 (Wydawnictwo MON)", "978-83-08-04900-6", "9788308049006", None, "Wydawnictwo MON", "paperback", "1961-01-01", "PL", "pl", "retail", "Oryginalne wydanie polskie.", {"isbn": "9788308049006"}, [(59, 1, "Tekst powieści", "Book", "novel", 0)]),
         (60, "中文精装版（商务印书馆）", "978-7-100-19889-8", "9787100198898", None, "商务印书馆", "hardcover", "2021-08-01", "CN", "zh-CN", "retail", "赵刚依据波兰语原版直译。", {"translator": "赵刚", "isbn": "9787100198898"}, [(60, 1, "正文", "Book", "novel", 0)])
     ]),

    (31, "永恒的终结", "The End of Eternity", ["时间旅行", "时间守卫", "阿西莫夫时间小说"], "1955-08-01", "1955-08-01", "1955-08-01", True, "美国", "en-US", "en",
     "艾萨克·阿西莫夫最受推崇的时间旅行科幻神作。永恒时空组织独立于时间之外，通过精密计算微调各个世纪的现实以抹杀灾难，然而这种对安全与平庸的执念却阻碍了人类跨出地球探索星辰大海的真正命运。",
     "https://lain.bgm.tv/pic/cover/l/54/12/328114_Y73q7.jpg",
     {"theme": "时间旅行与文明演化"},
     ["图书", "小说", "科幻", "硬科幻", "哲学", "恋爱", "名著"], 17,
     {"en-US": ("The End of Eternity", "Isaac Asimov's definitive time-travel masterwork exploring the Eternity organization and humanity's cosmic fate."),
      "ja": ("永遠の終わり（エターニティの終焉）", "アイザック・アシモフによる時間改変SFの金字塔。")},
     [
         (61, "英文原版 (Doubleday)", "978-0-7653-1919-7", "9780765319197", None, "Doubleday / Tor Books", "hardcover", "1955-08-01", "US", "en-US", "retail", "First Edition time travel classic.", {"isbn": "9780765319197"}, [(61, 1, "Full Novel", "Book", "novel", 0)]),
         (62, "中文精装版（江苏文艺出版社 / 读客）", "978-7-5399-6839-1", "9787539968391", None, "江苏文艺出版社", "hardcover", "2014-06-01", "CN", "zh-CN", "retail", "崔正男译本。", {"isbn": "9787539968391"}, [(62, 1, "正文", "Book", "novel", 0)])
     ]),

    (32, "神经漫游者", "Neuromancer", ["Neuromancer", "赛博空间", "凯斯", "威廉吉布森"], "1984-07-01", "1984-07-01", "1984-07-01", True, "美国", "en-US", "en",
     "威廉·吉布森开创赛博朋克流派的史诗奠基作，雨果奖、星云奖与菲利普·K·迪克奖三料大满贯。落魄黑客凯斯受神秘势力雇佣侵入超人工智能矩阵，创造了'赛博空间'、矩阵与人工智能觉醒的未来愿景。",
     "https://lain.bgm.tv/pic/cover/l/d0/bb/183863_n93U8.jpg",
     {"award": "雨果奖、星云奖、菲利普·迪克奖三料大满贯 (1984)"},
     ["图书", "小说", "科幻", "赛博朋克", "反乌托邦", "雨果奖", "星云奖", "名著"], 26,
     {"en-US": ("Neuromancer", "William Gibson's genre-defining cyberpunk masterpiece winning the triple crown of Hugo, Nebula, and Philip K. Dick awards."),
      "ja": ("ニューロマンサー", "ウィリアム・ギブスン著。サイバーパンクの原点にして三冠受賞の金字塔。")},
     [
         (63, "英文原版初版 (Ace Science Fiction Specials)", "978-0-441-56959-5", "9780441569595", None, "Ace Books", "paperback", "1984-07-01", "US", "en-US", "retail", "First Edition Ace paperback.", {"isbn": "9780441569595"}, [(63, 1, "Complete Novel", "Book", "novel", 0)]),
         (64, "中文典藏精装版（江苏凤凰文艺出版社 / 读客）", "978-7-5594-3990-1", "9787559439901", None, "江苏凤凰文艺出版社", "hardcover", "2019-11-01", "CN", "zh-CN", "retail", "高峰译本，蔓生三部曲第一卷。", {"isbn": "9787559439901", "volume": 1}, [(64, 1, "正文", "Book", "novel", 0)])
     ]),

    (33, "黑暗的左手", "The Left Hand of Darkness", ["格森星", "双性人", "厄休拉勒古恩"], "1969-03-01", "1969-03-01", "1969-03-01", True, "美国", "en-US", "en",
     "厄休拉·勒古恩荣获雨果奖与星云奖双奖的女性主义与人类学思辨科幻巅峰。星际联盟使者金利·艾来到终年严寒的格森星，面对没有固定性别的无性/双性智慧族群，跨越文化与生理隔阂探寻理解与爱。",
     "https://lain.bgm.tv/pic/cover/l/d4/06/141444_m0M7z.jpg",
     {"award": "雨果奖与星云奖双料得主 (1970)"},
     ["图书", "小说", "科幻", "哲学", "文学", "雨果奖", "星云奖", "名著"], 27,
     {"en-US": ("The Left Hand of Darkness", "Ursula K. Le Guin's Hugo and Nebula award-winning anthropological sci-fi masterpiece exploring gender on the frozen world of Gethen."),
      "ja": ("闇の左手", "アーシュラ・K・ル＝グウィンによるジェンダーと異文化理解を描いたSF不朽の名作。")},
     [
         (65, "英文原版精装 (Ace Books)", "978-0-441-47812-5", "9780441478125", None, "Ace Books", "hardcover", "1969-03-01", "US", "en-US", "retail", "Hainish Cycle Classic.", {"isbn": "9780441478125"}, [(65, 1, "Full Novel", "Book", "novel", 0)]),
         (66, "中文版（北京联合出版公司 / 读客）", "978-7-5596-1033-1", "9787559610331", None, "北京联合出版公司", "hardcover", "2017-09-01", "CN", "zh-CN", "retail", "陶雪蕾译本。", {"isbn": "9787559610331"}, [(66, 1, "正文", "Book", "novel", 0)])
     ]),

    (34, "悉达多", "Siddhartha", ["流浪者之歌", "赫塞悉达多", "婆罗门之子"], "1922-10-01", "1922-10-01", "1922-10-01", True, "德国", "de-DE", "de",
     "诺贝尔文学奖得主赫尔曼·黑塞享誉全球的心灵文学经典。年轻的婆罗门之子悉达多为探求生命终极真理，放弃名利身份历经苦行、红尘繁华与摆渡沉思，在河流的低语中领悟圆融与万物合一。",
     "https://lain.bgm.tv/pic/cover/l/21/df/4774_XpC1c.jpg",
     {"award": "赫尔曼·黑塞心灵经典"},
     ["图书", "小说", "文学", "哲学", "心理", "诺贝尔文学奖", "名著"], 28,
     {"en-US": ("Siddhartha", "Hermann Hesse's spiritual masterpiece recounting a young Indian man's journey to self-discovery and ultimate enlightenment."),
      "ja": ("シッダールタ", "ヘルマン・ヘッセによる魂の探求と解脱を描いた精神文学の最高傑作。")},
     [
         (67, "德语原版初版 (S. Fischer Verlag)", "978-3-518-36682-0", "9783518366820", None, "S. Fischer Verlag", "paperback", "1922-10-01", "DE", "de", "retail", "Erstausgabe in deutscher Sprache.", {"isbn": "9783518366820"}, [(67, 1, "Vollständiger Text", "Book", "novel", 0)]),
         (68, "中文精装典藏版（上海译文出版社）", "978-7-5327-7389-3", "9787532773893", 49, "上海译文出版社", "hardcover", "2017-01-01", "CN", "zh-CN", "retail", "姜乙经典译本。", {"translator": "姜乙", "isbn": "9787532773893"}, [(68, 1, "正文", "Book", "novel", 0)])
     ]),

    (35, "变形记", "Die Verwandlung", ["The Metamorphosis", "格里高尔·萨姆沙", "甲虫", "卡夫卡变形记"], "1915-10-01", "1915-10-01", "1915-10-01", True, "奥地利", "de-AT", "de",
     "弗兰茨·卡夫卡现代主义与荒诞派文学的开山名作。推销员格里高尔·萨姆沙清晨醒来发现自己变成了一只巨大的甲虫，由此展开家庭、亲情与现代社会异化的深刻寓言。",
     "https://lain.bgm.tv/pic/cover/l/b8/0a/55122_Ggw9Q.jpg",
     {"theme": "现代主义与存在主义先驱"},
     ["图书", "小说", "文学", "哲学", "心理", "名著"], 29,
     {"en-US": ("The Metamorphosis", "Franz Kafka's existential masterwork following Gregor Samsa waking up transformed into a monstrous insect."),
      "ja": ("変身（カフカ）", "フランツ・カフカによる不条理文学の金字塔。ある朝、巨大な毒虫に変身していたグレゴール・ザムザ。")},
     [
         (69, "德语原版初版 (Kurt Wolff Verlag)", "978-3-15-009900-1", "9783150099001", None, "Kurt Wolff Verlag", "paperback", "1915-10-01", "DE", "de", "retail", "Erstausgabe Leipzig 1915.", {"isbn": "9783150099001"}, [(69, 1, "Die Verwandlung", "Book", "novel", 0)]),
         (70, "中文版（人民文学出版社）", "978-7-02-011032-2", "9787020110322", None, "人民文学出版社", "paperback", "2015-08-01", "CN", "zh-CN", "retail", "高中甫译本。", {"isbn": "9787020110322"}, [(70, 1, "正文", "Book", "novel", 0)])
     ]),

    (36, "月亮与六便士", "The Moon and Sixpence", ["思特里克兰德", "高更原型", "毛姆月亮六便士"], "1919-04-15", "1919-04-15", "1919-04-15", True, "英国", "en-GB", "en",
     "威廉·萨默塞特·毛姆传世杰作，以画家高更为原型。证券经纪人思特里克兰德在中年突然舍弃优渥的家庭与事业，奔赴巴黎和塔希提岛追求纯粹的绘画艺术，探讨崇高理想与现实生活的永恒冲突。",
     "https://lain.bgm.tv/pic/cover/l/8e/3c/69877_jp.jpg",
     {"quote": "满地都是六便士，他却抬头看见了月亮。"},
     ["图书", "小说", "文学", "哲学", "心理", "名著"], 30,
     {"en-US": ("The Moon and Sixpence", "W. Somerset Maugham's celebrated novel inspired by the life of Paul Gauguin, chronicling an artist's obsessive pursuit of genius."),
      "ja": ("月と六ペンス", "サマセット・モーム著。ポール・ゴーギャンをモデルにした芸術への狂気と情熱を描く傑作。")},
     [
         (71, "英文原版初版 (William Heinemann)", "978-0-09-948844-6", "9780099488446", None, "William Heinemann / Vintage", "paperback", "1919-04-15", "GB", "en-GB", "retail", "First published in London.", {"isbn": "9780099488446"}, [(71, 1, "Complete Text", "Book", "novel", 0)]),
         (72, "中文精装典藏版（上海译文出版社）", "978-7-5327-4043-7", "9787532740437", 49, "上海译文出版社", "hardcover", "2006-08-01", "CN", "zh-CN", "retail", "傅惟慈经典译本。", {"translator": "傅惟慈", "isbn": "9787532740437"}, [(72, 1, "正文", "Book", "novel", 0)])
     ]),

    # --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    # 3. 海内外轻小说与系列文学 (14部)
    # --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    (37, "无职转生 ~到了异世界就拿出真本事~", "無職転生 - 異世界行ったら本気だす -", ["Mushoku Tensei", "无职转生", "鲁迪乌斯", "洛琪希", "理不尽な孫の手"], "2014-01-23", "2014-01-23", "2022-11-25", True, "日本", "ja", "ja",
     "不讲理不求人著、白鹰插画的异世界转生流巅峰里程碑。34岁宅男遭遇车祸转生为魔法世界婴儿鲁迪乌斯·格雷拉特，发誓在异世界认真活出无悔一生的壮阔编年史。",
     "https://lain.bgm.tv/pic/cover/l/0a/6f/214265_5rZrn.jpg",
     {"volumes": 26, "label": "MFブックス", "format": "light_novel"},
     ["图书", "小说", "轻小说", "奇幻", "异世界", "转生", "冒险", "MF文库J"], 31,
     {"en-US": ("Mushoku Tensei: Jobless Reincarnation", "Pioneering isekai light novel series by Rifujin na Magonote detailing Rudeus Greyrat's entire lifelong second chance."),
      "ja": ("無職転生 - 異世界行ったら本気だす -", "理不尽な孫の手による異世界転生ファンタジーの金字塔。全26巻完結。")},
     [
         (73, "日文单行本 第1卷", "978-4-04-066220-6", "9784040662206", 50, "KADOKAWA / メディアファクトリー", "paperback", "2014-01-23", "JP", "ja", "retail", "幼年期篇第1卷。", {"volume": 1, "isbn": "9784040662206"}, [(73, 1, "第1巻 本文", "Book", "novel", 0)]),
         (74, "日文单行本 完结第26卷", "978-4-04-681934-5", "9784046819345", 50, "KADOKAWA / メディアファクトリー", "paperback", "2022-11-25", "JP", "ja", "retail", "鲁迪乌斯一生的壮丽终章。", {"volume": 26, "isbn": "9784046819345", "is_final": True}, [(74, 1, "第26巻 完結", "Book", "novel", 0)])
     ]),

    (38, "OVERLORD", "オーバーロード", ["不死者之王", "骨王", "安兹乌尔恭", "丸山黄金OVERLORD"], "2012-07-30", "2012-07-30", "", False, "日本", "ja", "ja",
     "丸山黄金著、so-bin插画的暗黑异世界轻小说巅峰。曾席卷网络的体感型游戏关闭服务器之际，骨王莫蒙伽留在公会大厅与异世界NPC一起降临异界，君临纳萨力克大坟墓。",
     "https://lain.bgm.tv/pic/cover/l/7f/75/150125_bI7gB.jpg",
     {"label": "KADOKAWA", "illustrator": "so-bin", "format": "light_novel"},
     ["图书", "小说", "轻小说", "奇幻", "异世界", "黑暗奇幻", "游戏竞技"], 32,
     {"en-US": ("OVERLORD", "Dark fantasy light novel series by Kugane Maruyama illustrated by so-bin, following Momonga / Ainz Ooal Gown."),
      "ja": ("オーバーロード", "丸山くがねによる大ヒットダークファンタジー。最凶の魔法詠唱者・アインズの覇道。")},
     [
         (75, "日文单行本 第1卷 不死者之王", "978-4-04-728152-3", "9784047281523", 50, "KADOKAWA / エンターブレイン", "hardcover", "2012-07-30", "JP", "ja", "retail", "第1卷 不死者の王。", {"volume": 1, "isbn": "9784047281523"}, [(75, 1, "第1巻 本文", "Book", "novel", 0)]),
         (76, "日文单行本 第16卷 半森林精灵神人 下", "978-4-04-736556-8", "9784047365568", 50, "KADOKAWA", "hardcover", "2022-07-29", "JP", "ja", "retail", "第16卷 单行本。", {"volume": 16, "isbn": "9784047365568"}, [(76, 1, "第16巻 本文", "Book", "novel", 0)])
     ]),

    (39, "关于我转生变成史莱姆这档事", "転生したらスライムだった件", ["Slime Tensei", "萌王", "利姆鲁", "史莱姆转生"], "2014-05-30", "2014-05-30", "", False, "日本", "ja", "ja",
     "伏濑著、みっつばー插画的现象级轻小说。上班族三上悟遇刺身亡转生为异世界最低级魔物史莱姆，获得'大贤者'与'捕食者'两大技能，化名利姆鲁·特恩佩斯特建立魔国联邦。",
     "https://lain.bgm.tv/pic/cover/l/2a/2d/154743_jp.jpg",
     {"label": "GCノベルズ", "format": "light_novel"},
     ["图书", "小说", "轻小说", "奇幻", "异世界", "转生", "冒险"], 33,
     {"en-US": ("That Time I Got Reincarnated as a Slime", "Hit fantasy series by Fuse following Rimuru Tempest building a nation of monsters with great sage skills."),
      "ja": ("転生したらスライムだった件", "伏瀬による大人気異世界転生ノベル。リムル＝テンペストの建国記。")},
     [
         (77, "日文单行本 第1卷", "978-4-89637-459-9", "9784896374599", None, "マイクロマガジン社 (GCノベルズ)", "paperback", "2014-05-30", "JP", "ja", "retail", "利姆鲁与暴风龙维鲁德拉相遇篇。", {"volume": 1, "isbn": "9784896374599"}, [(77, 1, "第1巻 本文", "Book", "novel", 0)])
     ]),

    (40, "魔王学院的不适任者～史上最强的魔王始祖，转生就读子孙们的学校～", "魔王学院の不適合者 ～史上最強の魔王の始祖、転生して子孫たちの学校へ通う～", ["魔王学院的不适任者", "阿诺斯", "不适任者"], "2018-03-10", "2018-03-10", "", False, "日本", "ja", "ja",
     "秋著、静间良纪插画的爽快系霸权轻小说。暴虐魔王阿诺斯·波鲁迪戈乌多转生至两千年后，因力量过于强大被魔王学院评定为'不适任者'，以绝对实力摧毁一切不公与阴谋。",
     "https://lain.bgm.tv/pic/cover/l/55/54/304417_F5j6m.jpg",
     {"label": "電撃文庫", "format": "light_novel"},
     ["图书", "小说", "轻小说", "奇幻", "热血", "校园", "电击文库"], 34,
     {"en-US": ("The Misfit of Demon King Academy", "Overpowered fantasy light novel series by Shu featuring Anos Voldigoad, the reincarnated Demon King of Tyranny."),
      "ja": ("魔王学院の不適合者", "秋による電撃文庫大ヒット作。二千年後に転生した暴虐の魔王アノス・ヴォルディゴード。")},
     [
         (78, "日文文库版 第1卷", "978-4-04-893681-1", "9784048936811", 50, "KADOKAWA / 電撃文庫", "paperback", "2018-03-10", "JP", "ja", "retail", "电击文库第1卷。", {"volume": 1, "isbn": "9784048936811"}, [(78, 1, "第1巻 本文", "Book", "novel", 0)])
     ]),

    (41, "化物语", "化物語", ["Bakemonogatari", "物语系列", "阿良良木历", "战场原黑仪", "西尾维新化物语"], "2006-11-01", "2006-11-01", "2006-12-01", True, "日本", "ja", "ja",
     "西尾维新怪异小说代表作《物语系列》第一季开篇（上·下两卷）。插画VOFAN。高中生阿良良木历在春假遭遇吸血鬼后，邂逅遭遇'重蟹'的战场原黑仪等少女，解决各种都市怪异。",
     "https://lain.bgm.tv/pic/cover/l/6a/a2/399868_W126q.jpg",
     {"label": "講談社BOX", "illustrator": "VOFAN", "format": "novel"},
     ["图书", "小说", "轻小说", "悬疑", "奇幻", "日常", "校园", "讲谈社BOX"], 35,
     {"en-US": ("Bakemonogatari", "Critically acclaimed supernatural dialogue-driven novel by Nisio Isin illustrated by VOFAN, beginning the Monogatari series."),
      "ja": ("化物語", "西尾維新による青春怪異小説の金字塔。「ひたぎクラブ」「まよいマイマイ」等を収録。")},
     [
         (79, "日文讲谈社BOX 单行本 上卷", "978-4-06-283602-9", "9784062836029", None, "講談社BOX", "hardcover", "2006-11-01", "JP", "ja", "retail", "收录战场原黑仪、八九寺真宵、神原骏河篇章。", {"volume": 1, "isbn": "9784062836029"}, [(79, 1, "化物語（上） 本文", "Book", "novel", 0)]),
         (80, "日文讲谈社BOX 单行本 下卷", "978-4-06-283607-4", "9784062836074", None, "講談社BOX", "hardcover", "2006-12-01", "JP", "ja", "retail", "收录千石抚子、羽川翼篇章。", {"volume": 2, "isbn": "9784062836074"}, [(80, 1, "化物語（下） 本文", "Book", "novel", 0)])
     ]),

    (42, "凉宫春日的忧郁", "涼宮ハルヒの憂鬱", ["The Melancholy of Haruhi Suzumiya", "凉宫春日", "SOS团", "谷川流"], "2003-06-06", "2003-06-06", "2003-06-06", True, "日本", "ja", "ja",
     "谷川流著、伊东杂音插画的轻小说黄金时代标志性巨作。第8届Sneaker大奖得主。'我对普通的人类没有兴趣。你们之中要是有外星人、未来人、异世界人或者超能力者的话，就尽管来找我吧！'阿虚与凉宫春日建立SOS团的非日常传奇。",
     "https://lain.bgm.tv/pic/cover/l/c5/4b/472852_9qK9V.jpg",
     {"award": "第8回スニーカー大賞大賞 (2003)", "label": "角川スニーカー文庫"},
     ["图书", "小说", "轻小说", "科幻", "校园", "日常", "角川Sneaker文库"], 36,
     {"en-US": ("The Melancholy of Haruhi Suzumiya", "Landmark light novel by Nagaru Tanigawa illustrated by Noizi Ito, revolutionizing modern ACG light novel culture."),
      "ja": ("涼宮ハルヒの憂鬱", "谷川流による第8回スニーカー大賞受賞作。SOS団の非日常系学園SF。")},
     [
         (81, "日文文库版 初版", "978-4-04-429201-0", "9784044292010", 50, "角川書店 / 角川スニーカー文庫", "paperback", "2003-06-06", "JP", "ja", "retail", "角川Sneaker文库初版。", {"isbn": "9784044292010"}, [(81, 1, "本文", "Book", "novel", 0)])
     ]),

    (43, "狼与香辛料", "狼と香辛料", ["Spice and Wolf", "赫萝", "罗伦斯", "支仓冻砂"], "2006-02-10", "2006-02-10", "", False, "日本", "ja", "ja",
     "支仓冻砂著、文仓十插画的经济中世纪奇幻轻小说巅峰。旅行商人克拉福·罗伦斯在装满麦子的马车上发现了长着狼耳与狼尾巴的丰收狼神赫萝，两人结伴开启经商与漫游北方的温馨旅途。",
     "https://lain.bgm.tv/pic/cover/l/9b/65/274457_0e6Z9.jpg",
     {"award": "第12回電撃小説大賞銀賞", "label": "電撃文庫"},
     ["图书", "小说", "轻小说", "奇幻", "冒险", "恋爱", "日常", "电击文库"], 37,
     {"en-US": ("Spice and Wolf", "Award-winning historical fantasy light novel by Isuna Hasekura following merchant Lawrence and the wolf deity Holo."),
      "ja": ("狼と香辛料", "支倉凍砂による経済ファンタジー。行商人ロレンスと賢狼ホロの旅路。")},
     [
         (82, "日文文库版 第1卷", "978-4-8402-3302-6", "9784840233026", 50, "メディアワークス / 電撃文庫", "paperback", "2006-02-10", "JP", "ja", "retail", "电击文库第1卷。", {"volume": 1, "isbn": "9784840233026"}, [(82, 1, "第1巻 本文", "Book", "novel", 0)])
     ]),

    (44, "奇诺之旅 -the Beautiful World-", "キノの旅 -the Beautiful World-", ["Kino's Journey", "奇诺之旅", "时雨泽惠一", "艾鲁梅斯"], "2000-07-10", "2000-07-10", "", False, "日本", "ja", "ja",
     "时雨泽惠一著、黑星红白插画的寓言式轻小说经典。人类奇诺与会说话的摩托车艾鲁梅斯在各个国家漫游旅行，在每个国家只停留三天，以旁观者视角见证光怪陆离的人性寓言，'世界并不美丽，但也因此而美丽'。",
     "https://lain.bgm.tv/pic/cover/l/54/12/328114_Y73q7.jpg",
     {"label": "電撃文庫", "format": "light_novel"},
     ["图书", "小说", "轻小说", "哲学", "探险", "日常", "电击文库"], 38,
     {"en-US": ("Kino's Journey: The Beautiful World", "Poetic philosophical episodic light novel series by Keiichi Sigsawa following traveler Kino and motorcycle Hermes."),
      "ja": ("キノの旅 -the Beautiful World-", "時雨沢恵一による連作短編寓話ノベル。「世界は美しくなんかない。そしてそれ故に、美しい」。")},
     [
         (83, "日文文库版 第1卷", "978-4-8402-1585-5", "9784840215855", 50, "メディアワークス / 電撃文庫", "paperback", "2000-07-10", "JP", "ja", "retail", "电击文库首卷。", {"volume": 1, "isbn": "9784840215855"}, [(83, 1, "第1巻 本文", "Book", "novel", 0)])
     ]),

    (45, "86-不存在的战区-", "86―エイティシックス―", ["86 Eighty-Six", "辛", "蕾娜", "安里朝都"], "2017-02-10", "2017-02-10", "", False, "日本", "ja", "ja",
     "安里朝都著、Shirabii插画的军事科幻轻小说神作。圣玛格诺利亚共和国宣称战争中'无人伤亡'，实际上是由被剥夺人权的第86区少年少女驾驶无人机军团抵御帝国军团。探讨尊严、反战与人性高贵。",
     "https://lain.bgm.tv/pic/cover/l/7f/73/404285_8wS88.jpg",
     {"award": "第23回電撃小説大賞大賞 (2016)", "label": "電撃文庫"},
     ["图书", "小说", "轻小说", "科幻", "战争", "硬科幻", "电击文库"], 39,
     {"en-US": ("86 -EIGHTY-SIX-", "Critically acclaimed military sci-fi light novel by Asato Asato exploring discrimination, war, and the indomitable human spirit."),
      "ja": ("86―エイティシックス―", "第23回電撃小説大賞大賞受賞。シンとレーナが紡ぐミリタリーSF傑作。")},
     [
         (84, "日文文库版 第1卷", "978-4-04-892666-9", "9784048926669", 50, "KADOKAWA / 電撃文庫", "paperback", "2017-02-10", "JP", "ja", "retail", "电击文库第1卷。", {"volume": 1, "isbn": "9784048926669"}, [(84, 1, "第1巻 本文", "Book", "novel", 0)])
     ]),

    (46, "幼女战记", "幼女戦記", ["Saga of Tanya the Evil", "谭雅·提古雷查夫", "存在X", "Carlo Zen"], "2013-10-31", "2013-10-31", "", False, "日本", "ja", "ja",
     "Carlo Zen著、筱月忍插画的硬核架空军事轻小说。现代精英精英上班族被神'存在X'转生至战乱异世界的孤儿谭雅，以幼女之躯加入帝国魔导军团，凭借极致理性与冷酷军事战术在第一次世界大战风云中生存晋升。",
     "https://lain.bgm.tv/pic/cover/l/7f/00/159846_4y48o.jpg",
     {"label": "KADOKAWA / エンターブレイン", "format": "light_novel"},
     ["图书", "小说", "轻小说", "战争", "异世界", "转生", "历史架空"], 40,
     {"en-US": ("The Saga of Tanya the Evil", "Hardcore military alternate-history isekai light novel by Carlo Zen following Tanya von Degurechaff."),
      "ja": ("幼女戦記", "カルロ・ゼンによる架空戦記ノベル。神への復讐と帝国の勝利のために戦うターニャ。")},
     [
         (85, "日文单行本 第1卷 Deus lo vult", "978-4-04-729173-7", "9784047291737", 50, "KADOKAWA / エンターブレイン", "hardcover", "2013-10-31", "JP", "ja", "retail", "第1卷 神がそれを望まれる。", {"volume": 1, "isbn": "9784047291737"}, [(85, 1, "第1巻 本文", "Book", "novel", 0)])
     ]),

    (47, "欢迎来到实力至上主义的教室", "ようこそ実力至上主義の教室へ", ["Classroom of the Elite", "实教", "绫小路清隆", "衣笠彰梧"], "2015-05-25", "2015-05-25", "", False, "日本", "ja", "ja",
     "衣笠彰梧著、知世俊作插画的智斗校园轻小说。全国顶尖的高度育成高中，一切以'实力'为考量。身居最底层的D班少年绫小路清隆隐藏自身真正实力，暗中操控全局博弈。",
     "https://lain.bgm.tv/pic/cover/l/d0/bb/183863_n93U8.jpg",
     {"label": "MF文庫J", "format": "light_novel"},
     ["图书", "小说", "轻小说", "校园", "推理", "心理", "MF文库J"], 41,
     {"en-US": ("Classroom of the Elite", "Hit psychological high school battle novel by Shogo Kinugasa following Kiyotaka Ayanokoji in an extreme merit-based academy."),
      "ja": ("ようこそ実力至上主義の教室へ", "衣笠彰梧による学園心理頭脳戦ノベル。実力至上主義の高校を舞台にしたサバイバル。")},
     [
         (86, "日文文库版 一年级篇 第1卷", "978-4-04-067657-9", "9784040676579", 50, "KADOKAWA / メディアファクトリー", "paperback", "2015-05-25", "JP", "ja", "retail", "一年级篇第1卷。", {"volume": 1, "isbn": "9784040676579"}, [(86, 1, "第1巻 本文", "Book", "novel", 0)])
     ]),

    (48, "药屋少女的呢喃", "薬屋のひとりごと", ["The Apothecary Diaries", "猫猫", "壬氏", "日向夏"], "2014-08-29", "2014-08-29", "", False, "日本", "ja", "ja",
     "日向夏著、しのとうこ插画的东方宫廷本格推理小说。花街长大的药师少女猫猫被拐入宫中成为下级宫女，凭借丰富的草药毒物知识与冷静的推理能力破解后宫深宫重重诡异谜案。",
     "https://lain.bgm.tv/pic/cover/l/7f/f3/245842_x2mK5.jpg",
     {"label": "ヒーロー文庫", "format": "light_novel"},
     ["图书", "小说", "轻小说", "推理", "悬疑", "历史架空", "日常"], 42,
     {"en-US": ("The Apothecary Diaries", "Court mystery novel series by Natsu Hyuuga following Maomao solving royal intrigue through herbal medicine and deduction."),
      "ja": ("薬屋のひとりごと", "日向夏による後宮謎解きエンタメノベル。薬師の少女・猫猫の毒殺推理。")},
     [
         (87, "日文文库版 第1卷", "978-4-07-298198-6", "9784072981986", None, "主婦の友社 (ヒーロー文庫)", "paperback", "2014-08-29", "JP", "ja", "retail", "英雄文库第1卷。", {"volume": 1, "isbn": "9784072981986"}, [(87, 1, "第1巻 本文", "Book", "novel", 0)])
     ]),

    (49, "刀剑神域进击篇", "ソードアート・オンライン プログレッシブ", ["Sword Art Online Progressive", "SAOP", "艾恩葛朗特逐层攻略", "川原砾"], "2012-10-10", "2012-10-10", "", False, "日本", "ja", "ja",
     "川原砾著、abec插画的《刀剑神域》艾恩葛朗特篇官方重启与逐层详述企划。从第一层托尔巴纳迷宫区起始，细致重现桐人与亚丝娜相遇及两人逐层攻略浮游城艾恩葛朗特的冒险细节。",
     "https://lain.bgm.tv/pic/cover/l/b8/67/237583_zK0Zq.jpg",
     {"label": "電撃文庫", "format": "light_novel"},
     ["图书", "小说", "轻小说", "科幻", "游戏竞技", "冒险", "电击文库"], None, # 川原砾 already in deadbeef
     {"en-US": ("Sword Art Online Progressive", "Detailed floor-by-floor reboot of the Aincrad arc by Reki Kawahara with abec."),
      "ja": ("ソードアート・オンライン プログレッシブ", "川原礫によるアインクラッド第一層からの完全攻略リブート作。")},
     [
         (88, "日文文库版 第1卷 (第1-2层)", "978-4-04-886977-5", "9784048869775", 50, "KADOKAWA / アスキー・メディアワークス", "paperback", "2012-10-10", "JP", "ja", "retail", "收录第1-2层攻略故事与无星夜的咏叹调。", {"volume": 1, "isbn": "9784048869775"}, [(88, 1, "第1巻 本文", "Book", "novel", 0)])
     ]),

    (50, "某魔法的禁书目录", "とある魔術の禁書目録", ["A Certain Magical Index", "魔禁", "上条当麻", "茵蒂克丝", "镰池和马魔禁"], "2004-04-10", "2004-04-10", "2010-10-10", True, "日本", "ja", "ja",
     "镰池和马著、灰村清孝插画的超长篇轻小说巅峰。以科学超能力盛行的学园都市与传承古老神秘的魔法世界交织碰撞为舞台，拥有能够抹杀一切异能之'幻想杀手'右手的上条当麻拯救少女茵蒂克丝。",
     "https://lain.bgm.tv/pic/cover/l/3d/bf/92160_t1qX3.jpg",
     {"volumes": 22, "label": "電撃文庫", "format": "light_novel"},
     ["图书", "小说", "轻小说", "奇幻", "科幻", "热血", "校园", "电击文库"], None, # 镰池和马 in cafef00d
     {"en-US": ("A Certain Magical Index", "Legendary light novel series by Kazuma Kamachi intertwining Academy City's espers and ancient magical cabals."),
      "ja": ("とある魔術の禁書目録", "鎌池和馬による電撃文庫の金字塔。科学と魔術が交差する学園都市ファンタジー。")},
     [
         (89, "日文文库版 第1卷 初版", "978-4-8402-2658-5", "9784840226585", 50, "メディアワークス / 電撃文庫", "paperback", "2004-04-10", "JP", "ja", "retail", "电击文库首卷。", {"volume": 1, "isbn": "9784840226585"}, [(89, 1, "第1巻 本文", "Book", "novel", 0)]),
         (90, "日文文库版 完结第22卷", "978-4-04-868972-4", "9784048689724", 50, "アスキー・メディアワークス / 電撃文庫", "paperback", "2010-10-10", "JP", "ja", "retail", "旧约完结卷 第三次世界大战终章。", {"volume": 22, "isbn": "9784048689724", "is_final": True}, [(90, 1, "第22巻 本文", "Book", "novel", 0)])
     ]),

    # --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    # 4. 世界观设定集、官方艺术画册与资料集 (5部)
    # --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    (51, "艾尔登法环 官方艺术设定集", "ELDEN RING OFFICIAL ART BOOK", ["Elden Ring Artbook", "老头环设定集", "交界地艺术集", "FromSoftware设定集"], "2022-11-30", "2022-11-30", "2022-11-30", True, "日本", "ja", "ja",
     "FromSoftware与角川联袂推出的《艾尔登法环》官方权威艺术画集（Volume I & Volume II）。收录交界地宏伟壮丽的场景概念原画、各色登场人物NPC与可怕半神、铠甲武器装备及地下墓穴生态全景细节。",
     "https://lain.bgm.tv/pic/cover/l/d4/06/141444_m0M7z.jpg",
     {"pages": 800, "volumes": 2, "format": "artbook"},
     ["图书", "画集", "设定集", "资料集", "奇幻", "黑暗奇幻", "艾尔登法环", "魂系"], 43,
     {"en-US": ("ELDEN RING OFFICIAL ART BOOK", "Two-volume official art book set for FromSoftware's masterpiece Elden Ring featuring concept art of the Lands Between."),
      "ja": ("ELDEN RING OFFICIAL ART BOOK", "フロム・ソフトウェアによる『ELDEN RING』公式画集。壮大な狭間の地のアートワークを網羅。")},
     [
         (91, "日文限定两卷套装 (Volume I & II)", "978-4-04-737357-0", "9784047373570", 50, "KADOKAWA Game Linkage", "box_set", "2022-11-30", "JP", "ja", "retail", "两卷合计超过800页的全彩精装豪华大开本。", {"pages": 800, "isbn": "9784047373570"}, [(91, 1, "Volume I 场景与世界观", "Book", "gallery", 0), (92, 2, "Volume II 敌人与武器设定", "Book", "gallery", 0)]),
         (93, "英文精装引进版 (Udon Entertainment)", "978-1-77294-279-8", "9781772942798", None, "Udon Entertainment", "hardcover", "2023-07-25", "US", "en-US", "retail", "English Edition Volume 1.", {"isbn": "9781772942798"}, [(93, 1, "Artbook Hardcover", "Book", "gallery", 0)])
     ]),

    (52, "赛博朋克2077 设定集：夜之城的世界", "The World of Cyberpunk 2077", ["World of Cyberpunk 2077", "夜之城设定集", "2077艺术集", "CDPR设定集"], "2020-07-28", "2020-07-28", "2020-07-28", True, "美国", "en-US", "en",
     "Dark Horse Books与CD PROJEKT RED深度联合编写的《赛博朋克2077》官方世界观宝典。全方位拆解夜之城六大城区的地理历史、赛博植入体义体科技、超梦体验、帮派势力分布与荒坂军用科技巨头内幕。",
     "https://coverartarchive.org/release/cb9f64bf-1b86-4f40-b6a6-0683a37213bb/front.jpg",
     {"pages": 192, "format": "lorebook"},
     ["图书", "设定集", "资料集", "画集", "科幻", "赛博朋克", "赛博朋克2077"], 44,
     {"en-US": ("The World of Cyberpunk 2077", "Official lore and art book by Dark Horse and CD PROJEKT RED detailing the history, technology, and gangs of Night City."),
      "ja": ("ワールド・オブ・サイバーパンク2077", "CD PROJEKT RED公式監修。ナイトシティの歴史・テクノロジー・裏社会を網羅した世界観ガイド。")},
     [
         (94, "英文原版精装大开本 (Dark Horse Books)", "978-1-5067-1358-8", "9781506713588", None, "Dark Horse Books", "hardcover", "2020-07-28", "US", "en-US", "retail", "Dark Horse Hardcover Deluxe Lorebook.", {"isbn": "9781506713588"}, [(94, 1, "The World of Cyberpunk 2077", "Book", "novel", 0)]),
         (95, "中文引进精装典藏版（四川美术出版社）", "978-7-5410-9426-2", "9787541094262", None, "四川美术出版社 / 读客", "hardcover", "2020-11-01", "CN", "zh-CN", "retail", "中文全彩精装大开本。", {"isbn": "9787541094262"}, [(95, 1, "正文", "Book", "novel", 0)])
     ]),

    (53, "魔兽世界编年史", "World of Warcraft: Chronicle", ["WoW Chronicle", "魔兽编年史", "泰坦与古神", "暴雪编年史"], "2016-03-15", "2016-03-15", "2018-03-27", True, "美国", "en-US", "en",
     "暴雪娱乐官方正统编年史三卷本。克里斯·梅森等暴雪核心叙事主创亲笔打造，Peter Lee与Joseph Lacroix绘制史诗插画，系统厘清艾泽拉斯宇宙诞生、泰坦秩序、古神封印、守护巨龙与部落联盟全史。",
     "https://image.tmdb.org/t/p/original/7jE5qQ1v9kX3q7k7m4N8uUa7zUj.jpg",
     {"volumes": 3, "format": "chronicle"},
     ["图书", "设定集", "资料集", "画集", "奇幻", "魔兽世界"], 45,
     {"en-US": ("World of Warcraft: Chronicle", "Three-volume definitive lore chronicle by Blizzard Entertainment and Dark Horse detailing the history and cosmos of Azeroth."),
      "ja": ("ワールド オブ ウォークラフト クロニクル", "ブリザード公式によるアゼロス創世と大戦の歴史を綴った正統クロニクル全3巻。")},
     [
         (96, "英文精装第一卷 (Dark Horse Books)", "978-1-61655-845-1", "9781616558451", None, "Dark Horse Books", "hardcover", "2016-03-15", "US", "en-US", "retail", "Volume 1: Creation of the Cosmos through the Rise of the Horde.", {"isbn": "9781616558451", "volume": 1}, [(96, 1, "Chronicle Volume 1", "Book", "novel", 0)]),
         (97, "中文精装全三卷典藏盒装（新星出版社）", "978-7-5133-2101-2", "9787513321012", None, "新星出版社", "box_set", "2018-05-01", "CN", "zh-CN", "retail", "刘尔铎等翻译，官方典藏三部曲全彩精装。", {"volumes": 3, "isbn": "9787513321012"}, [(97, 1, "卷一：创世与上古", "Book", "novel", 0), (98, 2, "卷二：德拉诺与二次大战", "Book", "novel", 0), (99, 3, "卷三：天灾军团与现代", "Book", "novel", 0)])
     ]),

    (54, "塞尔达传说：旷野之息 大师之书", "ゼルダの伝説 30周年記念書籍 第3集 THE LEGEND OF ZELDA BREATH OF THE WILD: MASTER WORKS", ["Breath of the Wild Master Works", "大师之书", "旷野之息设定集", "任天堂设定集"], "2017-12-15", "2017-12-15", "2017-12-15", True, "日本", "ja", "ja",
     "任天堂官方授权制作的《塞尔达传说：旷野之息》终极艺术设定资料宝典。全书分为'艺术原画'、'资料设定'、'海拉鲁历史'三大章节，收录上千幅未公开概念设计稿与主创人员对海拉鲁灭亡百年史的独家访谈。",
     "https://coverartarchive.org/release/3eef8a56-8a71-4fe1-92b8-f6a6176fc805/front.jpg",
     {"pages": 416, "format": "master_works"},
     ["图书", "画集", "设定集", "资料集", "奇幻", "冒险", "塞尔达传说"], 46,
     {"en-US": ("The Legend of Zelda: Breath of the Wild - Creating a Champion", "Ultimate master works art and design documentation book by Nintendo and Dark Horse for Breath of the Wild."),
      "ja": ("ゼルダの伝説 ブレス オブ ザ ワイルド: MASTER WORKS", "任天堂公式『ブレス オブ ザ ワイルド』完全設定資料集。ハイラル100年の歴史と未公開アート。")},
     [
         (100, "日文原版精装大开本 (徳間書店)", "978-4-19-864535-9", "9784198645359", None, "徳間書店 / アンビット", "hardcover", "2017-12-15", "JP", "ja", "retail", "全416页全彩超大开本设定集。", {"pages": 416, "isbn": "9784198645359"}, [(100, 1, "マスターワークス 本文", "Book", "gallery", 0)]),
         (101, "英文精装引进版 (Dark Horse Books)", "978-1-5067-1010-5", "9781506710105", None, "Dark Horse Books", "hardcover", "2018-11-20", "US", "en-US", "retail", "English edition: Creating a Champion.", {"isbn": "9781506710105"}, [(101, 1, "Creating a Champion", "Book", "gallery", 0)])
     ]),

    (55, "黑暗之魂 官方艺术设定集", "DARK SOULS TRILOGY - ARCHIVE OF THE FIRE", ["Dark Souls Artbook", "黑魂设定集", "传火档案", "FromSoftware黑魂"], "2018-05-24", "2018-05-24", "2018-05-24", True, "日本", "ja", "ja",
     "FromSoftware官方推出的《黑暗之魂》三部曲典藏视觉概念资料集。完整收录罗德兰、多兰古雷格与洛斯里克三代火之时代的美术概念图、Boss原画、武器装备与装备说明文深层叙事文本。",
     "https://image.tmdb.org/t/p/original/TkTPELv4kC3u1lkloush8skOjE.jpg",
     {"pages": 384, "format": "artbook"},
     ["图书", "画集", "设定集", "资料集", "奇幻", "黑暗奇幻", "黑暗之魂", "魂系"], 43,
     {"en-US": ("Dark Souls: Design Works", "Comprehensive visual artbook compilation covering FromSoftware's Dark Souls Trilogy."),
      "ja": ("DARK SOULS TRILOGY ARCHIVE OF THE FIRE", "フロム・ソフトウェアによるダークソウル三部作の完全美術設定資料集。")},
     [
         (102, "日文三部曲综合设计集 (KADOKAWA)", "978-4-04-893798-6", "9784048937986", 50, "KADOKAWA Game Linkage", "hardcover", "2018-05-24", "JP", "ja", "retail", "黑魂三部曲传火档案全彩艺术集。", {"pages": 384, "isbn": "9784048937986"}, [(102, 1, "本文 原画与设定", "Book", "gallery", 0)])
     ])
]

print("Defined works count:", len(WORKS))

# Now generate SQL statements
sql_lines = []

sql_lines.append("-- 30_books_webnovel_samples.sql")
sql_lines.append("-- MetaFusion 经典图书、网络文学、世界名著、轻小说与官方设定集核心种子数据集 (55部经典作品)")
sql_lines.append("-- 固定 UUID 前缀 bb000000-0000-4000-8000-")
sql_lines.append("-- 遵循 LRM 规范：纯净作品名、Release 分卷呈现、多维标签体系、work_translations、cover_aspect = '3:4'")
sql_lines.append("")
sql_lines.append("BEGIN;")
sql_lines.append("")
sql_lines.append("SELECT setval(pg_get_serial_sequence('tags', 'id'), COALESCE((SELECT MAX(id) FROM tags), 1));")
sql_lines.append("")
sql_lines.append("-- ---------------------------------------------------------------------------")
sql_lines.append("-- 0. 标签扩充 (Tags)")
sql_lines.append("-- ---------------------------------------------------------------------------")
sql_lines.append("INSERT INTO tags (name, group_type, category_scope) VALUES")
tag_values = []
for tag_name, group_type in TAGS:
    tag_values.append(f"({sql_str(tag_name)}, {sql_str(group_type)}, '{{}}')")
sql_lines.append(",\n".join(tag_values))
sql_lines.append("ON CONFLICT (name) DO NOTHING;")
sql_lines.append("")

sql_lines.append("-- ---------------------------------------------------------------------------")
sql_lines.append("-- 1. 创作者与出版社 (Artists / Authors / Studios / Publishers)")
sql_lines.append("-- ---------------------------------------------------------------------------")
sql_lines.append("INSERT INTO artists (id, name, original_name, disambiguation, entity_type, country, biography, begin_date, end_date, ended, external_ids) VALUES")
artist_values = []
for artist_idx, name, orig_name, disambig, etype, country, bio, bdate, ext_ids, trans in ARTISTS:
    aid = get_uuid(2, artist_idx)
    artist_values.append(f"('{aid}', {sql_str(name)}, {sql_str(orig_name)}, {sql_str(disambig)}, {sql_str(etype)}, {sql_str(country)}, {sql_str(bio)}, {sql_str(bdate)}, '', FALSE, {sql_json(ext_ids)})")
sql_lines.append(",\n".join(artist_values))
sql_lines.append("ON CONFLICT (id) DO UPDATE SET")
sql_lines.append("    name = EXCLUDED.name,")
sql_lines.append("    original_name = EXCLUDED.original_name,")
sql_lines.append("    disambiguation = EXCLUDED.disambiguation,")
sql_lines.append("    biography = EXCLUDED.biography,")
sql_lines.append("    country = EXCLUDED.country,")
sql_lines.append("    external_ids = EXCLUDED.external_ids;")
sql_lines.append("")

sql_lines.append("-- 艺术家多语言翻译 (Artist Translations)")
sql_lines.append("INSERT INTO artist_translations (artist_id, locale, name, biography) VALUES")
atrans_values = []
for artist_idx, name, orig_name, disambig, etype, country, bio, bdate, ext_ids, trans in ARTISTS:
    aid = get_uuid(2, artist_idx)
    for loc, (tname, tbio) in trans.items():
        atrans_values.append(f"('{aid}', {sql_str(loc)}, {sql_str(tname)}, {sql_str(tbio)})")
sql_lines.append(",\n".join(atrans_values))
sql_lines.append("ON CONFLICT (artist_id, locale) DO UPDATE SET name = EXCLUDED.name, biography = EXCLUDED.biography;")
sql_lines.append("")

sql_lines.append("-- ---------------------------------------------------------------------------")
sql_lines.append("-- 2. 作品库 (Works - 55部高质量图书与网络文学作品)")
sql_lines.append("-- ---------------------------------------------------------------------------")
sql_lines.append("INSERT INTO works (id, category_code, title, original_title, aliases, release_date, begin_date, end_date, ended, country, language, original_language, summary, cover_image_url, cover_aspect, status, created_by, catalog_metadata) VALUES")
work_values = []
for work in WORKS:
    w_idx, title, orig_title, aliases, rdate, bdate, edate, ended, country, lang, orig_lang, summary, cover_url, cat_meta, tags, author_idx, trans, releases = work
    wid = get_uuid(1, w_idx)
    rdate_val = sql_str(rdate) if rdate else "NULL"
    work_values.append(f"('{wid}', '', {sql_str(title)}, {sql_str(orig_title)}, {sql_arr(aliases)}, {rdate_val}, {sql_str(bdate)}, {sql_str(edate)}, {'TRUE' if ended else 'FALSE'}, {sql_str(country)}, {sql_str(lang)}, {sql_str(orig_lang)}, {sql_str(summary)}, {sql_str(cover_url)}, '3:4', 'completed', '00000000-0000-0000-0000-000000000001', {sql_json(cat_meta)})")
sql_lines.append(",\n".join(work_values))
sql_lines.append("ON CONFLICT (id) DO UPDATE SET")
sql_lines.append("    title = EXCLUDED.title,")
sql_lines.append("    original_title = EXCLUDED.original_title,")
sql_lines.append("    aliases = EXCLUDED.aliases,")
sql_lines.append("    summary = EXCLUDED.summary,")
sql_lines.append("    cover_image_url = EXCLUDED.cover_image_url,")
sql_lines.append("    cover_aspect = EXCLUDED.cover_aspect,")
sql_lines.append("    catalog_metadata = EXCLUDED.catalog_metadata;")
sql_lines.append("")

sql_lines.append("-- 作品多语言翻译 (Work Translations)")
sql_lines.append("INSERT INTO work_translations (work_id, locale, title, summary) VALUES")
wtrans_values = []
for work in WORKS:
    w_idx, title, orig_title, aliases, rdate, bdate, edate, ended, country, lang, orig_lang, summary, cover_url, cat_meta, tags, author_idx, trans, releases = work
    wid = get_uuid(1, w_idx)
    for loc, (ttitle, tsummary) in trans.items():
        wtrans_values.append(f"('{wid}', {sql_str(loc)}, {sql_str(ttitle)}, {sql_str(tsummary)})")
sql_lines.append(",\n".join(wtrans_values))
sql_lines.append("ON CONFLICT (work_id, locale) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary;")
sql_lines.append("")

sql_lines.append("-- 作品标签关联 (Work Tag Relations)")
sql_lines.append("INSERT INTO work_tag_relations (work_id, tag_id)")
sql_lines.append("SELECT w.id, t.id FROM (VALUES")
wtag_values = []
for work in WORKS:
    w_idx, title, orig_title, aliases, rdate, bdate, edate, ended, country, lang, orig_lang, summary, cover_url, cat_meta, tags, author_idx, trans, releases = work
    wid = get_uuid(1, w_idx)
    for tname in tags:
        wtag_values.append(f"    ('{wid}'::uuid, {sql_str(tname)})")
sql_lines.append(",\n".join(wtag_values))
sql_lines.append(") AS w(id, tag_name)")
sql_lines.append("JOIN tags t ON t.name = w.tag_name")
sql_lines.append("ON CONFLICT DO NOTHING;")
sql_lines.append("")

sql_lines.append("-- 作品-创作者关系 (Work Artist Relations)")
sql_lines.append("INSERT INTO work_artist_relations (work_id, artist_id, role)")
sql_lines.append("SELECT v.work_id, v.artist_id, v.role")
sql_lines.append("FROM (VALUES")
wart_values = []
for work in WORKS:
    w_idx, title, orig_title, aliases, rdate, bdate, edate, ended, country, lang, orig_lang, summary, cover_url, cat_meta, tags, author_idx, trans, releases = work
    wid = get_uuid(1, w_idx)
    if author_idx:
        aid = get_uuid(2, author_idx)
        role = "studio" if author_idx in [43, 44, 45, 46] else "author"
        wart_values.append(f"    ('{wid}'::uuid, '{aid}'::uuid, '{role}')")
    elif w_idx == 49: # SAOP -> 川原砾
        wart_values.append(f"    ('{wid}'::uuid, 'deadbeef-0000-4000-8000-000000000201'::uuid, 'author')")
    elif w_idx == 50: # 魔禁 -> 镰池和马
        wart_values.append(f"    ('{wid}'::uuid, 'cafef00d-0000-4000-8000-000000000211'::uuid, 'author')")
sql_lines.append(",\n".join(wart_values))
sql_lines.append(") AS v(work_id, artist_id, role)")
sql_lines.append("WHERE EXISTS (SELECT 1 FROM works w WHERE w.id = v.work_id)")
sql_lines.append("  AND EXISTS (SELECT 1 FROM artists a WHERE a.id = v.artist_id)")
sql_lines.append("  AND NOT EXISTS (")
sql_lines.append("      SELECT 1 FROM work_artist_relations r")
sql_lines.append("      WHERE r.work_id = v.work_id AND r.artist_id = v.artist_id AND r.role = v.role")
sql_lines.append("  );")
sql_lines.append("")

sql_lines.append("-- ---------------------------------------------------------------------------")
sql_lines.append("-- 3. 发行版 (Releases)")
sql_lines.append("-- ---------------------------------------------------------------------------")
sql_lines.append("INSERT INTO releases (id, work_id, publisher_id, edition_name, catalog_number, barcode, publisher, packaging, edition_date, country, language, distribution_channel, is_master_verified, notes, catalog_metadata) VALUES")
rel_values = []
for work in WORKS:
    w_idx, title, orig_title, aliases, rdate, bdate, edate, ended, country, lang, orig_lang, summary, cover_url, cat_meta, tags, author_idx, trans, releases = work
    wid = get_uuid(1, w_idx)
    for rel in releases:
        rel_idx, edition_name, cat_num, barcode, pub_idx, pub_name, packaging, edate, rcountry, rlang, dist_chan, notes, rcat_meta, mediums = rel
        rid = get_uuid(3, rel_idx)
        pub_id_str = f"'{get_uuid(2, pub_idx)}'" if pub_idx else "NULL"
        edate_val = sql_str(edate) if edate else "NULL"
        rel_values.append(f"('{rid}', '{wid}', {pub_id_str}, {sql_str(edition_name)}, {sql_str(cat_num)}, {sql_str(barcode)}, {sql_str(pub_name)}, {sql_str(packaging)}, {edate_val}, {sql_str(rcountry)}, {sql_str(rlang)}, {sql_str(dist_chan)}, TRUE, {sql_str(notes)}, {sql_json(rcat_meta)})")
sql_lines.append(",\n".join(rel_values))
sql_lines.append("ON CONFLICT (id) DO UPDATE SET")
sql_lines.append("    edition_name = EXCLUDED.edition_name,")
sql_lines.append("    catalog_number = EXCLUDED.catalog_number,")
sql_lines.append("    barcode = EXCLUDED.barcode,")
sql_lines.append("    publisher = EXCLUDED.publisher,")
sql_lines.append("    packaging = EXCLUDED.packaging,")
sql_lines.append("    notes = EXCLUDED.notes,")
sql_lines.append("    catalog_metadata = EXCLUDED.catalog_metadata;")
sql_lines.append("")

sql_lines.append("-- ---------------------------------------------------------------------------")
sql_lines.append("-- 4. 载体层 (Mediums)")
sql_lines.append("-- ---------------------------------------------------------------------------")
sql_lines.append("INSERT INTO mediums (id, release_id, position, name, format, media_category, track_count) VALUES")
med_values = []
for work in WORKS:
    for rel in work[17]:
        rel_idx = rel[0]
        rid = get_uuid(3, rel_idx)
        for med in rel[13]:
            med_idx, pos, mname, mformat, mcat, tcount = med
            mid = get_uuid(4, med_idx)
            med_values.append(f"('{mid}', '{rid}', {pos}, {sql_str(mname)}, {sql_str(mformat)}, {sql_str(mcat)}, {tcount})")
sql_lines.append(",\n".join(med_values))
sql_lines.append("ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, format = EXCLUDED.format, media_category = EXCLUDED.media_category;")
sql_lines.append("")

sql_lines.append("COMMIT;")
sql_lines.append("")

full_sql = "\n".join(sql_lines)

with open("deploy/init_db/30_books_webnovel_samples.sql", "w", encoding="utf-8") as f:
    f.write(full_sql)

print("Generated deploy/init_db/30_books_webnovel_samples.sql successfully! Total chars:", len(full_sql))

