import urllib.request
import urllib.error
import json
import ssl
import sys

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
        "sources": [{"kind": "url", "citation": "Bushiroad Music Official", "url": source_url}]
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

token = mf_login("MoeCaa", "Ytc0123456789@")

# 查找《迷跡波》Work UUID
req = urllib.request.Request(f"{BASE_URL}/catalog/entities?q=%E8%BF%B7%E8%B7%A1%E6%B3%A2", headers={"Authorization": f"Bearer {token}", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
    items = json.loads(resp.read().decode('utf-8')).get("items", [])
    album_work = items[0] if items else None

if not album_work:
    print("Album work not found")
    sys.exit(1)

album_work_id = album_work["id"]
print(f"Found Album Work: {album_work['title']} ({album_work_id})")

# 1. 创建《迷跡波》通常盘 Release
rel_std = mf_create_entity({
    "kind": "release",
    "title": "迷跡波 【通常盤】",
    "original_language": "ja",
    "translations": {
        "ja": {"title": "迷跡波 【通常盤】"},
        "zh": {"title": "迷迹波 【通常盘】 (CD only)"}
    },
    "types": ["release"],
    "attributes": {"catalog_number": "BRMM-10709", "edition_date": "2023-11-01", "packaging": "standard"},
    "external_ids": {"catalog_no": "BRMM-10709"},
    "pictures": [],
    "subjects": [{"work_id": album_work_id, "role": "primary", "position": 0}],
    "status": "published"
}, "创建《迷跡波》通常盘 Release", "https://bushiroad-music.com/musics/brmm-10708_10709/", token)

if rel_std:
    print(f"✓ Created Release 通常盘: {rel_std['id']}")
    # 创建下属 Medium (CD)
    med_cd1 = mf_create_entity({
        "kind": "medium",
        "release_id": rel_std["id"],
        "title": "Disc 1 (CD)",
        "original_language": "ja",
        "translations": {"zh": {"title": "CD 唱片"}},
        "types": ["medium"],
        "attributes": {"format": "cd", "role": "primary"},
        "position": 0,
        "number": "1",
        "pictures": [],
        "status": "published"
    }, "创建通常盘 Medium CD", "https://bushiroad-music.com/musics/brmm-10708_10709/", token)
    if med_cd1:
        print(f"  ✓ Created Medium CD: {med_cd1['id']}")

# 2. 创建《迷跡波》蓝光付生产限定盘 Release (CD + Blu-ray)
rel_ltd = mf_create_entity({
    "kind": "release",
    "title": "迷跡波 【Blu-ray付生産限定盤】",
    "original_language": "ja",
    "translations": {
        "ja": {"title": "迷跡波 【Blu-ray付生産限定盤】"},
        "zh": {"title": "迷迹波 【附带蓝光光盘初回生产限定盘】 (CD + BD)"}
    },
    "types": ["release"],
    "attributes": {"catalog_number": "BRMM-10708", "edition_date": "2023-11-01", "packaging": "box"},
    "external_ids": {"catalog_no": "BRMM-10708"},
    "pictures": [],
    "subjects": [{"work_id": album_work_id, "role": "primary", "position": 0}],
    "status": "published"
}, "创建《迷跡波》初回限定盘 Release", "https://bushiroad-music.com/musics/brmm-10708_10709/", token)

if rel_ltd:
    print(f"✓ Created Release 限定盘: {rel_ltd['id']}")
    # 创建下属 Medium 1: CD
    med_cd2 = mf_create_entity({
        "kind": "medium",
        "release_id": rel_ltd["id"],
        "title": "Disc 1: 迷跡波 (Audio CD)",
        "original_language": "ja",
        "translations": {"zh": {"title": "CD 录音唱片"}},
        "types": ["medium"],
        "attributes": {"format": "cd", "role": "primary"},
        "position": 0,
        "number": "1",
        "pictures": [],
        "status": "published"
    }, "创建限定盘 Medium CD", "https://bushiroad-music.com/musics/brmm-10708_10709/", token)

    # 创建下属 Medium 2: Blu-ray Disc (Live 演唱会影像)
    med_bd = mf_create_entity({
        "kind": "medium",
        "release_id": rel_ltd["id"],
        "title": "Disc 2: MyGO!!!!! 4th LIVE「前へ進む音の中で」 (Blu-ray Disc)",
        "original_language": "ja",
        "translations": {"zh": {"title": "演唱会现场蓝光光盘 (BD)"}},
        "types": ["medium"],
        "attributes": {"format": "bd", "role": "supplement"},
        "position": 1,
        "number": "2",
        "pictures": [],
        "status": "published"
    }, "创建限定盘 Medium BD", "https://bushiroad-music.com/musics/brmm-10708_10709/", token)

    if med_cd2 and med_bd:
        print(f"  ✓ Created Mediums for 限定盘: CD ({med_cd2['id']}) + BD ({med_bd['id']})")

print("Bushiroad multi-release creation completed successfully!")
