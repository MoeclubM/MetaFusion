#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MyGO!!!!! 全图谱重导 Phase C：音乐 works + release/medium/track/expression + 演职员关系

work: 音乐条目（单曲 music_single / 专辑 album / 合辑 compilation 口径按 album）
  合并: 509765+509766 Divide/Unite 同名 -> 1 work（以 509766 大盘曲目为准，release 分版本）
        548186+548209 聿日箋秋 -> 1 work（单曲版+专辑版作 2 release）
release: 每条目 1 release（品番/版本特性进 attributes）；多版本条目按碟片数拆 medium
medium: format=cd；BD 付限定盘加 medium format=bd（曲目按 disc 分）
track: 曲目（episodes），contents -> expression（全局曲目母版，按歌名去重）
expression: 曲目母版 work_id=歌曲work（同一首歌跨 release 复用）
agent: 词曲编 staff（person）+ 厂牌/机构（organization）+ 合作乐队（group）
关系:
  歌曲work performed_by MyGO（演唱）
  歌曲work created_by 词/曲/编曲人（attributes 无职位字段，职位写 musicbrainz 惯例？无字段则裸边）
  歌曲work credited_to 厂牌
  翻唱曲目 cover_of 原曲 expression（仅 485636/580090，且原曲不在库则跳过并记录）
  歌曲 insert_song_of / soundtrack_of TV（按 45638 关联口径：主题歌演出/插入歌演出）
"""
import json
import os
import re
import ssl
import sys
import time
import urllib.request
import urllib.error

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SURVEY = "C:/Users/QwQ/AppData/Local/Temp/mygo_survey"
BASE_URL = os.getenv("MF_BASE", "https://findverse.cc/api")
USERNAME = os.getenv("MF_USER", "MoeCaa")
PASSWORD = os.getenv("MF_PASS", "")
if not PASSWORD:
    raise SystemExit("MF_PASS env required")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_FP = os.path.join(SCRIPT_DIR, ".mygo_reimport_state.json")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# sid -> (work类型码, 备注)。合辑/翻唱照常建 work。
MUSIC_WORKS = {
    407228: ("music_single", "出道单曲 迷星叫"),
    428092: ("music_single", "2nd 单曲 音一会"),
    437672: ("music_single", "3rd 单曲 壱雫空"),
    447501: ("music_single", "单曲 碧天伴走"),
    450691: ("music_single", "单曲 詩超絆"),
    450817: ("music_single", "单曲 無路矢"),
    452529: ("music_single", "单曲 迷路日々"),
    465940: ("music_single", "单曲 処救生"),
    449998: ("album", "1st 专辑 迷跡波"),
    473854: ("music_single", "迷星叫/迷路日々 Anime ver."),
    482518: ("music_single", "单曲 輪符雨"),
    485636: ("music_single", "翻唱 ノンブレス・オブリージュ"),
    473843: ("music_single", "砂寸奏/回層浮"),
    492567: ("music_single", "端程山"),
    515607: ("music_single", "单曲 過惰幻"),
    522587: ("music_single", "单曲 霧周途"),
    523501: ("music_single", "单曲 歩拾道"),
    515757: ("album", "2nd 专辑 跡暖空"),
    548209: ("music_single", "6th 单曲 聿日箋秋（548186 先行配信版并入同 work）"),
    556155: ("music_single", "潜在表明 THE FIRST TAKE"),
    565040: ("music_single", "往欄印"),
    567294: ("album", "ガルパ翻唱合集 Vol.10（合辑口径）"),
    580090: ("music_single", "翻唱 だれかの心臓になれたなら"),
    581873: ("music_single", "詩超絆 Anime ver. 特典CD（无封面）"),
    492569: ("album", "翻唱合集 Extra Volume"),
    585826: ("music_single", "静降想"),
    692365: ("music_single", "世点彩（2026 未来发售）"),
    632570: ("music_single", "証命讃歌"),
    637687: ("music_single", "致並跡"),
    509766: ("music_single", "Divide/Unite 合同 LIVE 盘（509765 同名小盘并入）"),
}

STAFF_AGENT_TYPE = {1: "person", 2: "organization", 3: "group"}


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def api(method, path, body=None, token=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json", "User-Agent": "MetaFusion-MyGO-Reimport/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE_URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        print(f"  HTTP {e.code}: {err[:300]}")
        return None


def login():
    r = api("POST", "/auth/login", {"username": USERNAME, "password": PASSWORD})
    if not r or "token" not in r:
        raise RuntimeError("login failed")
    return r["token"]


def src(url, citation):
    return {"kind": "url", "citation": citation, "url": url}


def aliases_of(infobox, *kinds):
    out = []
    for b in infobox or []:
        if b.get("key") == "别名":
            v = b.get("value")
            items = v if isinstance(v, list) else [{"v": v}]
            for it in items:
                if isinstance(it, dict):
                    if kinds and it.get("k") not in kinds:
                        continue
                    if it.get("v"):
                        out.append(it["v"])
                elif isinstance(it, str) and it:
                    out.append(it)
    return out


def cn_name_of(infobox):
    for b in infobox or []:
        if b.get("key") == "简体中文名" and isinstance(b.get("value"), str):
            return b["value"]
    return None


def ib_text(infobox, key):
    for b in infobox or []:
        if b.get("key") == key:
            v = b.get("value")
            if isinstance(v, str):
                return v
            if isinstance(v, list):
                parts = []
                for it in v:
                    parts.append(it.get("v", "") if isinstance(it, dict) else str(it))
                return " / ".join(p for p in parts if p)
    return ""


def split_names(s):
    return [x.strip() for x in re.split(r"[、，,／/・&+×xX]", s or "") if x.strip()]


def create(token, state, bucket, key, entity, note, sources):
    if key in state.get(bucket, {}):
        return state[bucket][key]
    body = {"entity": entity, "expected_version": 0, "edit_note": note, "sources": sources}
    r = api("POST", "/catalog/entities", body, token)
    if r and r.get("id"):
        state.setdefault(bucket, {})[key] = r["id"]
        json.dump(state, open(STATE_FP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        return r["id"]
    print(f"  FAILED [{entity['kind']}] {entity['title'][:40]}")
    return None


def relate(token, state, rel_type, src_id, tgt_id, attrs, note, sources):
    rkey = f"{rel_type}:{src_id[:8]}:{tgt_id[:8]}:{json.dumps(attrs, sort_keys=True, ensure_ascii=False)}"
    if rkey in state.get("relations", {}):
        return True
    body = {"relation": {"type": rel_type, "source_id": src_id, "target_id": tgt_id,
                         "position": 0, "attributes": attrs},
            "expected_version": 0, "edit_note": note, "sources": sources}
    r = api("POST", "/catalog/relations", body, token)
    if r and (r.get("id") or r.get("ok")):
        state.setdefault("relations", {})[rkey] = True
        json.dump(state, open(STATE_FP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        return True
    return False


def build_staff_agent(p):
    pid = p["id"]
    name_ja = p["name"]
    ib = p.get("infobox") or []
    cn = cn_name_of(ib)
    summary = (p.get("summary") or "").strip()
    img = ((p.get("images") or {}).get("large") or "").split("?")[0]
    tcode = STAFF_AGENT_TYPE.get(p.get("type"), "person")
    translations = {"ja": {"title": name_ja, "summary": summary,
                           "aliases": aliases_of(ib, "纯假名", "日文名", "昵称")}}
    if cn and cn != name_ja:
        translations["zh-CN"] = {"title": cn, "summary": summary, "aliases": []}
    roma = aliases_of(ib, "罗马字", "英文名")
    if roma:
        translations["en-US"] = {"title": roma[0], "summary": "", "aliases": roma[1:]}
    ent = {"kind": "agent", "title": name_ja, "original_language": "ja",
           "translations": translations, "types": [tcode], "attributes": {},
           "external_ids": {"metafusion_import": f"bgm:person:{pid}",
                            "bangumi_person": str(pid)},
           "pictures": [], "status": "published"}
    if img:
        ent["pictures"].append({
            "url": img,
            "caption": {"zh-CN": f"{name_ja} 照片", "en-US": f"{name_ja} photo"},
            "source": {"kind": "url", "citation": "Bangumi",
                       "url": f"https://bangumi.tv/person/{pid}"}})
    return ent


def main():
    token = login()
    state = load(STATE_FP) if os.path.exists(STATE_FP) else {}
    agents = state.get("agents", {})
    mygo_group = agents.get("bgm:person:45638")
    tv_id = state.get("works", {}).get("bgm:subject:428735")
    assert mygo_group, "Phase A missing"
    S = lambda u: [src(u, "Bangumi")]

    # ---- 1. staff agents ----
    staff_ids = set()
    for sid in MUSIC_WORKS:
        try:
            sp = load(f"{SURVEY}/spersons/sp_{sid}.json")
        except FileNotFoundError:
            continue
        for it in sp:
            if it.get("id") and it.get("relation") in ("作词", "作曲", "编曲", "艺术家", "厂牌", "出版方", "插图"):
                if it["id"] == 45638:
                    continue
                staff_ids.add(it["id"])
    print(f"staff agents to create: {len(staff_ids)}")
    staff_map = {}
    for pid in sorted(staff_ids):
        key = f"bgm:person:{pid}"
        if key in agents:
            staff_map[pid] = agents[key]
            continue
        try:
            p = load(f"{SURVEY}/persons/p_{pid}.json")
        except FileNotFoundError:
            print(f"  NO CACHE person {pid}, skip")
            continue
        ent = build_staff_agent(p)
        nid = create(token, state, "agents", key, ent,
                     f"重导音乐演职人员 {p['name']}（词曲编/厂牌/合作乐队）",
                     S(f"https://bangumi.tv/person/{pid}"))
        if nid:
            staff_map[pid] = nid
            agents[key] = nid
        time.sleep(0.3)
    print(f"staff agents ok: {len(staff_map)}/{len(staff_ids)}")

    # ---- 2. music works + release/medium/track/expression ----
    n_rel_ok = n_rel_fail = 0
    expr_by_song = {}  # 歌名 -> expression id（跨 release 复用）
    for sid, (tcode, desc) in MUSIC_WORKS.items():
        subj = load(f"{SURVEY}/subj/s_{sid}.json")
        name_ja = subj["name"]
        name_cn = (subj.get("name_cn") or "").strip()
        ib = subj.get("infobox") or []
        summary = (subj.get("summary") or "").strip()
        img = ((subj.get("images") or {}).get("large") or "").split("?")[0]
        translations = {"ja": {"title": name_ja, "summary": summary,
                               "aliases": aliases_of(ib, "纯假名")}}
        if name_cn and name_cn != name_ja:
            translations["zh-CN"] = {"title": name_cn, "summary": summary, "aliases": []}
        work = {"kind": "work", "title": name_ja, "original_language": "ja",
                "translations": translations, "types": [tcode], "attributes": {},
                "external_ids": {"metafusion_import": f"bgm:subject:{sid}",
                                 "bangumi": str(sid)},
                "pictures": [], "status": "published"}
        if img:
            work["pictures"].append({
                "url": img,
                "caption": {"zh-CN": f"{name_ja} 封面", "en-US": f"{name_ja} cover"},
                "source": {"kind": "url", "citation": "Bangumi",
                           "url": f"https://bangumi.tv/subject/{sid}"}})
        page = f"https://bangumi.tv/subject/{sid}"
        wid = create(token, state, "works", f"bgm:subject:{sid}", work,
                     f"重导音乐 {name_ja}（{desc}）：original_language=ja",
                     S(page))
        if not wid:
            continue
        print(f"WORK {sid} {name_ja} {wid[:8]}")
        time.sleep(0.3)

        # release
        cat_no = ib_text(ib, "品番") or ib_text(ib, " catalog") or ""
        attrs = {}
        pub_date = (subj.get("date") or "").strip()
        if re.match(r"^\d{4}-\d{2}-\d{2}$", pub_date):
            attrs["edition_date"] = pub_date
        attrs["country"] = "JP"
        label = ib_text(ib, "厂牌") or ib_text(ib, "出版方")
        pub_agent = None
        if label:
            first_label = label.split(" / ")[0].split("/")[0].strip()
            # publisher 是 entity 引用：按名找已入库 staff agent
            for pid2, aid2 in staff_map.items():
                try:
                    nm = load(f"{SURVEY}/persons/p_{pid2}.json").get("name", "")
                except FileNotFoundError:
                    continue
                if nm and (nm == first_label or first_label in nm or nm in first_label):
                    pub_agent = aid2
                    break
            if pub_agent:
                attrs["publisher"] = pub_agent
        ver = ib_text(ib, "版本特性")
        rel = {"kind": "release", "title": f"{name_ja}（{ver or '标准盘'}）",
               "original_language": "ja",
               "translations": {"ja": {"title": f"{name_ja}（{ver or '标准盘'}）",
                                       "summary": "", "aliases": []}},
               "types": ["release"], "attributes": attrs,
               "external_ids": {"metafusion_import": f"bgm:subject:{sid}:release"},
               "subjects": [{"work_id": wid, "role": "primary", "position": 0}],
               "status": "published"}
        rid = create(token, state, "releases", f"bgm:subject:{sid}:release", rel,
                     f"重导发行版：{name_ja}（{ver or '标准盘'}，{label or '厂牌未详'}）", S(page))
        if not rid:
            continue
        time.sleep(0.3)

        # medium + tracks
        tr = load(f"{SURVEY}/tracks/t_{sid}.json")
        by_disc = {}
        for ep in tr.get("data", []):
            by_disc.setdefault(ep.get("disc", 1) or 1, []).append(ep)
        for disc, eps in sorted(by_disc.items()):
            fmt = "cd"
            med = {"kind": "medium", "title": f"Disc {disc}" if len(by_disc) > 1 else "CD",
                   "original_language": "ja",
                   "translations": {"ja": {"title": f"Disc {disc}" if len(by_disc) > 1 else "CD",
                                           "summary": "", "aliases": []}},
                   "types": ["medium"], "attributes": {"format": fmt},
                   "external_ids": {"metafusion_import": f"bgm:subject:{sid}:disc:{disc}"},
                   "release_id": rid, "position": disc, "status": "published"}
            mid = create(token, state, "mediums", f"bgm:subject:{sid}:disc:{disc}", med,
                         f"重导介质 Disc {disc}（{name_ja}）", S(page))
            if not mid:
                continue
            for ep in sorted(eps, key=lambda e: e.get("sort", 0)):
                song = (ep.get("name") or "").strip()
                if not song:
                    continue
                # expression 按 (work, song) 建：不同单曲即使同名也是不同录音版本，
                # 且后端要求 track 引用的 expression.work_id 必须在所属 release subjects 内声明，
                # 跨 work 复用同一 expression 会触发 undeclared_release_subject。
                base = re.sub(r"\s*[-~(-].*$", "", song).strip() or song
                ekey = f"bgm:subject:{sid}:song:{base}"
                eid = None
                ex = {"kind": "expression", "title": base, "original_language": "ja",
                      "translations": {"ja": {"title": base, "summary": "", "aliases": []}},
                      "types": ["expression"], "attributes": {},
                      "external_ids": {"metafusion_import": ekey},
                      "work_id": wid, "status": "published"}
                eid = create(token, state, "expressions", ekey, ex,
                             f"重导曲目母版：{base}", S(page))
                time.sleep(0.2)
                if not eid:
                    continue
                dur = None
                try:
                    ds = int(ep.get("duration_seconds") or 0)
                    dur = ds if ds > 0 else None
                except (TypeError, ValueError):
                    pass
                tattrs = {}
                if dur:
                    tattrs["duration"] = dur
                tk = {"kind": "track", "title": song, "original_language": "ja",
                      "translations": {"ja": {"title": song, "summary": "", "aliases": []}},
                      "types": ["track"], "attributes": tattrs,
                      "external_ids": {"metafusion_import": f"bgm:ep:{ep.get('id')}"},
                      "medium_id": mid, "position": int(ep.get("sort") or 0),
                      "number": str(ep.get("sort") or ""),
                      "contents": [{"expression_id": eid, "position": 0, "locator": {}}],
                      "status": "published"}
                create(token, state, "tracks", f"bgm:ep:{ep.get('id')}", tk,
                       f"重导分轨：{song}（关联母版 {base}）", S(page))
                time.sleep(0.15)

        # ---- 关系 ----
        try:
            sp = load(f"{SURVEY}/spersons/sp_{sid}.json")
        except FileNotFoundError:
            sp = []
        for it in sp:
            pid, rel = it.get("id"), it.get("relation")
            if pid == 45638:
                if relate(token, state, "performed_by", wid, mygo_group, {},
                          "演唱：MyGO!!!!! performed_by 歌曲", S(page)):
                    n_rel_ok += 1
                else:
                    n_rel_fail += 1
                continue
            if pid not in staff_map:
                continue
            aid = staff_map[pid]
            if rel in ("作词", "作曲", "编曲"):
                if relate(token, state, "created_by", wid, aid, {},
                          f"创作：{it.get('name')}（{rel}）created_by 歌曲", S(page)):
                    n_rel_ok += 1
                else:
                    n_rel_fail += 1
            elif rel in ("厂牌", "出版方"):
                if relate(token, state, "credited_to", wid, aid, {},
                          f"厂牌：{it.get('name')} credited_to 歌曲", S(page)):
                    n_rel_ok += 1
                else:
                    n_rel_fail += 1
            elif rel == "艺术家":
                if relate(token, state, "performed_by", wid, aid, {},
                          f"合作演出：{it.get('name')} performed_by", S(page)):
                    n_rel_ok += 1
                else:
                    n_rel_fail += 1
        # 歌曲 -> TV 主题歌/插入歌
        if tv_id and sid not in (567294, 492569):
            # 迷星叫/壱雫空等是 OP/ED/插曲：统一用 insert_song_of 指向 TV（45638 关联口径含主题歌演出）
            if relate(token, state, "insert_song_of", wid, tv_id, {},
                      "剧中歌/主题歌关联 TV", S(page)):
                n_rel_ok += 1
            else:
                n_rel_fail += 1
        time.sleep(0.3)

    print(f"\nPhase C done: relations ok={n_rel_ok} fail={n_rel_fail}")


if __name__ == "__main__":
    main()
