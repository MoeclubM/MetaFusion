import urllib.request
import urllib.error
import json
import ssl
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE_URL = "https://findverse.cc/api"
BGM_API = "https://api.bgm.tv/v0"
BGM_HEADERS = {"User-Agent": "MoeclubM/MetaFusion (contact: qytc233@gmail.com)"}

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def bgm_get(path):
    url = f"{BGM_API}{path}"
    req = urllib.request.Request(url, headers=BGM_HEADERS)
    for retry in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception as e:
            time.sleep(1)
    return None

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
        "sources": [{"kind": "url", "citation": "Bangumi 番组计划", "url": source_url}]
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
        print(f"Error creating entity {entity_data.get('title')}: {e.code} -> {e.read().decode('utf-8', errors='replace')}")
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
        "sources": [{"kind": "url", "citation": "Bangumi 关联图谱", "url": source_url}]
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
root_id = "ea8c8cd1-c75b-4919-9f02-b61e9a082b44"
name = "BanG Dream! It's MyGO!!!!!"
print(f"Using MyGO Work: {name} (UUID: {root_id})")

# 关联条目
rel_subjects = bgm_get("/subjects/428735/subjects") or []
print(f"Found {len(rel_subjects)} related subjects for MyGO!!!!!")

type_map = {1: ["novel"], 2: ["animation"], 3: ["music"], 4: ["game"]}

for rel in rel_subjects:
    r_id = rel.get("id")
    r_name = rel.get("name") or "Untitled"
    r_name_cn = rel.get("name_cn") or r_name
    r_type = rel.get("type", 2)
    r_rel = rel.get("relation_type", "")
    r_url = f"https://bangumi.tv/subject/{r_id}"

    detail = bgm_get(f"/subjects/{r_id}") or {}
    r_summary = detail.get("summary", "")
    r_pics = []
    if detail.get("images", {}).get("large"):
        r_pics.append({
            "url": detail["images"]["large"],
            "caption": {"zh-CN": f"{r_name_cn} 封面", "en-US": f"{r_name} Cover"},
            "source": {"kind": "url", "citation": "Bangumi", "url": r_url}
        })

    rel_types = type_map.get(r_type, ["animation"])
    if any(k in r_rel for k in ["原声", "片头曲", "片尾曲", "角色歌", "音乐", "单曲", "专辑"]):
        rel_types = ["music"]

    related_work = mf_create_entity({
        "kind": "work",
        "title": r_name,
        "original_language": "ja",
        "translations": {
            "ja": {"title": r_name, "summary": r_summary},
            "zh": {"title": r_name_cn, "summary": r_summary}
        },
        "types": rel_types,
        "attributes": {},
        "external_ids": {"bangumi": str(r_id)},
        "pictures": r_pics,
        "status": "published"
    }, f"导入关联条目 [{r_rel}]: {r_name}", r_url, token)

    if not related_work:
        continue

    target_uuid = related_work["id"]
    print(f"  ✓ 关联作品 [{r_rel}]: {r_name} ({r_name_cn}) -> UUID: {target_uuid}")

    if "续集" in r_rel or "续作" in r_rel:
        mf_create_relation("sequel_of", target_uuid, root_id, f"续作关联: {r_name}", r_url, token)
        print(f"    * 关系: {r_name} --[续作于 sequel_of]--> {name}")
    elif "前传" in r_rel:
        mf_create_relation("sequel_of", root_id, target_uuid, f"前传关联: {r_name}", r_url, token)
        print(f"    * 关系: {name} --[续作于 sequel_of]--> {r_name}")
    elif any(k in r_rel for k in ["原声集", "片头曲", "片尾曲", "角色歌", "插曲", "音乐", "单曲", "专辑"]):
        mf_create_relation("soundtrack_of", target_uuid, root_id, f"配乐单曲关联: {r_name}", r_url, token)
        print(f"    * 关系: {r_name} --[配乐用于 soundtrack_of]--> {name}")
    elif any(k in r_rel for k in ["不同演绎", "总集篇", "番外", "衍生"]):
        mf_create_relation("adaptation_of", target_uuid, root_id, f"总集篇/衍生关联: {r_name}", r_url, token)
        print(f"    * 关系: {r_name} --[改编自 adaptation_of]--> {name}")
    elif "主线故事" in r_rel or "系列" in r_rel:
        mf_create_relation("adaptation_of", root_id, target_uuid, f"所属企划/系列: {r_name}", r_url, token)
        print(f"    * 关系: {name} --[所属企划 adaptation_of]--> {r_name}")

# 演职员
persons = bgm_get("/subjects/428735/persons") or []
print(f"Found {len(persons)} persons for MyGO!!!!!")
for p in persons[:8]:
    p_name = p.get("name") or "Person"
    p_role = p.get("type") or "Staff"
    p_id = p.get("id")
    p_url = f"https://bangumi.tv/person/{p_id}"

    agent = mf_create_entity({
        "kind": "agent",
        "title": p_name,
        "original_language": "ja",
        "translations": {
            "ja": {"title": p_name},
            "zh": {"title": p_name}
        },
        "types": ["person"],
        "attributes": {},
        "external_ids": {"bangumi_person": str(p_id)},
        "pictures": [],
        "status": "published"
    }, f"导入演职员 Agent: {p_name}", p_url, token)

    if agent:
        agent_id = agent["id"]
        mf_create_relation("created_by", root_id, agent_id, f"制作署名: {p_role}", p_url, token)
        print(f"  ✓ 制作署名: {name} --[创作者 created_by]--> {p_name} ({p_role})")

print("MyGO!!!!! relations completed successfully!")
