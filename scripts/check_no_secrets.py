#!/usr/bin/env python3
"""仓库隐私扫描：提交前拦住私钥、真实凭据、本机绝对路径与自定的敏感串。

为什么需要它：仓库是公开的，历史一旦推上去就收不回来；把"有没有把 key 提上去"
交给一次自动化扫描，比事后清理便宜得多。

**本脚本自身不含任何机器标识**（主机名、内网域名、本机目录都不写在代码里）：
需要拦住的"实例专有串"由外部注入，两种来源，任选其一或都不给：

    MF_FORBIDDEN_PATTERNS      环境变量，按行分隔的敏感串（CI 里放仓库变量/密钥）
    docs-local/secret-patterns.txt   本机配置（该目录 .gitignore 排除，不进仓库）

没有配置时仍会做通用检查：私钥块、凭据文件被跟踪、带口令的连接串、明文凭据赋值、
本机绝对路径。

用法：
    python scripts/check_no_secrets.py               # 扫描当前工作区（git 跟踪的文件）
    python scripts/check_no_secrets.py --rev HEAD~1  # 扫描某个历史版本（自查历史用）

退出码 1 表示发现问题（CI 会因此失败）。
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PRIVATE_KEY_RE = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")
CRED_FILE_RE = re.compile(
    r"(^|/)(\.env($|\.)|id_(rsa|ed25519|ecdsa)$|.*\.(pem|key|p12|pfx)$|credentials(\.|$))", re.IGNORECASE
)
# 明文凭据赋值：值必须是"一整段不透明 token"（含字母与数字、无空格与代码标点）且不短，
# 这样 password: newPassword、token = strings.TrimSpace(token) 之类的代码不会误报。
CRED_ASSIGN_RE = re.compile(
    r"(?i)\b(pass(word|wd)?|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\b\s*[=:]\s*['\"]?([A-Za-z0-9+/=_\-]{20,})['\"]?"
)
CODE_HINT_RE = re.compile(r"(?i)(\bdef\b|\bfunction\b|\bawait\b|\bconst\b|\blet\b|\bvar\b|Optional\[|os\.getenv|trimspace|payload\.|request\.|self\.)")
DSN_RE = re.compile(r"\b(postgres(ql)?|redis|amqp|mongodb)://([^\s:/@'\"]+):([^\s@/]{4,})@([^\s/?'\"]+)")
# 本机/宿主机绝对路径：用户目录、容器里的 root 家目录、Windows 盘符根目录下的目录。
# 只按"形态"判断，不写死任何具体机器上的路径。
LOCAL_PATH_RE = re.compile(r"([A-Za-z]:[\\/](Users|Documents|Desktop)[\\/]|/(root|home)/[A-Za-z0-9_.-]+)")
LOCAL_HOST_RE = re.compile(r"(?i)^(localhost|127\.0\.0\.1|::1|postgres|db|host\.docker\.internal|[a-z0-9-]+)$")
PLACEHOLDER_RE = re.compile(r"(?i)(test|example|dummy|fake|local|ci|change|placeholder|notsecret|no-?secret|your|<|\$\{?\{|xxx)")


def forbidden_patterns() -> list[str]:
    """实例专有串来自外部配置：仓库里不留主机名/内网域名等标识。"""
    raw = os.getenv("MF_FORBIDDEN_PATTERNS", "")
    items = [line.strip() for line in raw.splitlines() if line.strip()]
    local = Path("docs-local/secret-patterns.txt")
    if local.is_file():
        items += [line.strip() for line in local.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")]
    return items


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
    """输出里不回显疑似凭据：等式右侧一律打码。"""
    s = re.sub(r"([=:]\s*)[^\s'\"]{8,}", r"\1***", text)
    return (s[:180] + "…") if len(s) > 180 else s.strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rev", default=None, help="scan a specific revision instead of the working tree")
    args = ap.parse_args()

    custom = forbidden_patterns()
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
            for needle in custom:
                if needle in line:
                    errors.append(f"{path}:{i}: 命中本机配置的敏感串（{mask(line)}）")
            dsn = DSN_RE.search(line)
            # 分组顺序：3=用户 4=口令 5=主机。本地/测试库的口令不算泄露。
            if dsn and not LOCAL_HOST_RE.match(dsn.group(5)) and not PLACEHOLDER_RE.search(dsn.group(4)):
                errors.append(f"{path}:{i}: 带口令的连接串（{mask(line)}）")
            cred = CRED_ASSIGN_RE.search(line)
            if cred and not CODE_HINT_RE.search(line):
                value = cred.group(3)
                if any(c.isdigit() for c in value) and any(c.isalpha() for c in value) and not PLACEHOLDER_RE.search(value):
                    errors.append(f"{path}:{i}: 疑似明文凭据（{mask(line)}）")
            # Dockerfile 的构建缓存挂载指向容器内路径，不是宿主机路径，不该报。
            if LOCAL_PATH_RE.search(line) and "--mount" not in line and "target=" not in line:
                warnings.append(f"{path}:{i}: 本机绝对路径（{mask(line)}）")

    if not custom:
        print("提示：未提供实例专有串（MF_FORBIDDEN_PATTERNS 或 docs-local/secret-patterns.txt），本次只做通用检查。")
    for w in warnings:
        print("warn: " + w)
    for e in errors:
        print("ERROR: " + e)
    if errors:
        print(f"\n发现 {len(errors)} 处需要处理的内容：仓库是公开的，请改成占位符或移出仓库。")
        return 1
    print(f"扫描通过：跟踪文件里没有私钥、真实凭据或本机绝对路径（{len(warnings)} 条路径提醒）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
