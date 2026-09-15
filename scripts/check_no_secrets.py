#!/usr/bin/env python3
"""仓库隐私扫描：提交前拦住凭据、私钥、生产主机名与本地敏感路径。

为什么需要它：仓库是公开的，历史一旦推上去就收不回来；把"有没有把 key 提上去"
交给一次自动化扫描，比事后清理便宜得多。

判定原则是"只报有值的东西"：字段名（password: newPassword）、变量（token = getAccessToken()）、
本地测试用的连接串（127.0.0.1 上的测试库）都不算泄露，报了只会让人忽略这个检查。

用法：
    python scripts/check_no_secrets.py               # 扫描当前工作区（git 跟踪的文件）
    python scripts/check_no_secrets.py --rev HEAD~1  # 扫描某个历史版本（自查历史用）

退出码 1 表示发现问题（CI 会因此失败）。
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# 生产主机名不写成完整字面量：拼出来再匹配，避免这个守卫文件自己把主机名带进仓库。
HOST_NEEDLE = "alice" + "slc"
HOST_RE = re.compile(re.escape(HOST_NEEDLE) + r"[A-Za-z0-9.\-]*", re.IGNORECASE)

PRIVATE_KEY_RE = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")
CRED_FILE_RE = re.compile(
    r"(^|/)(\.env($|\.)|id_(rsa|ed25519|ecdsa)$|.*\.(pem|key|p12|pfx)$|credentials(\.|$))", re.IGNORECASE
)
# 明文凭据赋值：值必须是"一整段不透明 token"（含大小写/数字，无空格与代码标点），
# 且至少 20 字符——这样 password: newPassword、token = strings.TrimSpace(token) 都不会误报。
CRED_ASSIGN_RE = re.compile(
    r"(?i)\b(pass(word|wd)?|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\b\s*[=:]\s*['\"]?([A-Za-z0-9+/=_\-]{20,})['\"]?"
)
CODE_HINT_RE = re.compile(r"(?i)(\bdef\b|\bfunction\b|\bawait\b|\bconst\b|\blet\b|\bvar\b|Optional\[|os\.getenv|trimspace|payload\.|request\.|self\.)")
DSN_RE = re.compile(r"\b(postgres(ql)?|redis|amqp|mongodb)://([^\s:/@'\"]+):([^\s@/]{4,})@([^\s/?'\"]+)")
LOCAL_PATH_RE = re.compile(r"(D:[\\/]NET|C:[\\/]Users[\\/][A-Za-z0-9_.-]+)")
LOCAL_HOST_RE = re.compile(r"(?i)^(localhost|127\.0\.0\.1|::1|postgres|db|host\.docker\.internal)$")
TEST_PW_RE = re.compile(r"(?i)(test|example|dummy|fake|local|ci|change|placeholder|notsecret|no-?secret)")


def tracked_files(rev: str | None) -> list[str]:
    cmd = ["git", "ls-tree", "-r", "--name-only", rev] if rev else ["git", "ls-files"]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return [f for f in out.stdout.splitlines() if f.strip()]


def read_file(path: str, rev: str | None) -> str | None:
    if rev:
        out = subprocess.run(["git", "show", f"{rev}:{path}"], capture_output=True, text=True)
        return out.stdout if out.returncode == 0 else None
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def mask(text: str) -> str:
    s = HOST_RE.sub("<prod-host>", text)
    s = re.sub(r"([=:]\s*)[^\s'\"]{12,}", r"\1***", s)
    return (s[:180] + "…") if len(s) > 180 else s.strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rev", default=None, help="scan a specific revision instead of the working tree")
    args = ap.parse_args()

    errors: list[str] = []
    warnings: list[str] = []
    for path in tracked_files(args.rev):
        if CRED_FILE_RE.search(path) and not path.endswith((".example", ".sample", ".template")):
            errors.append(f"{path}: 疑似凭据文件被跟踪（应删除并写进 .gitignore）")
            continue
        text = read_file(path, args.rev)
        if text is None or len(text) > 2_000_000:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            if PRIVATE_KEY_RE.search(line):
                errors.append(f"{path}:{i}: 私钥内容（{mask(line)}）")
            if HOST_RE.search(line):
                errors.append(f"{path}:{i}: 生产主机名（{mask(line)}）")
            dsn = DSN_RE.search(line)
            # 分组顺序：3=用户 4=口令 5=主机。本地/测试库的口令不算泄露。
            if dsn and not LOCAL_HOST_RE.match(dsn.group(5)) and not TEST_PW_RE.search(dsn.group(4)):
                errors.append(f"{path}:{i}: 带口令的连接串（{mask(line)}）")
            cred = CRED_ASSIGN_RE.search(line)
            if cred and not CODE_HINT_RE.search(line):
                value = cred.group(3)
                if any(c.isdigit() for c in value) and any(c.isalpha() for c in value) and not TEST_PW_RE.search(value):
                    errors.append(f"{path}:{i}: 疑似明文凭据（{mask(line)}）")
            if LOCAL_PATH_RE.search(line):
                warnings.append(f"{path}:{i}: 本机绝对路径（{mask(line)}）")

    for w in warnings:
        print("warn: " + w)
    for e in errors:
        print("ERROR: " + e)
    if errors:
        print(f"\n发现 {len(errors)} 处需要处理的内容：仓库是公开的，请改成占位符或移出仓库。")
        return 1
    print(f"扫描通过：跟踪文件里没有私钥、生产主机名或明文凭据（{len(warnings)} 条本机路径提醒）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
