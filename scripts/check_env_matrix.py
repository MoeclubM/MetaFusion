#!/usr/bin/env python3
"""环境变量矩阵双向检查：编排注入了没人读的键 / 代码读了但编排没注入且默认不安全。

为什么需要它：2026-09 审计实测"环境变量矩阵两个方向都没有检查"——

1. 注入了没人读：REDIS_ADDR / ELASTICSEARCH_URL 只出现在编排里，全仓零读者（容器白常驻）；
2. 读了但没注入：STORAGE_MAX_UPLOAD_MB / STORAGE_VERIFY_MAX_MB / STORAGE_VERIFY_TIMEOUT_SECONDS
   的代码默认值是 0 = 不限制，而编排一个都没注入——上限只剩网关的 1 GiB 兜底；
3. 两类问题都不会让任何现有检查变红（check_deploy.py 只看 build.target 与 :? 必填项）。

检查内容（任一不过以非零码退出）：

A. 注入 → 登记：deploy/*.yml 每个服务 environment 里的键，必须在 KEYS 登记表里
   （或属于 ALLOWED_INFRA：由镜像自己消费，如 POSTGRES_*）；
B. 登记 → 注入：KEYS 里 safe=False 的键，必须在指定编排文件的指定服务里注入
   （safe=False = 默认值会带来无上限资源占用或明文链路这类风险）；
C. 登记 → 代码：KEYS 里每个读者路径必须真实存在且文件里出现该键名，
   防止"登记表说有人读、代码里其实已经删了"的静默漂移。兄弟仓库目录缺席时记
   "未能校验"并照常退出 0——CI 上它们由前一步按 deploy/versions.lock 检出，因此那里是全量校验。

用法：python scripts/check_env_matrix.py [仓库根目录] [--siblings-root DIR] [--selftest]
"""
import argparse
import os
import sys

import yaml


class ComposeLoader(yaml.SafeLoader):
    """"docker compose 的 !reset / !override 标签对本次检查无意义，当 null 处理。"""


ComposeLoader.add_multi_constructor("!", lambda loader, suffix, node: None)

# 与 deploy/versions.lock 同一套布局约定：兄弟仓库默认在与主仓库并列的 ../metafusion-* 下，
# 服务器把仓库收进主仓库内时用 --siblings-root（或 MF_SIBLINGS_ROOT）覆盖。
SIBLING_DIRS = {
    "auth": "../metafusion-auth",
    "community": "../metafusion-community",
    "storage": "../metafusion-storage",
}

# 各服务源码相对仓库根的位置：目录服务的 Go 代码在 backend/ 下，兄弟服务在各自仓库根。
REPO_BASE = {"catalog": "backend"} 

# 编排把变量交给镜像/基础运行时自己消费，本仓库代码里没有读者——逐条写清理由，
# 不是白名单兜底：往这里加一条之前，先确认"没人读"是设计而不是遗漏。
ALLOWED_INFRA = {
    "POSTGRES_USER": "postgres 镜像初始化库用的账号（服务自己读的是 DB_USER）",
    "POSTGRES_PASSWORD": "postgres 镜像初始化库口令",
    "POSTGRES_DB": "postgres 镜像初始化的库名",
    "NODE_ENV": "Node/Next 自己读的运行模式（前端与三个管理台）",
    "RUSTFS_ACCESS_KEY": "rustfs 容器自己读的凭据 canonical 名",
    "RUSTFS_SECRET_KEY": "rustfs 容器自己读的凭据 canonical 名",
    "RUSTFS_ROOT_USER": "rustfs 旧镜像的凭据别名（镜像 pin 到 digest 后删，见编排注释）",
    "RUSTFS_ROOT_PASSWORD": "rustfs 旧镜像的凭据别名（同上）",
    "RUSTFS_STORAGE_DIR": "rustfs 容器的数据目录",
    "discovery.type": "opensearch 单节点模式配置",
    "OPENSEARCH_JAVA_OPTS": "opensearch 堆参数",
    "DISABLE_INSTALL_DEMO_CONFIG": "opensearch 演示配置开关",
    "DISABLE_SECURITY_PLUGIN": "opensearch 安全插件开关（仅 --profile search 下启用）",
    "GIN_MODE": "gin 框架自己读的运行模式（release 关掉调试输出）",
    "CGO_ENABLED": "Go 工具链自己读（dev 栈在容器里 go run 编译时用）",
    "WATCHPACK_POLLING": "Next/webpack 文件监听器自己读（dev 栈热重载）",
}

# 环境变量登记表：键 -> 谁读（仓库 + 文件）、默认值、默认值是否安全、哪份编排的哪个服务必须注入。
# safe=False 只用于"缺失/为 0 时行为不安全"的键：无上限的资源占用、明文链路。
KEYS = {
    # ── 目录服务（本仓库 backend/）────────────────────────────────────────
    "PORT": {"readers": [("catalog", "cmd/server/main.go")], "default": "8080", "safe": True},
    "DATABASE_URL": {"readers": [("catalog", "cmd/server/main.go")], "default": "空 → 回退 DB_* 拼装", "safe": True},
    "DB_HOST": {"readers": [("catalog", "cmd/server/main.go")], "default": "localhost", "safe": True},
    "DB_PORT": {"readers": [("catalog", "cmd/server/main.go")], "default": "5432", "safe": True},
    "DB_USER": {"readers": [("catalog", "cmd/server/main.go")], "default": "metafusion", "safe": True},
    "DB_PASSWORD": {"readers": [("catalog", "cmd/server/main.go")], "default": "空（连不上库）", "safe": True},
    "DB_NAME": {"readers": [("catalog", "cmd/server/main.go")], "default": "metafusion_db", "safe": True},
    "DB_SSLMODE": {"readers": [("catalog", "cmd/server/main.go"), ("auth", "internal/config/config.go"), ("community", "internal/config/config.go"), ("storage", "internal/config/config.go")], "default": "disable（明文连接）", "safe": False, "inject": [("deploy/docker-compose.yml", "backend"), ("deploy/docker-compose.yml", "auth"), ("deploy/docker-compose.yml", "community"), ("deploy/docker-compose.yml", "storage"), ("deploy/docker-compose.metadata.yml", "backend")]},
    "AUTH_JWT_ISSUER": {"readers": [("catalog", "cmd/server/main.go"), ("auth", "cmd/server/main.go"), ("community", "internal/config/config.go"), ("storage", "internal/config/config.go")], "default": "https://findverse.cc/api", "safe": True},
    "AUTH_JWT_AUDIENCE": {"readers": [("catalog", "cmd/server/main.go"), ("auth", "cmd/server/main.go"), ("community", "internal/config/config.go"), ("storage", "internal/config/config.go")], "default": "metafusion", "safe": True},
    "AUTH_JWT_PUBLIC_KEY": {"readers": [("catalog", "internal/catalog/token.go"), ("community", "internal/config/config.go"), ("storage", "internal/config/config.go")], "default": "空 → 回退 JWKS 地址", "safe": True},
    "AUTH_JWKS_URL": {"readers": [("catalog", "internal/catalog/token.go")], "default": "http://auth:8081/api/oidc/jwks", "safe": True},
    "AUTH_JWT_PRIVATE_KEY": {"readers": [("catalog", "internal/catalog/token.go"), ("auth", "internal/store/token.go")], "default": "账号服务：空 → 拒绝启动（fail closed）；目录服务：空 → 回退 JWKS", "safe": True, "note": "审计 S-9 已修：账号服务空值默认拒绝启动，只有显式开关 AUTH_JWT_ALLOW_EPHEMERAL_KEY 才回退临时密钥"},
    "AUTH_JWT_ALLOW_EPHEMERAL_KEY": {"readers": [("auth", "internal/store/token.go")], "default": "空 = 关闭（未配置签发私钥即拒绝启动）", "safe": True},
    "CORS_ALLOWED_ORIGINS": {"readers": [("catalog", "cmd/server/main.go")], "default": "空 = 不注册 CORS 中间件", "safe": True},
    "COMMUNITY_URL": {"readers": [("catalog", "internal/capabilities/registry.go")], "default": "空 = 能力判为未部署", "safe": True},
    "STORAGE_URL": {"readers": [("catalog", "internal/capabilities/registry.go")], "default": "空 = 能力判为未部署", "safe": True},
    # ── 账号服务（../metafusion-auth）─────────────────────────────────────
    "AUTH_ACCOUNT_URL": {"readers": [("auth", "internal/handler/oauth.go")], "default": "空 = 站点相对路径", "safe": True},
    # ── 互动服务（../metafusion-community）───────────────────────────────
    "COMMUNITY_JWKS_URL": {"readers": [("community", "internal/config/config.go")], "default": "http://auth:8081/api/oidc/jwks", "safe": True},
    "AUTH_URL": {"readers": [("catalog", "cmd/server/main.go"), ("community", "internal/config/config.go"), ("storage", "internal/config/config.go")], "default": "空 = 只接受 JWT；PAT（mfp_ 前缀）一律 503", "safe": True},
    "CATALOG_URL": {"readers": [("community", "internal/config/config.go"), ("storage", "internal/config/config.go")], "default": "http://backend:8080", "safe": True},
    "COMMUNITY_CATALOG_TIMEOUT_MS": {"readers": [("community", "internal/config/config.go")], "default": "5000ms", "safe": True},
    # ── 存储服务（../metafusion-storage）─────────────────────────────────
    "STORAGE_ROOT": {"readers": [("storage", "internal/config/config.go")], "default": "./storage-data", "safe": True},
    "STORAGE_S3_ENDPOINT": {"readers": [("storage", "internal/config/config.go")], "default": "空 = 本地对象模式", "safe": True},
    "STORAGE_S3_PUBLIC_ENDPOINT": {"readers": [("storage", "internal/config/config.go")], "default": "空 → 沿用内部端点（不开放浏览器直传）", "safe": True},
    "STORAGE_S3_ACCESS_KEY": {"readers": [("storage", "internal/config/config.go")], "default": "空", "safe": True},
    "STORAGE_S3_SECRET_KEY": {"readers": [("storage", "internal/config/config.go")], "default": "空", "safe": True},
    "STORAGE_S3_BUCKET": {"readers": [("storage", "internal/config/config.go")], "default": "metafusion-master", "safe": True},
    "STORAGE_S3_TLS": {"readers": [("storage", "internal/config/config.go")], "default": "true", "safe": True},
    "STORAGE_JWKS_URL": {"readers": [("storage", "internal/config/config.go")], "default": "http://auth:8081/api/oidc/jwks", "safe": True},
    "STORAGE_PRESIGN_TTL_MINUTES": {"readers": [("storage", "internal/config/config.go")], "default": "120 分钟", "safe": True, "note": "窗口偏长（审计 E7/S10 的不可撤销问题另计），不是无上限"},
    "STORAGE_MAX_PARTS": {"readers": [("storage", "internal/config/config.go")], "default": "10000", "safe": True},
    "STORAGE_MAX_UPLOAD_MB": {"readers": [("storage", "internal/config/config.go")], "default": "0 = 不限制", "safe": False, "inject": [("deploy/docker-compose.yml", "storage")]},
    "STORAGE_VERIFY_MAX_MB": {"readers": [("storage", "internal/config/config.go")], "default": "0 = 不限制", "safe": False, "inject": [("deploy/docker-compose.yml", "storage")]},
    "STORAGE_VERIFY_TIMEOUT_SECONDS": {"readers": [("storage", "internal/config/config.go")], "default": "0 = 不限制", "safe": False, "inject": [("deploy/docker-compose.yml", "storage")]},
    # 旧名别名：拆分期两侧共用一份 .env 才保留，canonical 名（STORAGE_*）已在编排里注入，
    # 因此"读了但没注入"在这里是安全的。
    "ARCHIVE_PATH": {"readers": [("storage", "internal/config/config.go")], "default": "空 → 用 STORAGE_ROOT", "safe": True},
    "ARCHIVE_S3_ENDPOINT": {"readers": [("storage", "internal/config/config.go")], "default": "空 → 用 STORAGE_S3_ENDPOINT", "safe": True},
    "ARCHIVE_S3_PUBLIC_ENDPOINT": {"readers": [("storage", "internal/config/config.go")], "default": "空 → 用 STORAGE_S3_PUBLIC_ENDPOINT", "safe": True},
    "ARCHIVE_S3_ACCESS_KEY": {"readers": [("storage", "internal/config/config.go")], "default": "空 → 用 STORAGE_S3_ACCESS_KEY", "safe": True},
    "ARCHIVE_S3_SECRET_KEY": {"readers": [("storage", "internal/config/config.go")], "default": "空 → 用 STORAGE_S3_SECRET_KEY", "safe": True},
    "ARCHIVE_S3_BUCKET": {"readers": [("storage", "internal/config/config.go")], "default": "空 → 用 STORAGE_S3_BUCKET", "safe": True},
    "ARCHIVE_S3_TLS": {"readers": [("storage", "internal/config/config.go")], "default": "空 → 用 STORAGE_S3_TLS", "safe": True},
}

# 已退役的编排变量：删掉之后不许再回来（它们是"注入了但全仓零读取"的死重量）。
RETIRED = {
    "REDIS_ADDR": "e13be7c 删除：没有任何代码读缓存地址（Redis 仍随栈启动，接线另批）",
    "ELASTICSEARCH_URL": "e13be7c 删除：检索走 PostgreSQL，OpenSearch 未接线",
}


def compose_files(root):
    d = os.path.join(root, "deploy")
    if not os.path.isdir(d):
        return []
    return sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith(".yml"))


def service_env(doc):
    """返回 {服务名: {键: 原始值}}；environment 支持列表与映射两种写法。"""
    out = {}
    for name, svc in (doc.get("services") or {}).items():
        env = svc.get("environment") if isinstance(svc, dict) else None
        keys = {}
        if isinstance(env, list):
            for item in env:
                text = str(item)
                keys[text.split("=", 1)[0].strip()] = text.split("=", 1)[1] if "=" in text else ""
        elif isinstance(env, dict):
            for key, value in env.items():
                keys[str(key)] = "" if value is None else str(value)
        out[name] = keys
    return out


def load_injected(root):
    """{相对路径: {服务名: {键: 值}}}，解析失败直接抛给调用方。"""
    result = {}
    for path in compose_files(root):
        with open(path, encoding="utf-8") as fh:
            doc = yaml.load(fh, Loader=ComposeLoader) or {}
        result[os.path.relpath(path, root).replace(os.sep, "/")] = service_env(doc)
    return result


def repo_dir(root, repo, siblings_root):
    if repo == "catalog":
        return os.path.join(root, REPO_BASE["catalog"])
    rel = SIBLING_DIRS[repo]
    if siblings_root:
        return os.path.normpath(os.path.join(os.path.abspath(siblings_root), os.path.basename(rel)))
    return os.path.normpath(os.path.join(root, rel))


def check(root, siblings_root):
    problems, unchecked, notes = [], [], []
    try:
        injected = load_injected(root)
    except Exception as exc:  # noqa: BLE001 —— 解析不了就是问题
        print("FAIL 编排解析失败: %s" % exc)
        print("check_env_matrix: 1 个问题，0 项未能校验")
        return 1

    # A. 注入 → 登记：编排里的每个键都得有人读（或写明是镜像自己消费的）
    for rel, services in injected.items():
        for svc, keys in services.items():
            for key in sorted(keys):
                if key in RETIRED:
                    problems.append("%s:%s: %s 已退役（%s），不能回到编排里" % (rel, svc, key, RETIRED[key]))
                    continue
                if key in KEYS or key in ALLOWED_INFRA:
                    continue
                problems.append("%s:%s: 注入了 %s，但登记表里没有读者——没人读的变量就是编排里的死重量" % (rel, svc, key))

    # B. 登记 → 注入：默认值不安全的键必须显式注入
    for key, meta in sorted(KEYS.items()):
        if meta.get("safe", True):
            continue
        for rel, svc in meta.get("inject", []):
            got = injected.get(rel, {}).get(svc, {})
            if key not in got:
                problems.append("%s:%s: %s 的默认值是「%s」，必须显式注入" % (rel, svc, key, meta.get("default", "")))
        if not meta.get("inject"):
            problems.append("%s: 标了 safe=False 却没写 inject 目标（登记表不完整）" % key)

    # C. 登记 → 代码：读者路径必须存在且真的出现该键名
    for key, meta in sorted(KEYS.items()):
        for repo, relpath in meta.get("readers", []):
            base = repo_dir(root, repo, siblings_root)
            shown = os.path.relpath(os.path.join(base, relpath), root)
            if not os.path.isdir(base):
                unchecked.append("%s（%s：%s）" % (key, repo, os.path.basename(base)))
                continue
            path = os.path.join(base, relpath)
            if not os.path.isfile(path):
                problems.append("%s: 登记表说 %s 读它，但 %s 不存在" % (key, repo, shown))
                continue
            with open(path, encoding="utf-8") as fh:
                if key not in fh.read():
                    problems.append("%s: 登记表说 %s 读它，但 %s 里没有这个键名" % (key, repo, shown))

    for key, meta in sorted(KEYS.items()):
        if meta.get("note"):
            notes.append("%s: %s" % (key, meta["note"]))
    for text in notes:
        print("note " + text)
    if unchecked:
        print("未能校验 %d 项：兄弟仓库目录不在本机（%s）" % (len(unchecked), "、".join(sorted(set(unchecked))[:4])))
    for bad in problems:
        print("FAIL " + bad)
    print("check_env_matrix: %d 个键，%d 个问题，%d 项未能校验" % (len(KEYS), len(problems), len(unchecked)))
    return 1 if problems else 0


SELFTEST_DOCS = [
    ("列表写法", {"services": {"a": {"environment": ["FOO=1", "BAR=2"]}}}, {"a": {"FOO": "1", "BAR": "2"}}),
    ("映射写法", {"services": {"b": {"environment": {"FOO": 1, "BAR": None}}}}, {"b": {"FOO": "1", "BAR": ""}}),
    ("没有 environment", {"services": {"c": {}}}, {"c": {}}),
]

# compose 的 !reset 标签（prod 覆盖文件用）不能把解析打挂：加载器要认得它并当 null。
SELFTEST_RESET_DOC = "services:\n  a:\n    build: !reset null\n    environment:\n      FOO: bar\n"


def selftest():
    failures = []
    for label, doc, want in SELFTEST_DOCS:
        got = service_env(doc)
        if got != want:
            failures.append("%s: 期望 %r，实际 %r" % (label, want, got))
    reset = yaml.load(SELFTEST_RESET_DOC, Loader=ComposeLoader)
    if service_env(reset) != {"a": {"FOO": "bar"}}:
        failures.append("!reset 标签解析: 期望 {'a': {'FOO': 'bar'}}，实际 %r" % service_env(reset))
    # safe=False 的登记项必须带 inject 目标，否则 B 检查会静默变成空转
    for key, meta in KEYS.items():
        if not meta.get("safe", True) and not meta.get("inject"):
            failures.append("%s: safe=False 但没写 inject" % key)
        for repo, _rel in meta.get("readers", []):
            if repo not in SIBLING_DIRS and repo != "catalog":
                failures.append("%s: 未知仓库 %s" % (key, repo))
    for bad in failures:
        print("FAIL " + bad)
    print("check_env_matrix --selftest: %d 项用例，%d 个问题" % (len(SELFTEST_DOCS) + 1 + len(KEYS), len(failures)))
    return 1 if failures else 0


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    default_root = os.path.dirname(here)
    ap = argparse.ArgumentParser(description="环境变量矩阵双向检查")
    ap.add_argument("root", nargs="?", default=default_root, help="仓库根目录")
    ap.add_argument("--siblings-root", default=os.environ.get("MF_SIBLINGS_ROOT"),
                    help="兄弟仓库所在根目录（默认按 ../metafusion-* 解析）")
    args = ap.parse_args()
    return check(os.path.abspath(args.root), args.siblings_root)


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    sys.exit(main())
