package catalog

import "time"

// 构建期注入的版本身份：backend/Dockerfile 用 -ldflags -X 写入这三个变量。
// 为什么必须构建期注入：容器里没有 .git（.dockerignore 排除），运行期读环境变量又会随重启漂移，
// 只有编译进二进制才能回答"这个进程是哪次提交的产物"（2026-09 审计：线上无法判断跑的是哪一版）。
//
// 没注入时保持 "unknown"：部署链路上没传 sha 就必须看得出来，不能用空串或时间戳冒充。
var (
	buildVersion = "unknown"
	buildGitSHA  = "unknown"
	buildTime    = "unknown"
)

// processStartedAt 是进程启动时刻（UTC）：与构建期身份一起回答"跑的是哪一版、这次已经跑了多久"，
// 重启与重新部署的区别一眼可见。
var processStartedAt = time.Now().UTC()

// VersionInfo 是 GET /api/version 的响应：只回身份字段。
// 这一个端点是匿名可读的，因此不放配置、凭据、数据库/对象存储地址与主机名——
// 它要回答的是"线上跑的是哪一版"，不是"线上是怎么部署的"。
type VersionInfo struct {
	Service   string `json:"service"`
	Version   string `json:"version"`
	GitSHA    string `json:"git_sha"`
	BuildTime string `json:"build_time"`
	StartedAt string `json:"started_at"`
}

// 注入值可能被显式传成空串（例如 METAFUSION_GIT_SHA=）：空串与"没注入"是同一件事。
func orUnknown(v string) string {
	if v == "" {
		return "unknown"
	}
	return v
}

func versionInfo() VersionInfo {
	return VersionInfo{
		Service:   "metafusion-catalog",
		Version:   orUnknown(buildVersion),
		GitSHA:    orUnknown(buildGitSHA),
		BuildTime: orUnknown(buildTime),
		StartedAt: processStartedAt.Format(time.RFC3339),
	}
}
