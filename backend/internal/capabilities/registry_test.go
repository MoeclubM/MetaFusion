package capabilities

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
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

// 未声明上游时，由独立服务承载的能力必须报未启用：
// 前端据此隐藏入口，而不是渲染一个永远为空的区块。
func TestUndeployedSubsystemsAreDisabled(t *testing.T) {
	r := New(func(string) string { return "" })
	items := r.Manifests()
	for _, id := range []string{"community", "records", "storage"} {
		if c := find(t, items, id); c.Enabled || c.Healthy {
			t.Fatalf("未声明 %s 时应为未启用: %+v", id, c)
		}
	}
	// 转码与媒体分析不做，清单里不应再出现 playback / media 这类历史能力 id。
	for _, gone := range []string{"playback", "media", "archive"} {
		for _, it := range items {
			if it.ID == gone {
				t.Fatalf("已退役的能力 id 仍在清单里: %s", gone)
			}
		}
	}
	// exchange 仍由目录自身提供：恒定可用，避免导入导出入口被误隐藏。
	if c := find(t, items, "exchange"); !c.Enabled || !c.Healthy {
		t.Fatalf("exchange 应恒为可用: %+v", c)
	}
}

// 目录不探测上游：即使声明了地址，也不得发出任何出站请求。
// 这是"目录仅依赖 PostgreSQL 即可完整运行"的回归护栏。
func TestNoOutboundProbe(t *testing.T) {
	var hits int64
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&hits, 1)
		w.WriteHeader(http.StatusOK)
	}));
	defer up.Close()

	env := map[string]string{"COMMUNITY_URL": up.URL, "RECORDS_URL": up.URL, "STORAGE_URL": up.URL}
	r := New(func(k string) string { return env[k] })
	for i := 0; i < 3; i++ {
		_ = r.Manifests()
	}
	if n := atomic.LoadInt64(&hits); n != 0 {
		t.Fatalf("目录不应探测上游，实际请求 %d 次", n)
	}
	for _, id := range []string{"community", "records", "storage"} {
		if c := find(t, r.Manifests(), id); !c.Enabled || !c.Healthy {
			t.Fatalf("已声明的能力应为启用且健康（同值）: %+v", c)
		}
	}
}

// 清单是声明式的：enabled 只看部署配置，不看上游当时是否可达。
// 上游挂掉时目录不该跟着把它标成不可用——那属于网关/运维面读 /health 的判断。
func TestDeclarationIsIndependentOfUpstreamState(t *testing.T) {
	env := map[string]string{"STORAGE_URL": "http://storage:8082"}
	r := New(func(k string) string { return env[k] })
	before := find(t, r.Manifests(), "storage")
	delete(env, "STORAGE_URL") // 同实例重新构造：只有声明变化才会改变结果
	after := find(t, New(func(k string) string { return env[k] }).Manifests(), "storage")
	if !before.Enabled || !before.Healthy {
		t.Fatalf("声明在场时应为启用: %+v", before)
	}
	if after.Enabled || after.Healthy {
		t.Fatalf("声明撤掉后应为未启用: %+v", after)
	}
}

// community 与 records 各有自己的声明变量：不再共用一个 ENV 决定两个能力。
func TestRecordsHasItsOwnSwitch(t *testing.T) {
	env := map[string]string{"COMMUNITY_URL": "http://community:8083"}
	r := New(func(k string) string { return env[k] })
	if c := find(t, r.Manifests(), "community"); !c.Enabled {
		t.Fatalf("声明了 community 就应启用: %+v", c)
	}
	if c := find(t, r.Manifests(), "records"); c.Enabled {
		t.Fatalf("只声明 community 时 records 不应跟着启用: %+v", c)
	}
	env["RECORDS_URL"] = "http://community:8083"
	r = New(func(k string) string { return env[k] })
	if c := find(t, r.Manifests(), "records"); !c.Enabled {
		t.Fatalf("声明了 records 就应启用: %+v", c)
	}
	// 反向：只声明 records 时 community 不启用。
	delete(env, "COMMUNITY_URL")
	r = New(func(k string) string { return env[k] })
	if c := find(t, r.Manifests(), "community"); c.Enabled {
		t.Fatalf("没声明 community 就不应启用: %+v", c)
	}
}

// id 集合与顺序是前端契约：CatalogProvider 与 /admin 子系统面板按 id 判断。
func TestManifestIDSetIsStable(t *testing.T) {
	r := New(func(string) string { return "" })
	ids := make([]string, 0, 4)
	for _, c := range r.Manifests() {
		ids = append(ids, c.ID)
	}
	if got := strings.Join(ids, " "); got != "exchange community records storage" {
		t.Fatalf("能力 id 集合或顺序漂移: %q", got)
	}
}
