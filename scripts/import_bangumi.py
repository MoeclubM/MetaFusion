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

def mf_find_by_bangumi_id(bgm_id, token):
    url = f"{BASE_URL}/catalog/entities?field=external_ids.bangumi&value={bgm_id}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "User-Agent": "MetaFusion-Importer"
    })
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            items = data.get("items", [])
            if items:
                return items[0]
    except Exception:
        pass
    return None

def mf_create_entity(entity_data, note, source_url, token):
    # 幂等检查
    bgm_id = entity_data.get("external_ids", {}).get("bangumi")
    if bgm_id:
        existing = mf_find_by_bangumi_id(bgm_id, token)
        if existing:
            return existing

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
        # duplicate_relation is OK
        err = e.read().decode('utf-8', errors='replace')
        if "duplicate_relation" not in err:
            print(f"Error creating relation {rel_type}: {e.code} -> {err}")
        return None

def import_subject_tree(root_subject_id, token):
    print(f"\n=================== 正在抓取 Bangumi Subject {root_subject_id} ===================")
    sub = bgm_get(f"/subjects/{root_subject_id}")
    if not sub:
        print(f"Failed to fetch subject {root_subject_id}")
        return

    name = sub.get("name") or "Untitled"
    name_cn = sub.get("name_cn") or name
    summary = sub.get("summary") or ""
    sub_type = sub.get("type", 2)
    bgm_url = f"https://bangumi.tv/subject/{root_subject_id}"

    type_map = {1: ["novel"], 2: ["animation"], 3: ["music"], 4: ["game"]}
    entity_types = type_map.get(sub_type, ["animation"])

    pics = []
    if sub.get("images", {}).get("large"):
        pics.append({
            "url": sub["images"]["large"],
            "caption": {"zh-CN": f"{name_cn} 封面", "en-US": f"{name} Cover"},
            "source": {"kind": "url", "citation": "Bangumi", "url": bgm_url}
        })

    root_work = mf_create_entity({
        "kind": "work",
        "title": name,
        "original_language": "ja",
        "translations": {
            "ja": {"title": name, "summary": summary},
            "zh": {"title": name_cn, "summary": summary}
        },
        "types": entity_types,
        "attributes": {},
        "external_ids": {"bangumi": str(root_subject_id)},
        "pictures": pics,
        "status": "published"
    }, f"导入 Bangumi 条目: {name}", bgm_url, token)

    if not root_work:
        print(f"Failed to create root work for {root_subject_id}")
        return

    root_id = root_work["id"]
    print(f"✓ 主作品: {name} ({name_cn}) -> UUID: {root_id}")

    # 1. 抓取分集 (Episodes) 并创建 ContentUnit
    eps = bgm_get(f"/episodes?subject_id={root_subject_id}&limit=50")
    if eps and "data" in eps:
        ep_list = eps["data"]
        print(f"正在导入 {len(ep_list)} 个剧集内容单元 (ContentUnit)...")
        for ep in ep_list[:26]:
            ep_name = ep.get("name") or f"Episode {ep.get('sort')}"
            ep_cn = ep.get("name_cn") or ep_name
            ep_num = str(int(ep.get("sort", 1)))
            ep_unit = mf_create_entity({
                "kind": "content_unit",
                "work_id": root_id,
                "title": f"第{ep_num}话 {ep_cn}",
                "original_language": "ja",
                "translations": {
                    "ja": {"title": f"第{ep_num}話 {ep_name}"},
                    "zh": {"title": f"第{ep_num}话 {ep_cn}"}
                },
                "types": ["content_unit"],
                "number": ep_num,
                "position": int(ep.get("sort", 1)),
                "attributes": {},
                "external_ids": {"bangumi_ep": str(ep.get("id"))},
                "pictures": [],
                "status": "published"
            }, f"导入剧集: 第{ep_num}话", f"https://bangumi.tv/ep/{ep.get('id')}", token)
            if ep_unit:
                print(f"  - 导入分集: {ep_unit['title']}")

    # 2. 抓取关联条目并创建实体与关系
    rel_subjects = bgm_get(f"/subjects/{root_subject_id}/subjects") or []
    print(f"正在处理 {len(rel_subjects)} 个关联条目与关系...")

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
        if any(k in r_rel for k in ["原声", "片头曲", "片尾曲", "角色歌", "音乐"]):
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

        # 建立逻辑关系
        if "原作" in r_rel:
            mf_create_relation("adaptation_of", root_id, target_uuid, f"动画改编自原作: {r_name}", r_url, token)
            print(f"    * 关系: {name} (动画) --[改编自 adaptation_of]--> {r_name} (原作)")
        elif "续集" in r_rel:
            mf_create_relation("sequel_of", target_uuid, root_id, f"续作关联: {r_name}", r_url, token)
            print(f"    * 关系: {r_name} (续作) --[续作于 sequel_of]--> {name}")
        elif "前传" in r_rel:
            mf_create_relation("sequel_of", root_id, target_uuid, f"前传关联: {r_name}", r_url, token)
            print(f"    * 关系: {name} --[续作于 sequel_of]--> {r_name} (前传)")
        elif any(k in r_rel for k in ["原声集", "片头曲", "片尾曲", "角色歌", "插曲", "音乐"]):
            mf_create_relation("soundtrack_of", target_uuid, root_id, f"音乐配乐关联: {r_name}", r_url, token)
            print(f"    * 关系: {r_name} (配乐/单曲) --[配乐用于 soundtrack_of]--> {name}")
        elif any(k in r_rel for k in ["不同演绎", "番外", "衍生"]):
            mf_create_relation("adaptation_of", target_uuid, root_id, f"衍生/不同演绎关联: {r_name}", r_url, token)
            print(f"    * 关系: {r_name} (衍生) --[改编/衍生自 adaptation_of]--> {name}")

    # 3. 抓取主要制作人员与演职员 (Persons) 并创建 Agent 与关系
    persons = bgm_get(f"/subjects/{root_subject_id}/persons") or []
    print(f"正在导入重要演职员/制作组织 (Agent)...")
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
            print(f"  ✓ 演职员署名: {name} --[创作者 created_by]--> {p_name} ({p_role})")

    print(f"=== 完成 Subject {root_subject_id} 的导入与关系关联 ===\n")

if __name__ == "__main__":
    t = mf_login("MoeCaa", "Ytc0123456789@")
    print(f"管理员认证登录成功，准备开始导入...")
    import_subject_tree(876, t)
    import_subject_tree(428735, t)
    print("ALL BANGUMI IMPORTS COMPLETED SUCCESSFULLY!")
