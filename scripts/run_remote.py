import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stdin.reconfigure(encoding='utf-8', errors='replace')

def get_cred():
    with open('D:/NET/machine.md', encoding='utf-8') as f:
        for line in f:
            if 'alice-slc' in line:
                parts = line.strip().split()
                return parts[0], parts[1], parts[2]
    raise RuntimeError('Cred not found')

def run(cmd):
    host, user, pwd = get_cred()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(host, port=22, username=user, password=pwd, timeout=20)
    stdin, stdout, stderr = ssh.exec_command(cmd, get_pty=True)
    out = stdout.read().decode('utf-8', errors='replace')
    ssh.close()
    return out

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '-':
        cmd = sys.stdin.read().strip()
    else:
        cmd = sys.argv[1] if len(sys.argv) > 1 else 'cd /root/metafusion && docker compose -f deploy/docker-compose.yml ps'
    print(run(cmd))