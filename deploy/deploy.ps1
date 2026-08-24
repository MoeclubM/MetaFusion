# ==============================================================================
# MetaFusion 极速部署与智能运维脚本 (PowerShell / Windows / WSL)
# 用法: .\deploy.ps1 [fast|dev|prod|restart|prune|status|logs] [service_name]
# ==============================================================================

param (
    [string]$Action = "fast",
    [string]$Target = ""
)

$DeployDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Show-Usage {
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "  MetaFusion 极速部署与运维工具 (PowerShell)" -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "用法: .\deploy.ps1 [action] [service_name]"
    Write-Host ""
    Write-Host "操作模式:"
    Write-Host "  fast [service]  - 增量极速构建并更新指定服务 (默认)"
    Write-Host "  dev             - 启动热重载开发模式 (源码直接挂载，免构建秒级热重载)"
    Write-Host "  prod            - 完整生产模式启动"
    Write-Host "  restart [svc]   - 快速重启服务"
    Write-Host "  prune           - 清理旧镜像与构建缓存 (释放磁盘)"
    Write-Host "  logs [svc]      - 查看容器日志"
    Write-Host "  status          - 查看服务运行状态"
    Write-Host "================================================================="
}

function Invoke-DeploySh {
    param([string]$Args)
    # 将 Windows 路径转换为 WSL 路径，兼容任意克隆位置
    $WslPath = (wsl wslpath -a "$DeployDir" 2>$null).Trim()
    if (-not $WslPath) {
        # 回退：若 wslpath 失败则直接使用 /mnt/c 拼接（兼容旧版）
        $WslPath = $DeployDir -replace '^([A-Za-z]):', '/mnt/$1' -replace '\\', '/'
        $WslPath = $WslPath.ToLower()
    }
    wsl bash -c "cd '$WslPath' && ./deploy.sh $Args"
}

switch ($Action.ToLower()) {
    "dev" {
        Write-Host "🚀 启动本地热重载开发模式..." -ForegroundColor Green
        Invoke-DeploySh "dev"
    }
    "fast" {
        Write-Host "⚡ 增量极速更新部署..." -ForegroundColor Green
        if ($Target) { Invoke-DeploySh "fast $Target" } else { Invoke-DeploySh "fast" }
    }
    "prod" {
        Write-Host "🏭 启动生产集群模式..." -ForegroundColor Green
        Invoke-DeploySh "prod"
    }
    "pull" {
        Write-Host "📦 拉取生产预构建镜像并极速启动..." -ForegroundColor Green
        Invoke-DeploySh "pull"
    }
    "migrate" {
        Write-Host "🗄️ 执行数据库版本迁移..." -ForegroundColor Cyan
        if ($Target) { Invoke-DeploySh "migrate $Target" } else { Invoke-DeploySh "migrate" }
    }
    "restart" {
        Write-Host "🔄 重启容器..." -ForegroundColor Yellow
        if ($Target) { Invoke-DeploySh "restart $Target" } else { Invoke-DeploySh "restart" }
    }
    "prune" {
        Write-Host "🧹 清理 Docker 磁盘占用..." -ForegroundColor Yellow
        Invoke-DeploySh "prune"
    }
    "logs" {
        if ($Target) { Invoke-DeploySh "logs $Target" } else { Invoke-DeploySh "logs" }
    }
    "status" {
        Invoke-DeploySh "status"
    }
    default {
        Show-Usage
    }
}
