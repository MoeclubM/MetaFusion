#!/usr/bin/env python3
"""审计表 DDL 一致性检查：授权脚本里的预建 DDL 必须与四个服务各自那份逐字一致。

为什么需要它：audit.audit_log 是**跨四个服务共用**的表，四个仓库是独立 module、没有跨仓依赖通道，
因此 DDL 天然有 4 份服务副本（Go 常量 + community/storage 的迁移文件）；授权脚本
deploy/sql/roles-least-privilege.sql 第 3b 节又加了一份**预建**副本——部署时以它为准，服务的
CREATE ... IF NOT EXISTS 全部空转，owner 才会固定是 mf_audit_owner。

为什么"预建副本必须与四份服务副本逐字一致"：预建决定的是**实际落库的结构**，服务侧决定的是
"我以为自己写的是哪些列"。两边一旦漂移（今天加一列、明天改个默认值），INSERT 会按旧列名写新表，
表现为审计行静默写失败——业务不受影响、留痕整段缺失，而现有检查一个都不会红。手工核对四份副本
是不可持续的（本轮就踩到过：预建 DDL 是我抄进脚本的，抄错没人知道），所以这里做成机器检查。

检查内容（任一不过以非零码退出）：
A. 八个来源提取出的语句集合必须完全一致：CREATE SCHEMA / pg_advisory_xact_lock(740205) /
   CREATE TABLE audit.audit_log / 四条 CREATE INDEX。比较用"去整行注释 + 折叠空白"的规范化文本，
   因此换行与缩进不算差异，字面差异会失败。
B. 结构形状独立断言（不看其它来源也能判）：18 个列、4 条索引（名字与列序固定）、锁键 740205。
C. 来源缺席（兄弟仓库没检出）记"未能校验"并照常退出 0——CI 上它们由前一步按 deploy/versions.lock
   检出，因此那里是全量校验。

用法：python scripts/check_audit_schema.py [仓库根目录] [--siblings-root DIR] [--selftest]
"""
import argparse
import os
import re
import sys

# 与 check_env_matrix.py 同一套布局约定：兄弟仓库默认在与主仓库并列的 ../metafusion-* 下。
SIBLING_DIRS = {
    "auth": "../metafusion-auth",
    "community": "../metafusion-community",
    "storage": "../metafusion-storage",
}

# 八个来源：("标签", "仓库", "相对仓库根的路径")。deploy 那一份从标记区间里取。
SOURCES = [
    ("deploy(预建)", "catalog", "deploy/sql/roles-least-privilege.sql"),
    ("catalog/迁移", "catalog", "backend/migrations/000002_audit_log.up.sql"),
    ("catalog/audit.go", "catalog", "backend/internal/audit/audit.go"),
    ("auth/audit.go", "auth", "internal/audit/audit.go"),
    ("community/迁移", "community", "migrations/000007_audit_log.up.sql"),
    ("community/audit.go", "community", "internal/audit/audit.go"),
    ("storage/迁移", "storage", "internal/store/migrations/000002_audit_log.up.sql"),
    ("storage/audit.go", "storage", "internal/audit/audit.go"),
]

REGION_BEGIN = "audit-ddl begin"
REGION_END = "audit-ddl end"
GO_CONST = re.compile(r"const\s+Schema\s*=\s*\x60")

# 只比较"契约语句"：授权脚本的区间里还夹着 SET LOCAL ROLE / BEGIN / COMMIT 这类记账语句，
# 两边统一过滤，DDL 本身仍然是逐字比对。
# 两种契约形态都要认：2026-09-19 之前是"裸语句 + IF NOT EXISTS"（CREATE INDEX 在表已存在时会 42501），
# 之后是"整段包在 to_regclass 守卫里"（PERFORM 取锁 + 无 IF NOT EXISTS 的建表/建索引）。
# 两种形态的语句集合必然不同，所以守卫本身也作为一个 canonical 元素参与比对——混用就是漂移。
CANONICAL_PREFIXES = ("create schema", "select pg_advisory_xact_lock", "perform pg_advisory_xact_lock",
                      "create table", "create index")
GUARD_MARKER = "to_regclass('audit.audit_log') is null"
GUARD_TOKEN = "GUARD to_regclass('audit.audit_log') IS NULL"

EXPECTED_COLUMNS = [
    "id", "occurred_at", "service", "action", "actor_user_id", "actor_username", "credential_type",
    "actor_ip", "actor_user_agent", "target_type", "target_id", "changes", "result", "error_code",
    "request_method", "route", "http_status", "request_id",
]
EXPECTED_INDEXES = [
    "audit_log_occurred_at_idx",
    "audit_log_service_action_idx",
    "audit_log_actor_idx",
    "audit_log_target_idx",
]
EXPECTED_LOCK = "740205"


def repo_dir(root, repo, siblings_root):
    if repo == "catalog":
        return root
    rel = SIBLING_DIRS[repo]
    if siblings_root:
        return os.path.normpath(os.path.join(os.path.abspath(siblings_root), os.path.basename(rel)))
    return os.path.normpath(os.path.join(root, rel))


def slice_region(text):
    """取授权脚本里 -- >>> audit-ddl begin / -- <<< audit-ddl end 之间的正文。"""
    start = text.find(REGION_BEGIN)
    end = text.find(REGION_END)
    if start < 0 or end < 0 or end <= start:
        return None
    return text[text.find("\n", start) + 1: text.rfind("\n", 0, end)]


def slice_go_const(text):
    """取 Go 文件里 const Schema = `...` 的正文（第一对反引号之间）。"""
    m = GO_CONST.search(text)
    if not m:
        return None
    rest = text[m.end():]
    close = rest.find("\x60")
    if close < 0:
        return None
    return rest[:close]


def read_source(path):
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()
    if path.endswith(".go"):
        return slice_go_const(raw)
    if path.endswith("roles-least-privilege.sql"):
        return slice_region(raw)
    return raw


def statements(text):
    """去整行注释 → 按分号切 → 折叠空白 → 只留契约语句（保持出现顺序）。"""
    lines = []
    for line in text.splitlines():
        if line.strip().startswith("--"):
            continue
        lines.append(line)
    joined = "\n".join(lines)
    out = []
    for stmt in joined.split(";"):
        norm = " ".join(stmt.split())
        if not norm:
            continue
        low = norm.lower()
        if any(low.startswith(p) for p in CANONICAL_PREFIXES):
            out.append(norm)
    if GUARD_MARKER in " ".join(joined.lower().split()):
        out.append(GUARD_TOKEN)
    return out


def table_columns(stmt):
    """从 CREATE TABLE 语句里取出顶层列定义（按顶层逗号切，忽略括号内的逗号）。"""
    body = stmt[stmt.find("(") + 1: stmt.rfind(")")]
    parts, depth, cur = [], 0, ""
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return [p.strip() for p in parts if p.strip()]


def diff_hint(a, b):
    """给出第一条差异的位置与前后的少量上下文：DDL 很长，只截前 200 字会看不到差在哪。"""
    i = 0
    limit = min(len(a), len(b))
    while i < limit and a[i] == b[i]:
        i += 1
    start = max(0, i - 40)
    return "…%s… ≠ …%s…" % (a[start:i + 40], b[start:i + 40])


def shape_problems(label, stmts, raw):
    """结构形状断言：列数/列序、四条索引、锁键。只看 DDL 语义，不看与其它来源是否一致。"""
    problems = []
    tables = [s for s in stmts if s.lower().startswith("create table")]
    indexes = [s for s in stmts if s.lower().startswith("create index")]
    locks = [s for s in stmts if s.lower().startswith("select pg_advisory_xact_lock")]

    if len(tables) != 1:
        problems.append("%s: CREATE TABLE 语句应为 1 条，实际 %d 条" % (label, len(tables)))
    else:
        cols = table_columns(tables[0])
        if len(cols) != len(EXPECTED_COLUMNS):
            problems.append("%s: audit.audit_log 列数应为 %d，实际 %d" % (label, len(EXPECTED_COLUMNS), len(cols)))
        else:
            got = [c.split()[0].strip('"') for c in cols]
            if got != EXPECTED_COLUMNS:
                problems.append("%s: audit.audit_log 列序不一致：%s" % (label, got))

    if len(indexes) != len(EXPECTED_INDEXES):
        problems.append("%s: CREATE INDEX 应为 %d 条，实际 %d" % (label, len(EXPECTED_INDEXES), len(indexes)))
    else:
        got = [re.search(r"audit_log_[a-z_]*idx", s).group(0) for s in indexes if re.search(r"audit_log_[a-z_]*idx", s)]
        if got != EXPECTED_INDEXES:
            problems.append("%s: 索引名/顺序不一致：%s" % (label, got))

    # 取锁语句两种形态都认（SELECT / 守卫里的 PERFORM），因此直接在原文里找键位
    if len(locks) > 1 or ("pg_advisory_xact_lock(%s)" % EXPECTED_LOCK) not in raw:
        problems.append("%s: 缺少 pg_advisory_xact_lock(%s)（四个服务同时首次建表要靠它串行化）" % (label, EXPECTED_LOCK))
    return problems


def check(root, siblings_root):
    problems, unchecked = [], []
    extracted = {}
    for label, repo, relpath in SOURCES:
        base = repo_dir(root, repo, siblings_root)
        if not os.path.isdir(base):
            unchecked.append("%s（%s 目录不在本机）" % (label, os.path.basename(base)))
            continue
        path = os.path.join(base, relpath)
        if not os.path.isfile(path):
            # 主仓库的来源缺席 = 检查自己的前提没了，必须红；兄弟仓库缺文件 = 按 versions.lock
            # 检出的那个版本还没有这个功能（例如锁还指向引入审计表之前），记"未能校验"照常退出 0——
            # 与 check_versions.py / check_env_matrix.py 对缺席兄弟仓库的口径一致。
            if repo == "catalog":
                problems.append("%s: 找不到来源文件 %s" % (label, os.path.join(os.path.basename(base), relpath)))
            else:
                unchecked.append("%s（%s 的检出里没有 %s）" % (label, os.path.basename(base), relpath))
            continue
        text = read_source(path)
        if text is None:
            problems.append("%s: 没能在 %s 里定位到 DDL（Go 常量 const Schema / 脚本标记区间）" % (label, relpath))
            continue
        stmts = statements(text)
        if not stmts:
            problems.append("%s: %s 里没提取到任何契约语句" % (label, relpath))
            continue
        extracted[label] = stmts
        problems.extend(shape_problems(label, stmts, text))

    # A. 来源之间逐字（规范化后）比对
    if len(extracted) >= 2:
        ref_label, ref = sorted(extracted.items())[0]
        ref_set = set(ref)
        for label, stmts in sorted(extracted.items()):
            if label == ref_label:
                continue
            diff = ref_set.symmetric_difference(set(stmts))
            if diff:
                only_ref = [s for s in ref if s not in set(stmts)]
                only_other = [s for s in stmts if s not in ref_set]
                hints = [diff_hint(a, b) for a, b in list(zip(only_ref, only_other))[:2]]
                problems.append("%s 与 %s 的 DDL 不一致：%s" % (label, ref_label, "；".join(hints)))
            elif stmts != ref:
                problems.append("%s 与 %s 的语句顺序不一致" % (label, ref_label))

    for bad in problems:
        print("FAIL " + bad)
    if unchecked:
        print("未能校验 %d 项：%s" % (len(unchecked), "、".join(sorted(unchecked))))
    print("check_audit_schema: %d 个来源，%d 个问题，%d 项未能校验"
          % (len(SOURCES), len(problems), len(unchecked)))
    return 1 if problems else 0


SELFTEST_SAMPLES = [
    ("空白与换行差异不算漂移",
     "CREATE TABLE audit.audit_log (\n  id  uuid PRIMARY KEY,\n  result text\n);",
     "CREATE TABLE audit.audit_log ( id uuid PRIMARY KEY, result text );",
     True),
    ("列的类型变了要红",
     "CREATE TABLE audit.audit_log ( id uuid PRIMARY KEY );",
     "CREATE TABLE audit.audit_log ( id text PRIMARY KEY );",
     False),
    ("整行注释不影响比对",
     "-- 说明\nCREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit.audit_log(actor_user_id DESC);",
     "CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit.audit_log(actor_user_id DESC);",
     True),
]


def selftest():
    failures = []
    for label, a, b, want_equal in SELFTEST_SAMPLES:
        same = statements(a) == statements(b)
        if same != want_equal:
            failures.append("%s: 期望相等=%s，实际相等=%s" % (label, want_equal, same))
    # 形状断言必须能抓到"少一列"
    broken = ["CREATE TABLE IF NOT EXISTS audit.audit_log ( id uuid PRIMARY KEY );",
              "CREATE INDEX IF NOT EXISTS audit_log_occurred_at_idx ON audit.audit_log(occurred_at DESC);",
              "SELECT pg_advisory_xact_lock(740205);"]
    if not shape_problems("selftest", broken, "\n".join(broken)):
        failures.append("形状断言没抓到残缺的建表语句")
    region = "-- >>> audit-ddl begin\nCREATE SCHEMA IF NOT EXISTS audit;\n-- <<< audit-ddl end\n"
    if "CREATE SCHEMA" not in (slice_region(region) or ""):
        failures.append("标记区间提取失败")
    for bad in failures:
        print("FAIL " + bad)
    print("check_audit_schema --selftest: %d 项用例，%d 个问题" % (len(SELFTEST_SAMPLES) + 2, len(failures)))
    return 1 if failures else 0


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    default_root = os.path.dirname(here)
    ap = argparse.ArgumentParser(description="审计表 DDL 一致性检查（deploy/sql 预建 DDL ↔ 四个服务副本）")
    ap.add_argument("root", nargs="?", default=default_root, help="仓库根目录")
    ap.add_argument("--siblings-root", default=os.environ.get("MF_SIBLINGS_ROOT"),
                    help="兄弟仓库所在根目录（默认按 ../metafusion-* 解析）")
    args = ap.parse_args()
    return check(os.path.abspath(args.root), args.siblings_root)


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    sys.exit(main())
