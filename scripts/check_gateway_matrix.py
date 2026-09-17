#!/usr/bin/env python3
"""网关矩阵自检：location 集合、限流覆盖、上游归属与 docs/architecture/service-split-migration.md §2 表对齐。

为什么需要它：矩阵是"唯一生效来源"，契约表在文档里，两者靠人肉同步。历史上出现过两类事故：
新前缀漏加 location 就静默落回目录服务（表现为 404）；切流后某个前缀仍指着旧上游。
脚本只用标准库，不联网、不需要 docker/nginx，本地与 CI 都能直接跑。

检查项（任一不过以非零码退出）：
1. 结构：花括号配平；每条 location 有 proxy_pass 或 return；proxy_pass 引用的 $变量必须在本块内 set；
   limit_req 用到的 zone 必须有同名 limit_req_zone 定义。
2. 限流覆盖：/api/ 下的每条 location 都必须带 limit_req —— 精确匹配与正则 location 不会继承
   location /api/ 的兜底限流，漏挂就是"看起来有、实际没有"。
3. 登记：矩阵里每条 location 的路径族必须在文档 §2 表里登记（白名单见下），反向也检查表格里的
   每条路径至少被一条 location 覆盖。
4. 归属：文档 §2 表把某前缀归给哪个服务（catalog / auth / community / storage），矩阵里该 location
   的上游主机就必须是该服务的容器名（backend / auth / community / storage）。这条专抓"切流后又指回目录"。

白名单（未登记仍允许，逐条给理由）：
  /                  —— 前端 Next.js 应用，非 API 前缀
  /admin             —— 主前端里的目录控制台（由 location / 兜底，未单列前缀）
  /docs              —— 文档站前缀
  /storage/preview   —— 退役占位，显式 return 404，不分流到任何上游
  /healthz /livez /live —— 网关自身存活探针（只证明 nginx 进程在跑）
  /ready /health     —— 兼容旧路径，仍指目录服务
  /health/<service>  —— 逐上游就绪探针

用法：python scripts/check_gateway_matrix.py [仓库根目录] [--matrix PATH] [--doc PATH]
"""
import argparse
import os
import re
import sys

LOCATION_RE = re.compile(r"^\s*location\s+(?:(=|\^~|~\*|~)\s+)?(\S+)\s*\{")
UPSTREAM_RE = re.compile(r'set\s+\$(\w+)\s+"http://([A-Za-z0-9_.-]+)(?::(\d+))?"')
PROXY_VAR_RE = re.compile(r"proxy_pass\s+\$(\w+)")
LIMIT_RE = re.compile(r"limit_req\s+zone=(\w+)")
ZONE_RE = re.compile(r"limit_req_zone\s+\S+\s+zone=(\w+):")
# 文档里的路径 token 常带方法前缀（"GET|POST /api/setup"、"POST /api/auth/login|refresh"）。
# 路径候选本身也用 "|" 分隔，所以先剥掉方法名，再按 "|" 取第一条候选路径。
METHOD_PREFIX = re.compile(r"^(?:[A-Z]{3,7}\s*\|\s*|[A-Z]{3,7}\s+)+")

# 文档 §2 表的"归属"列 -> 矩阵里允许的上游主机名。
# 每个域多一个 <域>-admin：服务自带的独立管理台（页面与静态资源，见 §7.3 决议）与域内 API 同属该域，
# 但它们在编排里是独立容器，因此单独登记而不是复用域 API 的主机名——同一域的两个上游之间写错
# （管理台指到域 API 容器）归人工复核，这里只保证"没指到别的域、也没指到不存在的服务"。
OWNER_HOSTS = {
    "catalog": {"backend"},
    "auth": {"auth", "auth-admin"},
    "community": {"community", "community-admin"},
    "storage": {"storage", "storage-admin"},
}

WHITELIST = {
    "/": "前端 Next.js 应用，非 API 前缀",
    "/admin": "主前端里的目录控制台：一条 location / 兜底，没有单列前缀",
    "/docs": "文档站前缀",
    "/storage/preview": "退役占位：显式 return 404，不分流到任何上游",
    "/healthz": "网关自身存活探针",
    "/livez": "网关自身存活探针别名",
    "/live": "网关自身存活探针别名",
    "/ready": "兼容旧路径：目录服务就绪探针",
    "/health": "兼容旧路径：目录服务探针（目录补 /health 之前如实 404）",
    "/health/catalog": "逐上游就绪探针",
    "/health/auth": "逐上游就绪探针",
    "/health/community": "逐上游就绪探针",
    "/health/storage": "逐上游就绪探针",
}


def strip_noise(text):
    """去掉注释与引号内内容：花括号配平与指令扫描都不该被它们干扰。"""
    text = re.sub("'[^']*'", "''", text)
    text = re.sub('"[^"]*"', '""', text)
    return re.sub("#.*", "", text)


def strip_comments(text):
    """只去掉注释部分，保留引号内容——上游地址写在引号里，去掉引号就抽不到主机名。"""
    return re.sub("#.*", "", text)


def normalize_path(raw):
    """把 location 表达式或文档里的路径 token 归一到"路径族"：去掉正则/通配/占位符尾巴。"""
    p = raw.strip()
    if p.startswith("^"):
        p = p[1:]
    for cut in ("{", "[", "(", "$", "\\"):
        idx = p.find(cut)
        if idx >= 0:
            p = p[:idx]
    p = p.replace("*", "")
    if p.startswith("/") and p.strip("/") == "":
        return "/"  # 根 location 不能被 rstrip 成空串，否则会绕过白名单
    p = p.rstrip("/")
    return p if p.startswith("/") else ""


def seg_prefix(short, long):
    """short 是否是 long 的路径段前缀（/a 是 /a/b 的前缀，/ab 不是）。"""
    if short == long:
        return True
    if short == "/":
        return long.startswith("/")
    return long.startswith(short + "/")


def parse_locations(lines):
    """返回 [(行号, 修饰符, 原始路径, 路径族, 块内文本)]。

    location 只出现在 server 块里，因此不按嵌套深度筛（那样得跟着 http/server 两层走），
    直接逐行匹配，再按花括号把块切出来。
    """
    blocks = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = LOCATION_RE.match(line)
        if not m:
            i += 1
            continue
        start = i
        d = line.count("{") - line.count("}")
        j = i + 1
        while j < len(lines) and d > 0:
            d += lines[j].count("{") - lines[j].count("}")
            j += 1
        blocks.append((start + 1, m.group(1) or "", m.group(2), normalize_path(m.group(2)), "\n".join(lines[start:j])))
        i = j
    return blocks


def split_cells(line):
    """按 "|" 切表格行，但反引号里的 "|" 不算分隔符。

    路径列里两种情况都有：`GET|POST /api/setup`（方法分隔）与
    `/api/favorites/toggle|status|mine`（路径候选分隔）。用朴素 split("|") 会把这些行切碎，
    表现是"文档里明明登记了，脚本却说没登记"。
    """
    cells, buf, in_tick = [], [], False
    for ch in line.strip().strip("|"):
        if ch == "`":
            in_tick = not in_tick
            buf.append(ch)
            continue
        if ch == "|" and not in_tick:
            cells.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    cells.append("".join(buf))
    return [c.strip() for c in cells]


def parse_doc_rows(text):
    """从 §2 表取 (归属, 路径族, 原始 token)；只读表格第二列，避免正文里的同名前缀干扰。"""
    rows = []
    in_section = False
    for line in text.splitlines():
        if line.startswith("## 2."):
            in_section = True
            continue
        if in_section and line.startswith("## "):
            break
        if not in_section or not line.lstrip().startswith("|"):
            continue
        cells = split_cells(line)
        if len(cells) < 2:
            continue
        owner, paths = cells[0].lower(), cells[1]
        if owner not in OWNER_HOSTS:
            continue
        for token in re.findall("`([^`]+)`", paths):
            token = METHOD_PREFIX.sub("", token)
            for piece in token.split("|")[:1]:
                family = normalize_path(piece)
                if family:
                    rows.append((owner, family, piece.strip()))
    return rows


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    default_root = os.path.dirname(here)
    ap = argparse.ArgumentParser(description="网关矩阵自检")
    ap.add_argument("root", nargs="?", default=default_root, help="仓库根目录")
    ap.add_argument("--matrix", default=None, help="矩阵文件（默认 <root>/deploy/nginx.conf）")
    ap.add_argument("--doc", default=None, help="契约文档（默认 <root>/docs/architecture/service-split-migration.md）")
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    matrix = os.path.abspath(args.matrix or os.path.join(root, "deploy", "nginx.conf"))
    doc = os.path.abspath(args.doc or os.path.join(root, "docs", "architecture", "service-split-migration.md"))

    problems = []
    for path in (matrix, doc):
        if not os.path.exists(path):
            problems.append("读不到 %s" % path)
    if problems:
        for bad in problems:
            print("FAIL " + bad)
        print("check_gateway_matrix: %d 个问题，0 项跳过" % len(problems))
        return 1

    with open(matrix, encoding="utf-8") as fh:
        raw = fh.read()
    with open(doc, encoding="utf-8") as fh:
        doc_text = fh.read()

    clean = strip_noise(raw)
    if clean.count("{") != clean.count("}"):
        problems.append("%s: 花括号不配平" % os.path.relpath(matrix, root))

    lines = raw.splitlines()
    zones = set(ZONE_RE.findall(clean))
    blocks = parse_locations(lines)
    doc_rows = parse_doc_rows(doc_text)
    rel_matrix = os.path.relpath(matrix, root)
    rel_doc = os.path.relpath(doc, root)

    for lineno, _modifier, raw_path, family, block in blocks:
        body = strip_comments(block)
        if "proxy_pass" not in body and "return" not in body:
            problems.append("%s:%d: location %s 既没有 proxy_pass 也没有 return" % (rel_matrix, lineno, raw_path))
        for zone in LIMIT_RE.findall(body):
            if zone not in zones:
                problems.append("%s:%d: limit_req 用了未定义的 zone=%s" % (rel_matrix, lineno, zone))
        for var in PROXY_VAR_RE.findall(body):
            if ("set $%s" % var) not in body:
                problems.append("%s:%d: proxy_pass 用了本块未 set 的 $%s" % (rel_matrix, lineno, var))
        if family.startswith("/api") and not LIMIT_RE.search(body):
            problems.append("%s:%d: location %s 在 /api/ 下却没挂 limit_req（精确匹配/正则不继承兜底限流）" % (rel_matrix, lineno, raw_path))

        if family in WHITELIST:
            continue
        hosts = {m[1] for m in UPSTREAM_RE.findall(body)}
        owners = {owner for owner, dfamily, _tok in doc_rows if seg_prefix(family, dfamily) or seg_prefix(dfamily, family)}
        if not owners:
            problems.append("%s:%d: location %s（路径族 %s）未在 %s §2 表登记，也不是白名单项" % (rel_matrix, lineno, raw_path, family, rel_doc))
            continue
        allowed = set()
        for owner in owners:
            allowed |= OWNER_HOSTS.get(owner, set())
        if hosts and not (hosts & allowed):
            problems.append("%s:%d: location %s 指向 %s，但 §2 表把该前缀归给 %s（应为 %s）" % (rel_matrix, lineno, raw_path, "/".join(sorted(hosts)), "/".join(sorted(owners)), "/".join(sorted(allowed))))

    # 反查分两种口径：目录侧的前缀本来就由 location /api/ 兜着，而账号/互动/存储的前缀
    # 必须显式从兜底里分流出来（这正是切流要保证的事），所以只有它们要求"非兜底 location"覆盖。
    catch_all = {"/", "/api"}
    dedicated = [(family, raw_path) for _ln, _mod, raw_path, family, _block in blocks if family not in catch_all]
    for owner, dfamily, token in doc_rows:
        covered_by = [(family, raw_path) for family, raw_path in dedicated if seg_prefix(family, dfamily) or seg_prefix(dfamily, family)]
        if covered_by:
            continue
        if owner == "catalog":
            any_cover = any(seg_prefix(family, dfamily) or seg_prefix(dfamily, family) for _ln, _mod, _raw, family, _block in blocks)
            if any_cover:
                continue
        problems.append("%s §2 表登记了 %s（归属 %s），矩阵里没有%s location 覆盖它"
                        % (rel_doc, token, owner, "任何" if owner == "catalog" else "把它从兜底里分流出来的"))

    for bad in problems:
        print("FAIL " + bad)
    print("check_gateway_matrix: %d 条 location、%d 条文档路径、%d 个问题" % (len(blocks), len(doc_rows), len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())