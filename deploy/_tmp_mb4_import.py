#!/usr/bin/env python3
# Operational import helper. Not part of the product; do not commit.
import json, time, urllib.error, urllib.request
from datetime import datetime

UA = "MetaFusion-CatalogImport/1.1 (https://github.com/QwQ/MetaFusion; catalog-import@metafusion.internal)"
MB = "https://musicbrainz.org/ws/2"
CAA = "https://coverartarchive.org"
API = "http://127.0.0.1:80/api/v1"
INTERVAL = 1.1
LOCAL_GAP = 0.12

ARTIST_MBIDS = [
    "adea3c3d-a84d-4f9e-ac0b-1ef71a8947a5",
    "3e0a5471-46af-4c01-bb2e-11b24c1b55fe",
    "9cacc8a5-fb40-4584-aea2-591172da6e84",
    "3d3b99e4-1a07-49d5-9c47-cd2a4c156d6c",
]

BANG_DREAM_ID = "cafef00d-0000-4000-8000-000000000002"
NAME_MERGE = {
    "poppin'party": "cafef00d-0000-4000-8000-000000000206",
    "poppin party": "cafef00d-0000-4000-8000-000000000206",
    "ポピパ": "cafef00d-0000-4000-8000-000000000206",
    "户山香澄": "cafef00d-0000-4000-8000-000000000205",
    "戸山香澄": "cafef00d-0000-4000-8000-000000000205",
    "戸山 香澄": "cafef00d-0000-4000-8000-000000000205",
    "kasumi toyama": "cafef00d-0000-4000-8000-000000000205",
    "爱美": "cafef00d-0000-4000-8000-000000000204",
    "愛美": "cafef00d-0000-4000-8000-000000000204",
    "aimi": "cafef00d-0000-4000-8000-000000000204",
    "bushiroad": "cafef00d-0000-4000-8000-000000000216",
    "株式会社ブシロード": "cafef00d-0000-4000-8000-000000000216",
}

_ext_last = 0.0
_local_last = 0.0
TOKEN = ""
REPORT = {
    "artists": [],
    "works": [],
    "releases": [],
    "covers_ok": 0,
    "covers_fail": 0,
    "gaps": [],
    "errors": [],
}

def norm(s):
    return "".join((s or "").lower().replace("'", "'").replace("’", "'").split())

def pause(last, gap):
    w = gap - (time.time() - last)
    if w > 0:
        time.sleep(w)
    return time.time()

def ext_get(url, method="GET", accept="application/json"):
    global _ext_last
    _ext_last = pause(_ext_last, INTERVAL)
    req = urllib.request.Request(url, method=method, headers={"User-Agent": UA, "Accept": accept})
    err = None
    for i in range(8):
        _ext_last = pause(_ext_last, INTERVAL)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                _ext_last = time.time()
                return r.getcode(), r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            err = e
            _ext_last = time.time()
            if e.code in (404, 405):
                return e.code, e.read(), dict(e.headers)
            if e.code in (429, 502, 503):
                time.sleep(min(40, 2 ** i) + INTERVAL)
                continue
            raise
        except Exception as e:
            err = e
            time.sleep(min(40, 2 ** i) + INTERVAL)
    raise err

def mb_get(path):
    code, body, _ = ext_get(MB + path)
    if code != 200:
        raise RuntimeError(f"MB {code} {path} {body[:200]}")
    return json.loads(body.decode("utf-8"))

def caa_front(release_mbid):
    url = f"{CAA}/release/{release_mbid}/front-500"
    try:
        code, _, _ = ext_get(url, method="HEAD", accept="*/*")
        if code in (200, 307, 302, 301):
            return url, None
        if code == 405:
            code2, _, _ = ext_get(url, method="GET", accept="*/*")
            if code2 in (200, 307, 302, 301):
                return url, None
            return None, f"CAA HTTP {code2}"
        return None, f"CAA HTTP {code}"
    except Exception as e:
        return None, str(e)

def api(method, path, payload=None, expect=(200, 201)):
    global _local_last, TOKEN
    _local_last = pause(_local_last, LOCAL_GAP)
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={
            "User-Agent": UA,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": "Bearer " + TOKEN,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.getcode(), json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        if e.code == 429:
            time.sleep(65)
            return api(method, path, payload, expect)
        try:
            body = json.loads(raw)
        except Exception:
            body = {"error": raw[:400]}
        if e.code not in expect:
            REPORT["errors"].append({"path": path, "code": e.code, "error": body})
        return e.code, body

class Index:
    def __init__(self):
        self.artist_by_mbid = {}
        self.artist_by_name = {}
        self.artist_row = {}
        self.work_by_rg = {}
        self.release_by_mbid = {}
        self.work_row = {}

    def add_artist(self, row):
        self.artist_row[row["id"]] = row
        mbid = (row.get("mbid") or "").strip()
        if mbid:
            self.artist_by_mbid[mbid] = row["id"]
        for key in (row.get("name"), row.get("original_name")):
            n = norm(key)
            if n:
                self.artist_by_name.setdefault(n, row["id"])

    def add_work(self, row):
        self.work_row[row["id"]] = row
        for k in (row.get("rg"), row.get("mbid")):
            if k:
                self.work_by_rg[k] = row["id"]

def load_index():
    idx = Index()
    import subprocess
    q = r"""
COPY (
  SELECT json_build_object(
    'artists', (SELECT json_agg(json_build_object(
        'id', id, 'name', name, 'original_name', original_name,
        'entity_type', entity_type, 'mbid', external_ids->>'musicbrainz',
        'external_ids', external_ids, 'disambiguation', disambiguation,
        'country', country, 'biography', biography,
        'begin_date', begin_date, 'end_date', end_date, 'ended', ended
    )) FROM artists),
    'works', (SELECT json_agg(json_build_object(
        'id', id, 'title', title, 'original_title', original_title,
        'aliases', aliases, 'summary', summary, 'cover', cover_image_url,
        'country', country, 'language', language, 'original_language', original_language,
        'catalog_metadata', catalog_metadata,
        'mbid', catalog_metadata#>>'{external_ids,musicbrainz}',
        'rg', catalog_metadata->>'musicbrainz_release_group',
        'status', status
    )) FROM works),
    'releases', (SELECT json_agg(json_build_object(
        'id', id, 'work_id', work_id,
        'mbid', catalog_metadata->>'musicbrainz',
        'barcode', barcode, 'catalog_number', catalog_number
    )) FROM releases)
  )
) TO STDOUT
"""
    raw = subprocess.check_output(
        ["wsl", "-e", "bash", "-lc",
         "docker exec metafusion-postgres psql -U metafusion -d metafusion_db -At -c \"%s\"" % q.replace('"', '\\"')],
        text=True,
    )
    # Running from WSL already is simpler; this function is called from WSL python.
    raise RuntimeError("use load_index_wsl")

def load_index_wsl():
    import subprocess
    sql = """
SELECT json_build_object(
  'artists', COALESCE((SELECT json_agg(json_build_object(
      'id', id, 'name', name, 'original_name', original_name,
      'entity_type', entity_type, 'mbid', external_ids->>'musicbrainz',
      'external_ids', external_ids, 'disambiguation', disambiguation,
      'country', country, 'biography', biography,
      'begin_date', begin_date, 'end_date', end_date, 'ended', ended
  )) FROM artists), '[]'::json),
  'works', COALESCE((SELECT json_agg(json_build_object(
      'id', id, 'title', title, 'original_title', original_title,
      'aliases', aliases, 'summary', summary, 'cover', cover_image_url,
      'country', country, 'language', language, 'original_language', original_language,
      'catalog_metadata', catalog_metadata,
      'mbid', catalog_metadata#>>'{external_ids,musicbrainz}',
      'rg', catalog_metadata->>'musicbrainz_release_group',
      'status', status
  )) FROM works), '[]'::json),
  'releases', COALESCE((SELECT json_agg(json_build_object(
      'id', id, 'work_id', work_id,
      'mbid', catalog_metadata->>'musicbrainz',
      'barcode', barcode, 'catalog_number', catalog_number
  )) FROM releases), '[]'::json)
);
"""
    raw = subprocess.check_output(
        ["docker", "exec", "metafusion-postgres", "psql", "-U", "metafusion", "-d", "metafusion_db", "-At", "-c", sql],
        text=True,
    )
    data = json.loads(raw)
    idx = Index()
    for a in data["artists"] or []:
        idx.add_artist(a)
    for w in data["works"] or []:
        idx.add_work(w)
    for r in data["releases"] or []:
        if r.get("mbid"):
            idx.release_by_mbid[r["mbid"]] = r
    return idx

def login():
    global TOKEN
    req = urllib.request.Request(
        API + "/auth/login",
        data=json.dumps({"email_or_username": "admin", "password": "AdminPassword2026!"}).encode(),
        method="POST",
        headers={"User-Agent": UA, "Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        TOKEN = json.loads(r.read().decode())["token"]

def mb_type_to_entity(mb_type, disamb, name):
    t = (mb_type or "").lower()
    d = (disamb or "") + " " + (name or "")
    if t == "character":
        return "virtual_character"
    if t == "orchestra":
        return "orchestra"
    if t == "person":
        return "person"
    if "bang dream" in d.lower() or "バンドリ" in d:
        if t in ("group", "other", ""):
            return "fictional_band"
    if t == "group":
        return "group"
    if t == "choir":
        return "group"
    return "group"

def country_zh(code):
    return {"JP": "日本", "CN": "中国", "US": "美国", "GB": "英国", "KR": "韩国", "TW": "中国台湾", "HK": "中国香港"}.get((code or "").upper(), code or "")

def pad_date(s):
    s = (s or "").strip()
    if not s:
        return None
    if len(s) == 4 and s.isdigit():
        return s + "-01-01"
    if len(s) == 7 and s[4] == "-":
        return s + "-01"
    if len(s) >= 10:
        return s[:10]
    return None

def pick_names(mb):
    name = mb.get("name") or ""
    sort_name = mb.get("sort-name") or ""
    aliases = mb.get("aliases") or []
    ja = ""
    en = ""
    zh = ""
    extra = []
    for a in aliases:
        n = a.get("name") or ""
        loc = a.get("locale") or ""
        if loc.startswith("ja") and (a.get("primary") or not ja):
            ja = n
        elif loc.startswith("en") and (a.get("primary") or not en):
            en = n
        elif loc.startswith("zh") and (a.get("primary") or not zh):
            zh = n
        if n and n not in extra:
            extra.append(n)
    original = ja or name
    display = zh or name
    return display, original, extra, ja, en, zh, sort_name

def find_artist(idx, mbid=None, name=None):
    if mbid and mbid in idx.artist_by_mbid:
        return idx.artist_by_mbid[mbid]
    n = norm(name)
    if n in NAME_MERGE:
        return NAME_MERGE[n]
    if n and n in idx.artist_by_name:
        return idx.artist_by_name[n]
    return None

def upsert_artist(idx, mb, entity_hint=None):
    mbid = mb.get("id")
    name, original, extras, ja, en, zh, sort_name = pick_names(mb)
    entity = entity_hint or mb_type_to_entity(mb.get("type"), mb.get("disambiguation"), name)
    existing = find_artist(idx, mbid, name)
    life = mb.get("life-span") or {}
    begin = (life.get("begin") or "")[:16]
    end = (life.get("end") or "")[:16]
    ended = bool(life.get("ended"))
    country = country_zh(mb.get("country")) or "日本"
    ext = {}
    if existing and existing in idx.artist_row:
        old = idx.artist_row[existing].get("external_ids") or {}
        if isinstance(old, dict):
            ext.update(old)
    ext["musicbrainz"] = mbid
    if extras:
        ext["aliases"] = extras[:20]
    trans = []
    if ja:
        trans.append({"locale": "ja", "name": ja})
    if en:
        trans.append({"locale": "en-US", "name": en})
    if zh:
        trans.append({"locale": "zh-CN", "name": zh})
    payload = {
        "name": name,
        "original_name": original,
        "disambiguation": mb.get("disambiguation") or "",
        "entity_type": entity,
        "country": country,
        "biography": "",
        "language": "ja",
        "begin_date": begin,
        "end_date": end,
        "ended": ended,
        "external_ids": ext,
        "translations": trans,
        "edit_note": "MusicBrainz artist import",
        "source_urls": [f"https://musicbrainz.org/artist/{mbid}"],
    }
    if existing:
        # keep fictional_band if seed already classified it that way
        if existing in idx.artist_row:
            prev = idx.artist_row[existing].get("entity_type")
            if prev == "fictional_band":
                payload["entity_type"] = "fictional_band"
            if prev == "virtual_character" and entity == "person":
                payload["entity_type"] = "virtual_character"
        code, body = api("PUT", f"/catalog/artists/{existing}", payload)
        action = "updated" if code == 200 else "update_failed"
        REPORT["artists"].append({"action": action, "name": name, "type": payload["entity_type"], "id": existing, "mbid": mbid, "http": code})
        if code != 200:
            REPORT["gaps"].append(f"artist update failed {name}: {body}")
            return existing
        row = dict(idx.artist_row.get(existing) or {})
        row.update({"id": existing, "name": name, "original_name": original, "entity_type": payload["entity_type"], "mbid": mbid, "external_ids": ext})
        idx.add_artist(row)
        return existing
    create = {k: payload[k] for k in ("name", "original_name", "disambiguation", "entity_type", "country", "biography", "language", "external_ids", "translations")}
    code, body = api("POST", "/catalog/artists", create)
    if code != 201:
        REPORT["gaps"].append(f"artist create failed {name}: {body}")
        return None
    aid = body.get("id")
    api("PUT", f"/catalog/artists/{aid}", payload)
    REPORT["artists"].append({"action": "created", "name": name, "type": create["entity_type"], "id": aid, "mbid": mbid})
    idx.add_artist({"id": aid, "name": name, "original_name": original, "entity_type": create["entity_type"], "mbid": mbid, "external_ids": ext})
    return aid

def rel_ok(src, tgt, rtype, qualifier=""):
    payload = {"relations": [{
        "source_type": "artist", "source_id": src,
        "target_type": "artist" if rtype != "part_of_franchise" else "franchise",
        "target_id": tgt, "relationship_type": rtype, "qualifier": qualifier,
    }]}
    if rtype == "part_of_franchise":
        payload["relations"][0]["source_type"] = "artist"
        payload["relations"][0]["target_type"] = "franchise"
    if rtype in ("performer", "producer", "composer"):
        payload["relations"][0]["source_type"] = "artist"
        payload["relations"][0]["target_type"] = "work"
    code, body = api("PUT", "/catalog/entity-relations", payload)
    if code != 200:
        REPORT["gaps"].append(f"rel {rtype} {src}->{tgt}: {body}")
    return code == 200

def format_tags(primary):
    p = (primary or "").lower()
    tags = ["音乐", "BanG Dream"]
    if p == "single":
        tags.append("单曲")
    else:
        tags.append("专辑")
    return tags

def map_packaging(rel):
    pkg = (rel.get("packaging") or "").lower()
    fmts = [(m.get("format") or "") for m in (rel.get("media") or [])]
    digital = all("digital" in f.lower() for f in fmts) if fmts else False
    if "digipak" in pkg:
        return "digipak"
    if "jewel" in pkg:
        return "jewel_case"
    if "gatefold" in pkg:
        return "gatefold"
    if "slipcase" in pkg:
        return "slipcase"
    if "box" in pkg:
        return "box_set"
    if digital or pkg in ("none", ""):
        return "digital" if digital else "jewel_case"
    return "jewel_case"

def map_format(fmt):
    f = (fmt or "").lower()
    if "blu" in f:
        return "Blu-ray"
    if "vinyl" in f or "12" in f:
        return "Vinyl"
    if "cassette" in f:
        return "Cassette"
    if "sacd" in f:
        return "SACD"
    if "digital" in f:
        return "Hi-Res FLAC"
    if "dvd" in f:
        return "DVD-Video"
    return "CD"

def release_country(rel):
    ev = rel.get("release-events") or []
    if ev:
        area = (ev[0].get("area") or {})
        codes = area.get("iso-3166-1-codes") or []
        if codes:
            return country_zh(codes[0])
    return country_zh(rel.get("country"))

def release_date(rel):
    ev = rel.get("release-events") or []
    if ev and ev[0].get("date"):
        return pad_date(ev[0]["date"])
    return pad_date(rel.get("date"))

def catalog_and_label(rel):
    infos = rel.get("label-info") or []
    cat = ""
    labels = []
    for info in infos:
        if not cat:
            cat = (info.get("catalog-number") or "").strip()
        lab = info.get("label") or {}
        if lab.get("id"):
            labels.append(lab)
    return cat, labels

def mediums_payload(rel):
    out = []
    for i, med in enumerate(rel.get("media") or []):
        tracks = []
        for t in med.get("tracks") or []:
            rec = t.get("recording") or {}
            length = t.get("length") or rec.get("length") or 0
            sec = int(length / 1000) if length else 0
            title = t.get("title") or rec.get("title") or ""
            ac = t.get("artist-credit") or rec.get("artist-credit") or rel.get("artist-credit") or []
            credit = "".join((x.get("name") or "") + (x.get("joinphrase") or "") for x in ac)
            pos = t.get("position") or (len(tracks) + 1)
            isrc = ""
            for isrc_o in rec.get("isrcs") or []:
                isrc = isrc_o
                break
            tracks.append({
                "position": pos,
                "title": title,
                "artist_credit": credit,
                "duration_seconds": sec,
                "isrc": isrc,
            })
        out.append({
            "position": med.get("position") or (i + 1),
            "name": med.get("title") or f"Disc {i+1}",
            "format": map_format(med.get("format")),
            "media_category": "music",
            "tracks": tracks,
        })
    return out

def pick_releases(rels):
    official = [r for r in rels if (r.get("status") or "").lower() == "official"]
    pool = official or rels
    # prefer JP physical with catalog, else any official
    def score(r):
        ev = r.get("release-events") or []
        codes = []
        if ev:
            codes = ((ev[0].get("area") or {}).get("iso-3166-1-codes")) or []
        jp = 2 if "JP" in codes else 0
        cat = 1 if any((x.get("catalog-number") or "") for x in (r.get("label-info") or [])) else 0
        caa = r.get("cover-art-archive") or {}
        art = 2 if caa.get("front") else 0
        return (jp + cat + art, r.get("date") or "")
    pool = sorted(pool, key=score, reverse=True)
    return pool

def upsert_label(idx, lab):
    if not lab.get("id"):
        return None
    existing = find_artist(idx, lab.get("id"), lab.get("name"))
    if existing:
        return existing
    fake = {
        "id": lab.get("id"),
        "name": lab.get("name"),
        "sort-name": lab.get("sort-name") or lab.get("name"),
        "type": "Other",
        "disambiguation": lab.get("disambiguation") or "",
        "country": "JP",
        "aliases": [],
        "life-span": {},
    }
    # labels are not persons
    return upsert_artist(idx, fake, entity_hint="label")

def publish_work(work_id):
    api("PUT", f"/admin/works/{work_id}/status", {"status": "published"})

def verify_release(release_id):
    api("PUT", f"/admin/releases/{release_id}/verify", {"is_master_verified": True})

def set_cover(work_id, url, work):
    if not url:
        REPORT["covers_fail"] += 1
        return False
    payload = {
        "title": work.get("title") or work.get("Title"),
        "original_title": work.get("original_title") or "",
        "aliases": work.get("aliases") or [],
        "summary": work.get("summary") or "",
        "cover_image_url": url,
        "country": work.get("country") or "日本",
        "language": work.get("language") or "ja",
        "original_language": work.get("original_language") or "ja",
        "catalog_metadata": work.get("catalog_metadata") or {},
        "tags": [t["name"] if isinstance(t, dict) else t for t in (work.get("tags") or [])] or format_tags("album"),
        "edit_note": "set Cover Art Archive front",
        "source_urls": [url],
    }
    if not payload["title"]:
        REPORT["covers_fail"] += 1
        REPORT["gaps"].append(f"cover skipped, missing title {work_id}")
        return False
    code, body = api("PUT", f"/catalog/works/{work_id}", payload)
    if code == 200:
        REPORT["covers_ok"] += 1
        return True
    REPORT["covers_fail"] += 1
    REPORT["gaps"].append(f"cover validate/update failed {work_id}: {body}")
    return False

def import_rg(idx, band_id, band_name, rg):
    rgid = rg.get("id")
    title = rg.get("title") or "Untitled"
    primary = (rg.get("primary-type") or "") or ""
    first_date = pad_date(rg.get("first-release-date"))
    existing = idx.work_by_rg.get(rgid)
    rels_data = mb_get(f"/release?release-group={rgid}&inc=media+recordings+labels+artist-credits+isrcs&fmt=json&limit=25")
    rels = pick_releases(rels_data.get("releases") or [])
    cover_url = None
    cover_err = None
    for rel in rels:
        caa = rel.get("cover-art-archive") or {}
        if caa.get("front") or caa.get("artwork"):
            cover_url, cover_err = caa_front(rel.get("id"))
            if cover_url:
                break
    if not cover_url and rels:
        cover_url, cover_err = caa_front(rels[0].get("id"))
    if not cover_url and cover_err:
        REPORT["gaps"].append(f"cover miss {title}: {cover_err}")

    tags = format_tags(primary)
    meta = {
        "external_ids": {"musicbrainz": rgid},
        "musicbrainz_release_group": rgid,
        "primary_type": primary,
        "secondary_types": rg.get("secondary-types") or [],
    }
    aliases = []
    for a in rg.get("aliases") or []:
        if a.get("name"):
            aliases.append(a["name"])

    if existing:
        code, work = api("GET", f"/catalog/works/{existing}?inc=releases")
        if code != 200:
            REPORT["gaps"].append(f"get work failed {title}")
            return
        work["catalog_metadata"] = meta
        work["title"] = work.get("title") or title
        work["original_title"] = work.get("original_title") or title
        if first_date:
            work["release_date"] = first_date
        work["country"] = work.get("country") or "日本"
        work["language"] = "ja"
        work["original_language"] = "ja"
        work["tags"] = tags
        work["aliases"] = aliases or work.get("aliases") or []
        work["status"] = "published"
        api("PUT", f"/catalog/works/{existing}", {
            "title": work["title"],
            "original_title": work.get("original_title") or title,
            "aliases": work.get("aliases") or [],
            "release_date": first_date,
            "summary": work.get("summary") or f"{band_name} / MusicBrainz release group",
            "cover_image_url": work.get("cover_image_url") or cover_url or "",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "catalog_metadata": meta,
            "tags": tags,
            "status": "published",
            "edit_note": "update from MusicBrainz release-group",
            "source_urls": [f"https://musicbrainz.org/release-group/{rgid}"],
        })
        publish_work(existing)
        if cover_url and not (work.get("cover_image_url") or ""):
            set_cover(existing, cover_url, {"title": work["title"], "original_title": title, "aliases": aliases, "summary": work.get("summary") or "", "country": "日本", "language": "ja", "original_language": "ja", "catalog_metadata": meta, "tags": tags})
        elif cover_url:
            REPORT["covers_ok"] += 1
        else:
            REPORT["covers_fail"] += 1
        rel_ok(band_id, existing, "performer")
        REPORT["works"].append({"action": "updated", "name": title, "type": "work", "id": existing, "rg": rgid})
        work_id = existing
    else:
        first = rels[0] if rels else None
        mediums = mediums_payload(first) if first else []
        cat, labels = catalog_and_label(first) if first else ("", [])
        pub_id = None
        if labels:
            pub_id = upsert_label(idx, labels[0])
        edition = (first.get("title") or title) if first else title
        payload = {
            "title": title,
            "original_title": title,
            "aliases": aliases,
            "release_date": first_date,
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": f"{band_name} / MusicBrainz {primary or 'release'}",
            "cover_image_url": cover_url or "",
            "tags": tags,
            "catalog_metadata": meta,
            "external_ids": {"musicbrainz": rgid},
            "artist_relations": [{"artist_id": band_id, "role": "performer"}],
            "edition_name": edition,
            "catalog_number": cat,
            "barcode": (first.get("barcode") or "") if first else "",
            "publisher_id": pub_id,
            "packaging": map_packaging(first) if first else "jewel_case",
            "edition_date": release_date(first) if first else first_date,
            "notes": f"https://musicbrainz.org/release-group/{rgid}",
            "mediums": mediums,
            "translations": [{"locale": "ja", "title": title}],
        }
        if not payload["cover_image_url"]:
            payload.pop("cover_image_url")
        code, body = api("POST", "/catalog/submit", payload)
        if code != 201:
            # retry without cover if URL rejected
            err = str(body)
            if "cover" in err.lower() or "url" in err.lower():
                payload.pop("cover_image_url", None)
                code, body = api("POST", "/catalog/submit", payload)
                REPORT["gaps"].append(f"submit cover rejected {title}: {err}")
            if code != 201:
                REPORT["gaps"].append(f"submit failed {title}: {body}")
                return
        work_id = body.get("work_id") or (body.get("work") or {}).get("id")
        if not work_id:
            REPORT["gaps"].append(f"submit no work_id {title}")
            return
        idx.add_work({"id": work_id, "title": title, "rg": rgid, "mbid": rgid})
        publish_work(work_id)
        if cover_url:
            set_cover(work_id, cover_url, {"title": title, "original_title": title, "aliases": aliases, "summary": payload["summary"], "country": "日本", "language": "ja", "original_language": "ja", "catalog_metadata": meta, "tags": tags})
        elif cover_err:
            REPORT["covers_fail"] += 1
        rel_ok(band_id, work_id, "performer")
        REPORT["works"].append({"action": "created", "name": title, "type": "work", "id": work_id, "rg": rgid})
        first_rel_id = None
        code, detail = api("GET", f"/catalog/works/{work_id}?inc=releases")
        releases = (detail.get("releases") or []) if code == 200 else []
        if releases and first:
            rid = releases[0]["id"]
            first_rel_id = rid
            idx.release_by_mbid[first.get("id")] = {"id": rid, "work_id": work_id, "mbid": first.get("id")}
            api("PUT", f"/catalog/releases/{rid}", {
                "edition_name": edition,
                "catalog_number": cat,
                "barcode": first.get("barcode") or "",
                "publisher_id": pub_id,
                "packaging": map_packaging(first),
                "edition_date": release_date(first),
                "country": release_country(first) or "日本",
                "language": "ja",
                "distribution_channel": "digital" if map_packaging(first) == "digital" else "physical",
                "catalog_metadata": {"musicbrainz": first.get("id"), "status": first.get("status")},
                "notes": f"https://musicbrainz.org/release/{first.get('id')}",
                "edit_note": "fill release country/barcode from MusicBrainz",
            })
            verify_release(rid)
            REPORT["releases"].append({"action": "created", "name": edition, "type": "release", "id": rid, "mbid": first.get("id")})
        extra = rels[1:] if rels else []
    if existing:
        extra = [rel for rel in rels if rel.get("id") not in idx.release_by_mbid]
    for rel in extra:
        if rel.get("id") in idx.release_by_mbid:
            continue
        cat, labels = catalog_and_label(rel)
        pub_id = upsert_label(idx, labels[0]) if labels else None
        code, created = api("POST", "/catalog/releases", {
            "work_id": work_id,
            "publisher_id": pub_id,
            "edition_name": rel.get("title") or title,
            "catalog_number": cat,
            "barcode": rel.get("barcode") or "",
            "packaging": map_packaging(rel),
            "edition_date": release_date(rel),
            "country": release_country(rel) or "日本",
            "language": "ja",
            "distribution_channel": "digital" if map_packaging(rel) == "digital" else "physical",
            "catalog_metadata": {"musicbrainz": rel.get("id"), "status": rel.get("status")},
            "notes": f"https://musicbrainz.org/release/{rel.get('id')}",
        })
        if code != 201:
            REPORT["gaps"].append(f"extra release {rel.get('title')}: {created}")
            continue
        rid = created.get("id")
        idx.release_by_mbid[rel.get("id")] = {"id": rid, "work_id": work_id, "mbid": rel.get("id")}
        verify_release(rid)
        REPORT["releases"].append({"action": "created", "name": rel.get("title") or title, "type": "release", "id": rid, "mbid": rel.get("id")})
        mediums = mediums_payload(rel)
        for med in mediums:
            code, mbody = api("POST", "/catalog/mediums", {
                "release_id": rid,
                "position": med["position"],
                "name": med["name"] or f"Disc {med['position']}",
                "format": med["format"],
                "media_category": "music",
            })
            if code != 201:
                REPORT["gaps"].append(f"medium {title}: {mbody}")
                continue
            mid = mbody.get("id")
            for t in med["tracks"]:
                api("POST", "/catalog/tracks", {
                    "medium_id": mid,
                    "position": t["position"],
                    "title": t["title"],
                    "duration_seconds": t["duration_seconds"],
                    "isrc": t["isrc"],
                    "artist_credit": t["artist_credit"],
                })

    # franchise edge: work -> franchise
    payload = {"relations": [{
        "source_type": "work", "source_id": work_id,
        "target_type": "franchise", "target_id": BANG_DREAM_ID,
        "relationship_type": "part_of_franchise",
    }]}
    code, body = api("PUT", "/catalog/entity-relations", payload)
    if code != 200:
        REPORT["gaps"].append(f"work franchise {title}: {body}")

def all_rgs(artist_mbid):
    out = []
    offset = 0
    while True:
        data = mb_get(f"/release-group?artist={artist_mbid}&limit=100&offset={offset}&fmt=json")
        items = data.get("release-groups") or []
        out.extend(items)
        total = data.get("release-group-count") or data.get("count") or 0
        offset += len(items)
        print(f"  RG page offset={offset}/{total}", flush=True)
        if offset >= total or not items:
            break
    return out

def import_band(idx, mbid):
    print(f"=== artist {mbid} ===", flush=True)
    mb = mb_get(f"/artist/{mbid}?inc=aliases+artist-rels+url-rels&fmt=json")
    band_id = upsert_artist(idx, mb)
    if not band_id:
        REPORT["gaps"].append(f"band missing {mbid}")
        return
    rel_ok(band_id, BANG_DREAM_ID, "part_of_franchise")
    # members
    for rel in mb.get("relations") or []:
        if rel.get("type") != "member of band":
            continue
        other = rel.get("artist") or {}
        if not other.get("id"):
            continue
        # fetch member for type/aliases/voice-actor
        try:
            member_mb = mb_get(f"/artist/{other['id']}?inc=aliases+artist-rels&fmt=json")
        except Exception as e:
            REPORT["gaps"].append(f"member fetch {other.get('name')}: {e}")
            member_mb = other
        mid = upsert_artist(idx, member_mb)
        if not mid:
            continue
        rel_ok(mid, band_id, "member_of")
        rel_ok(mid, BANG_DREAM_ID, "part_of_franchise")
        for vr in member_mb.get("relations") or []:
            if vr.get("type") != "voice actor":
                continue
            va = vr.get("artist") or {}
            if not va.get("id"):
                continue
            hint = "person" if (va.get("type") or "").lower() == "person" else None
            vid = upsert_artist(idx, va, entity_hint=hint)
            if not vid:
                continue
            # CV is person, character is mid if character
            src, tgt = vid, mid
            if (member_mb.get("type") or "").lower() != "character":
                # if member is person, skip inverted
                if (va.get("type") or "").lower() == "character":
                    src, tgt = mid, vid
                else:
                    continue
            rel_ok(src, tgt, "voice_actor_of", qualifier="ja")
    rgs = all_rgs(mbid)
    print(f"  {mb.get('name')} release-groups={len(rgs)}", flush=True)
    for i, rg in enumerate(rgs, 1):
        print(f"  [{i}/{len(rgs)}] {rg.get('title')}", flush=True)
        try:
            import_rg(idx, band_id, mb.get("name"), rg)
        except Exception as e:
            REPORT["gaps"].append(f"rg {rg.get('title')}: {e}")
            print(f"    ERR {e}", flush=True)

def main():
    login()
    idx = load_index_wsl()
    print(f"index artists={len(idx.artist_row)} works={len(idx.work_row)}", flush=True)
    for mbid in ARTIST_MBIDS:
        try:
            import_band(idx, mbid)
        except Exception as e:
            REPORT["gaps"].append(f"band {mbid}: {e}")
            print(f"BAND ERR {mbid} {e}", flush=True)
    out = "/tmp/mb4_report.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(REPORT, f, ensure_ascii=False, indent=2)
    print("DONE", out, flush=True)
    print(json.dumps({
        "artists": len(REPORT["artists"]),
        "works": len(REPORT["works"]),
        "releases": len(REPORT["releases"]),
        "covers_ok": REPORT["covers_ok"],
        "covers_fail": REPORT["covers_fail"],
        "gaps": len(REPORT["gaps"]),
        "errors": len(REPORT["errors"]),
    }, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
