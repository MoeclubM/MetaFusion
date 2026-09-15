import os
import sys

import paramiko

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stdin.reconfigure(encoding='utf-8', errors='replace')


def get_cred() -> tuple[str, str, str]:
    """读取远端凭据。

    仓库里**不写**主机名/用户名/口令：优先取环境变量，其次读仓库外的凭据文件
    （默认 D:/NET/machine.md，可被 MF_CRED_FILE 覆盖）。凭据文件里第一行含点号、
    且至少三段空白分隔的内容即视为 `host user password [备注]`。
    """
    host = os.getenv("MF_SSH_HOST")
    user = os.getenv("MF_SSH_USER")
    pwd = os.getenv("MF_SSH_PASSWORD")
    if host and user and pwd:
        return host, user, pwd
    path = os.getenv("MF_CRED_FILE", "D:/NET/machine.md")
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if not parts or line.lstrip().startswith("#"):
                continue
            if "." not in parts[0] or len(parts) < 3:
                continue
            return parts[0], parts[1], parts[2]
    raise RuntimeError(
        "凭据未找到：设置 MF_SSH_HOST/MF_SSH_USER/MF_SSH_PASSWORD，
        或把 `host user password` 写进 MF_CRED_FILE 指向的文件（默认 D:/NET/machine.md）"
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
        command = sys.argv[1] if len(sys.argv) > 1 else "cd /root/metafusion && docker compose -f deploy/docker-compose.yml ps"
    print(run(command))
