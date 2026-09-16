#!/usr/bin/env python3
"""deploy/ 编排自检：本机无 docker 时也能跑（CI 的 compose-lint 只做 config 解析，
解析不出 \"构建目标不存在\" 这类错误——deploy/docker-compose.metadata.yml 就曾把
catalog-server 当成 backend 的阶段名，直到 build 才炸）。

检查三件事，任一不过以非零码退出：
1. deploy/*.yml 能被 YAML 解析；
2. 每个服务的 build.target 必须在对应 Dockerfile 里存在（上下文目录不在本机时跳过，
   例如 CI 上只有主仓库，兄弟仓库缺席）；
3. 编排里 \"${VAR:?...}\" 形式声明的必填变量，必须能在 .env.example 里找到。

用法：python scripts/check_deploy.py [仓库根目录]
"""
import os
import re
import sys

import yaml

REQUIRED = re.compile(r"\$\{([A-Z][A-Z0-9_]*):\?")
STAGE = re.compile(r"^FROM\s+\S+\s+[aA][sS]\s+(\S+)", re.M)


class ComposeLoader(yaml.SafeLoader):
    """"docker compose 的 !reset / !override 标签对 YAML 解析无意义，这里当 null 处理。"""


ComposeLoader.add_multi_constructor("!", lambda loader, suffix, node: None)


def compose_files(root):
    d = os.path.join(root, "deploy")
    return sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith(".yml"))


def stages_of(dockerfile):
    with open(dockerfile, encoding="utf-8") as fh:
        return {m.group(1).lower() for m in STAGE.finditer(fh.read())}


def main():
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
    problems, skipped = [], []

    for path in compose_files(root):
        rel = os.path.relpath(path, root)
        try:
            with open(path, encoding="utf-8") as fh:
                doc = yaml.load(fh, Loader=ComposeLoader) or {}
        except Exception as exc:  # noqa: BLE001 —— 解析失败就是要报出来的问题
            problems.append(f"{rel}: YAML 解析失败: {exc}")
            continue

        for name, svc in (doc.get("services") or {}).items():
            build = svc.get("build")
            if not isinstance(build, dict):
                continue
            ctx = os.path.normpath(os.path.join(os.path.dirname(path), build.get("context", ".")))
            dfile = os.path.normpath(os.path.join(ctx, build.get("dockerfile") or "Dockerfile"))
            target = build.get("target")
            if not os.path.exists(dfile):
                skipped.append(f"{rel}:{name}: 跳过（本机没有 {os.path.relpath(dfile, root)}）")
                continue
            stages = stages_of(dfile)
            if target and target.lower() not in stages:
                problems.append(
                    f"{rel}:{name}: build.target={target} 在 {os.path.relpath(dfile, root)} "
                    f"里不存在（可用阶段: {', '.join(sorted(stages))}）"
                )

    # 3. 必填变量必须写进模板，否则照着 .env.example 建的 .env 起不来
    template = os.path.join(root, ".env.example")
    documented = set()
    if os.path.exists(template):
        with open(template, encoding="utf-8") as fh:
            documented = set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]*)=", fh.read(), re.M))
    for path in compose_files(root):
        rel = os.path.relpath(path, root)
        with open(path, encoding="utf-8") as fh:
            for var in sorted(set(REQUIRED.findall(fh.read()))):
                if var not in documented:
                    problems.append(f"{rel}: 必填变量 {var} 未在 .env.example 中记录")

    for note in skipped:
        print(f"skip {note}")
    for bad in problems:
        print(f"FAIL {bad}")
    print(f"check_deploy: {len(problems)} 个问题，{len(skipped)} 项跳过")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
