import urllib.request
import urllib.error
import json
import ssl
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE_URL = "https://findverse.cc/api"
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def mf_login(username, password):
    url = f"{BASE_URL}/auth/login"
    data = json.dumps({"username": username, "password": password}).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", "User-Agent": "MetaFusion-Importer"})
    with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
        return json.loads(resp.read().decode('utf-8'))['token']

def mf_create_entity(entity_data, note, source_url, token):
    body = {
        "entity": entity_data,
        "expected_version": 0,
        "edit_note": note,
        "sources": [{"kind": "url", "citation": "Bangumi / Bushiroad Music", "url": source_url}]
    }
    req = urllib.request.Request(f"{BASE_URL}/catalog/entities", data=json.dumps(body).encode('utf-8'), headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "MetaFusion-Importer"
    })
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8', errors='replace')
        print(f"Error creating {entity_data.get('title')}: {e.code} -> {err}")
        return None

def mf_create_relation(rel_type, src_id, tgt_id, note, source_url, token):
    body = {
        "relation": {
            "type": rel_type,
            "source_id": src_id,
            "target_id": tgt_id,
            "position": 0,
            "attributes": {}
        },
        "expected_version": 0,
        "edit_note": note,
        "sources": [{"kind": "url", "citation": "Bushiroad Music / Bangumi 关联图谱", "url": source_url}]
    }
    req = urllib.request.Request(f"{BASE_URL}/catalog/relations", data=json.dumps(body).encode('utf-8'), headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "MetaFusion-Importer"
    })
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8', errors='replace')
        if "duplicate_relation" not in err:
            print(f"Error creating relation {rel_type}: {e.code} -> {err}")
        return None

token = mf_login("MoeCaa", "Ytc0123456789@")
mygo_anime_id = "ea8c8cd1-c75b-4919-9f02-b61e9a082b44" # BanG Dream! It's MyGO!!!!!

# 1. 创建企划母体 Collection: BanG Dream! 企划
bangdream_col = mf_create_entity({
    "kind": "collection",
    "title": "BanG Dream!",
    "original_language": "ja",
    "translations": {
        "ja": {"title": "BanG Dream!", "summary": "ブシロードによるメディアミックスプロジェクト。"},
        "zh": {"title": "BanG Dream! 梦想协奏曲", "summary": "武士道旗下次世代少女乐队跨媒体企划。"}
    },
    "types": ["collection"],
    "attributes": {},
    "external_ids": {"bangumi": "183207", "official": "https://bang-dream.com/"},
    "pictures": [{"url": "https://api.bgm.tv/v0/subjects/183207/image", "caption": {"zh-CN": "BanG Dream! 企划", "en-US": "BanG Dream! Franchise"}, "source": {"kind": "url", "citation": "Bangumi", "url": "https://bangumi.tv/subject/183207"}}],
    "status": "published"
}, "创建企划 Collection", "https://bangumi.tv/subject/183207", token)

if bangdream_col:
    mf_create_relation("includes", bangdream_col["id"], mygo_anime_id, "企划包含动画作品", "https://bangumi.tv/subject/428735", token)
    print("✓ Collection [BanG Dream!] --[includes]--> Work [BanG Dream! It's MyGO!!!!!]")

# 2. 创建 OP 歌曲 Work: 《壱雫空》 (Hitoshizuku)
op_song_work = mf_create_entity({
    "kind": "work",
    "title": "壱雫空",
    "original_language": "ja",
    "translations": {
        "ja": {"title": "壱雫空", "summary": "MyGO!!!!! 3rd Single，动画《BanG Dream! It's MyGO!!!!!》片头曲。"},
        "zh": {"title": "壱雫空 (一滴空)", "summary": "动画《BanG Dream! It's MyGO!!!!!》OP 主题曲。"}
    },
    "types": ["music", "song"],
    "attributes": {},
    "external_ids": {"bangumi": "440263", "bushiroad": "BRMM-10673"},
    "pictures": [{"url": "https://bushiroad-music.com/wp-content/uploads/2023/06/BRMM-10673_jk.jpg", "caption": {"zh-CN": "壱雫空 单曲封面", "en-US": "Hitoshizuku Single Cover"}, "source": {"kind": "url", "citation": "Bushiroad", "url": "https://bushiroad-music.com/musics/brmm-10673_10674/"}}],
    "status": "published"
}, "创建 OP 单曲 Work: 壱雫空", "https://bangumi.tv/subject/440263", token)

if op_song_work:
    mf_create_relation("soundtrack_of", op_song_work["id"], mygo_anime_id, "动画 OP 配乐", "https://bangumi.tv/subject/440263", token)
    print("✓ Work [壱雫空] --[soundtrack_of]--> Work [BanG Dream! It's MyGO!!!!!]")

# 3. 创建 ED 歌曲 Work: 《栞》 (Shiori)
ed_song_work = mf_create_entity({
    "kind": "work",
    "title": "栞",
    "original_language": "ja",
    "translations": {
        "ja": {"title": "栞", "summary": "MyGO!!!!! 3rd Single c/w 曲，动画《BanG Dream! It's MyGO!!!!!》片尾曲。"},
        "zh": {"title": "书签 (栞)", "summary": "动画《BanG Dream! It's MyGO!!!!!》ED 片尾曲。"}
    },
    "types": ["music", "song"],
    "attributes": {},
    "external_ids": {"bangumi": "440264"},
    "pictures": [],
    "status": "published"
}, "创建 ED 单曲 Work: 栞", "https://bangumi.tv/subject/440264", token)

if ed_song_work:
    mf_create_relation("soundtrack_of", ed_song_work["id"], mygo_anime_id, "动画 ED 配乐", "https://bangumi.tv/subject/440264", token)
    print("✓ Work [栞] --[soundtrack_of]--> Work [BanG Dream! It's MyGO!!!!!]")

# 4. 创建 1st 专辑 Work: 《迷跡波》 (Meisekiba)
album_work = mf_create_entity({
    "kind": "work",
    "title": "迷跡波",
    "original_language": "ja",
    "translations": {
        "ja": {"title": "迷跡波", "summary": "MyGO!!!!! 1st Album，收录动画全部主题曲与插曲。"},
        "zh": {"title": "迷迹波", "summary": "MyGO!!!!! 首张录音室完整专辑。"}
    },
    "types": ["music", "album"],
    "attributes": {},
    "external_ids": {"bangumi": "448660", "bushiroad": "BRMM-10708"},
    "pictures": [{"url": "https://bushiroad-music.com/wp-content/uploads/2023/09/BRMM-10708_jk.jpg", "caption": {"zh-CN": "迷跡波 专辑封面", "en-US": "Meisekiba Album Cover"}, "source": {"kind": "url", "citation": "Bushiroad", "url": "https://bushiroad-music.com/musics/brmm-10708_10709/"}}],
    "status": "published"
}, "创建完整专辑 Work: 迷跡波", "https://bangumi.tv/subject/448660", token)

if album_work:
    mf_create_relation("soundtrack_of", album_work["id"], mygo_anime_id, "动画原声/主题曲专辑", "https://bangumi.tv/subject/448660", token)
    print("✓ Work [迷跡波] --[soundtrack_of]--> Work [BanG Dream! It's MyGO!!!!!]")

# 5. 创建续篇动画 Work: 《BanG Dream! Ave Mujica》
ave_anime_work = mf_create_entity({
    "kind": "work",
    "title": "BanG Dream! Ave Mujica",
    "original_language": "ja",
    "translations": {
        "ja": {"title": "BanG Dream! Ave Mujica", "summary": "TVアニメ「BanG Dream! It's MyGO!!!!!」の続編。"},
        "zh": {"title": "BanG Dream! Ave Mujica", "summary": "电视动画《BanG Dream! It's MyGO!!!!!》正统续篇动画。"}
    },
    "types": ["animation"],
    "attributes": {},
    "external_ids": {"bangumi": "452959"},
    "pictures": [],
    "status": "published"
}, "创建续作动画 Work: BanG Dream! Ave Mujica", "https://bangumi.tv/subject/452959", token)

if ave_anime_work:
    mf_create_relation("sequel_of", ave_anime_work["id"], mygo_anime_id, "正统动画续篇", "https://bangumi.tv/subject/452959", token)
    print("✓ Work [BanG Dream! Ave Mujica] --[sequel_of]--> Work [BanG Dream! It's MyGO!!!!!]")

# 6. 创建 Bushiroad 经典多版本实体: 《迷跡波》 普通盘 vs 蓝光付生产限定盘
# 6.1 普通盘 Release
rel_std = mf_create_entity({
    "kind": "release",
    "title": "迷跡波 【通常盤】",
    "original_language": "ja",
    "translations": {
        "ja": {"title": "迷跡波 【通常盤】"},
        "zh": {"title": "迷迹波 【通常盘】 (CD only)"}
    },
    "types": ["release"],
    "attributes": {"catalog_number": "BRMM-10709", "format": "cd", "packaging": "standard", "edition_date": "2023-11-01"},
    "external_ids": {"catalog_no": "BRMM-10709"},
    "pictures": [],
    "subjects": [{"work_id": album_work["id"], "role": "primary", "position": 0}],
    "status": "published"
}, "创建《迷跡波》通常盘 Release", "https://bushiroad-music.com/musics/brmm-10708_10709/", token)

# 6.2 蓝光付生产限定盘 Release (包含 CD + 现场 Live 演唱会 Blu-ray)
rel_ltd = mf_create_entity({
    "kind": "release",
    "title": "迷跡波 【Blu-ray付生産限定盤】",
    "original_language": "ja",
    "translations": {
        "ja": {"title": "迷跡波 【Blu-ray付生産限定盤】"},
        "zh": {"title": "迷迹波 【附带蓝光光盘初回生产限定盘】 (CD + BD)"}
    },
    "types": ["release"],
    "attributes": {"catalog_number": "BRMM-10708", "format": "bd", "packaging": "box", "edition_date": "2023-11-01"},
    "external_ids": {"catalog_no": "BRMM-10708"},
    "pictures": [],
    "subjects": [{"work_id": album_work["id"], "role": "primary", "position": 0}],
    "status": "published"
}, "创建《迷跡波》限定盘 Release (CD+BD)", "https://bushiroad-music.com/musics/brmm-10708_10709/", token)

print("Bushiroad multi-release creation completed successfully!")
