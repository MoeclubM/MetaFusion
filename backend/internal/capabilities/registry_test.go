package capabilities

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func find(t *testing.T, items []Capability, id string) Capability {
	t.Helper()
	for _, it := range items {
		if it.ID == id {
			return it
		}
	}
	t.Fatalf("能力清单缺少 %s", id)
	return Capability{}
}

// 未配置上游时，由独立服务承载的能力必须报未启用：
// 前端据此隐藏入口，而不是渲染一个永远为空的区块。
func TestUndeployedSubsystemsAreDisabled(t *testing.T) {
	r := New(func(string) string { return "" })
	r.Refresh(context.Background())
	items := r.Manifests()
	if c := find(t, items, "community"); c.Enabled || c.Healthy {
		t.Fatalf("未部署社区服务时应为未启用: %+v", c)
	}
	if c := find(t, items, "archive"); c.Enabled {
		t.Fatalf("未部署存储服务时应为未启用: %+v", c)
	}
	// exchange 仍由目录自身提供：恒定可用，避免导入导出入口被误隐藏。
	if c := find(t, items, "exchange"); !c.Enabled || !c.Healthy {
		t.Fatalf("exchange 应恒为可用: %+v", c)
	}
}

// 配置了上游且 /health 正常时，能力为启用且健康；上游挂掉则健康为 false 但保持启用
// （前端按 enabled 决定是否展示入口，healthy 用于运维观察）。
func TestUpstreamHealthDecidesHealthyFlag(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer up.Close()

	env := map[string]string{"COMMUNITY_URL": up.URL}
	r := New(func(k string) string { return env[k] })
	r.Refresh(context.Background())
	c := find(t, r.Manifests(), "community")
	if !c.Enabled || !c.Healthy {
		t.Fatalf("上游健康时社区能力应为启用且健康: %+v", c)
	}
	if rec := find(t, r.Manifests(), "records"); !rec.Enabled || !rec.Healthy {
		t.Fatalf("同一上游承载的能力应一起生效: %+v", rec)
	}

	up.Close()
	r.Refresh(context.Background())
	c = find(t, r.Manifests(), "community")
	if !c.Enabled {
		t.Fatalf("上游地址仍在配置里，应保持启用: %+v", c)
	}
	if c.Healthy {
		t.Fatalf("上游已下线，健康应为 false: %+v", c)
	}
}
