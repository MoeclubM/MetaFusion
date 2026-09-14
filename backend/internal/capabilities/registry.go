// Package capabilities 提供"部署态能力清单"。
//
// 拆分前，能力清单来自单体进程内的模块注册表（可运行时开关）；子系统拆出去之后，
// 模块不再是进程内的开关，而是**独立部署单元**：能力在不在，取决于对应服务有没有部署、
// 健不健康。因此这里保留原来的响应形状（前端与定义编辑器都依赖它），
// 但把数据来源换成"是否配置了上游 + 后台探测的缓存结果"。
//
// 探测在后台按固定间隔进行，请求路径只读缓存：目录接口不能因为某个外围服务挂掉而变慢。
package capabilities

import (
	"context"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
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

// subsystem 描述一项能力：或由本进程提供（local），或由独立服务承载（由环境变量给出地址）。
type subsystem struct {
	id      string
	version string
	deps    map[string]string
	// envKey 是决定该能力是否部署的环境变量；local 为 true 时忽略。
	envKey string
	local  bool
}

// 固定顺序即前端展示顺序；id 与拆分前保持一致，避免前端与 i18n 键一起改。
var subsystems = []subsystem{
	{id: "exchange", version: "2.0.0", deps: map[string]string{}, local: true},
	{id: "community", version: "2.0.0", deps: map[string]string{}, envKey: "COMMUNITY_URL"},
	{id: "records", version: "2.0.0", deps: map[string]string{}, envKey: "COMMUNITY_URL"},
	{id: "archive", version: "2.0.0", deps: map[string]string{}, envKey: "STORAGE_URL"},
	{id: "playback", version: "2.0.0", deps: map[string]string{"archive": "^2.0.0"}, envKey: "STORAGE_URL"},
	{id: "media", version: "2.0.0", deps: map[string]string{"archive": "^2.0.0"}, envKey: "STORAGE_URL"},
}

// Registry 持有能力清单与上游健康状态的缓存。
type Registry struct {
	getenv func(string) string
	client *http.Client
	// interval 是后台探测间隔；测试里可以调小。
	interval time.Duration

	mu    sync.RWMutex
	items []Capability
}

func New(getenv func(string) string) *Registry {
	if getenv == nil {
		getenv = os.Getenv
	}
	r := &Registry{getenv: getenv, client: &http.Client{Timeout: 2 * time.Second}, interval: 30 * time.Second}
	r.items = r.compose(map[string]bool{})
	return r
}

// compose 依据"上游是否配置 + 探测结果"生成清单。
func (r *Registry) compose(healthy map[string]bool) []Capability {
	out := make([]Capability, 0, len(subsystems))
	for _, s := range subsystems {
		enabled := s.local || strings.TrimSpace(r.getenv(s.envKey)) != ""
		item := Capability{ID: s.id, Version: s.version, Dependencies: s.deps, Enabled: enabled}
		// 本进程提供的能力恒定健康；独立服务的能力按探测结果。
		item.Healthy = enabled && (s.local || healthy[s.envKey])
		out = append(out, item)
	}
	return out
}

// Manifests 返回当前缓存的清单（只读，供 HTTP 层直接返回）。
func (r *Registry) Manifests() []Capability {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Capability, len(r.items))
	copy(out, r.items)
	return out
}

// Refresh 探测各上游的 /health 并刷新缓存；探测失败只体现为 healthy=false。
func (r *Registry) Refresh(ctx context.Context) {
	healthy := map[string]bool{}
	for _, s := range subsystems {
		if s.local {
			continue
		}
		if _, done := healthy[s.envKey]; done {
			continue
		}
		healthy[s.envKey] = r.probe(ctx, r.getenv(s.envKey))
	}
	r.mu.Lock()
	r.items = r.compose(healthy)
	r.mu.Unlock()
}

// probe 只问 /health：它是各服务都提供的存活端点，且不依赖数据库。
func (r *Registry) probe(ctx context.Context, base string) bool {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		return false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/health", nil)
	if err != nil {
		return false
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// Start 先探测一次，然后按间隔刷新，直到 ctx 结束。
func (r *Registry) Start(ctx context.Context) {
	r.Refresh(ctx)
	go func() {
		ticker := time.NewTicker(r.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
				r.Refresh(probeCtx)
				cancel()
			}
		}
	}()
}
