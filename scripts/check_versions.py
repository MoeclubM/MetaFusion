#!/usr/bin/env python3
"""部署版本锁自检：deploy/versions.lock 记录各兄弟仓库期望的 commit，部署前逐条比对。

为什么需要它：编排用 ../../metafusion-* 当构建上下文，主仓库代码与兄弟仓库代码之间没有任何
版本绑定——同一个 METAFUSION_TAG 可能对应不同的兄弟仓库提交，回滚时无法判断"当时那份 community
是哪一次提交"。锁文件把这件事写成可检查的约束：构建前跑一遍，检出与锁不一致就停下。

行为：
- 逐条 `git -C <目录> rev-parse HEAD`，与锁里记录的 sha 比对（锁里可以写短 sha 或完整 sha 的前缀）；
- 兄弟目录不存在（只检出主仓库的机器、CI 上很常见）：打印 SKIP，不算失败；
- git 不可用：整体 SKIP 并返回 0，但打印原因——宁可显式跳过，也不要假装通过；
- 任何一条不一致：打印期望与实际，返回 1；
- 例外：锁里 `.（主仓库）` 那条只提示不判失败——锁文件随主仓库提交一起前进，拿它当失败条件
  等于让检查永远红着，真正的部署输入是兄弟仓库那几行。

锁的更新方式（人工，不做自动改写）：切流窗口开始时按 `git -C <目录> rev-parse --short HEAD`
把六行 sha 更新一遍并提交；不要为了"让检查变绿"而改 sha。

用法：python scripts/check_versions.py [--lock PATH]
"""
import argparse
import os
import shutil
import subprocess
import sys


def read_lock(path):
    """返回 [(仓库目录, 期望 sha)]，跳过注释与空行。"""
    entries = []
    with open(path, encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            text = line.split("#", 1)[0].strip()
            if not text:
                continue
            if "=" not in text:
                entries.append((lineno, "", ""))  # 格式错的行走后面的失败分支
                continue
            repo, sha = (part.strip() for part in text.split("=", 1))
            entries.append((lineno, repo, sha))
    return entries


def head_of(repo_dir):
    """取仓库 HEAD，失败返回 None。"""
    try:
        done = subprocess.run(["git", "-C", repo_dir, "rev-parse", "HEAD"],
                              capture_output=True, text=True, encoding="utf-8", timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    return done.stdout.strip()


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    ap = argparse.ArgumentParser(description="部署版本锁自检")
    ap.add_argument("--lock", default=None, help="锁文件（默认 <root>/deploy/versions.lock）")
    ap.add_argument("--root", default=root, help="仓库根目录（默认由脚本位置推断）")
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    lock = os.path.abspath(args.lock or os.path.join(root, "deploy", "versions.lock"))
    if not os.path.exists(lock):
        print("FAIL 读不到 " + os.path.relpath(lock, root))
        print("check_versions: 1 个问题，0 项跳过")
        return 1

    if shutil.which("git") is None:
        print("SKIP 本机没有 git：版本锁无法校验（CI 上应装好 git，否则这个检查等于没跑）")
        print("check_versions: 0 个问题，1 项跳过")
        return 0

    problems, skipped, checked, notes = [], [], 0, []
    for lineno, repo, expected in read_lock(lock):
        if not repo or not expected:
            problems.append("%s:%d: 行格式应为 `<仓库目录>=<sha>`" % (os.path.relpath(lock, root), lineno))
            continue
        repo_dir = os.path.normpath(os.path.join(root, repo))
        if not os.path.isdir(repo_dir):
            skipped.append("%s: 目录不在本机，跳过（%s）" % (repo, os.path.relpath(repo_dir, root)))
            continue
        actual = head_of(repo_dir)
        if actual is None:
            skipped.append("%s: 不是 git 仓库或 git 读不到 HEAD，跳过" % repo)
            continue
        checked += 1
        if actual == expected or actual.startswith(expected):
            continue
        if repo == ".":
            notes.append("主仓库 HEAD %s 与锁里的 %s 不一致：不作为失败项（锁文件随主仓库提交一起前进，回滚时以本文件所在的提交为准）" % (actual[:12], expected[:12]))
            continue
        problems.append("%s: 期望 %s，实际 %s（%s）" % (repo, expected[:12], actual[:12], os.path.relpath(repo_dir, root)))

    for note in skipped:
        print("skip " + note)
    for note in notes:
        print("note " + note)
    for bad in problems:
        print("FAIL " + bad)
    print("check_versions: 校验 %d 个仓库，%d 个问题，%d 项跳过" % (checked, len(problems), len(skipped)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
