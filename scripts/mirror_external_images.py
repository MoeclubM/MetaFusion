#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把外部官网图片镜像进 MetaFusion 自己的存储，并把实体的图片引用换成我们的地址。

背景：站上有一批图片直接引用外部官网地址（如 bang-dream.com 的乐队键视觉、成员图、唱片封面）。
浏览器加载这些跨站图片时会被 Chrome 的 ORB（Opaque Response Blocking）拦掉
（net::ERR_BLOCKED_BY_ORB），页面上只剩 alt 文本；平台没有图片代理，而服务端直连这些
地址是完全正常的（200 + image/webp）。所以这里由服务端把图下载下来，按 storage 的正式
上传契约存进对象存储，再把实体的 pictures[].url 换成 storage 的分发地址
（GET /api/storage/assets/{id}/content），原始来源留在 pictures[].source 里。

内容不改变：不转码、不缩放、不裁剪，上传的就是下载到的原字节（以 sha256 回读校验）。
只改 pictures[i].url 与 pictures[i].source；taken_at、题名、翻译、关系等一律不动，
也不删除任何实体。

幂等：图片已经是本站地址的直接跳过；同一份内容按 sha256 走秒传，绑定按
(asset, entity, binding_role) 去重，图片地址已是本站地址时再跑一次会报"无需处理"。
另有两条针对现网的适配：目录列表接口按 IP+路由限流（120 次/分钟，网关后是共享 IP），
被限流时按 Retry-After 自动等待重试；列表是 offset 分页，并发建档会让同一实体出现在两页里，
任务按 (实体, 原图 URL) 去重。

用法：
  python scripts/mirror_external_images.py --dry-run
  MF_USERNAME=admin MF_PASSWORD=... python scripts/mirror_external_images.py --limit 3
  TOKEN=<bearer> python scripts/mirror_external_images.py --hosts bang-dream.com,bushiroad.com
  BASE=http://127.0.0.1:8080 python scripts/mirror_external_images.py --dry-run

退出码：0 = 没有失败；1 = 有失败项或参数/登录出错。
"""

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter

DEFAULT_BASE = "https://findverse.cc"
DEFAULT_HOSTS = "bang-dream.com"
DEFAULT_ROLE = "cover_image"
# 官网/CDN 会拦默认 UA；这一步在服务端跑，不受 ORB 影响，但不能看起来像脚本爬虫。
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
PAGE_SIZE = 50  # 服务端会夹住 limit，按返回条数判断是否到底，不假设页大小

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# ---------------------------------------------------------------- HTTP 基础

class Http:
    def __init__(self, base, token="", timeout=60, retries=5):
        self.base = base.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.retries = retries

    def request(self, method, path, data=None, raw=False, headers=None):
        url = path if path.startswith("http") else self.base + path
        body = None
        hdrs = {"User-Agent": UA, "Accept": "*/*"}
        if data is not None:
            body = json.dumps(data).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        if self.token and path.startswith("/"):
            hdrs["Authorization"] = "Bearer " + self.token
        hdrs.update(headers or {})
        last = None
        for attempt in range(self.retries):
            req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    payload = resp.read()
                    if raw:
                        return resp.status, dict(resp.headers), payload
                    return resp.status, dict(resp.headers), (json.loads(payload.decode("utf-8")) if payload else {})
            except urllib.error.HTTPError as e:
                payload = e.read()
                if e.code == 429:
                    # 目录接口按 IP+路由限流（routeLimiter，120 次/分钟，网关后的客户端 IP 是
                    # 共享的，别人浏览站点也会占额度）：等它放行，别把限流当失败。
                    try:
                        wait = int(e.headers.get("Retry-After") or 0)
                    except (TypeError, ValueError):
                        wait = 0
                    wait = min(max(wait, 3), 65)
                    last = ApiError(429, "rate_limited")
                    print("    被限流（429），等 %d 秒后重试" % wait, flush=True)
                    time.sleep(wait)
                    continue
                # 其余 4xx 是确定性结论，重试没有意义（409 版本冲突由调用方自己重读重试）。
                if 400 <= e.code < 500:
                    raise ApiError(e.code, payload.decode("utf-8", "replace")[:300])
                last = ApiError(e.code, payload.decode("utf-8", "replace")[:200])
            except Exception as e:  # 网络抖动/超时
                last = ApiError(0, "%s: %s" % (type(e).__name__, str(e)[:150]))
            if attempt < self.retries - 1:
                time.sleep(1.5 * (attempt + 1))
        raise last

    def get(self, path, params=None):
        if params:
            path += "?" + urllib.parse.urlencode(params, doseq=True)
        return self.request("GET", path)[2]

    def post(self, path, data):
        return self.request("POST", path, data)[2]

    def put(self, path, data):
        return self.request("PUT", path, data)[2]

    def put_bytes(self, path, payload, content_type):
        req = urllib.request.Request(self.base + path, data=payload, method="PUT")
        req.add_header("User-Agent", UA)
        req.add_header("Authorization", "Bearer " + self.token)
        req.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise ApiError(e.code, e.read().decode("utf-8", "replace")[:200])


class ApiError(Exception):
    def __init__(self, code, detail):
        super().__init__("HTTP %s: %s" % (code, detail))
        self.code = code
        self.detail = detail


# ---------------------------------------------------------------- 图片判定

# 只认这些文件头：任务要求"Content-Type 与文件头都要看，不是图片就跳过并记录"。
# 判据从严——未知文件头一律当"不是图片"，宁可跳过并报出来，也不把内容存成图。
IMAGE_MAGIC = (
    ("image/jpeg", lambda b: b[:3] == b"\xff\xd8\xff"),
    ("image/png", lambda b: b[:8] == b"\x89PNG\r\n\x1a\n"),
    ("image/gif", lambda b: b[:6] in (b"GIF87a", b"GIF89a")),
    ("image/webp", lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP"),
    ("image/avif", lambda b: b[4:8] == b"ftyp" and b[8:12] in (b"avif", b"avis")),
    ("image/heic", lambda b: b[4:8] == b"ftyp" and b[8:12] in (b"heic", b"heix", b"hevc", b"mif1")),
    ("image/bmp", lambda b: b[:2] == b"BM"),
    ("image/tiff", lambda b: b[:4] in (b"II*\x00", b"MM\x00*")),
    ("image/x-icon", lambda b: b[:4] == b"\x00\x00\x01\x00"),
    ("image/svg+xml", lambda b: b.lstrip()[:4] == b"<svg"),
)


def sniff_image(data):
    for mime, test in IMAGE_MAGIC:
        try:
            if test(data[:16]):
                return mime
        except (IndexError, TypeError):
            continue
    return ""


def check_image(data, content_type):
    """返回 (sniffed_mime, 说明)；不是图片时 sniffed_mime 为空。"""
    declared = (content_type or "").split(";")[0].strip().lower()
    if not data:
        return "", "响应体为空"
    if not declared.startswith("image/"):
        return "", "Content-Type 不是图片：%s" % (content_type or "(空)")
    sniffed = sniff_image(data)
    if not sniffed:
        return "", "文件头不是已知图片格式（前 12 字节 %s）" % data[:12].hex()
    note = ""
    if sniffed != declared:
        note = "（声明 %s，文件头是 %s，按文件头登记）" % (declared, sniffed)
    return sniffed, note


# ---------------------------------------------------------------- 目录与存储

def login(http, username, password):
    out = http.post("/api/auth/login", {"username": username, "password": password})
    token = out.get("token") or out.get("access_token")
    if not token:
        raise SystemExit("登录失败：响应里没有 token")
    return token


def all_entities(http):
    items, offset = [], 0
    while True:
        data = http.get("/api/catalog/entities", {"limit": PAGE_SIZE, "offset": offset})
        batch = data.get("items") or []
        items.extend(batch)
        if len(batch) < PAGE_SIZE:
            return items
        offset += len(batch)


def is_own_url(url, base_host):
    """已经是本站 storage 分发地址的图片：跳过（幂等判据）。"""
    parsed = urllib.parse.urlparse(url)
    return (parsed.hostname or "").lower() == base_host and parsed.path.startswith("/api/storage/assets/")


def host_matches(host, suffixes):
    host = (host or "").lower()
    return any(host == s or host.endswith("." + s) for s in suffixes)


def pick_tasks(entities, suffixes, public_base):
    """筛出需要镜像的 (实体, 图片下标, 原图 URL)，并按 (实体, 原图) 去重。

    目录列表是 offset 分页：并发建档会让后面的分页整体后移，同一实体因此可能在两页里各出现
    一次（本实例上有别的进程在实时编目）。不去重就会对同一张图做两遍，第二遍白跑。
    """
    own_host = (urllib.parse.urlparse(public_base).hostname or "").lower()
    tasks, seen, dupes = [], set(), 0
    for ent in entities:
        for idx, pic in enumerate(ent.get("pictures") or []):
            url = (pic.get("url") or "").strip()
            if not url or is_own_url(url, own_host):
                continue
            host = (urllib.parse.urlparse(url).hostname or "").lower()
            if not host_matches(host, suffixes):
                continue
            key = (ent.get("id"), url)
            if key in seen:
                dupes += 1
                continue
            seen.add(key)
            tasks.append((ent, idx, url, host))
    return tasks, dupes


def download_image(http, url, page_url):
    headers = {
        "User-Agent": UA,
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    if page_url:
        headers["Referer"] = page_url
    status, hdrs, payload = http.request("GET", url, raw=True, headers=headers)
    return status, (hdrs.get("Content-Type") or ""), payload


def upload_to_storage(http, data, mime, file_name, entity_id, role):
    """走 storage 的正式上传契约：initiate → （未命中秒传时）流式上传 → 回读核对。

    一律用 PUT /api/storage/upload/stream/{asset_id} 送字节：它是 README 里写明的
    "本地对象模式的主要上传方式，也可作为预签名不可用时的兜底"。预签名地址的 Host 是
    对象存储端点（本实例没配 STORAGE_S3_PUBLIC_ENDPOINT），本机根本连不上。
    """
    digest = hashlib.sha256(data).hexdigest()
    init = http.post("/api/storage/upload/initiate", {
        "file_name": file_name,
        "file_size": len(data),
        "sha256_hash": digest,
        "mime_type": mime,
        "part_count": 1,
        "binding_role": role,
    })
    asset_id = init.get("asset_id") or ""
    if not asset_id:
        raise ApiError(0, "initiate 响应没有 asset_id：%s" % json.dumps(init, ensure_ascii=False)[:200])
    instant = bool(init.get("is_instant_upload"))
    if not instant:
        http.put_bytes("/api/storage/upload/stream/" + asset_id, data, "application/octet-stream")
    # 回读核对：大小与 sha256 都要对上，否则实体不该引用它。
    check = http.get("/api/storage/assets/" + asset_id).get("asset") or {}
    if check.get("status") != "complete":
        raise ApiError(0, "资产未完成：status=%s fail_reason=%s" % (check.get("status"), check.get("fail_reason")))
    if check.get("sha256") != digest or int(check.get("size_bytes") or -1) != len(data):
        raise ApiError(0, "回读不符：sha256=%s size=%s（期望 %s / %d）"
                       % (check.get("sha256"), check.get("size_bytes"), digest, len(data)))
    # 绑定到目标实体：storage 的读取可见性靠"任一绑定目标实体可见"，不绑定就没人能匿名读到。
    http.post("/api/storage/bind", {
        "asset_id": asset_id,
        "target_entity_id": entity_id,
        "binding_role": role,
    })
    return asset_id, digest, instant


def mirrored_picture(pic, asset_id, public_base, original_url, host):
    """新的图片记录：地址换成我们的，来源保留原始页面 URL 并把原图 URL 写进说明。"""
    src = dict(pic.get("source") or {})
    citation = (src.get("citation") or "").strip()
    note = "原图 %s（%s）已镜像至本站存储" % (original_url, host)
    src["citation"] = (citation + "；" + note) if citation else note
    if not src.get("kind"):
        src["kind"] = "url"
    if src.get("kind") == "url" and not src.get("url"):
        src["url"] = original_url
    out = dict(pic)  # taken_at / caption 原样保留
    out["url"] = "%s/api/storage/assets/%s/content" % (public_base.rstrip("/"), asset_id)
    out["source"] = src
    return out


def save_picture(http, entity_id, original_url, new_pic, edit_note, source_url):
    """PUT 是整实体替换：先读全量、只换这一张图，再带乐观锁写回。"""
    for attempt in range(2):
        ent = http.get("/api/catalog/entities/" + entity_id)
        pics = list(ent.get("pictures") or [])
        idx = next((i for i, p in enumerate(pics) if (p.get("url") or "") == original_url), None)
        if idx is None:
            return "already", ent  # 已经被别的流程改掉了：当作无需处理
        pics[idx] = new_pic
        ent["pictures"] = pics
        payload = {
            "entity": ent,
            "expected_version": ent.get("version", 0),
            "edit_note": edit_note,
            "sources": [{"kind": "url", "citation": "原图来源页面（镜像前记录）", "url": source_url}],
        }
        try:
            out = http.put("/api/catalog/entities/" + entity_id, payload)
            return "ok", out
        except ApiError as e:
            if e.code == 409 and attempt == 0:
                time.sleep(1.0)  # 版本冲突：重读一次再写
                continue
            raise
    return "conflict", None


# ---------------------------------------------------------------- 主流程

def safe_name(url, fallback="image"):
    base = urllib.parse.urlparse(url).path.rsplit("/", 1)[-1]
    base = urllib.parse.unquote(base).strip()
    return base[:120] or fallback


def main():
    ap = argparse.ArgumentParser(description="把外部官网图片镜像进本站存储，并改写实体图片引用")
    ap.add_argument("--base", default=os.environ.get("BASE", DEFAULT_BASE), help="站点 API 根（默认 %s）" % DEFAULT_BASE)
    ap.add_argument("--token", default=os.environ.get("TOKEN", ""), help="Bearer 令牌（默认取 env TOKEN）")
    ap.add_argument("--username", default=os.environ.get("MF_USERNAME", ""), help="登录用户名（默认取 env MF_USERNAME）")
    ap.add_argument("--password", default=os.environ.get("MF_PASSWORD", ""), help="登录口令（默认取 env MF_PASSWORD）")
    ap.add_argument("--hosts", default=os.environ.get("MF_MIRROR_HOSTS", DEFAULT_HOSTS),
                    help="要镜像的来源域名后缀，逗号分隔（默认 %s，子域自动匹配）" % DEFAULT_HOSTS)
    ap.add_argument("--public-base", default="", help="写进 pictures[].url 的对外地址前缀（默认同 --base）")
    ap.add_argument("--binding-role", default=DEFAULT_ROLE, help="storage 绑定用途码（默认 %s）" % DEFAULT_ROLE)
    ap.add_argument("--limit", type=int, default=0, help="本次最多处理几张（0 = 不限）")
    ap.add_argument("--dry-run", action="store_true", help="只打印计划，不下载、不上传、不改实体")
    ap.add_argument("--list-limit", type=int, default=40, help="明细里最多打印多少条（默认 40）")
    args = ap.parse_args()

    public_base = (args.public_base or args.base).rstrip("/")
    suffixes = [h.strip().lower().lstrip(".") for h in args.hosts.split(",") if h.strip()]
    http = Http(args.base)
    if not args.token:
        if not (args.username and args.password):
            raise SystemExit("需要凭据：给 --token，或给 --username/--password（也可用环境变量 MF_USERNAME/MF_PASSWORD）")
        http.token = login(http, args.username, args.password)
    else:
        http.token = args.token

    try:
        entities = all_entities(http)
    except ApiError as e:
        print("读取实体列表失败：%s" % e)
        print("（实体列表接口有每分钟限流；稍后重跑即可，脚本会按 Retry-After 自动等待）")
        return 1
    tasks, dupes = pick_tasks(entities, suffixes, public_base)
    if args.limit and args.limit > 0:
        tasks = tasks[:args.limit]

    hosts = Counter(t[3] for t in tasks)
    kinds = Counter(str(t[0].get("kind")) for t in tasks)
    print("站点 %s；实体 %d 个；来源域名 %s" % (args.base, len(entities), ",".join(suffixes)))
    if dupes:
        print("（分页去重：同一实体的同一张图出现 %d 次，已合并）" % dupes)
    if not tasks:
        print("无需处理（0 张待镜像）。")
        return 0
    print("待镜像 %d 张（涉及实体 %d 个）" % (len(tasks), len({t[0]["id"] for t in tasks})))
    print("来源分布：" + "，".join("%s %d" % (h, n) for h, n in hosts.most_common()))
    print("类型分布：" + "，".join("%s %d" % (k, n) for k, n in kinds.most_common()))

    if args.dry_run:
        print("\n计划明细（最多 %d 条）：" % args.list_limit)
        for ent, idx, url, host in tasks[:args.list_limit]:
            print("  %-12s %-28s %s" % (ent.get("kind"), (ent.get("title") or "")[:26], url))
        if len(tasks) > args.list_limit:
            print("  …（另有 %d 条）" % (len(tasks) - args.list_limit))
        print("\n--dry-run：未下载、未上传、未修改任何实体。")
        return 0

    ok = skipped = failed = 0
    details = []
    for i, (ent, idx, url, host) in enumerate(tasks, 1):
        label = "%s %s" % (ent.get("kind"), (ent.get("title") or "")[:24])
        print("[%d/%d] %s  %s" % (i, len(tasks), label, safe_name(url)), flush=True)
        pic = (ent.get("pictures") or [])[idx]
        page_url = ((pic.get("source") or {}).get("url") or "")
        try:
            _, ctype, data = download_image(http, url, page_url)
            mime, note = check_image(data, ctype)
            if not mime:
                skipped += 1
                details.append(("跳过（非图片）", ent["id"], url, note))
                print("    跳过：%s" % note)
                continue
            asset_id, digest, instant = upload_to_storage(
                http, data, mime, safe_name(url), ent["id"], args.binding_role)
            new_pic = mirrored_picture(pic, asset_id, public_base, url, host)
            note_src = page_url or url
            edit_note = "镜像外部图片到本站存储：%s（来源 %s）" % (url, host)
            state, out = save_picture(http, ent["id"], url, new_pic, edit_note, note_src)
            if state != "ok":
                skipped += 1
                details.append(("跳过（图片引用已变）", ent["id"], url, state))
                print("    跳过：实体的图片引用已变化，不再改写")
                continue
            ok += 1
            print("    镜像成功：asset=%s %d 字节 sha256=%s%s%s 版本→%s"
                  % (asset_id, len(data), digest[:16], "（秒传）" if instant else "",
                     (" " + note) if note else "", out.get("version")))
            print("    url → %s" % new_pic["url"])
        except ApiError as e:
            failed += 1
            details.append(("失败", ent["id"], url, str(e)))
            print("    失败：%s" % e)
        except Exception as e:  # 单张出错不影响其余图片
            failed += 1
            details.append(("失败", ent["id"], url, "%s: %s" % (type(e).__name__, str(e)[:150])))
            print("    失败：%s: %s" % (type(e).__name__, str(e)[:150]))

    print("\n计数：镜像成功 %d / 跳过（非图片或引用已变） %d / 失败 %d" % (ok, skipped, failed))
    if details:
        print("明细（最多 40 条）：")
        for state, eid, url, why in details[:40]:
            print("  [%s] %s %s  %s" % (state, eid[:12], url[:80], why))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
