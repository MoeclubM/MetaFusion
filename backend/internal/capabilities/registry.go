// Package capabilities 提供"部署态能力清单"。
//
// 拆分前，能力清单来自单体进程内的模块注册表（可运行时开关）；子系统拆出去之后，
// 模块不再是进程内的开关，而是**独立部署单元**：能力在不在由部署配置声明；
// 清单因此是一份**声明**（子系统在不在场），不是健康探测结果。
//
// 目录服务**不探测外围服务**（不发任何出站请求）：健康与可用性由网关/运维面各自读
// 各服务的 GET /health 判断。这样目录即使在外围全挂时也能独立自洽，
// 也不会出现"换个服务复用同一探测器恒判不健康"的口径漂移；
// 响应形状与拆分前一致（前端与定义编辑器按 id 判断），因此 healthy 与 enabled 同值。
package capabilities

import (
	"os"
	"strings"
)

// Capability 的形状与拆分前的模块清单一致（id/version/dependencies/enabled/healthy），
// 前端按 id 判断能力是否可用（例如社区区块是否渲染）。
type Capability struct {
	ID           string            `json:"id"`
	Version      string            `json:"version"`
	Dependencies map[string]string `json:"dependencies"`
	Enabled      bool              `json:"enabled"`
	Healthy      bool              `json:"healthy"`
}

// subsystem 描述一项能力：或由本进程提供（local），或由独立服务承载（由环境变量声明在不在场）。
type subsystem struct {
	id      string
	version string
	deps    map[string]string
	// envKey 是声明该能力在场的环境变量；local 为 true 时忽略。
	envKey string
	local  bool
}

// 固定顺序即前端展示顺序，id 集合是前端契约（CatalogProvider 与 /admin 的子系统面板按 id 判断）。
// 旧的 archive / playback / media 是单体模块层的名字（归档 / 预览转码 / 媒体分析），
// 拆分后只剩一个存储服务，转码与媒体分析不做，因此统一成 `storage`。
// 论坛/短评/收藏由同一个互动服务承载，因此只有一条 community 声明：与它指向同一上游的
// records 已随 /api/records/* 一起删除（前端零消费）。
var subsystems = []subsystem{
	{id: "exchange", version: "2.0.0", deps: map[string]string{}, local: true},
	{id: "community", version: "2.0.0", deps: map[string]string{}, envKey: "COMMUNITY_URL"},
	{id: "storage", version: "2.0.0", deps: map[string]string{}, envKey: "STORAGE_URL"},
}

// Registry 持有清单。清单在构造时按部署配置定型，运行期不再变化——
// 目录不轮询、不探测，因此没有缓存、没有后台协程。
type Registry struct {
	items []Capability
}

// New 按部署配置（getenv）生成清单：配置了 envKey 即视为该子系统在场。
func New(getenv func(string) string) *Registry {
	if getenv == nil {
		getenv = os.Getenv
	}
	return &Registry{items: compose(getenv)}
}

// compose 生成清单：enabled 表示部署配置声明了该子系统；healthy 与它同值，
// 因为目录不做任何探测——真正的健康判断在网关/运维面按各服务 /health 进行。
func compose(getenv func(string) string) []Capability {
	out := make([]Capability, 0, len(subsystems))
	for _, s := range subsystems {
		declared := s.local || strings.TrimSpace(getenv(s.envKey)) != ""
		out = append(out, Capability{
			ID: s.id, Version: s.version, Dependencies: s.deps,
			Enabled: declared, Healthy: declared,
		})
	}
	return out
}

// Manifests 返回清单副本（只读，供 HTTP 层直接返回）。
func (r *Registry) Manifests() []Capability {
	out := make([]Capability, len(r.items))
	copy(out, r.items)
	return out
}
