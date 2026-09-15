import os
import sys
from pathlib import Path

import paramiko

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stdin.reconfigure(encoding='utf-8', errors='replace')


def get_cred() -> tuple[str, str, str]:
    """读取远端凭据：仓库里不写主机名/用户名/口令，也不写本机凭据文件的位置。

    优先级：
      1. MF_SSH_HOST / MF_SSH_USER / MF_SSH_PASSWORD 环境变量；
      2. MF_CRED_FILE 指向的文件（默认 ~/.mf-credentials，可用 MF_CRED_FILE 覆盖），
         文件里第一行"含点号且至少三段空白分隔"的内容视为 host user password [备注]。
    """
    host = os.getenv("MF_SSH_HOST")
    user = os.getenv("MF_SSH_USER")
    pwd = os.getenv("MF_SSH_PASSWORD")
    if host and user and pwd:
        return host, user, pwd
    path = Path(os.getenv("MF_CRED_FILE", str(Path.home() / ".mf-credentials"))).expanduser()
    with path.open(encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if not parts or line.lstrip().startswith("#"):
                continue
            if "." not in parts[0] or len(parts) < 3:
                continue
            return parts[0], parts[1], parts[2]
    raise RuntimeError(
        "凭据未找到：设置 MF_SSH_HOST/MF_SSH_USER/MF_SSH_PASSWORD，"
        "或把 `host user password` 写进 MF_CRED_FILE 指向的文件（默认 ~/.mf-credentials）"
    )


def run(cmd: str) -> str:
    host, user, pwd = get_cred()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(host, port=22, username=user, password=pwd, timeout=20)
    _, stdout, _ = ssh.exec_command(cmd, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    ssh.close()
    return out


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "-":
        command = sys.stdin.read().strip()
    else:
        command = sys.argv[1] if len(sys.argv) > 1 else "docker compose -f deploy/docker-compose.yml ps"
    print(run(command))
